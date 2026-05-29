import { createSignal, type Accessor } from "solid-js";
import { api, eventsUrl } from "./api";

/**
 * Reactive accessor for the latest server cache `version`.
 *
 * Module-level singleton: one EventSource per browser tab, plus a low-frequency
 * `/version` poll as a belt-and-suspenders fallback in case the SSE stream
 * silently dies (proxies / sleep modes drop long-lived connections without
 * an explicit close). Importers just read `serverVersion()` in a reactive
 * context.
 */
const [version, setVersion] = createSignal(0);

const es = new EventSource(eventsUrl());
es.onmessage = (e) => {
  try {
    const v = (JSON.parse(e.data) as { version: number }).version;
    if (typeof v === "number") setVersion(v);
  } catch {
    // ignore malformed frames
  }
};

setInterval(async () => {
  try {
    const { version: v } = await api.version();
    if (v > version()) setVersion(v);
  } catch {
    // network hiccup — skip
  }
}, 5000);

export const serverVersion: Accessor<number> = version;
