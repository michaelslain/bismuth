// Client-side cache of note bodies, keyed by file path.
//
// Opening a note is a GET /file round-trip, and reopening the same note — a new
// tab, a split, a tab-switch that unmounts→remounts FileView — re-ran that fetch
// every time and (briefly) painted a spinner. This cache lets a reopen resolve
// INSTANTLY from the last-read body.
//
// Freshness is driven by the existing SSE stream (serverVersion.ts). Unlike the
// bases RowCache (which can only track a single monotonic version because a base's
// rows are resolved opaquely server-side), the note stream tells us exactly WHICH
// paths changed, so we evict precisely: a change to A never throws away B's cached
// body. An unknown extent (a poll catch-up with no paths) conservatively clears all.
//
// The Editor keeps the open file live via its own SSE reconcile; this cache only
// short-circuits the INITIAL read (FileView), so it never serves a stale open buffer.
import { onServerChange, serverVersion } from "./serverVersion";
import { api } from "./api";

// Bounded LRU so a long session over a large vault can't accumulate note bodies
// without limit: Map preserves insertion order, so re-inserting a key moves it to
// the most-recently-used end and we evict from the front on overflow. ~200 bodies
// is a few MB at typical note sizes.
const MAX_ENTRIES = 200;
const cache = new Map<string, string>();

/** Insert or refresh `path` as most-recently-used, evicting the oldest past the cap. */
function setEntry(path: string, text: string): void {
  cache.delete(path);
  cache.set(path, text);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

// Evict on every server change. With known paths, drop exactly those; with an
// unknown extent (empty paths — initial snapshot / fallback poll), clear all.
onServerChange((c) => {
  if (c.paths.length === 0) cache.clear();
  else for (const p of c.paths) cache.delete(p);
});

/**
 * Read a note body, served synchronously from cache on a hit (so createResource
 * resolves with no pending/spinner tick). On a miss, fetch and cache it — unless
 * the server version advanced mid-fetch, meaning a change may have touched this
 * path while we were reading, in which case we skip caching so the next read
 * refetches fresh. Returns a bare string on a hit, a Promise on a miss.
 */
export function readNoteCached(path: string): string | Promise<string> {
  const hit = cache.get(path);
  if (hit !== undefined) {
    setEntry(path, hit); // mark most-recently-used
    return hit;
  }
  const v = serverVersion();
  return api.read(path).then((text) => {
    if (serverVersion() === v) setEntry(path, text);
    return text;
  });
}

/**
 * Seed the cache with known-current content so the next reopen is an instant hit.
 * Called by the Editor after it reads fresh on an external change (SSE reconcile)
 * and after a save — the moments we hold the canonical on-disk text.
 */
export function primeNoteCache(path: string, text: string): void {
  setEntry(path, text);
}
