// app/src/bootGate.ts
//
// Decides when the boot splash (index.html's #boot-splash overlay) may be dismissed. The splash
// must stay up until the home-tab Knowledge Graph has actually PAINTED ITS FIRST FRAME — not
// merely until its initial data resolved — so the user never sees a bare, empty graph area
// behind (or right after) the fading splash. It must also NEVER strand the overlay: every path
// that could otherwise leave it up forever bypasses the paint wait.
//
// Pure decision function + a thin stateful wrapper, no DOM/window access — fully unit-testable
// in isolation. The real wiring (data-ready, first-paint, visibility, the 12s safety timer) lives
// in App.tsx/GraphView.tsx/CanvasGraphRenderer.ts and index.html.

export interface BootGateSignals {
  /** The app's initial graph+tree fetch has settled — success OR failure (allSettled never
   *  blocks forever on a rejected/backend-down fetch). */
  dataReady: boolean;
  /** Whether a graph view is expected to mount and paint before boot is considered done.
   *  GraphView is unconditionally mounted by App (as the home tab or the sidebar mini-graph), so
   *  this is true on every normal launch; kept as an explicit input so the gate also covers a
   *  restored session whose active tab is something else and never shows a graph at all. */
  graphMounts: boolean;
  /** The mounted graph renderer has drawn its first real frame (any node count, including a
   *  brand-new/empty vault — zero nodes still counts as painted). */
  graphPainted: boolean;
  /** The window/document isn't visible (a backgrounded launch). GraphView pauses its render loop
   *  while hidden, so a paint may never arrive — but nothing is visible to strand either, so the
   *  paint wait is considered satisfied once data is ready. */
  hidden: boolean;
  /** A safety backstop (index.html's 12s timer, or a caller-driven equivalent) fired — dismiss
   *  unconditionally, regardless of every other signal. */
  timedOut: boolean;
}

/** Pure decision: given the current signals, may the splash be dismissed right now? */
export function canDismissBoot(s: BootGateSignals): boolean {
  if (s.timedOut) return true;
  if (!s.dataReady) return false;
  if (s.graphMounts && !s.graphPainted && !s.hidden) return false;
  return true;
}

export interface BootGate {
  setDataReady(v: boolean): void;
  setGraphPainted(v: boolean): void;
  setHidden(v: boolean): void;
  setTimedOut(v: boolean): void;
  /** True once `onDismiss` has fired. Stays true — the gate never dismisses twice. */
  readonly dismissed: boolean;
}

/** Stateful wrapper around `canDismissBoot`: tracks the live signals and invokes `onDismiss`
 *  exactly once, the instant the decision first flips to true. Signals may arrive in any order,
 *  any number of times (including after dismissal, which is then a no-op). */
export function createBootGate(opts: { graphMounts: boolean; onDismiss: () => void }): BootGate {
  const signals: BootGateSignals = {
    dataReady: false,
    graphMounts: opts.graphMounts,
    graphPainted: false,
    hidden: false,
    timedOut: false,
  };
  let dismissed = false;
  const maybeDismiss = () => {
    if (dismissed || !canDismissBoot(signals)) return;
    dismissed = true;
    opts.onDismiss();
  };
  return {
    setDataReady(v) { signals.dataReady = v; maybeDismiss(); },
    setGraphPainted(v) { signals.graphPainted = v; maybeDismiss(); },
    setHidden(v) { signals.hidden = v; maybeDismiss(); },
    setTimedOut(v) { signals.timedOut = v; maybeDismiss(); },
    get dismissed() { return dismissed; },
  };
}
