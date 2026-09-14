// app/src/daemon/daemonPageModel.ts
// Pure derivations behind the daemon page (DaemonPage.tsx / DaemonPageHost.tsx): the face's status
// line, whether a cron failed recently enough to hurt, and the view bar's count readouts. No Solid
// imports — the host owns the polling and feeds these the snapshot it last fetched.
import type { DaemonCron, DaemonSnapshot } from '../../../core/src/daemonGraph'
import type { DaemonMood } from './daemonFaceModel'
import { relTimeMs } from '../relTime'

/** How long a failed cron keeps the face `hurt`. */
export const RECENT_FAILURE_MS = 30 * 60 * 1000

/** Any ENABLED cron whose last run failed within RECENT_FAILURE_MS of `nowMs`. A disabled cron's
 *  old failure is history the user already acted on, so it never hurts. */
export function hasRecentFailure(crons: DaemonCron[], nowMs: number): boolean {
    return crons.some(c => {
        if (!c.enabled || c.lastFired?.result !== 'failed') return false
        const at = Date.parse(c.lastFired.timestamp)
        return !Number.isNaN(at) && at >= nowMs - RECENT_FAILURE_MS
    })
}

/** The one status line under the face, `//` separated. */
export function faceCaption(
    snap: DaemonSnapshot,
    mood: DaemonMood,
    nowMs: number,
): string {
    if (mood === 'asleep' || !snap.daemon.running)
        return 'asleep // daemon is off'
    const running = snap.crons.filter(c => c.running)
    if (running.length > 0) {
        const more = running.length > 1 ? ` +${running.length - 1}` : ''
        return `working // ${running[0].name}${more}`
    }
    let last: { name: string; at: number } | null = null
    for (const c of snap.crons) {
        if (!c.lastFired) continue
        const at = Date.parse(c.lastFired.timestamp)
        if (Number.isNaN(at)) continue
        if (!last || at > last.at) last = { name: c.name, at }
    }
    if (!last) return 'watching // nothing has run yet'
    // relTimeMs measures against the wall clock; shift the timestamp so the age is taken from
    // `nowMs` instead, which keeps this deterministic under test.
    const age = relTimeMs(Date.now() - (nowMs - last.at))
    return `watching // last: ${last.name} ${age}`
}

function count(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`
}

/** The view bar's readouts: cron + service counts always, the inbox only when something is due. */
export function barReadouts(snap: DaemonSnapshot, inboxDue: number): string[] {
    const out = [
        count(snap.crons.length, 'cron', 'crons'),
        count(snap.processes.length, 'service', 'services'),
    ]
    if (inboxDue > 0) out.push(`${inboxDue} in inbox`)
    return out
}
