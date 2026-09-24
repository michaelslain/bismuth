// app/src/daemon/daemonAttention.ts
// Which daemon-page rows need the user's attention, and the stable "attention first" order the
// row-limited sections use so a limit never hides a problem. Pure — shared by the lists (which
// sort by it) and DaemonPageHost (which floors each section's row budget at its attention count).
import type { DaemonCron, DaemonProcess } from '../../../core/src/daemonGraph'
import { cronTone } from './cronStatus'

/** A cron whose last run failed (or was killed) — the same `failed` tone its row paints. */
export function cronNeedsAttention(cron: DaemonCron, daemonRunning: boolean): boolean {
    return cronTone(cron, daemonRunning) === 'failed'
}

/** An enabled service that is not live because the daemon process itself is down. Per-process
 *  liveness is not reported (see DaemonProcesses.tsx), so this is all-or-nothing by design. */
export function processNeedsAttention(process: DaemonProcess, daemonRunning: boolean): boolean {
    return process.enabled && !daemonRunning
}

/** `items` with every attention row first, each group keeping its original order. */
export function attentionFirst<T>(items: T[], needsAttention: (item: T) => boolean): T[] {
    const first: T[] = []
    const rest: T[] = []
    for (const item of items) (needsAttention(item) ? first : rest).push(item)
    return [...first, ...rest]
}
