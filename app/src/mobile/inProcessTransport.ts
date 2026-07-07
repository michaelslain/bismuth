// The mobile Transport: instead of HTTP to a Bun server, it calls the in-process
// backend (core/src/localBackend) directly. The mobile entrypoint constructs a
// LocalBackend (pointed at the on-device vault, via tauri-plugin-fs FileAccess)
// and `setTransport(inProcessTransport(backend))` swaps it in for HTTP at boot —
// no api call site changes.
import type { Transport } from "../api";
import type { LocalBackend } from "../../../core/src/localBackend";

/** Wrap a result as a `Response` so `api.post/put` callers (which expect a
 *  Response — a web standard available in WKWebView) keep working unchanged. */
function asResponse(data: unknown): Response {
  if (typeof data === "string") return new Response(data);
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}

export function inProcessTransport(backend: LocalBackend): Transport {
  return {
    getJson: <T>(path: string) => backend.dispatch("GET", path) as Promise<T>,
    getText: (path: string) => backend.dispatch("GET", path) as Promise<string>,
    post: (path: string, body: unknown) => backend.dispatch("POST", path, body).then(asResponse),
    put: (path: string, body: unknown) => backend.dispatch("PUT", path, body).then(asResponse),
    postJson: <T>(path: string, body: unknown) => backend.dispatch("POST", path, body) as Promise<T>,
    // Same optimistic-concurrency contract as the HTTP transport (#46), implemented client-side
    // since the in-process backend has no HTTP status codes to 409 with: read-compare-write
    // against the SAME dispatch("GET"/"PUT", "/file", ...) primitives above. There's a small
    // read-then-write TOCTOU window (not atomic against `writeNote` the way the server's check
    // is), acceptable for this single-process, single-tab mobile backend — unlike the desktop
    // HTTP server, there's no concurrent external writer racing the SAME vault via a second process.
    writeFileChecked: async (path: string, contents: string, baseText: string) => {
      const current = (await backend.dispatch("GET", `/file?path=${encodeURIComponent(path)}`)) as string;
      if (current !== baseText) return { conflict: true as const, current };
      await backend.dispatch("PUT", "/file", { path, contents });
      return { conflict: false as const };
    },
    // Binary asset upload + URL resolution go through tauri-plugin-fs / convertFileSrc
    // on device; not wired in this increment (documented follow-up).
    uploadAsset: async () => {
      throw new Error("uploadAsset is not supported by the in-process backend yet");
    },
    assetUrl: (target: string) => target,
    // No SSE on mobile — the mobile entry subscribes to backend.subscribe() directly
    // and the api.version() poll (existing resilience path) covers change detection.
    // eventsUrl returns an unusable value on purpose; EventSource is not used on mobile.
    eventsUrl: () => "",
    base: () => "inprocess://local",
  };
}
