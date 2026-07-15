// core/src/gcal/sync.ts
// Phase 2: TWO-WAY sync (Google ⇄ Bismuth) with last-write-wins. One pass:
//   A. Pull — reconcile every remote event into the base (create / update / delete-local).
//   B. Push — insert new local events, patch locally-changed ones (If-Match → 412 handling).
//   C. Delete — events removed locally (gone from the base but still linked) are deleted on Google.
// Change detection is timestamp-free where possible: a per-event content SIGNATURE in the
// non-vault manifest flags local edits; the remote `updated` time flags remote edits. Only a
// genuine conflict (both changed) consults the policy — lastWriteWins compares the row's
// `localUpdated` stamp against the remote `updated`. Recurring + cancelled-with-no-link events
// are skipped (recurrence is Phase 3). The base file stays clean; all sync state is external.
import { randomUUID } from "node:crypto";
import { readNote, writeNote } from "../files";
import { parseFrontmatter } from "../frontmatter";
import { parseBaseFile } from "../bases/parse";
import { reassemble } from "../bases/rowOps";
import { categoryColorId } from "./colors";
import { placeholderFile, type Row } from "../bases/types";
import {
  listEvents,
  insertEvent,
  patchEvent,
  getEvent,
  deleteEvent,
  PreconditionFailed,
  SyncTokenExpired,
  DuplicateId,
  type GEvent,
  type ListResult,
} from "./client";
import { fromGoogle, buildNote, eventFieldsOf, signature, toGoogle, googleEventId } from "./map";

/** Extended-property key under which we stamp each Google event with its Bismuth row id, so
 *  links can be rebuilt from Google alone if the manifest is ever lost. */
const BID_PROP = "bismuthId";
const readBid = (ev: GEvent): string | undefined => ev.extendedProperties?.private?.[BID_PROP];
/** Attach the bismuthId stamp to an outgoing event body (insert/patch). */
function stamped(body: Record<string, unknown>, bid: string): Record<string, unknown> {
  return { ...body, extendedProperties: { private: { [BID_PROP]: bid } } };
}
import { readManifest, writeManifest, baseSyncOf, type SyncManifest, type BaseSync } from "./manifest";

export type ConflictPolicy = "lastWriteWins" | "googleWins" | "bismuthWins";

export interface SyncResult {
  total: number; // remote events returned
  pulledNew: number; // remote events created locally
  pulledUpdate: number; // remote changes applied locally
  pushedNew: number; // local events inserted to Google
  pushedUpdate: number; // local changes patched to Google
  deletedLocal: number; // remote deletions removed locally
  deletedRemote: number; // local deletions removed on Google
  conflicts: number; // both sides changed (resolved per policy)
  skipped: number; // recurring / unmappable remote events
  failed: number; // per-event push/delete errors that were skipped (sync still completes)
  relinked: number; // events re-matched to a local row via their bismuthId stamp (self-heal)
}

export interface SyncOpts {
  vault: string;
  basePath: string;
  calendarId: string;
  accessToken: string;
  policy: ConflictPolicy;
  timeZone: string;
  theme?: string; // active Bismuth theme (resolves the `accent` category color)
  manifestHome?: string; // overrides the manifest dir (tests); prod → ~/.bismuth
}

const DAY_MS = 86_400_000;

/** Build a category-name → Google colorId map from the base file's `categories` frontmatter. */
function categoryColorMap(text: string, theme?: string): Record<string, string> {
  const cats = parseFrontmatter(text).data.categories; // reuse the canonical FM parser (tolerates malformed YAML)
  const out: Record<string, string> = {};
  for (const c of Array.isArray(cats) ? cats : []) {
    const cc = c as { name?: unknown; color?: unknown };
    if (cc && cc.name && cc.color) {
      const id = categoryColorId(String(cc.color), theme);
      if (id) out[String(cc.name)] = id;
    }
  }
  return out;
}

function sigOfNote(note: Record<string, unknown>): string {
  return signature(eventFieldsOf(note));
}
function localUpdatedOf(note: Record<string, unknown>): string {
  return note.localUpdated == null ? "" : String(note.localUpdated);
}

/**
 * Update the synced fields of a row note from a remote event. Writes ALL fields the
 * signature covers (incl. recurrence) so the stored sig recomputed via sigOfNote matches —
 * otherwise the unwritten field (e.g. recurrence) is mis-detected as a local edit and
 * re-pushed, reverting the remote change. `category` is intentionally preserved: Google
 * carries no Bismuth category, so a pull must not blank it.
 */
function applyRemoteToNote(note: Record<string, unknown>, ev: GEvent): void {
  const mapped = fromGoogle(ev);
  if (!mapped) return;
  note.title = mapped.title;
  note.date = mapped.date;
  note.startTime = mapped.startTime;
  note.endTime = mapped.endTime;
  note.location = mapped.location;
  note.description = mapped.description;
  note.recurrence = mapped.recurrence ? JSON.stringify(mapped.recurrence) : undefined;
  note.localUpdated = ev.updated; // mark as synced state, not a fresh local edit
}

/** Conflict winner. lastWriteWins compares ISO timestamps (UTC strings sort chronologically). */
function resolveConflict(policy: ConflictPolicy, localUpdated: string, remoteUpdated: string): "local" | "remote" {
  if (policy === "googleWins") return "remote";
  if (policy === "bismuthWins") return "local";
  if (!localUpdated) return "local"; // no local timestamp → keep local rather than silently discard it
  return localUpdated > remoteUpdated ? "local" : "remote";
}

export async function syncEvents(opts: SyncOpts): Promise<SyncResult> {
  const { vault, basePath, calendarId, accessToken, policy, timeZone, theme, manifestHome } = opts;
  const text = await readNote(vault, basePath); // throws if the base file is missing
  const meta = { name: basePath.split("/").pop() ?? basePath, path: basePath };
  const { rows, config } = parseBaseFile(text, meta);
  const colorMap = categoryColorMap(text, theme); // category name → Google colorId (for pushed events)
  const manifest: SyncManifest = readManifest(manifestHome);
  // PER-CALENDAR: this base's own sync state (link map + token + target). Keying by base path
  // means two synced calendars never share links — no cross-base retarget guard needed.
  const bs: BaseSync = baseSyncOf(manifest, basePath);

  // If this base was pointed at a DIFFERENT Google calendar than last time, its old links +
  // sync token belong to the old calendar — drop them and full-resync against the new target.
  // (The old calendar's events are left untouched; Phase C's deletes are idempotent 404/410s.)
  if (bs.calendarId && bs.calendarId !== calendarId) {
    bs.links = {};
    delete bs.syncToken;
  }
  bs.calendarId = calendarId;

  const byBid = new Map<string, Row>();
  rows.forEach((r) => { if (r.note.id != null) byBid.set(String(r.note.id), r); });

  // Incremental when we have a sync token (changed/deleted events only); otherwise a full
  // sync within a window. A 410 means the token expired → drop it and do a full resync.
  const now = Date.now();
  const fullWindow = { timeMin: new Date(now - 90 * DAY_MS).toISOString(), timeMax: new Date(now + 365 * DAY_MS).toISOString(), showDeleted: true };
  let listed: ListResult;
  if (bs.syncToken) {
    try {
      listed = await listEvents(accessToken, calendarId, { syncToken: bs.syncToken });
    } catch (e) {
      if (!(e instanceof SyncTokenExpired)) throw e;
      delete bs.syncToken;
      listed = await listEvents(accessToken, calendarId, fullWindow);
    }
  } else {
    listed = await listEvents(accessToken, calendarId, fullWindow);
  }
  const events = listed.items;

  const res: SyncResult = {
    total: events.length, pulledNew: 0, pulledUpdate: 0, pushedNew: 0, pushedUpdate: 0,
    deletedLocal: 0, deletedRemote: 0, conflicts: 0, skipped: 0, failed: 0, relinked: 0,
  };
  const deleteBids = new Set<string>();
  const newRows: Row[] = [];
  const toStamp: Array<{ gcalId: string; bid: string }> = []; // pulled events to tag with their bismuthId
  const baseFile = rows[0]?.file ?? placeholderFile(meta.name, meta.path);

  // ---- Phase A: reconcile remote → local ----
  for (const ev of events) {
    let link = bs.links[ev.id];
    if (ev.status === "cancelled") {
      if (link) {
        if (byBid.has(link.bismuthId)) { deleteBids.add(link.bismuthId); res.deletedLocal++; }
        delete bs.links[ev.id];
      }
      continue;
    }
    const mapped = fromGoogle(ev);
    if (!mapped) { res.skipped++; continue; }
    // SELF-HEAL: an unlinked Google event that still carries a bismuthId for an existing local
    // row is a recovered link (manifest lost / crashed mid-sync) — re-attach it rather than
    // pull it back as a duplicate. Re-link at the current state; later edits reconcile normally.
    if (!link) {
      const bid = readBid(ev);
      if (bid && byBid.has(bid)) {
        link = { bismuthId: bid, etag: ev.etag, updated: ev.updated, sig: sigOfNote(byBid.get(bid)!.note) };
        bs.links[ev.id] = link;
        res.relinked++;
        continue;
      }
    }
    if (!link) {
      const bid = randomUUID();
      const row: Row = { file: baseFile, note: buildNote(bid, mapped, ev.updated), formula: {} };
      newRows.push(row);
      byBid.set(bid, row);
      bs.links[ev.id] = { bismuthId: bid, etag: ev.etag, updated: ev.updated, sig: signature(mapped) };
      toStamp.push({ gcalId: ev.id, bid }); // tag the remote event so the self-heal can re-link it
      res.pulledNew++;
      continue;
    }
    const row = byBid.get(link.bismuthId);
    if (!row) continue; // local row deleted → Phase C
    const remoteChanged = ev.updated !== link.updated;
    const localChanged = sigOfNote(row.note) !== link.sig;
    if (remoteChanged && localChanged) {
      res.conflicts++;
      const winner = resolveConflict(policy, localUpdatedOf(row.note), ev.updated ?? "");
      if (winner === "remote") {
        applyRemoteToNote(row.note, ev);
        // sig from the WRITTEN note (not `mapped`) so the next sync's sigOfNote matches and
        // doesn't mis-read a preserved category / applied recurrence as a fresh local edit.
        bs.links[ev.id] = { bismuthId: link.bismuthId, etag: ev.etag, updated: ev.updated, sig: sigOfNote(row.note) };
        res.pulledUpdate++;
      } else {
        // Local wins → keep the row; refresh the etag/updated so Phase B patches cleanly
        // (no 412), but keep the OLD sig so Phase B still recognizes the pending local edit.
        bs.links[ev.id] = { bismuthId: link.bismuthId, etag: ev.etag, updated: ev.updated, sig: link.sig };
      }
    } else if (remoteChanged) {
      applyRemoteToNote(row.note, ev);
      bs.links[ev.id] = { bismuthId: link.bismuthId, etag: ev.etag, updated: ev.updated, sig: sigOfNote(row.note) };
      res.pulledUpdate++;
    }
    // else: only-local or no change → Phase B decides whether to push.
  }

  // ---- Phase B: push local → remote ----
  const bidToEntry = new Map<string, { gcalId: string; etag?: string; sig?: string }>();
  for (const [gcalId, link] of Object.entries(bs.links)) {
    bidToEntry.set(link.bismuthId, { gcalId, etag: link.etag, sig: link.sig });
  }
  for (const row of rows) {
    const bid = String(row.note.id ?? "");
    if (!bid || deleteBids.has(bid)) continue;
    const fields = eventFieldsOf(row.note);
    const entry = bidToEntry.get(bid);
    // One malformed event (bad recurrence, rejected by Google, etc.) must NOT abort the
    // whole batch — count it and move on. The base file + remaining events still sync.
    try {
      if (!entry) {
        // Insert with a deterministic id + bismuthId stamp. If the event already exists on
        // Google (lost link / crash), Google returns 409 → re-link instead of duplicating.
        try {
          const ev = await insertEvent(accessToken, calendarId, stamped(toGoogle(fields, timeZone, colorMap), bid), googleEventId(bid));
          bs.links[ev.id] = { bismuthId: bid, etag: ev.etag, updated: ev.updated, sig: signature(fields) };
          res.pushedNew++;
        } catch (e) {
          if (!(e instanceof DuplicateId)) throw e;
          const gid = googleEventId(bid);
          const ev = await getEvent(accessToken, calendarId, gid);
          bs.links[gid] = { bismuthId: bid, etag: ev.etag, updated: ev.updated, sig: sigOfNote(row.note) };
          res.relinked++;
        }
        continue;
      }
      if (sigOfNote(row.note) === entry.sig) continue; // unchanged (or already pulled-over)
      try {
        const ev = await patchEvent(accessToken, calendarId, entry.gcalId, stamped(toGoogle(fields, timeZone, colorMap), bid), entry.etag);
        bs.links[entry.gcalId] = { bismuthId: bid, etag: ev.etag, updated: ev.updated, sig: signature(fields) };
        res.pushedUpdate++;
      } catch (e) {
        if (!(e instanceof PreconditionFailed)) throw e;
        // Remote moved under us → re-read and resolve.
        res.conflicts++;
        const fresh = await getEvent(accessToken, calendarId, entry.gcalId);
        const winner = resolveConflict(policy, localUpdatedOf(row.note), fresh.updated ?? "");
        if (winner === "local") {
          const ev = await patchEvent(accessToken, calendarId, entry.gcalId, stamped(toGoogle(fields, timeZone, colorMap), bid), fresh.etag);
          bs.links[entry.gcalId] = { bismuthId: bid, etag: ev.etag, updated: ev.updated, sig: signature(fields) };
          res.pushedUpdate++;
        } else {
          applyRemoteToNote(row.note, fresh);
          bs.links[entry.gcalId] = {
            bismuthId: bid, etag: fresh.etag, updated: fresh.updated, sig: sigOfNote(row.note),
          };
          res.pulledUpdate++;
        }
      }
    } catch (e) {
      res.failed++;
      console.error(`[gcal] push failed for event ${bid}: ${(e as Error).message}`);
    }
  }

  // ---- Phase C: local deletions → remote ----
  const currentBids = new Set<string>();
  for (const row of rows) if (!deleteBids.has(String(row.note.id ?? ""))) currentBids.add(String(row.note.id ?? ""));
  for (const row of newRows) currentBids.add(String(row.note.id ?? ""));
  for (const [gcalId, link] of Object.entries(bs.links)) {
    if (currentBids.has(link.bismuthId)) continue;
    try {
      await deleteEvent(accessToken, calendarId, gcalId, link.etag);
      delete bs.links[gcalId];
      res.deletedRemote++;
    } catch (e) {
      // Precondition failure → remote changed; leave it for the next sync. Any other error
      // → count + continue (one bad delete must not abort the batch).
      if (!(e instanceof PreconditionFailed)) {
        res.failed++;
        console.error(`[gcal] delete failed for ${gcalId}: ${(e as Error).message}`);
      }
    }
  }

  // ---- Stamp pulled events so the manifest-loss self-heal can re-link them too ----
  // (Only Bismuth-PUSHED events are stamped on insert; without this, a Google-created event
  // would be re-duplicated after a lost manifest.) Best effort — a failure only weakens the
  // self-heal for that event, no correctness loss.
  for (const { gcalId, bid } of toStamp) {
    const link = bs.links[gcalId];
    if (!link) continue;
    try {
      const ev = await patchEvent(accessToken, calendarId, gcalId, { extendedProperties: { private: { [BID_PROP]: bid } } }, link.etag);
      link.etag = ev.etag;
      link.updated = ev.updated; // keep current so this stamp-patch isn't re-read as a remote edit
    } catch { /* leave unstamped */ }
  }

  // ---- Persist ----
  // Only rewrite the base file when rows actually changed. An idle sync (the steady state)
  // must NOT rewrite a byte-identical file — that would trip the vault watcher (SSE re-render +
  // git churn) every interval and widen the window to clobber a concurrent in-app edit.
  // pulledUpdate counts every applyRemoteToNote, so it covers all in-place row mutations.
  if (newRows.length || deleteBids.size || res.pulledUpdate) {
    const finalRows = rows.filter((r) => !deleteBids.has(String(r.note.id ?? ""))).concat(newRows);
    await writeNote(vault, basePath, reassemble(text, finalRows, config));
  }
  if (listed.nextSyncToken) bs.syncToken = listed.nextSyncToken; // enable next incremental sync
  bs.lastSyncAt = new Date().toISOString();
  writeManifest(manifest, manifestHome);
  return res;
}
