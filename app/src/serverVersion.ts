import { createSignal, type Accessor } from "solid-js";
import { api, eventsUrl } from "./api";
import { recordSseError, recordPollCatchup } from "./telemetry";
import { pushToast, dismissToast } from "./Toast";
import { decideConnectionState, type ConnectionEvent, type ConnectionState } from "./connectionState";

/**
 * `dirty` tells graph/tree consumers whether their data actually changed. The
 * server omits it for the initial snapshot and the fallback poll; an absent
 * `dirty` means "extent unknown — assume everything changed."
 */
export type ServerChange = {
  version: number;
  paths: string[];
  dirty?: { graph: boolean; tree: boolean };
};

/**
 * Connection state for error recovery tracking.
 * - 'connected': EventSource is open and receiving messages
 * - 'disconnected': EventSource closed or errored; polling at the faster interval
 * - 'reconnecting': Attempting to re-establish the EventSource connection
 *
 * The type lives in ./connectionState (re-exported here) alongside the pure
 * `decideConnectionState` transition function — see that module for why the
 * decision had to be extracted (github issue #3).
 */
export type { ConnectionState };

/**
 * Reactive accessor for the latest server cache `version` plus the paths
 * that triggered the current invalidation.
 *
 * `paths` is empty when we don't know what changed (initial snapshot,
 * fallback poll). Consumers that care about specific files should treat
 * an empty `paths` as "assume anything could have changed."
 *
 * Module-level singleton: one EventSource per browser tab, plus a low-frequency
 * `/version` poll as a belt-and-suspenders fallback in case the SSE stream
 * silently dies (proxies / sleep modes drop long-lived connections without
 * an explicit close).
 */
const [change, setChange] = createSignal<ServerChange>({ version: 0, paths: [] });
const [connectionState, setConnectionState] = createSignal<ConnectionState>("connected");

// ---------------------------------------------------------------------------
// Imperative subscription — for non-Solid callers (e.g. CodeMirror widgets)
// ---------------------------------------------------------------------------
type ChangeCallback = (c: ServerChange) => void;
const changeListeners = new Set<ChangeCallback>();

/** Internal: update the Solid signal and notify any imperative subscribers. */
function fireChange(c: ServerChange): void {
  setChange(c);
  for (const cb of changeListeners) cb(c);
}

/** Last version observed specifically via SSE (not bumped by the poll). */
let lastSseVersion = 0;

// Have we EVER reached the backend this session? On a cold launch (esp. right after a
// self-update relaunch) the sidecar takes ~1–4s to start listening, so the first SSE connect
// fails. That's normal boot warmup, not a dropped connection — showing "Connection lost.
// Retrying…" then would flash a scary toast on every launch. So the disconnect toast is
// suppressed until we've connected at least once; the GET retry in api.ts fills the UI in
// silently meanwhile. After the first successful contact, a real drop toasts as usual.
let everConnected = false;

// Tracks the active "connection lost" toast so we show it only once per
// disconnect session (deduplication).
let connectionErrorToastId: number | null = null;

// When the toast was last dismissed (ms, Date.now()), or null if it never has
// been this session. Feeds decideConnectionState's cooldown, which stops a
// flapping SSE stream (opens, errors, opens, errors... — a real corporate
// proxy/VPN pattern that kills long-lived streams but serves ordinary GETs
// fine) from showing/dismissing the toast on every poll tick.
let toastDismissedAt: number | null = null;

const NORMAL_POLL_INTERVAL = 5000; // 5 seconds
const DISCONNECTED_POLL_INTERVAL = 1000; // 1 second when disconnected

let currentPollInterval = NORMAL_POLL_INTERVAL;
let pollIntervalHandle: ReturnType<typeof setInterval> | undefined;

// Try to create EventSource; if server is down, we'll catch this on first poll
let es: EventSource | null = null;
let esClosed = false;

/**
 * Run the pure `decideConnectionState` for one of the four observation points
 * (SSE opened/errored, poll succeeded/failed) and apply its decision: update
 * the `connectionState` signal, show/dismiss the toast, and switch the poll
 * cadence. Single call site for all four paths so none of them can drift out
 * of sync with each other again (github issue #3).
 */
function applyConnectionDecision(event: ConnectionEvent) {
  const previousState = connectionState();
  const decision = decideConnectionState({
    state: previousState,
    event,
    everConnected,
    toastShown: connectionErrorToastId !== null,
    now: Date.now(),
    dismissedAt: toastDismissedAt,
  });

  everConnected = decision.everConnected;
  toastDismissedAt = decision.dismissedAt;
  setConnectionState(decision.nextState);

  if (decision.dismissToast && connectionErrorToastId !== null) {
    dismissToast(connectionErrorToastId);
    connectionErrorToastId = null;
  }

  // Show toast only once per disconnect session, never during initial boot before we've ever
  // reached the backend (that's warmup, not a lost connection), and never within the cooldown
  // right after a dismissal (otherwise a flapping SSE stream re-shows it on every poll tick).
  // decideConnectionState already encodes all three rules; this just avoids pushing a second
  // toast on top of one already showing.
  if (decision.showToast && connectionErrorToastId === null) {
    connectionErrorToastId = pushToast(
      "Connection lost. Retrying...",
      {
        label: "Retry now",
        onClick: () => {
          setConnectionState("reconnecting");
          attemptReconnect();
        },
      },
      0 // Don't auto-dismiss; user must manually close or reconnection fixes it
    );
  }

  const desiredInterval = decision.pollInterval === "normal" ? NORMAL_POLL_INTERVAL : DISCONNECTED_POLL_INTERVAL;
  if (currentPollInterval !== desiredInterval) {
    currentPollInterval = desiredInterval;
    startPolling(); // restart the timer so the new cadence actually takes effect
  }

  // Single call site for this log line (it used to be duplicated at each of the three
  // error-observation call sites) so the wording can't drift between them. Gated on an
  // actual transition INTO "disconnected" (previousState !== "disconnected"), not on
  // every repeat event: poll-failure is now called unconditionally below (regression
  // fix — see that catch handler's comment), so without this gate a sustained outage
  // would warn once per DISCONNECTED_POLL_INTERVAL (1s) for as long as it stayed down.
  if ((event === "sse-error" || event === "poll-failure") && previousState !== "disconnected") {
    console.warn("[sse] connection lost; switching to aggressive polling", {
      at: new Date().toISOString(),
    });
  }

  return decision;
}

/** Close the live EventSource (if any) so a fresh one can be created. */
function closeEventSource(): void {
  if (es !== null) {
    es.close();
    es = null;
  }
}

// Fallback poll: aggressive when disconnected, normal when connected
function startPolling(): void {
  if (pollIntervalHandle !== undefined) clearInterval(pollIntervalHandle);

  pollIntervalHandle = setInterval(async () => {
    try {
      const { version: v } = await api.version();
      // Capture BEFORE applying the decision: the poll reaching the backend means we are not
      // disconnected, whatever the SSE stream is doing — clear the state and the toast right
      // here rather than only ever doing it from es.onopen, which could leave a stalled SSE
      // handshake (one that never fires onopen OR onerror) showing "connection lost" forever
      // even though this very poll proves the app is working (github issue #3).
      const wasNotConnected = connectionState() !== "connected";
      applyConnectionDecision("poll-success");

      if (v > change().version) {
        // Only log as 'SSE missed' when the version wasn't already delivered via SSE.
        if (v > lastSseVersion) recordPollCatchup(v, lastSseVersion);
        fireChange({ version: v, paths: [] });
      }

      // If the SSE stream wasn't already connected, try reopening it in the background — the
      // poll alone is a coarser fallback, not a replacement for real-time updates. Guard on
      // `es === null` so we don't tear down an EventSource that's still mid-handshake —
      // otherwise a handshake slower than the poll interval would be killed every tick and
      // never reach `onopen`.
      if (wasNotConnected && !esClosed && es === null) {
        attemptReconnect();
      }
    } catch {
      // Poll failed. Always re-evaluate — decideConnectionState already dedupes
      // correctly (toastShown short-circuits showToast once the notice is up, and the
      // cooldown handles a flapping SSE stream), so this alone won't spam the toast.
      // This used to be guarded on `connectionState() === "connected"`, which meant a
      // poll-failure arriving any time after state had already left "connected" was
      // silently dropped: once the toast was dismissed (e.g. a brief recovery) and the
      // cooldown passed, a still-dead backend never got the notice — or its Retry-now
      // button — back, even across minutes of continuous failure (regression found in
      // whole-branch review; see connectionState.test.ts's matching case).
      applyConnectionDecision("poll-failure");
      closeEventSource(); // so attemptReconnect / the next successful poll can open a fresh one
    }
  }, currentPollInterval);
}

function attemptReconnect(): void {
  closeEventSource();
  createEventSource();
}

function createEventSource(): void {
  if (es !== null || esClosed) return; // Already created or manually closed

  try {
    es = new EventSource(eventsUrl());

    es.onopen = () => {
      const wasNotConnected = connectionState() !== "connected";
      applyConnectionDecision("sse-open");
      if (wasNotConnected) console.log("[sse] connection restored");
    };

    es.onmessage = (e) => {
      everConnected = true;
      try {
        const raw = JSON.parse(e.data) as Partial<ServerChange>;
        if (typeof raw.version !== "number") return;
        lastSseVersion = raw.version;
        fireChange({
          version: raw.version,
          paths: Array.isArray(raw.paths) ? raw.paths : [],
          dirty: raw.dirty,
        });
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = (e) => {
      recordSseError(e);
      applyConnectionDecision("sse-error");
      closeEventSource();
    };
  } catch {
    // EventSource constructor itself failed; fall back to poll
    applyConnectionDecision("sse-error");
  }
}

// Initialize EventSource on module load
createEventSource();

// Close EventSource on page unload to prevent connection leaks
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    esClosed = true;
    if (es !== null) {
      es.close();
      es = null;
    }
    if (pollIntervalHandle !== undefined) {
      clearInterval(pollIntervalHandle);
    }
  });
}

startPolling();

/** Just the version number. Triggers re-runs on any invalidation. */
export const serverVersion: Accessor<number> = () => change().version;

/** Full change record (version + changed paths). */
export const lastChange: Accessor<ServerChange> = change;

/** Current connection state (connected, disconnected, or reconnecting). */
export const currentConnectionState: Accessor<ConnectionState> = connectionState;

/**
 * Subscribe to server change events from outside Solid's reactive scope
 * (e.g. CodeMirror widgets). Returns an unsubscribe function.
 *
 * The callback fires whenever the backend version advances — driven by the
 * same SSE + poll paths that update `serverVersion`.
 */
export function onServerChange(cb: ChangeCallback): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}
