export type NodeKind = "self" | "note" | "memory" | "agent" | "tag";
export type EdgeKind = "link" | "message" | "about" | "tag";
export type NodeState = "idle" | "awake" | "dead";

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  state?: NodeState;
  folder?: string;
  /** Precomputed 3D layout coordinate [x,y,z], attached by the backend (see layout-cache.ts). */
  position?: [number, number, number];
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
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
