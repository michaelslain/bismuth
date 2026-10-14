// app/src/updateCheck.ts
// Auto-checks whether the installed (source-built) app is behind origin/main. The sidecar
// may still be starting when the webview loads, so we retry the first check quickly until
// it answers, then settle into a periodic poll. Exposes a signal the UpdateBanner reads.
// The backend's GET /update/status does the git fetch; it self-disables (available:false)
// in dev / non-source builds, so this is a harmless no-op there.
import { createSignal } from 'solid-js'
import { api } from './api'
import { settings } from './settings'
import { showUpdateFailureWith } from './updateFailure'
export { updatePhaseText } from './updateFailure'
import { createUpdateRun, type StartOptions } from './updateRun'
import type { UpdateStatus } from '../../core/src/selfUpdate'

const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus | null>(null)
export { updateStatus }

/** The one shared run (updateRun.ts) behind the banner, the update and cancel commands,
 *  auto-update and the diverged-clone reset. */
const shared = createUpdateRun({
    apply: opts => api.applyUpdate(opts),
    progress: () => api.updateProgress(),
    cancel: () => api.cancelUpdate(),
    quit: async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('quit_app') // the detached relauncher swaps the .app + reopens
    },
    recheck: () => recheckUpdate(),
    showFailure: r =>
        showUpdateFailureWith(r, {
            reapply: () => shared.start({ reset: true }),
        }),
    wait: ms => new Promise(r => setTimeout(r, ms)),
})

/** The run in flight (phase, progress, cancelling), or null. The banner renders from it. */
export const updateRun = shared.run

/**
 * Apply the pending update: pull, rebuild, and on `ready` quit so the relauncher swaps the bundle.
 * Joins the run already in flight instead of starting a second. Progress, cancel and the outcome
 * toasts are the shared run's; resolves with the outcome.
 */
export function applyUpdateAndRelaunch(opts: StartOptions = {}) {
    return shared.start(opts)
}

export const cancelUpdate = shared.cancel
export const showUpdateToast = shared.showToast

// Opt-in (settings.update.autoUpdate): when an update is available, apply it in the
// background and relaunch when the rebuild is ready — no banner click. A no-op in dev
// (the backend reports available:false), and only runs once per session.
let autoStarted = false
async function maybeAutoUpdate(): Promise<void> {
    if (autoStarted) return
    if (!updateStatus()?.available) return
    if (!settings.update?.autoUpdate) return
    autoStarted = true
    const r = await applyUpdateAndRelaunch({ quiet: true })
    // A diverged clone needs the owner's click (its toast asks once), and a cancel is the owner
    // saying no: neither retries this session. Anything else lets a later check retry.
    if (r.result === 'error' && !r.diverged) autoStarted = false
    else if (r.result === 'up-to-date') autoStarted = false
}

const PERIODIC_MS = 5 * 60 * 1000 // re-check every 5 min once the backend is reachable
const BOOT_RETRY_MS = 4000 // retry the first check this often until the sidecar answers
const BOOT_MAX_TRIES = 60 // ~4 min of boot retries before falling back to the periodic poll

/** One status check. Returns false when the backend isn't reachable yet (don't surface). Also
 *  adopts a run this window did not start (the CLI's, or one that outlived a reload). */
async function check(): Promise<boolean> {
    try {
        setUpdateStatus(await api.updateStatus())
        if (!updateRun())
            shared.adopt(
                await api.updateProgress().catch(() => ({ phase: 'idle' as const })),
            )
        void maybeAutoUpdate()
        return true
    } catch {
        return false
    }
}

/** Re-check immediately (e.g. after an update no-ops, to refresh the banner). */
export function recheckUpdate(): void {
    void check()
}

let started = false
export function startUpdateChecks(): void {
    if (started) return
    started = true

    let periodic: ReturnType<typeof setInterval> | null = null
    const beginPeriodic = () => {
        if (!periodic) periodic = setInterval(() => void check(), PERIODIC_MS)
    }

    // Retry quickly until the (possibly still-starting) sidecar answers, then go periodic.
    let tries = 0
    const boot = setInterval(async () => {
        tries++
        if ((await check()) || tries >= BOOT_MAX_TRIES) {
            clearInterval(boot)
            beginPeriodic()
        }
    }, BOOT_RETRY_MS)

    // Immediate first attempt — covers the common case where the sidecar is already up.
    void check().then(ok => {
        if (ok) {
            clearInterval(boot)
            beginPeriodic()
        }
    })
}

startUpdateChecks()
