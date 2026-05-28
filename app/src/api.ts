// Backend base URL. Defaults to the standard core port; override with VITE_API_BASE
// to run the frontend against a backend on a different port (e.g. alongside another worktree).
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4321";
import type { GraphData, TreeEntry } from "../../core/src/graph";
import type { Task } from "../../core/src/tasks";
import type { Card } from "../../core/src/srs/types";
import type { Row } from "../../core/src/bases/types";

/** POST JSON; throw the server's error text on a non-2xx so callers can surface it in a toast. */
async function post(path: string, body: unknown): Promise<Response> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r;
}

export const api = {
  graph: () => fetch(`${BASE}/graph`).then((r) => r.json() as Promise<GraphData>),
  agentGraph: () => fetch(`${BASE}/agent-graph`).then((r) => r.json() as Promise<GraphData>),
  tree: () => fetch(`${BASE}/tree`).then((r) => r.json() as Promise<TreeEntry[]>),
  read: (path: string) => fetch(`${BASE}/file?path=${encodeURIComponent(path)}`).then((r) => r.text()),
  write: (path: string, contents: string) =>
    fetch(`${BASE}/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, contents }) }),
  backup: () => fetch(`${BASE}/backup`, { method: "POST" }),
  meta: (path: string) =>
    fetch(`${BASE}/meta?path=${encodeURIComponent(path)}`).then((r) => r.json() as Promise<Record<string, unknown>>),
  config: () =>
    fetch(`${BASE}/config`).then((r) => r.json() as Promise<{ vault: string; memory: string | null }>),
  version: () =>
    fetch(`${BASE}/version`).then((r) => r.json() as Promise<{ version: number }>),
  vaultData: () => fetch(`${BASE}/vault-data`).then((r) => r.json() as Promise<Row[]>),

  move: (from: string, to: string) => post("/move", { from, to }),
  del: (path: string) => post("/delete", { path }).then((r) => r.json() as Promise<{ trashPath: string }>),
  restore: (trashPath: string, to: string) => post("/restore", { trashPath, to }),
  create: (path: string, kind: "file" | "dir") => post("/create", { path, kind }),
  tasks: () => fetch(`${BASE}/tasks`).then((r) => r.json() as Promise<Task[]>),
  toggleTask: (path: string, line: number) => post("/tasks/toggle", { path, line }),

  noteCards: (path: string) =>
    fetch(`${BASE}/cards/note?path=${encodeURIComponent(path)}`).then((r) => r.json() as Promise<Card[]>),
  reviewCard: (id: string, response: "hard" | "good" | "easy", question?: string) =>
    post("/cards/review", { id, response, question }),

  setProperty: (path: string, key: string, value: unknown) => post("/set-property", { path, key, value }),
};
