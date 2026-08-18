// app/src/bootGate.ts
//
// Decides when the boot splash (index.html's #boot-splash overlay) may be dismissed. The splash
// must stay up until the home-tab Knowledge Graph has actually PAINTED A FRAME CONTAINING THE
// LOADED DATA — not merely until its initial data resolved, and not merely until ANY frame has
// been painted — so the user never sees a bare, empty graph area behind (or right after) the
// fading splash.
//
// Measured regression this encodes a fix for: the renderer paints an early frame of the EMPTY
// graph (zero nodes) well before the initial fetch resolves. If that early paint were allowed to
// satisfy the paint wait, `dataReady` flipping true immediately afterwards would open the gate
// with nothing but that stale empty frame on screen — a real boot showed the splash starting to
// fade at 465ms over a blank canvas, with the graph not actually appearing until ~968ms. So a
// paint only counts if it lands AFTER `dataReady` is already true (see `setGraphPainted` below);
// an earlier paint is simply dropped, and the first paint once data is ready is the one that
// opens the gate.
//
// It must also NEVER strand the overlay: every path that could otherwise leave it up forever
// bypasses the paint wait (the `hidden` bypass, the bounded `paintWaitExpired` fallback, and
// `timedOut` as the unconditional last resort).
//
// Pure decision function + a thin stateful wrapper, no DOM/window access — fully unit-testable
// in isolation. The real wiring (data-ready, paint, visibility, the fallback timer, the 12s
// safety timer) lives in App.tsx/GraphView.tsx/AsciiGraphRenderer.ts and index.html.

export interface BootGateSignals {
    /** The app's initial graph+tree fetch has settled — success OR failure (allSettled never
     *  blocks forever on a rejected/backend-down fetch). */
    dataReady: boolean
    /** Whether a graph view is expected to mount and paint before boot is considered done.
     *  GraphView is unconditionally mounted by App (as the home tab or the sidebar mini-graph), so
     *  this is true on every normal launch; kept as an explicit input so the gate also covers a
     *  restored session whose active tab is something else and never shows a graph at all. */
    graphMounts: boolean
    /** A graph frame that was painted AFTER `dataReady` went true (any node count, including a
     *  brand-new/empty vault — zero nodes still counts, as long as the paint happened once data
     *  had already arrived). A paint that lands before `dataReady` does NOT set this — see the
     *  stateful wrapper's `setGraphPainted`, which is where that ordering is enforced. */
    graphPainted: boolean
    /** The window/document isn't visible (a backgrounded launch). GraphView pauses its render loop
     *  while hidden, so a paint may never arrive — but nothing is visible to strand either, so the
     *  paint wait is considered satisfied once data is ready. */
    hidden: boolean
    /** A bounded fallback (~1.5s after dataReady, started by App) fired because no qualifying
     *  paint arrived in time — e.g. the renderer had nothing new to redraw. Satisfies the paint
     *  wait so a real-but-invisible paint gap can't strand the overlay all the way out to
     *  index.html's 12s backstop. */
    paintWaitExpired: boolean
    /** A safety backstop (index.html's 12s timer, or a caller-driven equivalent) fired — dismiss
     *  unconditionally, regardless of every other signal. */
    timedOut: boolean
}

/** Pure decision: given the current signals, may the splash be dismissed right now? */
export function canDismissBoot(s: BootGateSignals): boolean {
    if (s.timedOut) return true
    if (!s.dataReady) return false
    if (s.graphMounts && !s.graphPainted && !s.hidden && !s.paintWaitExpired)
        return false
    return true
}

export interface BootGate {
    setDataReady(v: boolean): void
    setGraphPainted(v: boolean): void
    setHidden(v: boolean): void
    setPaintWaitExpired(v: boolean): void
    setTimedOut(v: boolean): void
    /** True once `onDismiss` has fired. Stays true — the gate never dismisses twice. */
    readonly dismissed: boolean
}

/** Stateful wrapper around `canDismissBoot`: tracks the live signals and invokes `onDismiss`
 *  exactly once, the instant the decision first flips to true. Signals may arrive in any order,
 *  any number of times (including after dismissal, which is then a no-op). */
export function createBootGate(opts: {
    graphMounts: boolean
    onDismiss: () => void
}): BootGate {
    const signals: BootGateSignals = {
        dataReady: false,
        graphMounts: opts.graphMounts,
        graphPainted: false,
        hidden: false,
        paintWaitExpired: false,
        timedOut: false,
    }
    let dismissed = false
    const maybeDismiss = () => {
        if (dismissed || !canDismissBoot(signals)) return
        dismissed = true
        opts.onDismiss()
    }
    return {
        setDataReady(v) {
            signals.dataReady = v
            maybeDismiss()
        },
        // A paint only counts once data is already ready — this is the ordering fix: an early paint
        // of the still-empty graph (which happens before the fetch resolves) must NOT latch true and
        // then get "cashed in" the instant dataReady flips. `v && signals.dataReady` means a paint
        // that arrives first is simply dropped; the NEXT paint after dataReady is what latches.
        setGraphPainted(v) {
            signals.graphPainted = v && signals.dataReady
            maybeDismiss()
        },
        setHidden(v) {
            signals.hidden = v
            maybeDismiss()
        },
        setPaintWaitExpired(v) {
            signals.paintWaitExpired = v
            maybeDismiss()
        },
        setTimedOut(v) {
            signals.timedOut = v
            maybeDismiss()
        },
        get dismissed() {
            return dismissed
        },
    }
}
