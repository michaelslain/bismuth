// The toast a failed self-update leaves, and the one recovery it offers. Pure of JSX and of
// updateCheck.ts (which polls at import time): the pipeline that re-runs the update is injected, so
// a headless test can drive the whole flow.
import type { UpdatePhase, UpdateProgress } from '../../core/src/selfUpdate'
import { dismissToast, pushToast, updateToast } from './ui/toastStore'

export type UpdateOutcome = {
    result: 'relaunching' | 'up-to-date' | 'error'
    message?: string
    /** The error stopped the update because the clone and origin/main diverged. */
    diverged?: boolean
}

export type UpdateFailureDeps = {
    /** Re-run the update with `reset` (backup branch + reset to origin/main), reporting phases. */
    reapply: (
        onPhase: (p: UpdatePhase | '', progress?: UpdateProgress) => void,
    ) => Promise<UpdateOutcome>
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
            : 'Updating…'
}

/**
 * `Update failed: <message>`. A diverged clone gets a `reset` action: it re-runs the
 * update with `reset`, which keeps the clone's own commits on a backup branch, and reports progress
 * in a toast of its own. Nothing resets without that click.
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
            onClick: () => void resetToUpstream(deps),
        },
    })
}

async function resetToUpstream(deps: UpdateFailureDeps): Promise<void> {
    const id = pushToast('Resetting to upstream…', undefined, 0)
    const r = await deps
        .reapply((p, progress) => updateToast(id, updatePhaseText(p, progress)))
        .catch(
            (e): UpdateOutcome => ({
                result: 'error',
                message: (e as Error).message,
            }),
        )
    if (r.result === 'relaunching') return
    dismissToast(id)
    if (r.result === 'error') showUpdateFailureWith(r, deps)
    else pushToast('Bismuth is already up to date')
}
