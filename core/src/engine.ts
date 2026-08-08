import { buildVaultGraph, resolveLinkTarget } from "./vault";
import { buildMemoryGraph } from "./memory";
import { mergeGraphs, type GraphData, type GraphEdge } from "./graph";
import { detectCommunityHierarchy } from "./community";

/**
 * Stamp `community` / `communityLabel` / `communityPath` / `communityPathLabels` onto each node from
 * the structural edge set. Uses only edges whose endpoints are both present (the same set used for
 * layout/degree). Mutates and returns `g`.
 *
 * The hierarchy's depth is a function of the graph's node count (community.ts
 * `communityLevelsFor`), so a small vault gets one flat level exactly as before and a big one gets
 * clusters nested up to 4 deep. `community`/`communityLabel` are always the FINEST level, so every
 * existing consumer is unaffected by the extra levels.
 *
 * Below `MIN_NODES_FOR_CLUSTERING`, skips detection entirely and leaves nodes unstamped: at that
 * size Louvain only ever finds a handful of near-empty groups, so the grouping is visual noise
 * rather than a useful organization of the graph.
 */
const MIN_NODES_FOR_CLUSTERING = 30;

function stampCommunities(g: GraphData): GraphData {
  if (g.nodes.length < MIN_NODES_FOR_CLUSTERING) return g;
  const present = new Set(g.nodes.map((n) => n.id));
  const structural = g.edges.filter((e) => present.has(e.from) && present.has(e.to));
  const assignments = detectCommunityHierarchy(
    // `kind` feeds the exemplar picker's tag preference (community.ts pickExemplar): a cluster whose
    // top-degree members include a tag is named "#school", not by a note's whole title.
    g.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind })),
    structural.map((e) => ({ from: e.from, to: e.to })),
  );
  for (const n of g.nodes) {
    const a = assignments.get(n.id);
    if (a) {
      n.community = a.community;
      n.communityLabel = a.label;
      n.communityPath = a.path;
      n.communityPathLabels = a.labels;
    }
  }
  return g;
}

export async function buildGraph(vaultDir: string, memoryDir?: string): Promise<GraphData> {
  const { graph: vault, byBase: vaultByBase, byPath: vaultByPath } = await buildVaultGraph(vaultDir);
  if (!memoryDir) return stampCommunities(vault);

  const memory = await buildMemoryGraph(memoryDir);
  const about: GraphEdge[] = [];
  for (const [rid, targets] of memory.links) {
    for (const t of targets) {
      // Resolve memory→vault "about" links by full path first, then basename, so a
      // path-qualified [[folder/Note]] reference in a memory note still links across.
      // `rid` is the memory note's full relative id, so subfolder notes reconstruct
      // their real `mem:` node id (a basename key produced dangling edges).
      const toId = resolveLinkTarget(t, vaultByBase, vaultByPath);
      if (toId) about.push({ from: `mem:${rid}`, to: toId, kind: "about" });
    }
  }
  const merged = mergeGraphs([vault, { nodes: memory.nodes, edges: [...memory.edges, ...about] }]);
  return stampCommunities(merged);
}
