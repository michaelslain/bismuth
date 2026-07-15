// core/test/gcal/sync.test.ts
// Two-way sync (Phases 2–3) against an in-memory fake Google Calendar that supports
// etag/If-Match (412), and sync tokens (incremental + 410). Covers pull, push-insert,
// local-edit→patch, remote-edit→pull, remote-cancel→local-delete, local-delete→
// remote-delete, idempotency, an LWW conflict, incremental delta, and 410 recovery.
// The manifest home is passed explicitly so nothing touches ~/.bismuth.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncEvents } from "../../src/gcal/sync";
import { parseBaseFile } from "../../src/bases/parse";
import { reassemble } from "../../src/bases/rowOps";
import { readManifest, writeManifest } from "../../src/gcal/manifest";
import type { Row } from "../../src/bases/types";

const realFetch = globalThis.fetch;
let vault: string;
let home: string;
const TZ = "America/New_York";
const CAL_BASE = `---\ntype: base\nviews:\n  - type: calendar\ncategories: []\n---\n`;

const BASE_T = Date.parse("2026-06-23T00:00:00Z");
let tick = 0;
const nextUpdated = () => new Date(BASE_T + ++tick * 1000).toISOString();
const at = (sec: number) => new Date(BASE_T + sec * 1000).toISOString();

function emptyFile(): Row["file"] {
  return { name: "cal", basename: "cal", path: "cal.md", folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] };
}
function writeBase(notes: Array<Record<string, unknown>>) {
  const rows: Row[] = notes.map((note) => ({ file: emptyFile(), note, formula: {} }));
  writeFileSync(join(vault, "cal.md"), reassemble(CAL_BASE, rows));
}
function readRows(): Array<Record<string, unknown>> {
  return parseBaseFile(readFileSync(join(vault, "cal.md"), "utf8"), { name: "cal", path: "cal.md" }).rows.map((r) => r.note);
}

class FakeGoogle {
  events = new Map<string, any>();
  etagN = 1;
  version = 0;
  calls = { list: 0, get: 0, insert: 0, patch: 0, delete: 0 };
  lastListHadToken = false;
  seed(ev: Record<string, any>) {
    this.events.set(ev.id, { etag: `etag${this.etagN++}`, updated: nextUpdated(), status: "confirmed", ...ev, _v: ++this.version });
    return this.events.get(ev.id);
  }
  /** Simulate a server-side change to an existing event (bumps version + etag + updated). */
  touch(id: string, changes: Record<string, any>) {
    const cur = this.events.get(id);
    Object.assign(cur, changes, { etag: `etag${this.etagN++}`, updated: changes.updated ?? nextUpdated(), _v: ++this.version });
    return cur;
  }
  install() {
    globalThis.fetch = (async (input: any, init: any) => {
      const u = new URL(typeof input === "string" ? input : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers ?? {});
      const m = u.pathname.match(/\/calendars\/[^/]+\/events(?:\/([^/]+))?$/);
      const id = m && m[1] ? decodeURIComponent(m[1]) : undefined;
      const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
      if (method === "GET" && !id) {
        this.calls.list++;
        const syncToken = u.searchParams.get("syncToken");
        this.lastListHadToken = !!syncToken;
        if (syncToken === "STALE") return new Response("gone", { status: 410 });
        let evs = [...this.events.values()];
        if (syncToken) {
          const since = Number(syncToken.slice(1));
          evs = evs.filter((e) => e._v > since);
        }
        const items = evs.map(({ _v, ...e }) => e);
        return json({ items, nextSyncToken: `v${this.version}` });
      }
      if (method === "GET" && id) {
        this.calls.get++;
        const e = this.events.get(id);
        if (!e) return new Response("nf", { status: 404 });
        const { _v, ...out } = e;
        return json(out);
      }
      if (method === "POST" && !id) {
        this.calls.insert++;
        const body = JSON.parse(String(init.body));
        if (body.id && this.events.has(body.id)) return new Response("duplicate", { status: 409 });
        const newId = body.id ?? `srv-${this.events.size + 1}`;
        const ev = { ...body, id: newId, etag: `etag${this.etagN++}`, updated: nextUpdated(), status: "confirmed", _v: ++this.version };
        this.events.set(newId, ev);
        const { _v, ...out } = ev;
        return json(out);
      }
      if (method === "PATCH" && id) {
        this.calls.patch++;
        const cur = this.events.get(id);
        const ifMatch = headers.get("If-Match");
        if (ifMatch && cur && ifMatch !== cur.etag) return new Response("precondition", { status: 412 });
        const ev = { ...cur, ...JSON.parse(String(init.body)), id, etag: `etag${this.etagN++}`, updated: nextUpdated(), _v: ++this.version };
        this.events.set(id, ev);
        const { _v, ...out } = ev;
        return json(out);
      }
      if (method === "DELETE" && id) {
        this.calls.delete++;
        const cur = this.events.get(id);
        const ifMatch = headers.get("If-Match");
        if (ifMatch && cur && ifMatch !== cur.etag) return new Response("precondition", { status: 412 });
        this.events.delete(id);
        return new Response(null, { status: 204 });
      }
      return new Response("unhandled", { status: 500 });
    }) as unknown as typeof fetch;
  }
}

let g: FakeGoogle;
const runBase = (basePath: string, policy: "lastWriteWins" | "googleWins" | "bismuthWins" = "lastWriteWins") =>
  syncEvents({ vault, basePath, calendarId: "primary", accessToken: "tok", policy, timeZone: TZ, manifestHome: home });
const run = () => runBase("cal.md");

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "bismuth-vault-"));
  home = mkdtempSync(join(tmpdir(), "bismuth-home-"));
  writeFileSync(join(vault, "cal.md"), CAL_BASE);
  tick = 0;
  g = new FakeGoogle();
  g.install();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(vault, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("pull: remote events create local rows; no writes back to Google", async () => {
  g.seed({ id: "g-a", summary: "Alpha", start: { dateTime: "2026-06-24T09:00:00-04:00" }, end: { dateTime: "2026-06-24T10:00:00-04:00" } });
  g.seed({ id: "g-b", summary: "Beta", start: { date: "2026-07-04" }, end: { date: "2026-07-05" } });
  const r = await run();
  expect(r.pulledNew).toBe(2);
  expect(r.pushedNew + r.pushedUpdate).toBe(0);
  // No event content is created/changed/deleted on Google — but each pulled event IS patched
  // once to add its bismuthId stamp (so the manifest-loss self-heal can re-link it).
  expect(g.calls.insert + g.calls.delete).toBe(0);
  expect(g.calls.patch).toBe(2);
  expect(readRows().map((n) => n.title).sort()).toEqual(["Alpha", "Beta"]);
  // A sync token is captured for the next incremental sync (in the per-base manifest entry).
  expect(readManifest(home).bases["cal.md"].syncToken).toBeTruthy();
});

test("push: a new local event is inserted to Google", async () => {
  writeBase([{ id: "loc-1", title: "Local One", date: "2026-06-24", startTime: "14:00", endTime: "15:00", localUpdated: at(50) }]);
  const r = await run();
  expect(r.pushedNew).toBe(1);
  expect(g.calls.insert).toBe(1);
  const inserted = [...g.events.values()].find((e) => e.summary === "Local One");
  expect(inserted.start.dateTime).toBe("2026-06-24T14:00:00");
  expect(inserted.start.timeZone).toBe(TZ);
});

test("idempotent: a second sync (incremental, no changes) makes no Google writes", async () => {
  g.seed({ id: "g-a", summary: "Alpha", start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  await run();
  const before = { ...g.calls };
  const r = await run();
  expect(r).toMatchObject({ pulledNew: 0, pulledUpdate: 0, pushedNew: 0, pushedUpdate: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0 });
  expect(g.lastListHadToken).toBe(true); // used the incremental token
  expect(g.calls.insert).toBe(before.insert);
  expect(g.calls.patch).toBe(before.patch);
  expect(g.calls.delete).toBe(before.delete);
});

test("local edit → patched to Google", async () => {
  g.seed({ id: "g-a", summary: "Alpha", start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  await run();
  const patchesBefore = g.calls.patch; // the pull already stamped g-a once
  const rows = readRows();
  rows[0].title = "Alpha edited";
  rows[0].localUpdated = at(500);
  writeBase(rows);
  const r = await run();
  expect(r.pushedUpdate).toBe(1);
  expect(g.calls.patch - patchesBefore).toBe(1); // exactly one push-patch for the edit
  expect(g.events.get("g-a").summary).toBe("Alpha edited");
});

test("remote edit → pulled into the local row (via incremental delta)", async () => {
  g.seed({ id: "g-a", summary: "Alpha", start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  await run();
  g.touch("g-a", { summary: "Alpha moved", start: { date: "2026-06-26" }, end: { date: "2026-06-27" } });
  const r = await run();
  expect(r.pulledUpdate).toBe(1);
  const row = readRows()[0];
  expect(row.title).toBe("Alpha moved");
  expect(row.date).toBe("2026-06-26");
});

test("remote cancellation → local row removed", async () => {
  g.seed({ id: "g-a", summary: "Alpha", start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  await run();
  expect(readRows().length).toBe(1);
  g.touch("g-a", { status: "cancelled" });
  const r = await run();
  expect(r.deletedLocal).toBe(1);
  expect(readRows().length).toBe(0);
});

test("local deletion → event deleted on Google", async () => {
  g.seed({ id: "g-a", summary: "Alpha", start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  await run();
  writeBase([]); // user removed the event locally
  const r = await run();
  expect(r.deletedRemote).toBe(1);
  expect(g.calls.delete).toBe(1);
  expect(g.events.has("g-a")).toBe(false);
});

test("conflict (both changed), lastWriteWins: the newer side wins", async () => {
  g.seed({ id: "g-a", summary: "Alpha", start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  await run();
  // Remote edit at t=100s ...
  g.touch("g-a", { summary: "Remote wins?", updated: at(100) });
  // ... local edit at t=200s (newer) → local should win and be pushed.
  const rows = readRows();
  rows[0].title = "Local newer";
  rows[0].localUpdated = at(200);
  writeBase(rows);
  const r = await run();
  expect(r.conflicts).toBe(1);
  expect(g.events.get("g-a").summary).toBe("Local newer");
  expect(readRows()[0].title).toBe("Local newer");
});

test("recurring pull → local recurrence; idempotent despite local-only seriesId", async () => {
  g.seed({ id: "g-r", summary: "Weekly", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"], start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  const r1 = await run();
  expect(r1.pulledNew).toBe(1);
  const rec = JSON.parse(String(readRows()[0].recurrence));
  expect(rec.type).toBe("weekly");
  expect(rec.daysOfWeek).toEqual([3]);
  // Second sync must NOT spuriously re-push (seriesId is excluded from the signature).
  const patchesBefore = g.calls.patch; // run 1 stamped the pulled event once
  const r2 = await run();
  expect(r2.pushedUpdate).toBe(0);
  expect(g.calls.patch - patchesBefore).toBe(0); // no further patches on the idle re-sync
});

// ---- Regression tests for the code-review fixes ----

test("per-base isolation: syncing a DIFFERENT base never mass-deletes the first base's events", async () => {
  writeBase([{ id: "a1", title: "A", date: "2026-06-24", startTime: "09:00", localUpdated: at(10) }]);
  await run();
  expect(g.events.size).toBe(1);
  const idA = [...g.events.keys()][0];
  // The manifest now keeps a SEPARATE entry per base path (no single bound base).
  expect(Object.keys(readManifest(home).bases["cal.md"].links)).toHaveLength(1);

  // A second, empty base against the SAME (shared, in this fake) calendar must NOT treat
  // cal.md's events as local deletions of cal2.md — cal2.md has its own (empty) link map,
  // so Phase C walks only cal2.md's links (none) and deletes nothing.
  writeFileSync(join(vault, "cal2.md"), CAL_BASE);
  const r = await runBase("cal2.md");
  expect(r.deletedRemote).toBe(0);
  expect(g.events.has(idA)).toBe(true); // first base's event survives on Google
  // Both bases keep independent manifest entries; cal.md's link map is untouched.
  const m = readManifest(home);
  expect(Object.keys(m.bases["cal.md"].links)).toHaveLength(1);
  expect(m.bases["cal2.md"]).toBeDefined();
});

test("remote recurrence change is applied locally and not reverted/re-pushed", async () => {
  g.seed({ id: "g-r", summary: "Weekly", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"], start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  await run();
  g.touch("g-r", { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"] }); // remote edits the RRULE
  const r = await run();
  expect(r.pulledUpdate).toBe(1);
  expect(JSON.parse(String(readRows()[0].recurrence)).daysOfWeek).toEqual([1, 3]); // applied locally
  // The local recurrence now matches remote → it must NOT be re-pushed (which would revert it).
  const patchesBefore = g.calls.patch;
  const r2 = await run();
  expect(r2.pushedUpdate).toBe(0);
  expect(g.calls.patch - patchesBefore).toBe(0);
});

test("a categorized event isn't spuriously re-pushed after a remote edit", async () => {
  writeBase([{ id: "c1", title: "Cat", date: "2026-06-24", startTime: "09:00", category: "Work", localUpdated: at(10) }]);
  await run(); // insert
  const gid = [...g.events.keys()][0];
  g.touch(gid, { summary: "Cat remote" }); // remote edits the title only
  const r = await run();
  expect(r.pulledUpdate).toBe(1);
  expect(readRows()[0].category).toBe("Work"); // category preserved (Google carries none)
  // The stored signature must reflect the preserved category → no spurious re-push next sync.
  const patchesBefore = g.calls.patch;
  const r2 = await run();
  expect(r2.pushedUpdate).toBe(0);
  expect(g.calls.patch - patchesBefore).toBe(0);
});

test("lastWriteWins with no local timestamp keeps the local copy (no silent overwrite)", async () => {
  g.seed({ id: "g-a", summary: "Alpha", start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  await run();
  g.touch("g-a", { summary: "Remote", updated: at(900) }); // concurrent remote edit
  const rows = readRows();
  rows[0].title = "Local no stamp";
  delete rows[0].localUpdated; // an unstamped local edit (hand-edited .md)
  writeBase(rows);
  const r = await run();
  expect(r.conflicts).toBe(1);
  expect(readRows()[0].title).toBe("Local no stamp"); // local kept, not silently discarded
  expect(g.events.get("g-a").summary).toBe("Local no stamp"); // and pushed to Google
});

test("idle sync does not rewrite the base file (no churn / clobber window)", async () => {
  writeBase([{ id: "a1", title: "A", date: "2026-06-24", startTime: "09:00", localUpdated: at(10) }]);
  await run(); // push a1 — no local row change, so no file write
  const path = join(vault, "cal.md");
  const mtime1 = statSync(path).mtimeMs;
  await new Promise((r) => setTimeout(r, 8));
  const r = await run(); // idle incremental
  expect(r.pushedNew + r.pushedUpdate + r.pulledNew + r.pulledUpdate + r.deletedLocal).toBe(0);
  expect(statSync(path).mtimeMs).toBe(mtime1); // base file untouched
});

test("recurring push → a Google RRULE event with the first occurrence as start", async () => {
  writeBase([{ id: "loc-r", title: "Standup", date: "2026-06-24", startTime: "09:00", endTime: "09:15", localUpdated: at(50), recurrence: JSON.stringify({ type: "weekly", daysOfWeek: [1, 3, 5], startDate: "2026-06-24", seriesId: "s1" }) }]);
  const r = await run();
  expect(r.pushedNew).toBe(1);
  const ev = [...g.events.values()].find((e) => e.summary === "Standup");
  expect(ev.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]);
  expect(ev.start.dateTime).toBe("2026-06-24T09:00:00");
});

test("self-heal: a LOST manifest re-links instead of duplicating (safe re-seed)", async () => {
  writeBase([
    { id: "loc-1", title: "A", date: "2026-06-24", startTime: "09:00", endTime: "10:00", localUpdated: at(10) },
    { id: "loc-2", title: "B", date: "2026-06-25", startTime: "11:00", endTime: "12:00", localUpdated: at(10) },
  ]);
  const r1 = await run();
  expect(r1.pushedNew).toBe(2);
  expect(g.events.size).toBe(2);
  const idsAfterSeed = [...g.events.keys()].sort();

  // Simulate the link file being lost (e.g. after disconnect → reconnect).
  rmSync(join(home, ".bismuth", "gcal", "sync.json"), { force: true });

  const r2 = await run();
  expect(r2.pushedNew).toBe(0); // did NOT re-insert
  expect(r2.relinked).toBe(2); // re-linked both via their bismuthId stamp
  expect(g.events.size).toBe(2); // no duplicates created on Google
  expect([...g.events.keys()].sort()).toEqual(idsAfterSeed);
  expect(readRows().length).toBe(2); // no duplicate local rows pulled back
});

test("pushed events carry a bismuthId stamp + deterministic id", async () => {
  writeBase([{ id: "abc12-uuid-0000", title: "X", date: "2026-06-24", startTime: "09:00", localUpdated: at(10) }]);
  await run();
  const ev = [...g.events.values()][0];
  expect(ev.extendedProperties.private.bismuthId).toBe("abc12-uuid-0000");
  expect(ev.id).toBe("abc12uuid0000"); // hyphens stripped → base32hex-valid deterministic id
});

test("410 (expired token) → engine drops it and recovers with a full resync", async () => {
  g.seed({ id: "g-a", summary: "Alpha", start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  await run();
  // Force a stale token; the fake returns 410 for it.
  const m = readManifest(home);
  m.bases["cal.md"].syncToken = "STALE";
  writeManifest(m, home);
  g.touch("g-a", { summary: "Alpha after expiry" });
  const r = await run(); // must not throw; full resync reconciles the change
  expect(r.pulledUpdate).toBe(1);
  expect(readRows()[0].title).toBe("Alpha after expiry");
  expect(readManifest(home).bases["cal.md"].syncToken).not.toBe("STALE"); // re-baselined
});
