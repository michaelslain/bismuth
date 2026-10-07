// app/src/ui/toastStore.ts
// Pure toast state + actions, split out of ToastHost.tsx (which additionally renders <ToastHost/>, a
// real Solid/JSX component). A module that only needs to push/dismiss a toast — like
// serverVersion.ts — imports this instead, so its module graph never pulls in JSX. See
// docs/contributing/testing.md's "cwd-dependent JSX-resolution trap" and app/src/pickResult.ts
// (split out of appWindow.ts for the identical reason): `bun test app/` — how the commit/push
// gate invokes it — breaks if a *.test.ts's import graph reaches a real .tsx file, and
// serverVersion.ts gained runtime test coverage in task 2 (seam B, github issues #3/#8).
import { createSignal } from 'solid-js'

export type ToastAction = { label: string; onClick: () => void }

/** `danger` is a failure: it reads in the danger ink, so an error never looks like an info toast. */
export type ToastTone = 'default' | 'danger'

export type Toast = {
    id: number
    message: string
    action?: ToastAction
    tone: ToastTone
    /** True when no timer will dismiss it (`ttl <= 0`) — the host draws a dismiss control then,
     *  because otherwise a persistent toast has no way off the screen but its owner's code. */
    persistent: boolean
}

export type PushToastOptions = {
    /** Auto-dismiss after this many ms (default 5000). `<= 0` or non-finite = persistent. */
    ttl?: number
    tone?: ToastTone
    action?: ToastAction
}

const [toasts, setToasts] = createSignal<Toast[]>([])
let nextId = 1
// Auto-dismiss timer handles, keyed by toast id, so an early dismiss (action
// click / external dismiss) can cancel the pending timeout instead of leaking it.
const timers = new Map<number, ReturnType<typeof setTimeout>>()

const isAction = (v: unknown): v is ToastAction =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ToastAction).onClick === 'function'

const timed = (ttl: number) => ttl > 0 && Number.isFinite(ttl)

/** Add a toast; auto-dismisses after `ttl` ms. Returns its id so callers can replace/dismiss it.
 *  The second argument is the options bag — `{ ttl, tone, action }`. The legacy positional form
 *  `pushToast(msg, action?, ttl?)` is still read (an object with an `onClick` is an action), so
 *  the ~20 call sites that predate the bag keep working until their surface task moves them.
 *  Pass `ttl <= 0` (or a non-finite value) to make the toast PERSISTENT — no auto-dismiss timer.
 *  That's the mode progress toasts use: push once, mutate via updateToast, dismissToast when done.
 *  (A literal 0 would otherwise schedule setTimeout(…, 0) and the toast would vanish on the next
 *  tick, before any awaited work resolves — so guard the timer here.) */
export function pushToast(
    message: string,
    opts?: PushToastOptions | ToastAction,
    legacyTtl?: number,
): number {
    const o: PushToastOptions = isAction(opts)
        ? { action: opts, ttl: legacyTtl }
        : { ...opts, ttl: opts?.ttl ?? legacyTtl }
    const ttl = o.ttl ?? 5000
    const id = nextId++
    setToasts(prev => [
        ...prev,
        {
            id,
            message,
            action: o.action,
            tone: o.tone ?? 'default',
            persistent: !timed(ttl),
        },
    ])
    if (timed(ttl)) timers.set(id, setTimeout(() => dismissToast(id), ttl))
    return id
}

/** Replace a live toast's message in place (e.g. progress updates). No-op if it's gone.
 *  Replaces the toast object so the keyed <For> re-renders the row; there's no enter
 *  animation (ToastHost.module.css is static), so the text just swaps with no flicker.
 *  Pass `ttl` to (re-)arm the same tracked auto-dismiss timer pushToast uses — e.g. a
 *  persistent progress toast (pushed with ttl <= 0) that should now count down to dismissal
 *  once the operation it was tracking finishes. Any prior timer for this id is cleared first,
 *  exactly like dismissToast does, so re-updating a toast never stacks two pending dismissals. */
export function updateToast(id: number, message: string, ttl?: number) {
    setToasts(prev =>
        prev.map(t =>
            t.id === id
                ? {
                      ...t,
                      message,
                      persistent: ttl === undefined ? t.persistent : !timed(ttl),
                  }
                : t,
        ),
    )
    if (ttl !== undefined) {
        const timer = timers.get(id)
        if (timer !== undefined) clearTimeout(timer)
        if (timed(ttl)) timers.set(id, setTimeout(() => dismissToast(id), ttl))
        else timers.delete(id)
    }
}

export function dismissToast(id: number) {
    const timer = timers.get(id)
    if (timer !== undefined) {
        clearTimeout(timer)
        timers.delete(id)
    }
    setToasts(prev => prev.filter(t => t.id !== id))
}

export { toasts }
