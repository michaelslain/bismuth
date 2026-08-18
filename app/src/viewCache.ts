// Tiny stale-while-revalidate cache over localStorage. The sidebar tree and the graph are
// re-fetched from the server on every launch; persisting the last good response and
// painting it on the next boot makes both appear instantly while the fresh data loads.
// All access is guarded — localStorage can be absent (test/SSR) or throw (quota, private
// mode) — so a cache miss or write failure degrades to "no cache", never an error.
//
// localStorage is scoped by ORIGIN, not by window — every Bismuth window shares one
// instance of it (all windows load the same http://localhost:1420 / tauri://localhost
// origin, differing only in a `?api=` query param). A plain cache key is therefore shared
// across every open vault: opening a second vault via "Open folder" would seed its sidebar
// tree / graph from whatever vault a DIFFERENT window last cached. scopedKey() namespaces a
// key by the window's own resolved backend, so each vault gets its own cache slot.
export function scopedKey(key: string, apiBase: string): string {
    return `${key}::${apiBase}`
}

export function readCache<T>(key: string): T | undefined {
    try {
        if (typeof localStorage === 'undefined') return undefined
        const raw = localStorage.getItem(key)
        return raw === null ? undefined : (JSON.parse(raw) as T)
    } catch {
        return undefined
    }
}

export function writeCache(key: string, value: unknown): void {
    try {
        if (typeof localStorage === 'undefined') return
        localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // unavailable or over quota — skip caching; the app works without it
    }
}
