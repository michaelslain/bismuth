import { createSignal, type Accessor } from "solid-js";
import { api, eventsUrl } from "./api";
import { recordSseError, recordPollCatchup } from "./telemetry";

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

const es = new EventSource(eventsUrl());
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
es.onerror = (e) => recordSseError(e);

// Close EventSource on page unload to prevent connection leaks
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => es.close());
}

setInterval(async () => {
  try {
    const { version: v } = await api.version();
    if (v > change().version) {
      // Only log as 'SSE missed' when the version wasn't already delivered via SSE.
      if (v > lastSseVersion) recordPollCatchup(v, lastSseVersion);
      fireChange({ version: v, paths: [] });
    }
  } catch {
    // network hiccup — skip
  }
}, 5000);

/** Just the version number. Triggers re-runs on any invalidation. */
export const serverVersion: Accessor<number> = () => change().version;

/** Full change record (version + changed paths). */
export const lastChange: Accessor<ServerChange> = change;

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
