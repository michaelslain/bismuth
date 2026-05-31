// Backend base URL. Defaults to the standard core port; override with VITE_API_BASE
// to run the frontend against a backend on a different port (e.g. alongside another worktree).
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4321";

import type { GraphData, TreeEntry } from "../../core/src/graph";
import type { Task } from "../../core/src/tasks";
import type { Card } from "../../core/src/srs/types";
import type { Row } from "../../core/src/bases/types";
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
  write: (path: string, contents: string) =>
    post("/file", { path, contents }).then(() => {}),
  backup: () => post("/backup", {}).then(() => {}),
  meta: (path: string) =>
    getJson<Record<string, unknown>>(`/meta?path=${encodeURIComponent(path)}`),
  config: () =>
    getJson<{ vault: string; memory: string | null }>("/config"),
  version: () =>
    getJson<{ version: number }>("/version"),
  vaultData: () => getJson<Row[]>("/vault-data"),
  schema: () => getJson<Schema>("/schema"),

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

  setProperty: (path: string, key: string, value: unknown) => post("/set-property", { path, key, value }),
};
