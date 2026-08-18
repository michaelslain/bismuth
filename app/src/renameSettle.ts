// app/src/renameSettle.ts
// "Where did this freshly-created row FINALLY land?" — a tiny promise registry keyed by the path
// a file was CREATED at.
//
// A new note is created under a placeholder name ("Untitled.md") and dropped straight into the
// file tree's inline rename, so its create-time path is almost never the path it keeps. Anything
// that must bind to the kept path — the new-note template's {{title}}, its {{cursor}} offset, the
// primed note-cache body (core/src/newNoteTemplate.ts) — parks a waiter here and lets the inline
// rename report back once it is over: committed (after `api.move` has landed, so a follow-up
// write can't race the move), reverted, escaped, or simply unmounted.
//
// Deliberately dumb: one shot per key, unknown keys ignored (an ordinary rename of a pre-existing
// file reports into the void), and a waiter that is never reported simply never resolves — the
// caller is a fire-and-forget async, so a dangling promise costs one closure and nothing else.
// Pure + headless so the ordering contract is unit-testable instead of browser-only.

export interface RenameSettleRegistry {
    /** Register a waiter for `createPath` and return its final-path promise. Registration is
     *  SYNCHRONOUS, so it is safe to call immediately before handing the row to inline rename —
     *  a fast Enter can report before the create round-trip even resolves. */
    waitFor(createPath: string): Promise<string>
    /** Report where `createPath` came to rest. No-op for an unknown/already-reported key. */
    report(createPath: string, finalPath: string): void
    /** Drop a waiter without resolving it (e.g. the create itself failed — there is no file to
     *  template). Returns true if a waiter was actually pending. */
    cancel(createPath: string): boolean
    /** Waiters still outstanding — for assertions/debugging. */
    readonly size: number
}

export function createRenameSettleRegistry(): RenameSettleRegistry {
    const waiters = new Map<string, (finalPath: string) => void>()
    return {
        waitFor(createPath: string): Promise<string> {
            return new Promise<string>(resolve =>
                waiters.set(createPath, resolve),
            )
        },
        report(createPath: string, finalPath: string): void {
            const resolve = waiters.get(createPath)
            if (!resolve) return
            waiters.delete(createPath) // one shot: a later blur/cleanup report is ignored
            resolve(finalPath)
        },
        cancel(createPath: string): boolean {
            return waiters.delete(createPath)
        },
        get size() {
            return waiters.size
        },
    }
}
