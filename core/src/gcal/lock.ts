// core/src/gcal/lock.ts
// A cross-process advisory lock so two backends (e.g. the dev server + the bundled app) can
// never run a Google Calendar sync against the shared manifest at the same time —
// interleaved syncs could otherwise strand links or double-insert. Held only for one sync;
// a stale lock (crashed process / older than STALE_MS) is reclaimed.
import { openSync, closeSync, writeFileSync, unlinkSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { gcalDir } from "./manifest";

// Reclaim a lock only if it's older than this — generous so a legitimately slow sync
// (large calendar / retries / throttling) is never stolen out from under itself.
const STALE_MS = 15 * 60 * 1000;

function lockPath(home?: string): string {
  return join(gcalDir(home), "sync.lock");
}

/** Thrown when another process currently holds the sync lock. */
export class SyncLocked extends Error {
  constructor() {
    super("a Google Calendar sync is already in progress");
    this.name = "SyncLocked";
  }
}

/** Run `fn` while holding the exclusive sync lock; throws SyncLocked if another process holds it. */
export async function withSyncLock<T>(fn: () => Promise<T>, home?: string): Promise<T> {
  mkdirSync(gcalDir(home), { recursive: true, mode: 0o700 });
  const path = lockPath(home);
  let fd: number | undefined;
  try {
    fd = openSync(path, "wx"); // O_CREAT | O_EXCL — atomic acquire
  } catch {
    // Exists — reclaim only if stale, otherwise refuse.
    let stale = true;
    try { stale = Date.now() - statSync(path).mtimeMs > STALE_MS; } catch { stale = true; }
    if (!stale) throw new SyncLocked();
    try { unlinkSync(path); } catch { /* raced */ }
    try { fd = openSync(path, "wx"); } catch { throw new SyncLocked(); }
  }
  try {
    writeFileSync(fd, `${process.pid} ${new Date().toISOString()}`);
  } catch { /* best effort */ }
  try {
    return await fn();
  } finally {
    try { if (fd !== undefined) closeSync(fd); } catch { /* */ }
    try { unlinkSync(path); } catch { /* */ }
  }
}
