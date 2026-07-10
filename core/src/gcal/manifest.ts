// core/src/gcal/manifest.ts
// Sync bookkeeping kept OUTSIDE the vault: the map from a Google event id → the local
// Bismuth row id (plus the last-seen etag/updated for future conflict handling). Storing
// this here — rather than as columns on the event rows — keeps the calendar base file
// clean and survives the frontend's calendar serializer, which only re-emits known event
// fields and would otherwise drop any extra sync columns on the next in-app edit.
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";

export interface SyncLink {
  bismuthId: string;
  etag?: string;
  updated?: string; // remote `updated` at last sync (remote-change detection)
  sig?: string; // content signature at last sync (local-change detection)
}
export interface SyncManifest {
  lastSyncAt?: string;
  syncToken?: string; // Google incremental-sync token (absent → next sync is a full sync)
  basePath?: string; // the base file this manifest is bound to — guards against reconciling
  // (and mass-deleting) one calendar's events against a different base after a retarget.
  links: Record<string, SyncLink>; // keyed by Google event id
}

export function gcalDir(home = homedir()): string {
  return join(home, ".bismuth", "gcal");
}
function manifestPath(home?: string): string {
  return join(gcalDir(home), "sync.json");
}

/** Read the sync manifest; returns an empty one if absent or unreadable (never throws). */
export function readManifest(home?: string): SyncManifest {
  try {
    const obj = JSON.parse(readFileSync(manifestPath(home), "utf8"));
    if (obj && typeof obj === "object" && obj.links) return obj as SyncManifest;
  } catch {
    /* fall through to empty */
  }
  return { links: {} };
}

/** Persist the manifest (creating the dir 0700, file 0600). */
export function writeManifest(m: SyncManifest, home?: string): void {
  mkdirSync(gcalDir(home), { recursive: true, mode: 0o700 });
  const path = manifestPath(home);
  writeFileSync(path, JSON.stringify(m, null, 2), { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
}

/** Delete the manifest (on disconnect). Never throws. */
export function clearManifest(home?: string): void {
  try {
    if (existsSync(manifestPath(home))) rmSync(manifestPath(home));
  } catch {
    /* ignore */
  }
}
