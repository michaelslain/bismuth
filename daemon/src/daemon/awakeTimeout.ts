/**
 * A session timeout measured in AWAKE time, not wall time.
 *
 * A single `setTimeout(budget)` keeps its wall-clock deadline across a system suspend: a laptop that
 * sleeps mid-run wakes past the deadline and the timer fires at once, killing a session that did a
 * few seconds of work. This polls instead, adding each tick's elapsed time to an awake counter, and
 * counts a gap much longer than the tick as a suspend (zero awake time).
 */

export type AwakeTimeoutOptions = {
    /** Poll period. */
    tickMs?: number
    /** Clock, injectable for tests. */
    now?: () => number
    /** Scheduler pair, injectable so tests can drive ticks by hand. */
    setInterval?: (fn: () => void, ms: number) => unknown
    clearInterval?: (handle: unknown) => void
}

/** A tick gap above `tickMs + SUSPEND_SLACK_MS` is a suspend and adds nothing to the counter. */
export const SUSPEND_SLACK_MS = 30_000

/** Calls `onExpire` once after `budgetMs` of awake time; returns a function that stops it. */
export function startAwakeTimeout(
    budgetMs: number,
    onExpire: () => void,
    opts: AwakeTimeoutOptions = {},
): () => void {
    const tickMs = opts.tickMs ?? 5_000
    const now = opts.now ?? Date.now
    const every =
        opts.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms))
    const cancel =
        opts.clearInterval ??
        ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>))

    let awake = 0
    let last = now()
    let done = false
    const handle = every(() => {
        if (done) return
        const t = now()
        const delta = t - last
        last = t
        if (delta > 0 && delta <= tickMs + SUSPEND_SLACK_MS) awake += delta
        if (awake >= budgetMs) {
            done = true
            cancel(handle)
            onExpire()
        }
    }, tickMs)

    return () => {
        if (done) return
        done = true
        cancel(handle)
    }
}
