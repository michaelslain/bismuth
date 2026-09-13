// app/src/oneShotPathChannel.ts
// Generic "stash a value for a path, consume it once" channel — the shape shared by
// pendingCursor.ts and pendingAnchor.ts: a Map<string, T> keyed by vault path, a `set` that
// stashes a value BEFORE the thing it's for exists (an editor view not yet created), a `take`
// that reads-then-deletes so the value fires exactly once (an unrelated later rebuild doesn't
// re-hijack the caret/scroll), and a `clear` that forgets without consuming (a create/open that
// never completed). Factored out so both call sites share one implementation instead of two
// hand-rolled copies of the same three functions.

export interface OneShotPathChannel<T> {
    /** Record a value for the next time `path`'s target is (re)created. */
    set(path: string, value: T): void
    /** Read AND clear a path's pending value (one-shot). undefined when none is pending. */
    take(path: string): T | undefined
    /** Forget a path's pending value without consuming it. */
    clear(path: string): void
}

/** A fresh, independent one-shot channel keyed by vault path. */
export function createOneShotPathChannel<T>(): OneShotPathChannel<T> {
    const byPath = new Map<string, T>()
    return {
        set(path, value) {
            byPath.set(path, value)
        },
        take(path) {
            const v = byPath.get(path)
            if (v !== undefined) byPath.delete(path)
            return v
        },
        clear(path) {
            byPath.delete(path)
        },
    }
}
