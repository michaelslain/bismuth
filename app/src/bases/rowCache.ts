// Client-side stale-while-revalidate cache for resolved base rows.
//
// Resolving a base's rows is a server round-trip (`POST /rows`). Reopening the
// same base — a new tab, a split, an unmount→remount — re-ran that round-trip
// every time and painted a generic spinner until it returned. This cache lets a
// reopen paint INSTANTLY from the last resolved rows while a fresh resolve runs
// in the background (stale-while-revalidate).
//
// Freshness is driven by the existing SSE version (`serverVersion.ts`): an entry
// resolved at version V stays usable until the backend version advances (a vault
// change), at which point it's marked stale so the next read revalidates. The
// cached rows are still returned immediately so the pane never blanks — they're
// just refreshed in the background. No version bump = no /rows refetch on reopen.
//
// The cache value is opaque (typed by the caller) so this module stays decoupled
// from the BaseView's `Loaded`-shaped payload and is unit-testable in isolation.

type Entry<T> = { value: T; version: number; stale: boolean }

/** A small SWR cache keyed by string, freshness-tracked against a monotonically
 *  increasing server version. Pure aside from its internal Map — the loader and
 *  the version source are injected. */
export class RowCache<T> {
    private store = new Map<string, Entry<T>>()
    // The latest token `begin(key)` has issued per key — models core/src/asyncCache.ts's
    // `generation` counter, one level more granular (per-key instead of whole-cache). A `set()`
    // carrying an older token than this is a fetch that started before a newer one and settled
    // after it — exactly the race a fast SSE-driven revalidate wins against a slow initial
    // resolve — and must be dropped rather than clobbering the newer value.
    private tokens = new Map<string, number>()

    /** Return the cached value for `key` if present (even if stale), else undefined. */
    peek(key: string): T | undefined {
        return this.store.get(key)?.value
    }

    /** True when `key` has a non-stale entry resolved at the current `version`. */
    isFresh(key: string, version: number): boolean {
        const e = this.store.get(key)
        return !!e && !e.stale && e.version === version
    }

    /** Claim a token for `key` before starting an async fetch. Pass the returned token to the
     *  matching `set()` call so a fetch that settles after a NEWER one was begun (and possibly
     *  already landed) gets dropped instead of overwriting fresher data.
     *
     *  See `set()`'s doc for the known behaviour around an erroring fetch. */
    begin(key: string): number {
        const next = (this.tokens.get(key) ?? 0) + 1
        this.tokens.set(key, next)
        return next
    }

    /** Record a freshly resolved value at `version` (clears any stale flag). When `token` is
     *  given, the write is dropped — and `false` returned — unless it is still the LATEST token
     *  `begin(key)` issued for this key; an older fetch settling late must not overwrite a newer
     *  value nor mark the entry fresh. Callers that pass no token keep the previous unconditional
     *  behaviour (always writes, always returns true).
     *
     *  Known behaviour, paired with `begin()`'s note above: if the newer fetch ERRORS it never
     *  calls `set()`, so its token is still "latest" and an older fetch's `set()` keeps returning
     *  `false` — the cache is left stuck on its pre-race value (stale or absent) until the NEXT
     *  version bump (`invalidate()`) lets a fresh `begin()`/`set()` pair revalidate it. That gap
     *  is intentional, not a bug to route around here: self-healing on the next vault change beats
     *  guessing whether a caller's `set()` after failure means "recovered" or "landed stale". */
    set(key: string, value: T, version: number, token?: number): boolean {
        if (token !== undefined && this.tokens.get(key) !== token) return false
        this.store.set(key, { value, version, stale: false })
        return true
    }

    /** Mark every entry resolved before `version` stale — a vault change may have
     *  altered any base's rows (the spec is resolved server-side, so we can't tell
     *  which entries are affected; over-revalidating is safe, under-revalidating is
     *  not). Cached values are kept so reopens still paint instantly. */
    invalidate(version: number): void {
        for (const e of this.store.values()) {
            if (e.version < version) e.stale = true
        }
    }
}
