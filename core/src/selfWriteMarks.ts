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
//
// Why an echo is matched by FILE STATE, not counted: one write does not reliably produce one watcher
// event. Under load FSEvents splits a single write into two deliveries ~50ms apart, so swallowing
// exactly one echo let the second through as a spurious change (a third SSE wave where the API
// published one). Counting any higher can't be right either — it would eat a genuine external edit.
// So once the write resolves, the path's on-disk stamp (mtime + size) is recorded, and any echo that
// finds the file still at that stamp is ours, however many arrive; an echo that finds it changed is
// someone else's, and ends suppression for that path.

export interface SelfWriteMarksOptions {
    now: () => number
    debounceMs: () => number
    graceMs: number
    /** The path's current on-disk stamp — any value that changes on every write (mtime + size);
     *  null when the path does not exist. */
    stampOf: (path: string) => string | null
}

export interface SelfWriteMarks {
    /** Record paths about to be written, before the write happens — expiry is a backstop
     *  (now + debounce) for the case where the echo never arrives at all. */
    mark(paths: string[]): void
    /** Re-arm paths whose write just resolved, extending the expiry to now + max(debounce,
     *  grace) and recording the stamp the write left behind. */
    rearm(paths: string[]): void
    /** True iff `path` is marked, unexpired, and the watcher event is our own write's echo: the
     *  write is still in flight, or the file is still exactly as the write left it. Keeps the mark
     *  for further echoes of that same write; drops it the moment the file is seen changed. */
    consume(path: string): boolean
    /** Undo mark() for a write that never actually happened (threw, or the route resolved with
     *  an error status) — otherwise the path stays armed with nothing on disk to ever produce
     *  the echo that would consume it, silently swallowing the NEXT genuine external write. */
    unmark(paths: string[]): void
}

type Mark = {
    expiresAt: number
    /** The write has resolved and `stamp` is what it left on disk. */
    resolved: boolean
    /** Stamp at the last echo swallowed (in flight) or at rearm (resolved); undefined = no echo yet. */
    stamp?: string | null
}

export function createSelfWriteMarks(
    opts: SelfWriteMarksOptions,
): SelfWriteMarks {
    const marks = new Map<string, Mark>()

    return {
        mark(paths) {
            const now = opts.now()
            // Sweep anything already expired so the map can't grow without bound across a long
            // server lifetime full of writes whose echoes never arrived.
            for (const [p, m] of marks) {
                if (m.expiresAt <= now) marks.delete(p)
            }
            for (const p of paths)
                marks.set(p, {
                    expiresAt: now + opts.debounceMs(),
                    resolved: false,
                })
        },
        rearm(paths) {
            const expiresAt =
                opts.now() + Math.max(opts.debounceMs(), opts.graceMs)
            for (const p of paths) {
                const m = marks.get(p)
                if (!m) continue
                const stamp = opts.stampOf(p)
                // A batch write (several notes in one request, e.g. POST /set-properties dragging
                // kanban cards) resolves as a whole, so a path whose echo was already swallowed can
                // sit here long after its own write finished. If the file has moved on since that
                // echo, the change can't be told apart from a genuine external edit — drop the mark
                // rather than adopt that state as ours, or the external edit would be swallowed.
                if (m.stamp !== undefined && m.stamp !== stamp) {
                    marks.delete(p)
                    continue
                }
                m.resolved = true
                m.stamp = stamp
                m.expiresAt = expiresAt
            }
        },
        consume(path) {
            const m = marks.get(path)
            if (!m) return false
            if (m.expiresAt <= opts.now()) {
                marks.delete(path)
                return false
            }
            const stamp = opts.stampOf(path)
            if (!m.resolved) {
                // Still being written: every echo is ours, and the latest stamp is what rearm checks.
                m.stamp = stamp
                return true
            }
            if (stamp === m.stamp) return true
            marks.delete(path)
            return false
        },
        unmark(paths) {
            for (const p of paths) marks.delete(p)
        },
    }
}
