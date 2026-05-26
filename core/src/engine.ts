import { basename } from "node:path";
import { buildVaultGraph, noteId } from "./vault";
import { buildMemoryGraph } from "./memory";
import { mergeGraphs, type GraphData, type GraphEdge, type GraphNode } from "./graph";
import { listMarkdown } from "./files";

const SELF: GraphNode = { id: "self", label: "You", kind: "self" };

export async function buildGraph(vaultDir: string, memoryDir?: string): Promise<GraphData> {
  const vault = await buildVaultGraph(vaultDir);
  const selfGraph: GraphData = { nodes: [SELF], edges: [] };
  if (!memoryDir) return mergeGraphs([selfGraph, vault]);

  const memory = await buildMemoryGraph(memoryDir);
  const vaultByBase = new Map<string, string>();
  for (const rel of await listMarkdown(vaultDir)) {
    vaultByBase.set(basename(noteId(rel)), noteId(rel));
  }
  const about: GraphEdge[] = [];
  for (const [base, targets] of memory.links) {
    for (const t of targets) {
      const toId = vaultByBase.get(t);
      if (toId) about.push({ from: `mem:${base}`, to: toId, kind: "about" });
    }
  }
  return mergeGraphs([selfGraph, vault, { nodes: memory.nodes, edges: [...memory.edges, ...about] }]);
}
