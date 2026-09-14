// core/src/selfWriteMarks.ts
//
// The self-write suppression map, extracted out of server.ts into a pure module (injectable
// clock/config) so its expiry semantics are unit-testable without a real fs.watch or debounce
// timer — see selfWriteMarks.test.ts.
//
// Why a MARK isn't enough on its own: the server records a path as self-written BEFORE it
// writes (see mark()), because the OS watcher could otherwise notice the write before the mark
// exists. That mark has to expire eventually — the watcher's echo might never arrive at all
// (missed event, path never actually touched) — so the map can't grow without bound waiting for
// an echo that isn't coming. The bug this module fixes: the ORIGINAL expiry was fixed at MARK
// time (before the write) + the debounce, so a write slower than the debounce — a big vault
// rename, a slow disk — let its own echo through as a second, spurious change. rearm() fixes
// this by resetting the expiry to a fresh window measured from when the write actually
// RESOLVED, using the larger of the debounce and a fixed grace period (SELF_WRITE_GRACE_MS in
// server.ts) so a write that takes barely longer than the debounce still gets real headroom.
export interface SelfWriteMarksOptions {
    now: () => number
    debounceMs: () => number
    graceMs: number
}

export interface SelfWriteMarks {
    /** Record paths about to be written, before the write happens — expiry is a backstop
     *  (now + debounce) for the case where the echo never arrives at all. */
    mark(paths: string[]): void
    /** Re-arm paths whose write just resolved, extending the expiry to now + max(debounce,
     *  grace) — covers a write slower than the debounce that would otherwise have already
     *  expired by the time the watcher notices it. */
    rearm(paths: string[]): void
    /** True (and consumes the entry) iff `path` was marked and hasn't expired. Deletes on read
     *  regardless of outcome, so a single echo is swallowed at most once. */
    consume(path: string): boolean
    /** Undo mark() for a write that never actually happened (threw, or the route resolved with
     *  an error status) — otherwise the path stays armed with nothing on disk to ever produce
     *  the echo that would consume it, silently swallowing the NEXT genuine external write. */
    unmark(paths: string[]): void
}

export function createSelfWriteMarks(
    opts: SelfWriteMarksOptions,
): SelfWriteMarks {
    const until = new Map<string, number>()

    function setExpiry(paths: string[], expiresAt: number): void {
        for (const p of paths) until.set(p, expiresAt)
    }

    return {
        mark(paths) {
            const now = opts.now()
            // Sweep anything already expired so the map can't grow without bound across a long
            // server lifetime full of writes whose echoes never arrived.
            for (const [p, expiresAt] of until) {
                if (expiresAt <= now) until.delete(p)
            }
            setExpiry(paths, now + opts.debounceMs())
        },
        rearm(paths) {
            setExpiry(
                paths,
                opts.now() + Math.max(opts.debounceMs(), opts.graceMs),
            )
        },
        consume(path) {
            const expiresAt = until.get(path)
            if (expiresAt === undefined) return false
            until.delete(path)
            return expiresAt > opts.now()
        },
        unmark(paths) {
            for (const p of paths) until.delete(p)
        },
    }
}
