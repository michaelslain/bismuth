import { buildVaultGraph, resolveLinkTarget } from "./vault";
import { buildMemoryGraph } from "./memory";
import { mergeGraphs, type GraphData, type GraphEdge } from "./graph";

export async function buildGraph(vaultDir: string, memoryDir?: string): Promise<GraphData> {
  const { graph: vault, byBase: vaultByBase, byPath: vaultByPath } = await buildVaultGraph(vaultDir);
  if (!memoryDir) return vault;

  const memory = await buildMemoryGraph(memoryDir);
  const about: GraphEdge[] = [];
  for (const [base, targets] of memory.links) {
    for (const t of targets) {
      // Resolve memory→vault "about" links by full path first, then basename, so a
      // path-qualified [[folder/Note]] reference in a memory note still links across.
      const toId = resolveLinkTarget(t, vaultByBase, vaultByPath);
      if (toId) about.push({ from: `mem:${base}`, to: toId, kind: "about" });
    }
  }
  return mergeGraphs([vault, { nodes: memory.nodes, edges: [...memory.edges, ...about] }]);
}
