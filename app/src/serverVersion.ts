import { createSignal, type Accessor } from "solid-js";
import { api, eventsUrl } from "./api";
import { recordSseError, recordPollCatchup } from "./telemetry";
import { pushToast, dismissToast } from "./Toast";

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
 * - 'disconnected': EventSource closed or errored; polling with reduced interval
 * - 'reconnecting': Attempting to re-establish connection via exponential backoff
 */
export type ConnectionState = "connected" | "disconnected" | "reconnecting";

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

// Connection error tracking for toast deduplication and exponential backoff
let connectionErrorToastId: number | null = null;
let lastErrorTime = 0;
let consecutiveErrors = 0;

const NORMAL_POLL_INTERVAL = 5000; // 5 seconds
const DISCONNECTED_POLL_INTERVAL = 1000; // 1 second when disconnected
const INITIAL_BACKOFF = 2000; // 2 seconds
const MAX_BACKOFF = 30000; // 30 seconds max

let currentPollInterval = NORMAL_POLL_INTERVAL;
let pollIntervalHandle: number | undefined;

// Try to create EventSource; if server is down, we'll catch this on first poll
let es: EventSource | null = null;
let esClosed = false;

// Fallback poll: aggressive when disconnected, normal when connected
function startPolling(): void {
  if (pollIntervalHandle !== undefined) clearInterval(pollIntervalHandle);

  pollIntervalHandle = setInterval(async () => {
    try {
      const { version: v } = await api.version();
      if (v > change().version) {
        // Only log as 'SSE missed' when the version wasn't already delivered via SSE.
        if (v > lastSseVersion) recordPollCatchup(v, lastSseVersion);
        fireChange({ version: v, paths: [] });
      }

      // Poll succeeded; if we were disconnected, try reconnecting EventSource
      if (connectionState() !== "connected" && !esClosed) {
        setConnectionState("reconnecting");
        attemptReconnect();
      }
    } catch {
      // Poll failed; if we were connected, mark as disconnected
      if (connectionState() === "connected") {
        handleConnectionError();
      }
    }
  }, currentPollInterval);
}

function handleConnectionError(): void {
  const now = Date.now();
  consecutiveErrors++;
  lastErrorTime = now;

  if (connectionState() !== "disconnected") {
    setConnectionState("disconnected");
    currentPollInterval = DISCONNECTED_POLL_INTERVAL;
    startPolling(); // Restart with faster interval
  }

  // Close the broken EventSource so we can attempt a fresh connection
  if (es !== null) {
    es.close();
    es = null;
  }

  // Show toast only once per disconnect session
  if (connectionErrorToastId === null) {
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

  console.warn("[sse] connection lost; switching to aggressive polling", {
    at: new Date().toISOString(),
    consecutiveErrors,
  });
}

function attemptReconnect(): void {
  if (es !== null) {
    es.close();
    es = null;
  }
  createEventSource();
}

function createEventSource(): void {
  if (es !== null || esClosed) return; // Already created or manually closed

  try {
    es = new EventSource(eventsUrl());

    es.onopen = () => {
      // Connection established
      if (connectionState() === "disconnected" || connectionState() === "reconnecting") {
        setConnectionState("connected");
        currentPollInterval = NORMAL_POLL_INTERVAL;
        consecutiveErrors = 0;

        // Dismiss error toast if one was showing
        if (connectionErrorToastId !== null) {
          dismissToast(connectionErrorToastId);
          connectionErrorToastId = null;
        }

        // Restart polling with normal interval
        startPolling();

        console.log("[sse] connection restored");
      }
    };

    es.onmessage = (e) => {
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
      handleConnectionError();
    };
  } catch {
    // EventSource constructor itself failed; fall back to poll
    handleConnectionError();
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
