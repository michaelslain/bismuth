// app/src/daemon/cronStatus.ts
// Pure derivation of a cron row's status key, extracted from DaemonServices.tsx so the
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
