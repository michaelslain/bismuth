export type NodeKind = "self" | "note" | "memory" | "agent";
export type EdgeKind = "link" | "message" | "about";
export type NodeState = "idle" | "awake" | "dead";

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  state?: NodeState;
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
