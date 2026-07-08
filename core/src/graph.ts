export type NodeKind = "note" | "memory" | "agent" | "tag" | "self" | "daemon" | "cron" | "process";
export type EdgeKind = "link" | "message" | "about" | "tag" | "open" | "supervises";

/**
 * Id of the synthetic "you" hub. There is one self node per brain VIEW, injected on the FRONTEND
 * (it's keyed off open tabs/panes — pure client state), not by the backend graph builders. The
 * sentinel-style `::` prefix can never collide with a note id (a vault path minus ".md").
 */
export const SELF_NODE_ID = "::you";

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
  /** For "agent" nodes only: the id of the parent node (a subagent's spawning session).
   *  Roots (terminal-tab sessions) have no parent; the frontend connects the "you" hub
   *  to every parent-less agent node in agents mode. */
  parent?: string;
  /** For subagent "agent" nodes only: the workflow-group key this subagent belongs to
   *  (a workflow orchestration script that spawned it, reported by the relay). Subagents
   *  spawned by the same workflow share this key; ordinary (non-workflow) subagents leave
   *  it undefined and render exactly as before. Drives the special-looking workflow lane
   *  in agents mode. */
  workflow?: string;
  /** Precomputed 3D layout coordinate [x,y,z], attached by the backend (see layout-cache.ts). */
  position?: [number, number, number];
  /** Precomputed flat 2D layout coordinate [x,y] (z=0), for an instant + smooth 2D↔3D morph. */
  position2d?: [number, number];
  /** Louvain community id (stable color/group key), attached by the backend. */
  community?: number;
  /** Exemplar name for the node's community (highest-degree member's label). */
  communityLabel?: string;
  /** Daemon-mode viz state (cron/process nodes only). Drives per-node opacity + tint in the
   *  renderer via `nodeVisualState`. Absent on every other node kind / graph mode. */
  daemon?: DaemonVizState;
}

/** Per-node visual-state inputs carried on daemon/cron/process nodes (consumed by `nodeVisualState`). */
export interface DaemonVizState {
  /** Cron/process enabled flag (disabled → greyed out). */
  enabled: boolean;
  /** Currently executing (running → full opacity + accent). */
  running: boolean;
  /** Result of the most recent run ("success" | "failed" | "unknown" | null = never ran). */
  lastResult: string | null;
  /** Epoch-ms of the last run, or null if it has never fired (idle → faded). */
  lastFiredMs: number | null;
  /** Cron expression from the cron definition file (cron nodes only; absent on process nodes,
   *  and on a `file-change` cron, which has no schedule). */
  schedule?: string;
  /** Trigger kind (cron nodes only). "schedule" (the default) fires on `schedule`'s cron
   *  expression; "file-change" fires when `watch` (a vault-relative path/glob) changes. */
  on?: "schedule" | "file-change";
  /** Vault-relative path/glob this cron watches (cron nodes only, `on: "file-change"` only). */
  watch?: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** For agents-mode session→subagent edges only: the workflow-group key when this
   *  connection belongs to a workflow (see GraphNode.workflow). Marks the edge as a
   *  workflow-lane connection so the renderer draws it distinctly from an ordinary
   *  session→subagent edge. Undefined on every other edge (ordinary rendering). */
  workflow?: string;
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
  /** True for the .settings / .daemon system folders — rendered distinctly, guarded from rename/delete. */
  isSystemFolder?: boolean;
  /** Display label override (e.g. the .daemon folder shows the configured daemon name). */
  label?: string;
  /**
   * AI visibility. Two different things depending on where the entry came from:
   * straight out of `listTree` this is the file's OWN raw explicit frontmatter value
   * (rarely "all" — an explicit override of an ancestor folder's rule); on the `GET
   * /tree` response it has been REPLACED with the RESOLVED cascade value (core/src/
   * visibility.ts `resolveVisibility`/`resolveFolderVisibility`, folded against the
   * folderVisibility settings map) and omitted entirely when resolved to "all" (like
   * `icon`). Directories never carry a raw value (folders have no frontmatter) — only
   * the resolved one, stamped by the same overlay. Because the badge (this field) and
   * the enforcement gate (`buildDenyPaths`) both call the same resolver, the tree can
   * never disagree with what chat.ts/the daemon actually do.
   */
  visibility?: "all" | "chat-only" | "hidden";
  /**
   * The node's OWN explicit setting (unresolved) — a file's own frontmatter value, or a
   * folder's own `folderVisibility` entry — omitted when absent (or, rarely, an explicit
   * file-level "all" override; that edge case doesn't need separate UI treatment since
   * choosing "Visible to Daemon + Chat" always clears the property either way). Only
   * present on the `GET /tree` response; used by the FileTree context menu to checkmark
   * the active row and to name the ancestor folder responsible when `visibility` (the
   * resolved value) differs from it.
   */
  ownVisibility?: "chat-only" | "hidden";
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
