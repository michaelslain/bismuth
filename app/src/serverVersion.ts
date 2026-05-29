import { createSignal, type Accessor } from "solid-js";
import { api, eventsUrl } from "./api";

export type ServerChange = { version: number; paths: string[] };

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

const es = new EventSource(eventsUrl());
es.onmessage = (e) => {
  try {
    const raw = JSON.parse(e.data) as Partial<ServerChange>;
    if (typeof raw.version !== "number") return;
    setChange({
      version: raw.version,
      paths: Array.isArray(raw.paths) ? raw.paths : [],
    });
  } catch {
    // ignore malformed frames
  }
};

setInterval(async () => {
  try {
    const { version: v } = await api.version();
    if (v > change().version) setChange({ version: v, paths: [] });
  } catch {
    // network hiccup — skip
  }
}, 5000);

/** Just the version number. Triggers re-runs on any invalidation. */
export const serverVersion: Accessor<number> = () => change().version;

/** Full change record (version + changed paths). */
export const lastChange: Accessor<ServerChange> = change;
