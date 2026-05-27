const BASE = "http://localhost:4321";
import type { GraphData } from "../../core/src/graph";

export const api = {
  graph: () => fetch(`${BASE}/graph`).then((r) => r.json() as Promise<GraphData>),
  agentGraph: () => fetch(`${BASE}/agent-graph`).then((r) => r.json() as Promise<GraphData>),
  tree: () => fetch(`${BASE}/tree`).then((r) => r.json() as Promise<string[]>),
  read: (path: string) => fetch(`${BASE}/file?path=${encodeURIComponent(path)}`).then((r) => r.text()),
  write: (path: string, contents: string) =>
    fetch(`${BASE}/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, contents }) }),
  backup: () => fetch(`${BASE}/backup`, { method: "POST" }),
  meta: (path: string) =>
    fetch(`${BASE}/meta?path=${encodeURIComponent(path)}`).then((r) => r.json() as Promise<Record<string, unknown>>),
  config: () =>
    fetch(`${BASE}/config`).then((r) => r.json() as Promise<{ vault: string; memory: string | null }>),
};
