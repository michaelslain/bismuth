// app/src/connectionState.ts
//
// Pure decision logic for connection-state + "connection lost" toast lifecycle,
// split out of serverVersion.ts so it can be unit tested in headless Bun without
// importing that module — serverVersion.ts opens a real EventSource and starts a
// poll `setInterval` at import time, which a headless Bun test can't safely do
// (see its header comment). Same pattern as app/src/fileTreeRefresh.ts.
//
// github issue #3: users saw "connection lost — polling" in the status bar and
// asked what it meant / why it wasn't going away. Triage found the SSE keepalive
// itself works fine (core/src/server.ts sends one every sseHeartbeatMs, verified
// surviving 360s with zero gaps) — the real defect is here, on the frontend's
// recovery path. `dismissToast` used to appear exactly once, inside `es.onopen`'s
// conditional body. The `/version` poll's success path set `everConnected` and
// delivered data, but never touched `connectionState` or the toast. So when the
// SSE reconnect handshake stalls forever — never firing `onopen` OR `onerror` —
// the app keeps working fine via the poll while showing "connection lost"
// indefinitely, with no automatic recovery. And because `App.tsx`'s status-bar
// span reads the same `connectionState`, clearing only the toast would still
// leave the status bar wrong: the fix has to clear the *state*, not just the
// notice.
//
// Round 2: making `connectionState` flip to "connected" on every successful
// poll (rather than only on a completed SSE handshake) makes a new interleaving
// reachable — a real one, not a hypothetical: a corporate proxy or VPN that
// kills long-lived streams but serves ordinary GETs fine. The SSE stream then
// repeatedly opens then errors while the poll keeps succeeding a moment later,
// so without further care the toast would show/dismiss roughly once a second,
// forever — worse than the original stuck-toast bug. `connectionState` itself
// stays honest (a succeeding poll genuinely means the backend is reachable, and
// the status bar tracking it is right to flip promptly); it's the user-visible
// NOTICE that needs hysteresis, via `TOAST_COOLDOWN_MS` below.

export type ConnectionState = "connected" | "disconnected" | "reconnecting";

/** What just happened, from the caller's four observation points. */
export type ConnectionEvent = "sse-open" | "sse-error" | "poll-success" | "poll-failure";

export interface ConnectionStateInput {
  /** The connection state immediately before this event. */
  state: ConnectionState;
  /** What just happened. */
  event: ConnectionEvent;
  /** Has the backend ever answered at least once this session? Suppresses the
   *  toast during boot warmup — a cold launch's sidecar takes ~1-4s to start
   *  listening, so the very first SSE connect attempt can fail for reasons
   *  that have nothing to do with a real drop. */
  everConnected: boolean;
  /** Is a "connection lost" toast currently showing? Callers dedupe by
   *  tracking the returned toast id and passing `id !== null` back in. */
  toastShown: boolean;
  /** Current time in ms (e.g. `Date.now()`). Purely a value the caller
   *  supplies — this module never reads the clock itself, so it stays a
   *  deterministic, unit-testable state machine. */
  now: number;
  /** When the notice was last dismissed (ms), or `null` if it never has been
   *  this session. Drives the re-show cooldown — see `TOAST_COOLDOWN_MS`. */
  dismissedAt: number | null;
}

export interface ConnectionStateDecision {
  /** Connection state after this event. */
  nextState: ConnectionState;
  /** `everConnected` after this event (sticky — once true, stays true). */
  everConnected: boolean;
  /** Show a brand-new "connection lost" toast now. */
  showToast: boolean;
  /** Dismiss the toast that is currently showing. */
  dismissToast: boolean;
  /** Poll interval to run at going forward. */
  pollInterval: "normal" | "fast";
  /** `dismissedAt` to carry forward into the next call (unchanged unless this
   *  event just dismissed the notice). */
  dismissedAt: number | null;
}

/**
 * How long after the notice is dismissed we hold off re-showing it, even if
 * the connection drops again in the meantime. This is what stops a flapping
 * SSE stream (opens, errors, opens, errors... while the poll keeps succeeding)
 * from showing/dismissing the notice on every tick — see the round-2 comment
 * above. `connectionState` itself is NOT debounced by this; only the notice.
 */
const TOAST_COOLDOWN_MS = 5000;

function withinCooldown(dismissedAt: number | null, now: number): boolean {
  return dismissedAt !== null && now - dismissedAt < TOAST_COOLDOWN_MS;
}

export function decideConnectionState(input: ConnectionStateInput): ConnectionStateDecision {
  const { state, event, toastShown, everConnected, now, dismissedAt } = input;

  switch (event) {
    case "sse-open": {
      // The SSE handshake completed. Always land on "connected", reset the
      // poll to its normal cadence, and clear any toast that was showing.
      const dismissingNow = toastShown;
      return {
        nextState: "connected",
        everConnected: true,
        showToast: false,
        dismissToast: dismissingNow,
        pollInterval: "normal",
        dismissedAt: dismissingNow ? now : dismissedAt,
      };
    }

    case "poll-success": {
      // The poll reaching the backend means we are NOT disconnected, whatever
      // the SSE stream is doing (github issue #3: a stalled handshake that
      // never fires onopen used to leave "connection lost — polling" showing
      // forever, even though the app was working fine via this very poll).
      // Clear both the state and the toast — the status bar reads
      // connectionState directly, so clearing only the toast would still
      // leave it wrong. Idempotent while already connected: no re-dismiss,
      // no re-toast, no interval churn.
      const dismissingNow = state !== "connected" && toastShown;
      return {
        nextState: "connected",
        everConnected: true,
        showToast: false,
        dismissToast: dismissingNow,
        pollInterval: "normal",
        dismissedAt: dismissingNow ? now : dismissedAt,
      };
    }

    case "sse-error":
    case "poll-failure":
      // Either signal means the connection is down. Show the toast once per
      // disconnect session, only after we've made contact at least once (a
      // cold launch's first failed attempt is boot warmup, not a drop), AND
      // only outside the post-dismissal cooldown — otherwise a flapping SSE
      // stream re-shows the notice as often as the poll ticks (round 2).
      return {
        nextState: "disconnected",
        everConnected,
        showToast: everConnected && !toastShown && !withinCooldown(dismissedAt, now),
        dismissToast: false,
        pollInterval: "fast",
        dismissedAt,
      };

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
