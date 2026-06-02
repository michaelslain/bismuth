// Tiny stale-while-revalidate cache over localStorage. The sidebar tree and the graph are
// re-fetched from the server on every launch; persisting the last good response and
// painting it on the next boot makes both appear instantly while the fresh data loads.
// All access is guarded — localStorage can be absent (test/SSR) or throw (quota, private
// mode) — so a cache miss or write failure degrades to "no cache", never an error.

export function readCache<T>(key: string): T | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // unavailable or over quota — skip caching; the app works without it
  }
}
