// app/src/preview/pdfDocCacheCore.ts
// The PURE, refcounted LRU factory behind pdfDocCache.ts's session-wide PDF document cache.
// No pdf.js, no DOM, no `serverVersion` import — this module is what pdfDocCache.test.ts
// exercises directly under Bun, so it must never pull in the api/transport stack.
//
// REFCOUNT + LRU, TOGETHER: a document can be both "cached" (present, eligible for LRU
// eviction) and "retained" (a live PdfPages instance holds it, via `acquire`/`put`'s
// `release`). Retained entries are NEVER evicted by capacity pressure (rule 3) — eviction
// only ever removes entries with a zero refcount, oldest first. `invalidate`/`remove` work
// the same way from the other direction: they take an entry out of the map immediately (so
// a fresh `acquire` misses) but defer the actual `destroy()` until nothing retains it any
// more, in case a caller is mid-render against the stale doc.
export type CachedPdf<D> = {
    doc: D
    destroy: () => void
}

export type PdfDocCache<D> = {
    /** A live entry for `key` (retained — call the returned release exactly once), or
     *  undefined on a miss. */
    acquire: (
        key: string,
    ) => { value: CachedPdf<D>; release: () => void } | undefined
    /** Insert a freshly-loaded document, retained by the caller; returns its release. */
    put: (key: string, value: CachedPdf<D>) => () => void
    /** The file changed: new acquires miss; the old entry is destroyed once nothing
     *  retains it. */
    invalidate: (key: string) => void
    invalidateAll: () => void
    rename: (from: string, to: string) => void
    /** Deleted: same as invalidate. */
    remove: (key: string) => void
}

type Entry<D> = {
    value: CachedPdf<D>
    refCount: number
    // false once invalidate/remove/rename-away/put-over has taken this key out of the live
    // map — the object survives only so its (possibly still-retained) handles can still
    // release it, at which point it is destroyed.
    live: boolean
}

export function createPdfDocCache<D>(opts: { max: number }): PdfDocCache<D> {
    const max = opts.max
    // Map iteration order doubles as LRU recency: an entry is deleted + re-set on every
    // acquire hit (and on insert), which moves it to the "most recently used" end — the
    // same trick noteCache.ts uses. Eviction walks from the front (least recently used).
    const entries = new Map<string, Entry<D>>()

    function touch(key: string, entry: Entry<D>) {
        entries.delete(key)
        entries.set(key, entry)
    }

    /** Evict unretained entries, oldest first, until back at/under capacity. A run of
     *  retained entries can leave the cache over capacity — that's rule 3: retained
     *  entries are never evicted by LRU pressure alone. */
    function evictExcess() {
        if (entries.size <= max) return
        for (const [key, entry] of entries) {
            if (entries.size <= max) break
            if (entry.refCount > 0) continue
            entries.delete(key)
            entry.live = false
            entry.value.destroy()
        }
    }

    function makeRelease(entry: Entry<D>) {
        let released = false
        return () => {
            if (released || entry.refCount <= 0) return
            released = true
            entry.refCount--
            if (entry.refCount > 0) return
            if (!entry.live) entry.value.destroy()
            else evictExcess()
        }
    }

    /** Takes `key`'s current entry (if any) out of the live map and destroys it once
     *  nothing retains it — immediately if it's already unretained. */
    function evictKey(key: string) {
        const entry = entries.get(key)
        if (!entry) return
        entries.delete(key)
        entry.live = false
        if (entry.refCount <= 0) entry.value.destroy()
    }

    return {
        acquire(key) {
            const entry = entries.get(key)
            if (!entry || !entry.live) return undefined
            entry.refCount++
            touch(key, entry)
            return { value: entry.value, release: makeRelease(entry) }
        },
        put(key, value) {
            evictKey(key) // a reload over an existing key follows the invalidate rules
            const entry: Entry<D> = { value, refCount: 1, live: true }
            entries.set(key, entry)
            evictExcess()
            return makeRelease(entry)
        },
        invalidate(key) {
            evictKey(key)
        },
        invalidateAll() {
            for (const key of [...entries.keys()]) evictKey(key)
        },
        rename(from, to) {
            const entry = entries.get(from)
            if (!entry || !entry.live) return
            entries.delete(from)
            if (to !== from) evictKey(to) // an entry already at `to` follows invalidate rules
            entries.set(to, entry)
        },
        remove(key) {
            evictKey(key)
        },
    }
}
