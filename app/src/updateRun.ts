// app/src/updateRun.ts
// The one self-update run the whole app shares. The UpdateBanner, the "Update Bismuth" and "Cancel
// Bismuth update" commands, opt-in auto-update and the diverged-clone reset all go through it, so
// they can never disagree: one poller, one progress toast (with its `cancel` action), one signal
// the banner reads. Starting while a run is in flight joins it; a run some other caller started
// (the CLI's `bismuth update apply`, or a run that outlived a webview reload) is adopted.
//
// Pure of JSX and of updateCheck.ts (which polls at import time): every effect is injected, so a
// headless test drives the whole lifecycle. updateCheck.ts wires the real instance.
import { createSignal, type Accessor } from 'solid-js'
import type { UpdatePhase, UpdateProgress } from '../../core/src/selfUpdate'
import { dismissToast, pushToast, toasts, updateToast } from './ui/toastStore'
import { updatePhaseText, type UpdateOutcome } from './updateFailure'

export type UpdateRunView = {
    phase: UpdatePhase
    progress: UpdateProgress
    /** Cancel was asked for; the backend is stopping the run. */
    cancelling: boolean
}

export type UpdateRunDeps = {
    apply: (opts: { reset?: boolean }) => Promise<UpdateProgress>
    progress: () => Promise<UpdateProgress>
    cancel: () => Promise<UpdateProgress>
    /** Quit the app so the detached relauncher swaps the bundle and reopens it. */
    quit: () => Promise<void>
    /** Refresh the update status (the banner's "N commits behind"). */
    recheck: () => void
    /** A failed run's toast (with the reset action for a diverged clone). */
    showFailure: (r: UpdateOutcome) => void
    wait: (ms: number) => Promise<void>
}

export type StartOptions = {
    /** Diverged clone: back up HEAD and reset to origin/main (the failure toast's `reset`). */
    reset?: boolean
    /** A background start (auto-update): no toast for an ordinary failure or for "up to date". */
    quiet?: boolean
    /** A toast the caller already shows (the command's "Checking…"): it becomes the progress toast. */
    toastId?: number
}

export type UpdateRun = {
    run: Accessor<UpdateRunView | null>
    start: (opts?: StartOptions) => Promise<UpdateOutcome>
    cancel: () => Promise<void>
    /** Join a run the backend reports in flight that this window did not start. */
    adopt: (p: UpdateProgress) => void
    /** Bring the progress toast back after its dismiss [x] took it away. */
    showToast: () => void
}

const POLL_MS = 2000
const DONE_TTL = 5000

const busy = (p: UpdatePhase) => p === 'pulling' || p === 'building'

export function createUpdateRun(deps: UpdateRunDeps): UpdateRun {
    const [run, setRun] = createSignal<UpdateRunView | null>(null)
    let current: Promise<UpdateOutcome> | null = null
    let quiet = false
    let cancelling = false
    // The progress toast: its id, whether it still carries `cancel`, and whether the person
    // dismissed it (then a poll does not bring it back; only showToast does).
    let toastId: number | null = null
    let toastHasCancel = false
    let toastDismissed = false

    const toastText = (p: UpdateProgress) =>
        cancelling ? 'Cancelling update…' : updatePhaseText(p.phase, p)
    const toastAlive = () =>
        toastId !== null && toasts().some(t => t.id === toastId)

    function paintToast(p: UpdateProgress): void {
        const wantCancel = !cancelling && busy(p.phase)
        if (toastAlive() && toastHasCancel === wantCancel) {
            updateToast(toastId!, toastText(p))
            return
        }
        // Gone without us dismissing it: the person closed it. (A cancel click swaps the toast
        // below, synchronously inside its onClick, before the host dismisses the clicked one.)
        if (toastId !== null && !toastAlive()) toastDismissed = true
        if (toastDismissed) return
        if (toastId !== null) dismissToast(toastId)
        toastId = pushToast(toastText(p), {
            ttl: 0,
            ...(wantCancel
                ? { action: { label: 'cancel', onClick: () => void cancel() } }
                : {}),
        })
        toastHasCancel = wantCancel
    }
    function show(p: UpdateProgress): void {
        if (p.cancelling) cancelling = true
        setRun({ phase: p.phase, progress: p, cancelling })
        paintToast(p)
    }

    async function poll(): Promise<UpdateOutcome> {
        for (;;) {
            await deps.wait(POLL_MS)
            let p: UpdateProgress
            try {
                p = await deps.progress()
            } catch {
                continue // transient; keep polling
            }
            show(p)
            if (p.phase === 'ready') {
                await deps.quit().catch(() => {})
                return { result: 'relaunching' }
            }
            if (p.phase === 'error')
                return {
                    result: 'error',
                    message: p.message,
                    ...(p.diverged ? { diverged: true } : {}),
                }
            if (p.phase === 'idle' || p.phase === 'cancelled') {
                deps.recheck()
                return {
                    result: p.phase === 'idle' ? 'up-to-date' : 'cancelled',
                }
            }
        }
    }

    function finish(r: UpdateOutcome): UpdateOutcome {
        current = null
        setRun(null)
        // `Relaunching…` stays up until the app quits.
        if (r.result !== 'relaunching' && toastAlive()) dismissToast(toastId!)
        toastId = null
        if (r.result === 'cancelled') pushToast('Update cancelled', { ttl: DONE_TTL })
        else if (r.result === 'error' && (!quiet || r.diverged)) deps.showFailure(r)
        else if (r.result === 'up-to-date' && !quiet)
            pushToast('Bismuth is already up to date', { ttl: DONE_TTL })
        return r
    }

    function begin(body: () => Promise<UpdateOutcome>, opts: StartOptions) {
        quiet = !!opts.quiet
        cancelling = false
        toastDismissed = false
        toastId = opts.toastId ?? null
        toastHasCancel = false
        current = body()
            .catch(
                (e): UpdateOutcome => ({
                    result: 'error',
                    message: (e as Error).message,
                }),
            )
            .then(finish)
        return current
    }

    function start(opts: StartOptions = {}): Promise<UpdateOutcome> {
        if (current) {
            if (!opts.quiet) quiet = false
            if (opts.toastId !== undefined && opts.toastId !== toastId)
                dismissToast(opts.toastId)
            showToast()
            return current
        }
        return begin(async () => {
            show({ phase: 'pulling' })
            const started = await deps.apply({ reset: opts.reset })
            if (started.phase === 'error')
                return { result: 'error', message: started.message }
            show(started)
            return poll()
        }, opts)
    }

    async function cancel(): Promise<void> {
        const view = run()
        if (!current || !view || cancelling || view.phase === 'ready') return
        cancelling = true
        show({ ...view.progress, cancelling: true })
        try {
            show(await deps.cancel())
        } catch (e) {
            cancelling = false
            pushToast(`Couldn't cancel the update: ${(e as Error).message}`, {
                tone: 'danger',
            })
            show(view.progress)
        }
    }

    function adopt(p: UpdateProgress): void {
        if (current || !busy(p.phase)) return
        void begin(async () => {
            show(p)
            return poll()
        }, {})
    }

    function showToast(): void {
        const view = run()
        if (!view) return
        if (!toastAlive()) toastId = null // the dismissed one is gone for good
        toastDismissed = false
        paintToast(view.progress)
    }

    return { run, start, cancel, adopt, showToast }
}
