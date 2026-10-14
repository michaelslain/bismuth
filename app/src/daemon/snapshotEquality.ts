// app/src/daemon/snapshotEquality.ts
// Pure structural equality + identity sharing for polled daemon data. A poll that returns the
// same data must not write a signal (it would re-run every effect that reads it), and a poll that
// changes one row must not replace the others (lists keyed by object identity would rebuild them).
import type { DaemonSnapshot } from '../../../core/src/daemonGraph'

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
    }
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every(
        k =>
            Object.prototype.hasOwnProperty.call(b, k) &&
            deepEqual(
                (a as Record<string, unknown>)[k],
                (b as Record<string, unknown>)[k],
            ),
    )
}

export function sameSnapshot(a: DaemonSnapshot, b: DaemonSnapshot): boolean {
    return deepEqual(a, b)
}

/** `next` with every element equal to one in `prev` swapped for that prev element; `prev` itself
 *  when nothing differs. */
export function reuseEqual<T>(prev: T[], next: T[]): T[] {
    if (deepEqual(prev, next)) return prev
    const pool = [...prev]
    return next.map(n => {
        const i = pool.findIndex(p => deepEqual(p, n))
        if (i < 0) return n
        return pool.splice(i, 1)[0]
    })
}

/** `prev` when equal; else `next` with unchanged cron/process rows keeping their prev identity. */
export function shareSnapshot(
    prev: DaemonSnapshot,
    next: DaemonSnapshot,
): DaemonSnapshot {
    if (sameSnapshot(prev, next)) return prev
    return {
        ...next,
        crons: reuseEqual(prev.crons, next.crons),
        processes: reuseEqual(prev.processes, next.processes),
    }
}
