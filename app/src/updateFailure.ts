// The toast a failed self-update leaves, and the one recovery it offers. Pure of JSX and of
// updateCheck.ts (which polls at import time): the pipeline that re-runs the update is injected, so
// a headless test can drive the whole flow.
import type { UpdatePhase, UpdateProgress } from '../../core/src/selfUpdate'
import { pushToast } from './ui/toastStore'

export type UpdateOutcome = {
    result: 'relaunching' | 'up-to-date' | 'error' | 'cancelled'
    message?: string
    /** The error stopped the update because the clone and origin/main diverged. */
    diverged?: boolean
}

export type UpdateFailureDeps = {
    /** Re-run the update with `reset` (backup branch + reset to origin/main). It runs as the shared
     *  update run (updateRun.ts), whose toast reports progress and whose outcome toasts close it. */
    reapply: () => Promise<UpdateOutcome>
}

const ASK_TTL = 20_000

/** The toast text for an update phase; after a reset it names the branch holding the old commits. */
export function updatePhaseText(
    p: UpdatePhase | '',
    progress?: UpdateProgress,
): string {
    const kept = progress?.backupBranch
        ? ` (old commits on ${progress.backupBranch})`
        : ''
    return p === 'pulling'
        ? 'Pulling update…'
        : p === 'building'
          ? `Building update… (a few min)${kept}`
          : p === 'ready'
            ? 'Relaunching…'
            : p === 'cancelled'
              ? 'Update cancelled'
              : 'Updating…'
}

/**
 * `Update failed: <message>`. A diverged clone gets a `reset` action: it re-runs the
 * update with `reset`, which keeps the clone's own commits on a backup branch; the shared run's
 * toast reports its progress. Nothing resets without that click.
 */
export function showUpdateFailureWith(
    r: UpdateOutcome,
    deps: UpdateFailureDeps,
): void {
    const message = `Update failed: ${r.message ?? 'unknown error'}`
    if (!r.diverged) {
        pushToast(message, { tone: 'danger' })
        return
    }
    pushToast(message, {
        tone: 'danger',
        ttl: ASK_TTL,
        action: {
            label: 'reset',
            onClick: () => void deps.reapply(),
        },
    })
}
