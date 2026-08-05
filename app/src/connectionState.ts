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
}

export function decideConnectionState(input: ConnectionStateInput): ConnectionStateDecision {
  const { state, event, toastShown, everConnected } = input;

  switch (event) {
    case "sse-open":
      // The SSE handshake completed. Always land on "connected", reset the
      // poll to its normal cadence, and clear any toast that was showing.
      return {
        nextState: "connected",
        everConnected: true,
        showToast: false,
        dismissToast: toastShown,
        pollInterval: "normal",
      };

    case "poll-success":
      // The poll reaching the backend means we are NOT disconnected, whatever
      // the SSE stream is doing (github issue #3: a stalled handshake that
      // never fires onopen used to leave "connection lost — polling" showing
      // forever, even though the app was working fine via this very poll).
      // Clear both the state and the toast — the status bar reads
      // connectionState directly, so clearing only the toast would still
      // leave it wrong. Idempotent while already connected: no re-dismiss,
      // no re-toast, no interval churn.
      return {
        nextState: "connected",
        everConnected: true,
        showToast: false,
        dismissToast: state !== "connected" && toastShown,
        pollInterval: "normal",
      };

    case "sse-error":
    case "poll-failure":
      // Either signal means the connection is down. Show the toast once per
      // disconnect session, and only after we've made contact at least once
      // (a cold launch's first failed attempt is boot warmup, not a drop).
      return {
        nextState: "disconnected",
        everConnected,
        showToast: everConnected && !toastShown,
        dismissToast: false,
        pollInterval: "fast",
      };

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
