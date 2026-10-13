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

/** The daemon's state in one word — the single derivation the status bar's `daemon:` readout
 *  and the page's caption both read, so the two never disagree. `stopped` is enabled in
 *  .settings but the machine process is not running. `working` counts a running cron OR an
 *  inbox page mid-run. */
export type DaemonState = 'off' | 'stopped' | 'idle' | 'working'

export function daemonState(i: {
    enabled: boolean
    running: boolean
    cronsRunning: number
    inboxWorking: boolean
}): DaemonState {
    if (!i.enabled) return 'off'
    if (!i.running) return 'stopped'
    return i.cronsRunning > 0 || i.inboxWorking ? 'working' : 'idle'
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
    inboxWorking = false,
): string {
    const running = snap.crons.filter(c => c.running)
    const state = daemonState({
        enabled,
        running: snap.daemon.running,
        cronsRunning: running.length,
        inboxWorking,
    })
    if (state === 'off') return 'asleep // daemon is off'
    if (state === 'stopped' || mood === 'asleep')
        return 'asleep // daemon not running'
    if (state === 'working') {
        if (running.length === 0) return 'working // inbox page'
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
    const age = relTimeMs(last.at, nowMs)
    return `watching // last: ${last.name} ${age}`
}

/** The view bar's ONE trailing readout: the face's status alone. An empty status yields no
 *  readout at all rather than an empty label. */
export function barReadouts(status: string): string[] {
    return status ? [status] : []
}
