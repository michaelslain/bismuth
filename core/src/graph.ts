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
  /** For session-tier "agent" nodes only: which agent CLI is running in that tab (a backend id
   *  from agentBackends/catalog.ts — "claude", "codex", …). Several CLIs now report into one relay
   *  registry, so the label alone (a cwd basename) no longer says WHAT is running; the frontend
   *  renders this as a per-backend badge/tint. Absent on subagent nodes (they inherit their
   *  parent's backend) and on every non-agent node kind. */
  backend?: string;
  /** Precomputed 3D layout coordinate [x,y,z], attached by the backend (see layout-cache.ts). */
  position?: [number, number, number];
  /** Precomputed flat 2D layout coordinate [x,y] (z=0), for an instant + smooth 2D↔3D morph. */
  position2d?: [number, number];
  /** Louvain community id (stable color/group key), attached by the backend. Always the FINEST
   *  level of the hierarchy below — every existing consumer (colours, cluster legend, graph search
   *  subtitles) keeps reading exactly this one field. */
  community?: number;
  /** Exemplar name for the node's community (highest-degree member's label). Finest level. */
  communityLabel?: string;
  /**
   * Hierarchical community membership, COARSEST → FINEST ("clusters in clusters in clusters").
   * The last element is always `community`. Length is 1..4 and derives from the graph's total node
   * count (see `communityLevelsFor` in community.ts): 1 level below ~360 nodes, 2 to ~1620, 3 to
   * ~7290, 4 beyond. Levels are strictly NESTED — two nodes sharing a finest community share every
   * coarser one — and ids are densely renumbered PER LEVEL, so an id only means something paired
   * with its level index. Drives the nested community forces in layout.ts.
   */
  communityPath?: number[];
  /** Exemplar name per level, COARSEST → FINEST; same length as `communityPath`, last element is
   *  `communityLabel`. Same exemplar rule at every level: the highest-degree member of that level's
   *  community (tie → lexicographically smallest id), i.e. the biggest real hub inside it. */
  communityPathLabels?: string[];
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

/**
 * The LOCAL neighbourhood of one node: `centerId` plus every node within `depth` hops of it, in
 * either direction, and every edge among that set. Direction-agnostic on purpose — "what is this note
 * connected to" means both the notes it links out to AND the notes that link back (its backlinks), and
 * a local view that showed only one of those would be lying by omission.
 *
 * Returns an EMPTY graph when `centerId` isn't in `g` (no node, nothing local to show) rather than
 * falling back to the whole graph, which would silently turn a local view into a global one.
 *
 * Hierarchy fields (`community`, `communityPath`, `communityPathLabels`) are STRIPPED from the result.
 * They describe a node's place in the whole vault's community structure, which is meaningless inside a
 * one-note neighbourhood — and every consumer treats their absence as "one flat level" (see
 * AsciiGraphRenderer's colorLevelsFor), so dropping them is how
 * a local view says "no clustering here" without needing a flag threaded through the renderers.
 *
 * Positions are left untouched but are NOT meaningful for a local view — they came from a layout of
 * the whole vault, so a caller rendering this should re-run the layout over the subgraph.
 */
export function localSubgraph(g: GraphData, centerId: string, depth = 1): GraphData {
  if (!centerId || !g.nodes.some((n) => n.id === centerId)) return { nodes: [], edges: [] };
  const keep = new Set<string>([centerId]);
  let frontier = new Set<string>([centerId]);
  for (let hop = 0; hop < Math.max(1, depth); hop++) {
    const next = new Set<string>();
    for (const e of g.edges) {
      if (frontier.has(e.from) && !keep.has(e.to)) next.add(e.to);
      if (frontier.has(e.to) && !keep.has(e.from)) next.add(e.from);
    }
    if (next.size === 0) break;
    for (const id of next) keep.add(id);
    frontier = next;
  }
  const nodes = g.nodes
    .filter((n) => keep.has(n.id))
    .map(({ community, communityPath, communityPathLabels, ...rest }) => rest);
  return { nodes, edges: g.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
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
