// app/src/graph/graphStability.ts
//
// Pure guards that keep the knowledge graph's SHAPE and CAMERA stable across re-fetches.
//
// The renderer used to fold node POSITIONS into its render signature, so any position delta for
// an otherwise-identical graph (the async 2nd/3rd-brain view layout replacing the full-graph
// fallback, a boot localStorage->server reconcile, a warm re-settle that lands a node a few px
// over) forced a full rebuild — which recomputed the layout AND reset the camera. The graph would
// "randomly change shape" and snap back to overview on an edit/resize/refetch even though its
// structure never changed.
//
// These two pure functions restore the invariant "same structure -> same shape + same camera":
//   - structuralGraphSig() ignores positions entirely, so a same-structure re-fetch is a no-op
//     for the renderer (it keeps the shape it already settled).
//   - shouldResetView() lets the renderer reset the camera ONLY when the visible node set changes
//     substantially (a mode switch / brand-new graph), never on an incremental edit to the graph
//     you're already looking at.
//
// Framework-free (no Solid, no canvas) so they're unit-tested in isolation (graphStability.test.ts).

interface StabilityNode {
  id: string;
  daemon?: { enabled: boolean; running: boolean } | null;
}
interface StabilityEdge {
  from: string;
  to: string;
}
interface StabilityGraph {
  nodes: readonly StabilityNode[];
  edges: readonly StabilityEdge[];
}

/**
 * A signature of the graph's STRUCTURE only — its node set, edge endpoints, and daemon
 * enabled/running state — with node coordinates deliberately excluded. Two graphs that differ
 * ONLY in their precomputed positions hash identically, so the renderer treats a position-only
 * re-fetch as "no change" and keeps its established shape. A real structural change (a node/edge
 * added, removed, or retargeted; a cron flipping running) changes the signature and triggers a
 * rebuild. O(n + m), mirrors the renderer's old signature() minus the position fold.
 */
export function structuralGraphSig(g: StabilityGraph): string {
  let h = 0;
  for (const e of g.edges) {
    let x = 2166136261;
    const s = e.from + "\0" + e.to;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
    h = (h + (x >>> 0)) >>> 0;
  }
  // Per-node id + daemon state (fill/border encoding). Positions are intentionally NOT included.
  const ds = g.nodes
    .map((n) => (n.daemon ? `${n.id}:${n.daemon.enabled ? 1 : 0}${n.daemon.running ? 1 : 0}` : n.id))
    .join(",");
  return `${g.nodes.length}|${g.edges.length}|${h >>> 0}|${ds}`;
}

/**
 * Whether a rebuild should snap the camera back to the whole-graph overview. TRUE only when the
 * incoming node set barely overlaps the one currently shown — i.e. it's a different graph (a mode
 * switch, or the very first graph, when there is no prior set). An incremental edit to the graph
 * you're already looking at (add/remove a note, open a tab so the "you" hub gains an edge) keeps a
 * high overlap and returns FALSE, so the user's zoom/pan/orbit is preserved instead of yanked.
 *
 * Overlap is |prev ∩ next| / max(|prev|, |next|); below `threshold` (default 0.5) counts as a new
 * graph. An empty prior set (first render) always resets.
 */
export function shouldResetView(
  prevIds: ReadonlySet<string>,
  nextNodes: readonly { id: string }[],
  threshold = 0.5,
): boolean {
  if (prevIds.size === 0) return true; // first graph — no camera to preserve
  let common = 0;
  for (const n of nextNodes) if (prevIds.has(n.id)) common++;
  const denom = Math.max(prevIds.size, nextNodes.length);
  if (denom === 0) return true;
  return common / denom < threshold;
}
