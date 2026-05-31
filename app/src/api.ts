// Backend base URL. Defaults to the standard core port; override with VITE_API_BASE
// to run the frontend against a backend on a different port (e.g. alongside another worktree).
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4321";

import type { GraphData, TreeEntry } from "../../core/src/graph";
import type { Task } from "../../core/src/tasks";
import type { Card } from "../../core/src/srs/types";
import type { Row, ParsedBase, SourceSpec } from "../../core/src/bases/types";
import type { Schema } from "../../core/src/schema/types";

/** Absolute URL for the SSE stream; passed to `new EventSource(...)`. */
export const eventsUrl = () => `${BASE}/events`;

/** Throw server error text on non-2xx response. */
async function checkOk(r: Response): Promise<void> {
  if (!r.ok) throw new Error(await r.text());
}

/** GET and parse JSON; throw the server's error text on a non-2xx so callers can surface it in a toast. */
async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  await checkOk(r);
  return r.json() as Promise<T>;
}

/** POST JSON; throw the server's error text on a non-2xx so callers can surface it in a toast. */
async function post(path: string, body: unknown): Promise<Response> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await checkOk(r);
  return r;
}

/** PUT JSON; throw the server's error text on a non-2xx. Used for file writes (PUT /file). */
async function put(path: string, body: unknown): Promise<Response> {
  const r = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await checkOk(r);
  return r;
}

/** POST JSON and parse response; throw the server's error text on a non-2xx. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await post(path, body);
  return r.json() as Promise<T>;
}

async function getText(path: string): Promise<string> {
  const r = await fetch(`${BASE}${path}`);
  await checkOk(r);
  return r.text();
}

export const api = {
  graph: () => getJson<GraphData>("/graph"),
  agentGraph: () => getJson<GraphData>("/agent-graph"),
  tree: () => getJson<TreeEntry[]>("/tree"),
  read: (path: string) => getText(`/file?path=${encodeURIComponent(path)}`),
  // The server exposes file writes as PUT /file (POST /file 404s) — use PUT so
  // editor autosave + settings.yaml persistence actually reach disk.
  write: (path: string, contents: string) =>
    put("/file", { path, contents }).then(() => {}),
  backup: () => post("/backup", {}).then(() => {}),
  meta: (path: string) =>
    getJson<Record<string, unknown>>(`/meta?path=${encodeURIComponent(path)}`),
  config: () =>
    getJson<{ vault: string; memory: string | null }>("/config"),
  version: () =>
    getJson<{ version: number }>("/version"),
  vaultData: () => getJson<Row[]>("/vault-data"),
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
  tasks: () => getJson<Task[]>("/tasks"),
  toggleTask: (path: string, line: number) => postJson<unknown>("/tasks/toggle", { path, line }),

  noteCards: (path: string) =>
    getJson<Card[]>(`/cards/note?path=${encodeURIComponent(path)}`),
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
};
