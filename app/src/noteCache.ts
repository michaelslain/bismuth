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
import { onServerChange } from "./serverVersion";
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

// Evict on every server change. A named `paths` change drops exactly those bodies, so
// a change to A never throws away B's cached body. An EMPTY `paths` means an unknown
// extent — but we only clear-all when the version actually ADVANCED past what we've
// already seen (a genuine /version poll catch-up after the SSE stream silently dropped
// an event we can't identify). Routine no-op polls and re-delivered versions leave the
// warm LRU intact (the reopen-speed win, B13); a true catch-up still evicts a stale
// closed-but-cached body that was edited on disk during the SSE outage.
let lastVersion = 0;
onServerChange((c) => {
  if (c.paths.length > 0) {
    for (const p of c.paths) cache.delete(p);
  } else if (c.version > lastVersion) {
    cache.clear();
  }
  if (c.version > lastVersion) lastVersion = c.version;
});

// Re-key the cached body across a rename/move so the renamed note stays an
// instant cache hit instead of refetching (or briefly painting empty). The
// title-rename + tree-rename flows dispatch `bismuth-moved {from,to}` BEFORE awaiting
// api.move, so by the time the editor remounts at `to` the body is already here.
if (typeof window !== "undefined") {
  window.addEventListener("bismuth-moved", (e) => {
    const { from, to } = (e as CustomEvent).detail as { from: string; to: string };
    const body = cache.get(from);
    if (body !== undefined) {
      cache.delete(from);
      setEntry(to, body);
    }
  });
}

/**
 * Read a note body, served synchronously from cache on a hit (so createResource
 * resolves with no pending/spinner tick). On a miss, fetch and always cache it.
 *
 * We intentionally do NOT skip caching when the server version advanced
 * mid-fetch: per-path eviction (above) already drops bodies whose path actually
 * changed, so a successful read is always safe to warm. The old version-guard
 * refused to cache during ANY unrelated version churn, leaving the LRU cold and
 * forcing repeated refetches; the open buffer's freshness is reconciled
 * independently by Editor.tsx's SSE handler, not by this cache.
 * Returns a bare string on a hit, a Promise on a miss.
 */
export function readNoteCached(path: string): string | Promise<string> {
  const hit = cache.get(path);
  if (hit !== undefined) {
    setEntry(path, hit); // mark most-recently-used
    return hit;
  }
  return api.read(path).then((text) => {
    setEntry(path, text);
    return text;
  });
}

/** Synchronous peek at the cached body without fetching — undefined if absent. Lets a
 *  component paint instantly from cache on (re)mount instead of flashing a spinner. */
export function peekNoteCache(path: string): string | undefined {
  return cache.get(path);
}

/**
 * Seed the cache with known-current content so the next reopen is an instant hit.
 * Called by the Editor after it reads fresh on an external change (SSE reconcile)
 * and after a save — the moments we hold the canonical on-disk text.
 */
export function primeNoteCache(path: string, text: string): void {
  setEntry(path, text);
}
