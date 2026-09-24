// app/src/daemon/cronStatus.ts
// Pure derivation of a cron row's status key, extracted from DaemonCrons.tsx so the
// failed/killed unification (failedResult.ts) is unit-testable without mounting Solid. No Solid
// imports — see cronStatus.test.ts.
import type { DaemonCron } from '../../../core/src/daemonGraph'
import { isFailedResult } from './failedResult'

export type CronStatusKey = 'running' | 'failed' | 'idle' | 'disabled'

export function cronStatus(cron: DaemonCron): CronStatusKey {
    if (!cron.enabled) return 'disabled'
    if (cron.running) return 'running'
    if (isFailedResult(cron.lastFired?.result)) return 'failed'
    return 'idle'
}

export default cronStatus

/** The row's dot/tone, moved from DaemonCrons.tsx's `toneFor`. A cron whose `running` flag is
 *  stale — set while the daemon PROCESS itself is down — can't really be live, so it falls back
 *  to what it last actually did: `failed` if that run failed (or was killed), `ok` if it
 *  succeeded, `idle` if it never fired at all. Without this a cron that fired once, then outlived
 *  a daemon restart with a stale `running: true`, reported `never` forever instead of its last
 *  real result. */
export type CronTone = 'off' | 'running' | 'failed' | 'ok' | 'idle'

export function cronTone(cron: DaemonCron, daemonRunning: boolean): CronTone {
    const key = cronStatus(cron)
    if (key === 'disabled') return 'off'
    if (key === 'failed') return 'failed'
    if (key === 'running') {
        if (daemonRunning) return 'running'
        if (!cron.lastFired) return 'idle'
        return isFailedResult(cron.lastFired.result) ? 'failed' : 'ok'
    }
    return cron.lastFired ? 'ok' : 'idle'
}
