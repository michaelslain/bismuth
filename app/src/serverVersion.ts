import { createSignal, type Accessor } from "solid-js";
import { api, eventsUrl } from "./api";

let signal: Accessor<number> | null = null;

/**
 * Returns a Solid accessor for the latest server cache `version`.
 *
 * On first call it opens a single shared `EventSource` to `/events` and starts
 * a low-frequency `/version` poll as a belt-and-suspenders fallback (in case
 * the SSE stream silently dies — some proxies / sleep modes drop long-lived
 * connections without an explicit close). Subsequent callers re-use the same
 * signal so there's only ever one EventSource per browser tab.
 */
export function serverVersion(): Accessor<number> {
  if (signal) return signal;
  const [version, setVersion] = createSignal(0);
  signal = version;

  // EventSource auto-reconnects on transient errors. We don't need to do anything
  // beyond passing the messages through.
  const es = new EventSource(eventsUrl());
  es.onmessage = (e) => {
    try {
      const v = (JSON.parse(e.data) as { version: number }).version;
      if (typeof v === "number") setVersion(v);
    } catch {
      // ignore malformed frames
    }
  };

  // Fallback: every 5 s, ask /version directly. If the server's value is ahead of
  // ours, the SSE stream is broken — adopt the new value and let consumers refetch.
  setInterval(async () => {
    try {
      const { version: v } = await api.version();
      if (v > version()) setVersion(v);
    } catch {
      // network hiccup — skip
    }
  }, 5000);

  return version;
}
