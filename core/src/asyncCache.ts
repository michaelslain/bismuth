// A small async value cache with four guarantees the bare `let cached = null`
// pattern lacked:
//   1. In-flight dedupe — concurrent get() calls while the value is being built share
//      ONE build instead of each kicking off their own. The cold /graph build is
//      seconds of CPU; running two at once is a disaster.
//   2. Invalidation safety — if invalidate() runs while a build is in flight, that
//      build's result is dropped instead of repopulating a now-stale cache. A
//      generation counter, captured when the build starts and checked when it
//      settles, enforces this.
//   3. Cancellation — every build receives an AbortSignal, and invalidate() aborts the
//      signal of every build it made stale (running or still queued). A build that
//      honours it stops early instead of finishing work nobody will read, and a queued
//      build that was aborted before its turn is never invoked at all.
//   4. warm() — kick the build off the critical path (e.g. on server boot) so the
//      first real request finds the value ready, or already in flight (and deduped).

export interface AsyncCache<T> {
    /** Cached value if fresh, else build it — deduping concurrent builds. */
    get(): Promise<T>
    /** The cached value without building; null when empty or invalidated. */
    peek(): T | null
    /**
     * Drop the cached value and abort every build this makes stale. A build in flight
     * when this runs won't repopulate it; its callers resolve with the next fresh build.
     */
    invalidate(): void
    /** Fire-and-forget get(), swallowing errors — for boot warming. */
    warm(): void
    /**
     * Apply an in-place mutation to the cached value IF one is present, returning
     * whether it ran. A no-op when the cache is empty or a build is in flight — the
     * caller should fall back to invalidate() so the next get() rebuilds fresh (a
     * half-built value can't be patched). Lets a caller splice a few changed entries
     * into a large cached collection instead of dropping and rebuilding the whole
     * thing (e.g. the bases rows feed after a single-note edit).
     */
    patch(mutate: (value: T) => void): boolean
}

const isAbortError = (err: unknown): boolean =>
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'AbortError'

/**
 * `build` receives an AbortSignal that invalidate() aborts once the build is stale. A
 * zero-argument build still type-checks (and simply runs to completion, as before).
 */
export function createAsyncCache<T>(
    build: (signal: AbortSignal) => Promise<T>,
): AsyncCache<T> {
    let cached: T | null = null
    // Tracked separately from `cached !== null` so a value of T that is itself null/undefined
    // still counts as "present" (this is a generic cache; the graph/tree callers never store null).
    let hasValue = false
    // The build whose result is still valid to serve. Cleared by invalidate(), so a caller
    // arriving after a mutation is never deduped onto a build that predates it.
    let inFlight: Promise<T> | null = null
    // Settles when the most recently STARTED build finishes; the next build chains off it so
    // rebuilds run one at a time instead of piling up. Never cleared by invalidate().
    let tail: Promise<void> = Promise.resolve()
    // Builds started (running or queued on `tail`) and not yet settled. At 0 nothing is running,
    // so a new build is invoked synchronously instead of a microtask later.
    let pending = 0
    // One controller per unsettled build. Every one of them predates the next invalidate(), so
    // that invalidate() aborts them all.
    const controllers = new Set<AbortController>()
    let generation = 0

    function get(): Promise<T> {
        if (hasValue) return Promise.resolve(cached as T)
        // Only share a build that is still known-current. invalidate() clears
        // `inFlight`, so this can never hand back a snapshot taken before the
        // mutation the caller is reading for.
        if (inFlight !== null) return inFlight
        return start()
    }

    function start(): Promise<T> {
        const gen = generation
        const controller = new AbortController()
        controllers.add(controller)
        const run = (): Promise<T> => {
            // Aborted while still queued: stale before it began, so never invoke it.
            if (controller.signal.aborted)
                return Promise.reject(controller.signal.reason)
            try {
                return Promise.resolve(build(controller.signal))
            } catch (err) {
                return Promise.reject(err) // a synchronous throw still settles as a rejection
            }
        }
        // Chain after whatever build is already executing rather than racing it. Because
        // invalidate() clears `inFlight`, each invalidation lets the next get() start a
        // fresh build — without this queue an invalidation storm (an agent rewriting notes
        // while the graph rebuilds) could have a dozen full graph builds, seconds of CPU
        // each, running at once. Serialized, at most one build RUNS and the rest wait (and
        // are aborted, so skipped, by the invalidations that made them stale); every other
        // caller dedupes onto `inFlight`. With nothing pending the build is invoked right
        // here, synchronously, so an invalidate() in the same tick reaches a build that is
        // really running. `tail` tracks the raw build only, so the stale-retry below (which
        // calls get()) can never wait on itself.
        const idle = pending === 0
        pending++
        const raw = idle ? run() : tail.then(run, run)
        const settle = () => {
            pending--
            controllers.delete(controller)
        }
        // Registered BEFORE the handlers below, so by the time a stale result retries via
        // get(), this build no longer counts as pending.
        tail = raw.then(settle, settle)
        const p: Promise<T> = raw.then(
            value => {
                // Only clear the slot if it is still OURS — after an invalidate a newer
                // build may already own `inFlight`, and nulling it would strand that one.
                if (inFlight === p) inFlight = null
                if (gen === generation) {
                    cached = value
                    hasValue = true
                    return value
                }
                // Invalidated mid-build: this value is stale by construction. Never hand
                // it to a caller (that is how a deleted folder kept rendering) — resolve
                // with the current state instead. Converges: each retry starts after the
                // invalidation that discarded the previous one.
                return get()
            },
            err => {
                if (inFlight === p) inFlight = null
                // An invalidated build that stopped on its abort is exactly a stale result:
                // retry against the current state. Any other failure — including an
                // AbortError the cache did not cause — reaches the caller.
                if (gen !== generation && isAbortError(err)) return get()
                throw err
            },
        )
        inFlight = p
        return p
    }

    return {
        get,
        peek: () => (hasValue ? (cached as T) : null),
        patch(mutate: (value: T) => void): boolean {
            // Only patch a fully-built value. If a build is in flight (or nothing is
            // cached) there is nothing coherent to mutate, so report false and let the
            // caller invalidate — the next get() then rebuilds from current state.
            if (!hasValue) return false
            mutate(cached as T)
            return true
        },
        invalidate() {
            cached = null
            hasValue = false
            generation++
            // Drop the in-flight build too, so the NEXT get() starts a fresh one rather
            // than being deduped onto a build that predates this invalidation. Without
            // this, applyDirty()'s invalidate-then-publish-SSE sequence handed the
            // client's immediate refetch a pre-mutation /tree or /graph, and since the
            // version had already been consumed no further refetch ever corrected it.
            inFlight = null
            // Every unsettled build predates this invalidation, so all of them are stale:
            // abort them. A build that ignores its signal still runs to completion, and its
            // generation check keeps it from repopulating the cache.
            for (const c of controllers) c.abort()
        },
        warm() {
            void get().catch(() => {})
        },
    }
}
