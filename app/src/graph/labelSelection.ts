// app/src/graph/labelSelection.ts
// Pure helper for the LabelLayer: which nodes get a permanent label regardless of camera state.
// Combines top-degree hubs with the currently-open file.
// Pure (no DOM, no Three.js) so it can be unit-tested directly.

type NodeLike = { id: string; kind: string };
type EdgeEndpoint = string | { id: string };
type EdgeLike = { source: EdgeEndpoint; target: EdgeEndpoint };

function endpointId(e: EdgeEndpoint): string {
  return typeof e === "object" ? e.id : (e as string);
}

/**
 * Return the union of: top-`hubCount` nodes by edge degree and `activeFile` (if present and in the
 * node list). Ties in degree are broken by id (lexicographically ascending) so the choice is
 * deterministic across renders.
 *
 * Degree is computed as undirected degree (total connections, in or out — counts both source and target).
 */
export function computeAlwaysOnSet(
  nodes: NodeLike[],
  edges: EdgeLike[],
  activeFile: string | null,
  hubCount: number,
): Set<string> {
  const result = new Set<string>();
  if (nodes.length === 0) return result;
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Active file, if it actually exists in the graph.
  if (activeFile && nodeIds.has(activeFile)) result.add(activeFile);

  // Top-N by undirected degree.
  if (hubCount > 0) {
    const deg = new Map<string, number>();
    for (const n of nodes) deg.set(n.id, 0);
    for (const e of edges) {
      const s = endpointId(e.source);
      const t = endpointId(e.target);
      if (deg.has(s)) deg.set(s, (deg.get(s) ?? 0) + 1);
      if (deg.has(t)) deg.set(t, (deg.get(t) ?? 0) + 1);
    }
    const ranked = nodes
      .map((n) => ({ id: n.id, d: deg.get(n.id) ?? 0 }))
      .sort((a, b) => (b.d - a.d) || a.id.localeCompare(b.id));
    for (let i = 0; i < Math.min(hubCount, ranked.length); i++) {
      result.add(ranked[i].id);
    }
  }

  return result;
}
