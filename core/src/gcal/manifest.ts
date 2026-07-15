// core/src/gcal/manifest.ts
// Sync bookkeeping kept OUTSIDE the vault: per calendar base, the map from a Google event
// id → the local Bismuth row id (plus the last-seen etag/updated for conflict handling).
// Storing this here — rather than as columns on the event rows — keeps the calendar base
// file clean and survives the frontend's calendar serializer, which only re-emits known
// event fields and would otherwise drop any extra sync columns on the next in-app edit.
//
// PER-CALENDAR: the manifest is keyed by base path, so a vault with several synced
// calendars keeps a SEPARATE link map + sync token + calendar target per base — two
// calendars can never clobber each other's links (which the old single-base manifest's
// retarget-guard papered over by wiping links whenever the bound base changed).
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";

export interface SyncLink {
  bismuthId: string;
  etag?: string;
  updated?: string; // remote `updated` at last sync (remote-change detection)
  sig?: string; // content signature at last sync (local-change detection)
}

/** The sync state for ONE calendar base ↔ ONE Google calendar. */
export interface BaseSync {
  lastSyncAt?: string;
  syncToken?: string; // Google incremental-sync token (absent → next sync is a full sync)
  calendarId?: string; // the Google calendar this base was last reconciled against — if it
  // changes (the base was pointed at a different Google calendar), links + token are dropped.
  links: Record<string, SyncLink>; // keyed by Google event id
}

export interface SyncManifest {
  bases: Record<string, BaseSync>; // keyed by the calendar base's vault path
}

export function gcalDir(home = homedir()): string {
  return join(home, ".bismuth", "gcal");
}
function manifestPath(home?: string): string {
  return join(gcalDir(home), "sync.json");
}

/**
 * Read the sync manifest; returns an empty one if absent or unreadable (never throws).
 * MIGRATES the old single-base shape ({ links, basePath, syncToken, lastSyncAt }) into the
 * per-base map ({ bases: { [basePath]: { links, syncToken, lastSyncAt } } }) so an existing
 * vault keeps its links + incremental token across the upgrade.
 */
export function readManifest(home?: string): SyncManifest {
  try {
    const obj = JSON.parse(readFileSync(manifestPath(home), "utf8")) as Record<string, unknown>;
    if (obj && typeof obj === "object") {
      if (obj.bases && typeof obj.bases === "object") return { bases: obj.bases as Record<string, BaseSync> };
      // Legacy single-base manifest → nest it under its bound base path.
      if (obj.links && typeof obj.links === "object") {
        const basePath = typeof obj.basePath === "string" ? obj.basePath : "";
        const entry: BaseSync = {
          links: obj.links as Record<string, SyncLink>,
          syncToken: typeof obj.syncToken === "string" ? obj.syncToken : undefined,
          lastSyncAt: typeof obj.lastSyncAt === "string" ? obj.lastSyncAt : undefined,
        };
        return { bases: basePath ? { [basePath]: entry } : {} };
      }
    }
  } catch {
    /* fall through to empty */
  }
  return { bases: {} };
}

/** The BaseSync entry for one base, creating an empty one if it doesn't exist yet. */
export function baseSyncOf(m: SyncManifest, basePath: string): BaseSync {
  let bs = m.bases[basePath];
  if (!bs) {
    bs = { links: {} };
    m.bases[basePath] = bs;
  }
  return bs;
}

/** Persist the manifest (creating the dir 0700, file 0600). */
export function writeManifest(m: SyncManifest, home?: string): void {
  mkdirSync(gcalDir(home), { recursive: true, mode: 0o700 });
  const path = manifestPath(home);
  writeFileSync(path, JSON.stringify(m, null, 2), { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
}

/** Delete the whole manifest (on disconnect). Never throws. */
export function clearManifest(home?: string): void {
  try {
    if (existsSync(manifestPath(home))) rmSync(manifestPath(home));
  } catch {
    /* ignore */
  }
}
