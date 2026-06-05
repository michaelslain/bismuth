// Backend base URL. Resolved at runtime so one frontend build can talk to different
// backends across windows: the `?api=<url>` query param wins (set when "Open folder"
// opens a sibling backend in a new window), then the VITE_API_BASE build env (used to
// run alongside another worktree), then the standard core port.
// Pure so it's unit-testable: given a location.search and the build env, pick the
// backend base. `?api=` wins (trailing slashes trimmed), then VITE_API_BASE, then default.
export function resolveBase(search: string | undefined, envBase: string | undefined): string {
  try {
    const fromQuery = new URLSearchParams(search ?? "").get("api");
    if (fromQuery) return fromQuery.replace(/\/+$/, "");
  } catch {
    // malformed search — fall through to the build-time default
  }
  return envBase ?? "http://localhost:4321";
}
const BASE = resolveBase(globalThis.location?.search, import.meta.env.VITE_API_BASE);

/** The backend this window is bound to (already query/env resolved). Exposed so the UI
 *  can build "new window" / "open folder" URLs that pin the right backend via `?api=`. */
export const apiBase = (): string => transport.base();

import type { GraphData, TreeEntry, ViewLayout } from "../../core/src/graph";
import type { SearchOpts, SearchResult } from "./searchOpts";
import type { Task } from "../../core/src/tasks";
import type { Card } from "../../core/src/srs/types";
import type { Row, ParsedBase, SourceSpec } from "../../core/src/bases/types";
import type { Schema } from "../../core/src/schema/types";

// --- Transport seam -------------------------------------------------------
// Everything the `api` object needs from the outside world is funnelled through
// a `Transport`. On desktop/browser this is plain HTTP to the Bun backend (the
// historical behavior). On iPad/iOS — where no Bun process can run — a future
// in-process transport will implement the same surface against in-WebView logic
// + tauri-plugin-fs, and `setTransport()` swaps it in at boot. Keeping the verbs
// (incl. post/put returning a `Response`, a web standard available in WKWebView)
// identical means zero call-site changes when the backend moves in-process.
export interface Transport {
  getJson<T>(path: string): Promise<T>;
  getText(path: string): Promise<string>;
  post(path: string, body: unknown): Promise<Response>;
  put(path: string, body: unknown): Promise<Response>;
  postJson<T>(path: string, body: unknown): Promise<T>;
  /** Upload attachment bytes to `targetPath`; returns the path actually written. */
  uploadAsset(targetPath: string, bytes: ArrayBuffer): Promise<string>;
  /** `src`-able URL for a vault media file (image/PDF/audio/video). */
  assetUrl(target: string): string;
  /** URL passed to `new EventSource(...)` for live change events. */
  eventsUrl(): string;
  /** The resolved backend base (used to pin `?api=` windows). */
  base(): string;
}

/** HTTP transport: the original fetch-against-`base` behavior, unchanged. */
export function httpTransport(base: string): Transport {
  /** Generic fetch wrapper: throw server error text on non-2xx, optionally parse JSON/text. */
  async function request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
    responseType?: "json" | "text",
  ): Promise<T | Response | string> {
    const r = await fetch(`${base}${path}`, {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    if (responseType === "json") return r.json() as Promise<T>;
    if (responseType === "text") return r.text() as Promise<string>;
    return r;
  }
  return {
    getJson: <T>(path: string) => request<T>("GET", path, undefined, "json") as Promise<T>,
    getText: (path: string) => request("GET", path, undefined, "text") as Promise<string>,
    post: (path: string, body: unknown) => request("POST", path, body) as Promise<Response>,
    put: (path: string, body: unknown) => request("PUT", path, body) as Promise<Response>,
    postJson: <T>(path: string, body: unknown) => request<T>("POST", path, body, "json") as Promise<T>,
    uploadAsset: async (targetPath: string, bytes: ArrayBuffer): Promise<string> => {
      const r = await fetch(`${base}/asset?path=${encodeURIComponent(targetPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      if (!r.ok) throw new Error(await r.text());
      const { path } = (await r.json()) as { path: string };
      return path;
    },
    assetUrl: (target: string) => `${base}/asset?path=${encodeURIComponent(target)}`,
    eventsUrl: () => `${base}/events`,
    base: () => base,
  };
}

// Active transport. Defaults to HTTP against the runtime-resolved `BASE`; a
// mobile entrypoint may `setTransport(inProcessTransport())` before first use.
let transport: Transport = httpTransport(BASE);
/** Swap the active transport (e.g. an in-process one on iOS). Desktop never calls this. */
export const setTransport = (t: Transport): void => {
  transport = t;
};

/** Absolute URL for the SSE stream; passed to `new EventSource(...)`. */
export const eventsUrl = () => transport.eventsUrl();

// Thin call-site helpers that route through the active transport. Kept as
// free functions so the `api` object below reads exactly as before.
const getJson = <T>(path: string) => transport.getJson<T>(path);
const getText = (path: string) => transport.getText(path);
const post = (path: string, body: unknown) => transport.post(path, body);
const put = (path: string, body: unknown) => transport.put(path, body);
const postJson = <T>(path: string, body: unknown) => transport.postJson<T>(path, body);

export const api = {
  graph: () => getJson<GraphData>("/graph"),
  agentGraph: () => getJson<GraphData>("/agent-graph"),
  graphViews: () => getJson<{ second: ViewLayout; third: ViewLayout }>("/graph/views"),
  tree: () => getJson<TreeEntry[]>("/tree"),
  read: (path: string) => getText(`/file?path=${encodeURIComponent(path)}`),
  // Absolute URL to a vault file's BINARY bytes (image/PDF/audio/video), resolved
  // filename-first by the backend. Used as the `src` of an embed widget. Honors the
  // window's bound backend via the transport so multi-window/?api= previews load correctly.
  assetUrl: (target: string) => transport.assetUrl(target),
  // Upload pasted/dropped attachment bytes to `targetPath` (under the attachments
  // folder). The backend de-collides the name and returns the path actually written,
  // whose basename the caller inserts as `![[basename]]`.
  uploadAsset: (targetPath: string, bytes: ArrayBuffer): Promise<string> =>
    transport.uploadAsset(targetPath, bytes),
  // The server exposes file writes as PUT /file (POST /file 404s) — use PUT so
  // editor autosave + settings.yaml persistence actually reach disk.
  write: (path: string, contents: string) =>
    put("/file", { path, contents }).then(() => {}),
  backup: () => post("/backup", {}).then(() => {}),
  search: (query: string, opts: SearchOpts) =>
    postJson<SearchResult[]>("/search", { query, opts }),
  replace: (query: string, replacement: string, opts: SearchOpts, scope: string) =>
    postJson<{ replaced: number; files: string[] }>("/replace", { query, replacement, opts, scope }),
  meta: (path: string) =>
    getJson<Record<string, unknown>>(`/meta?path=${encodeURIComponent(path)}`),
  version: () =>
    getJson<{ version: number }>("/version"),
  schema: () => getJson<Schema>("/schema"),
  settings: () => getJson<Record<string, unknown>>("/settings"),
  base: (file: string) => getJson<ParsedBase>(`/base?file=${encodeURIComponent(file)}`),
  // Single source resolver: resolve a SourceSpec to Row[] server-side, following
  // base composition + scoped tasks. Replaces the per-kind client-side resolver.
  resolveRows: (spec: SourceSpec) => postJson<Row[]>("/rows", { spec }),
  rowCreate: (file: string, note: Record<string, unknown>) => post("/row/update", { file, index: null, note }),
  rowUpdate: (file: string, index: number, note: Record<string, unknown>) => post("/row/update", { file, index, note }),
  rowDelete: (file: string, index: number) => post("/row/delete", { file, index }),

  move: (from: string, to: string) => post("/move", { from, to }),
  del: (path: string) => postJson<{ trashPath: string }>("/delete", { path }),
  restore: (trashPath: string, to: string) => post("/restore", { trashPath, to }),
  create: (path: string, kind: "file" | "dir") => post("/create", { path, kind }),
  // Spawn a sibling backend pointed at `folder` (its own brain). Returns the new
  // backend's base URL; the caller opens a window with `?api=<url>` to show it.
  openFolder: (folder: string) => postJson<{ url: string; vault: string }>("/open-folder", { folder }),
  templates: () => getJson<Array<{ name: string; path: string }>>("/templates"),
  dailyNote: (id: string) => postJson<{ path: string; created: boolean }>("/daily-note", { id }),
  tasks: () => getJson<Task[]>("/tasks"),
  toggleTask: (path: string, line: number) => postJson<unknown>("/tasks/toggle", { path, line }),

  noteCards: (path: string) =>
    getJson<Card[]>(`/cards/note?path=${encodeURIComponent(path)}`),
  dueCards: () => getJson<Card[]>(`/cards/due`),
  reviewCard: (id: string, response: "hard" | "good" | "easy", question?: string) =>
    post("/cards/review", { id, response, question }),
  // Row-based review for a flashcard base: advances the row's due/ease/interval columns.
  reviewCardRow: (file: string, index: number, response: "hard" | "good" | "easy") =>
    post("/cards/review", { file, index, response }),

  setProperty: (path: string, key: string, value: unknown) => post("/set-property", { path, key, value }),
  deleteProperty: (path: string, key: string) => post("/delete-property", { path, key }),
  // Folders have no frontmatter — their icon override lives in settings.yaml.
  // An empty icon clears the override (back to the default folder icon).
  setFolderIcon: (path: string, icon: string) => post("/folder-icon", { path, icon }),
  // Persist a single setting by path (the backend merges it into settings.yaml in
  // place, preserving comments + the property registry + unknown keys).
  setSetting: (path: string[], value: unknown) => post("/set-setting", { path, value }).then(() => {}),
  saveDrawing: (path: string, doc: unknown) => post("/drawing/save", { path, doc }).then(() => {}),
};
