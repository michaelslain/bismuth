// app/src/daemon/daemonPageModel.ts
// Pure derivations behind the daemon page (DaemonPage.tsx / DaemonPageHost.tsx / DaemonHub.tsx):
// the face's status (the view bar's only trailing readout), and whether a cron failed recently
// enough to hurt. No Solid imports — the host owns the polling and feeds these whatever it last
// fetched.
import type { DaemonCron, DaemonSnapshot } from '../../../core/src/daemonGraph'
import type { DaemonMood } from './daemonFaceModel'
import { relTimeMs } from '../relTime'
import { isFailedResult } from './failedResult'

/** How long a failed cron keeps the face `hurt`. */
export const RECENT_FAILURE_MS = 30 * 60 * 1000

/** Any ENABLED cron whose last run failed (or was killed by a timeout — the daemon counts that
 *  the same way, see failedResult.ts) within RECENT_FAILURE_MS of `nowMs`. A disabled cron's old
 *  failure is history the user already acted on, so it never hurts. */
export function hasRecentFailure(crons: DaemonCron[], nowMs: number): boolean {
    return crons.some(c => {
        if (!c.enabled || !c.lastFired || !isFailedResult(c.lastFired.result))
            return false
        const at = Date.parse(c.lastFired.timestamp)
        return !Number.isNaN(at) && at >= nowMs - RECENT_FAILURE_MS
    })
}

/** The one status string, `//` separated — the view bar's (now only) readout. `enabled`
 *  disambiguates the two ways the face can be asleep: `daemon.enabled: false` in .settings (the
 *  user turned it off) vs enabled but the machine daemon process isn't actually running (not
 *  installed, crashed) — telling the user "off" when their own setting says "on" points them at
 *  the wrong fix. */
export function faceCaption(
    snap: DaemonSnapshot,
    mood: DaemonMood,
    nowMs: number,
    enabled: boolean,
): string {
    if (mood === 'asleep' || !snap.daemon.running)
        return enabled
            ? 'asleep // daemon not running'
            : 'asleep // daemon is off'
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

/** The view bar's ONE trailing readout: the face's status alone. An empty status yields no
 *  readout at all rather than an empty label. */
export function barReadouts(status: string): string[] {
    return status ? [status] : []
}
