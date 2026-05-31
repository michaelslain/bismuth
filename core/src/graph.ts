export type NodeKind = "note" | "memory" | "agent" | "tag";
export type EdgeKind = "link" | "message" | "about" | "tag";

// Node kinds belonging to each brain VIEW, mirrored by the frontend's mode filter.
// "both" is the full graph (no subset). Each sub-view is laid out on its OWN node set
// so cross-brain-linked nodes aren't stranded far from their cluster when the other brain is hidden.
export const SECOND_BRAIN_KINDS = new Set<NodeKind>(["note", "tag"]);
export const THIRD_BRAIN_KINDS = new Set<NodeKind>(["memory"]);
export type NodeState = "idle" | "awake";

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  state?: NodeState;
  folder?: string;
  /** Precomputed 3D layout coordinate [x,y,z], attached by the backend (see layout-cache.ts). */
  position?: [number, number, number];
  /** Precomputed flat 2D layout coordinate [x,y] (z=0), for an instant + smooth 2D↔3D morph. */
  position2d?: [number, number];
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}
/**
 * A self-contained precomputed layout for one brain VIEW (2nd / 3rd), keyed by node id. The "both"
 * view uses the positions baked onto the nodes themselves; the sub-views need their own layouts
 * because slicing the full layout strands cross-brain-linked nodes (see layout-cache.ts).
 */
export interface ViewLayout {
  pos3d: Record<string, [number, number, number]>;
  pos2d: Record<string, [number, number]>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Per-view layouts for the brain subsets, so 2nd/3rd render their own layout instead of a
   *  stranded slice of the full ("both") layout. Absent on subgraph responses (agents, etc.). */
  views?: { second?: ViewLayout; third?: ViewLayout };
}

/** Subgraph containing only nodes of the given kinds and the edges between them (pure). */
export function subgraphByKinds(g: GraphData, kinds: Set<NodeKind>): GraphData {
  const nodes = g.nodes.filter((n) => kinds.has(n.kind));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: g.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

/** A vault entry surfaced by /tree: a markdown file (with optional `icon` frontmatter) or a directory. */
export interface TreeEntry {
  path: string;
  icon?: string;
  kind: "file" | "dir";
}

export function emptyGraph(): GraphData {
  return { nodes: [], edges: [] };
}

export function mergeGraphs(graphs: GraphData[]): GraphData {
  const byId = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  for (const g of graphs) {
    for (const n of g.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
    edges.push(...g.edges);
  }
  return { nodes: [...byId.values()], edges };
}
