# Graph Overview

This document is the canonical reference for Bismuth's knowledge graph data model: the eight node kinds, six edge kinds, five graph modes (2nd/3rd/both/agents/daemon), the "you" self hub, backend-precomputed 2D/3D layout, and the daemon-mode node-visual encoding. The graph is a shared data structure built by backend modules in `core/src/` and rendered by the Three.js WebGL renderer in `app/src/graph/`.

---

## Data Types

### `GraphNode`

Every node in the graph carries these fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | Unique identifier. Note nodes: vault-relative path without `.md` (e.g. `"reading/My Note"`). Tag nodes: `"tag:<name>"`. Memory nodes: `"mem:<basename>"`. Agent sessions: `"agent:sess:<sessionId>"`. Subagents: `"agent:sub:<agentId>"`. Daemon hub: `"::daemon"`. Crons: `"cron:<name>"`. Processes: `"process:<name>"`. Self: `"::you"`. |
| `label` | `string` | yes | Human-readable display name. |
| `kind` | `NodeKind` | yes | One of eight values (see Node Kinds below). |
| `state` | `"idle" \| "awake"` | no | Live activity state, used on `agent` nodes only. |
| `folder` | `string` | no | Top-level folder name for `note` nodes (e.g. `"reading"` for `reading/quotes/x.md`). Root-level notes get `"(root)"`. |
| `parent` | `string` | no | `agent` subagent nodes only: the node id of the spawning session node. Absent on root (terminal-tab) sessions. |
| `position` | `[number, number, number]` | no | Precomputed 3D layout coordinate `[x,y,z]`, attached by the backend (see Layout section). Integer-rounded. |
| `position2d` | `[number, number]` | no | Precomputed flat 2D coordinate `[x,y]` (z is always 0 and is dropped), for a smooth 2D/3D morph. |
| `community` | `number` | no | Louvain community id — a stable integer used as a color/group key. Absent on subgraphs (agents, daemon). |
| `communityLabel` | `string` | no | Label of the highest-degree member of the node's community (the exemplar). Absent on subgraphs. |
| `daemon` | `DaemonVizState` | no | Cron/process nodes only. Carries `enabled`, `running`, `lastResult`, `lastFiredMs`, and (crons only) `schedule`. Absent on all other node kinds. |

### `GraphEdge`

```ts
interface GraphEdge {
  from: string;  // source node id
  to: string;    // target node id
  kind: EdgeKind;
}
```

### `GraphData`

```ts
interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  views?: { second?: ViewLayout; third?: ViewLayout };
}
```

`views` carries per-brain-view precomputed layouts (see Layout section). Absent on subgraph responses (agents, daemon mode).

### `ViewLayout`

```ts
interface ViewLayout {
  pos3d: Record<string, [number, number, number]>;
  pos2d: Record<string, [number, number]>;
}
```

A self-contained set of 2D and 3D coordinates for one brain subset (second or third). Used when the user switches to 2nd-brain or 3rd-brain mode so cross-brain-linked nodes don't appear stranded far from their own cluster.

---

## Node Kinds

There are eight node kinds (`NodeKind`):

### `"note"`

A markdown file in the vault. Created by `buildVaultGraph()` in `vault.ts`.

- **id**: vault-relative path, `.md` extension stripped. Example: `"reading/My Note"` for the file `reading/My Note.md`.
- **label**: the filename without extension. Example: `"My Note"`.
- **folder**: top-level folder component. `"reading"` for `reading/quotes/x.md`; `"(root)"` for files directly in the vault root.
- **community/communityLabel**: present after `stampCommunities()` in `engine.ts`.

### `"tag"`

A hashtag that appears in frontmatter or note body. Created by `buildVaultGraph()` alongside note edges.

- **id**: `"tag:<name>"` (e.g. `"tag:book"` for `#book`).
- **label**: `"#<name>"` (e.g. `"#book"`).
- **folder**: absent.

### `"memory"`

A note from the Claude-bot memory directory. Created by `buildMemoryGraph()` in `memory.ts`.

- **id**: `"mem:<basename>"` (e.g. `"mem:michael-profile"` for `michael-profile.md` in the memory dir).
- **label**: the memory note's basename without `.md`.
- Exists in the 3rd-brain and "both" views only.

### `"self"`

The synthetic "you" hub that represents the user. There is exactly one self node per rendered brain view.

- **id**: always `"::you"` (the exported constant `SELF_NODE_ID`).
- **label**: `"You"`.
- **position**: always `[0, 0, 0]` — the center of the graph.
- **position2d**: always `[0, 0]`.
- **Critical**: the self node is injected entirely on the **frontend** (in `app/src/graph/youNode.ts`). The backend graph builders never emit it. Its `::` prefix can never collide with a vault note id.

### `"agent"`

A Claude Code session or subagent running inside one of Bismuth's terminal tabs. Created by `buildAgentGraph()` in `agents.ts`. Appears only in "agents" mode.

- **Session nodes** — id: `"agent:sess:<sessionId>"`. Label: `basename(cwd)`, falling back to `terminalId`. No `parent` field.
- **Subagent nodes** — id: `"agent:sub:<agentId>"`. Label: the `agentType` string (e.g. `"Explore"`, `"Plan"`, `"general-purpose"`). `parent` is the session's node id.
- **state**: `"awake"` if the session heartbeat within the last 10 minutes OR has a running (non-done) subagent; `"idle"` otherwise. Subagents: `"awake"` if not done, `"idle"` if done.
- No `community`, no `daemon`, no `folder`.

### `"daemon"`

The claude-bot daemon hub node. Created by `buildDaemonGraph()` in `daemonGraph.ts`. There is exactly one per daemon graph.

- **id**: `"::daemon"` (the exported constant `DAEMON_NODE_ID`).
- **label**: `"claude-bot"`.
- No `daemon` viz-state (that field is for `cron`/`process` children only).

### `"cron"`

A cron job managed by the claude-bot daemon. One per `*.md` file under `<home>/crons/`.

- **id**: `"cron:<name>"` (e.g. `"cron:daily-briefing"`).
- **label**: the cron's name from frontmatter (falls back to filename).
- **daemon** field is always present:
  - `enabled`: from frontmatter `enabled:` (default `true` when absent).
  - `running`: `true` if the cron's name appears in `.running.json`.
  - `lastResult`: from `.last-fired.json` (e.g. `"success"`, `"failed"`, `"unknown"`), or `null` if never run.
  - `lastFiredMs`: epoch-ms of last fire from `.last-fired.json`, or `null`.
  - `schedule`: the cron expression string from frontmatter (e.g. `"0 8 * * *"`).

### `"process"`

A process managed by the claude-bot daemon. One per `*.md` file under `<home>/processes/`.

- **id**: `"process:<name>"` (e.g. `"process:file-watcher"`).
- **label**: name from frontmatter.
- **daemon** field is always present:
  - `enabled`: from frontmatter.
  - `running`: always `false` (claude-bot does not expose a per-process liveness file).
  - `lastResult`: always `null`.
  - `lastFiredMs`: always `null`.
  - `schedule`: absent.

---

## Edge Kinds

There are six edge kinds (`EdgeKind`):

| Kind | From | To | Description |
|---|---|---|---|
| `"link"` | `note` | `note` | A `[[WikiLink]]` from one vault note to another. Resolved by `resolveLinkTarget()` — path-qualified `[[folder/Note]]` wins, then basename `[[Note]]`. Only created when the target note exists. |
| `"tag"` | `note` | `tag` | A note references a `#tag` (in frontmatter or body). |
| `"message"` | `memory` | `memory` | An inter-memory edge built by `buildMemoryGraph()`. Also used for `agent session → subagent` edges in agents mode. |
| `"about"` | `memory` | `note` | A cross-brain edge from a memory node to a vault note. Created when a memory note's wikilinks resolve to vault note ids. Resolution follows the same `byPath` then `byBase` logic as vault wikilinks. |
| `"open"` | `self` | `note` / `memory` | Created on the frontend by `withYouNode()` for every tab/pane that shows a note currently open in the app. Sentinel pane ids (`::settings`, `::graph`, terminal tabs, etc.) are excluded. |
| `"supervises"` | `daemon` | `cron` / `process` | Daemon hub to each cron or process child. The only edge kind in daemon mode. |

---

## Node Kind Sets by Brain View

The constants `SECOND_BRAIN_KINDS` and `THIRD_BRAIN_KINDS` in `graph.ts` define which node kinds belong to each sub-view filter:

```ts
const SECOND_BRAIN_KINDS = new Set<NodeKind>(["note", "tag"]);
const THIRD_BRAIN_KINDS  = new Set<NodeKind>(["memory"]);
```

The "both" view uses the full merged graph (no subset). Sub-views each get their own independent layout computed from their own node set, so cross-brain-linked nodes (e.g. a memory note that has an `"about"` edge to a vault note) don't appear stranded at the periphery when the other brain is hidden.

---

## Graph Modes

### Mode 1: `"both"` — Full Brain

The union of vault + memory. Built by `buildGraph(vaultDir, memoryDir)` in `engine.ts`:

1. Call `buildVaultGraph(vaultDir)` → `GraphData` with `note` + `tag` nodes + `link` + `tag` edges.
2. If `memoryDir` supplied: call `buildMemoryGraph(memoryDir)` → memory nodes + `message` edges.
3. For each memory note's wikilinks, resolve them against the vault `byBase`/`byPath` maps. Matches produce `"about"` edges from `"mem:<basename>"` to the vault note id.
4. Merge via `mergeGraphs()` (first-seen wins for duplicate node ids; all edges retained, including duplicates).
5. Run `stampCommunities()` (Louvain) on the merged graph → sets `community`/`communityLabel` on every node.
6. Attach precomputed 2D/3D positions via `attachLayout()`.

The frontend adds the `"self"` node via `withYouNode()`, which emits `"open"` edges to every currently-open note.

### Mode 2: `"2nd"` — Second Brain (Vault Only)

The backend builds the full "both" graph, then the frontend filters to nodes with `kind` in `SECOND_BRAIN_KINDS` (`"note"`, `"tag"`) using the `subgraphByKinds()` utility. The backend precomputes a dedicated sub-view layout via `computeViewLayouts()` — returned in `GraphData.views.second` — so positions are correct for the isolated note+tag set.

The `"self"` node (kind `"self"`) is NOT in `SECOND_BRAIN_KINDS` — `withYouNode()` adds it after view filtering on the frontend, prepending it to the filtered node list and attaching `"open"` edges.

### Mode 3: `"3rd"` — Third Brain (Memory Only)

Analogous to 2nd-brain mode. The backend's full "both" graph is filtered by `THIRD_BRAIN_KINDS` (`"memory"`). Sub-view layout is in `GraphData.views.third`. The `"self"` node is likewise injected by the frontend after filtering.

### Mode 4: `"agents"` — Live Claude Sessions

Completely separate graph from the vault/memory graph. Built by `buildAgentGraph()` in `agents.ts` over a `RelaySnapshot`:

1. The relay plugin running inside each terminal tab's Claude process POSTs to `/relay/*` as hooks fire.
2. `relay.ts` maintains an in-process registry of `RelaySession` and `RelaySubagent` objects.
3. At read time (GET `/agent-graph`), `prune()` is called with the live PTY id set, removing sessions whose terminal tab has closed and orphaned/expired subagents.
4. `buildAgentGraph(snapshot, liveTerminalIds, now)` filters sessions to those whose `terminalId` is in `liveTerminalIds`, then builds one `agent` node per session and one `agent` node per subagent whose parent session survived.
5. Session-to-subagent edges use kind `"message"`.
6. A session past the awake threshold (10 min since last heartbeat) is `"idle"` — but stays `"awake"` if it has a running (not-done) subagent.
7. The `"self"` node and `you→session` edges are injected by the frontend (same `withYouNode()` path as other modes), connecting the hub to every parent-less (root) agent node.

**No community detection** is run on the agents graph. No `community`/`communityLabel` fields. No `views` field on the response.

**Node ids are stable** for a given session/subagent pair. Session nodes: `"agent:sess:<sessionId>"`. Subagent nodes: `"agent:sub:<agentId>"`.

### Mode 5: `"daemon"` — Claude-Bot Daemon

Built by `daemonGraph()` in `daemonGraph.ts` from the daemon's on-disk state files. Never throws; degrades gracefully to an empty/partial snapshot on missing or malformed files.

1. Read `<home>/daemon.pid` and check PID liveness → hub node `running` flag.
2. Read each `<home>/crons/*.md` for cron definitions (name, schedule, enabled).
3. Read `<home>/crons/.last-fired.json` and `.running.json` for runtime state.
4. Read each `<home>/processes/*.md` for process definitions.
5. `buildDaemonGraph(snapshot)` emits: one `daemon` hub node, one `cron` node per cron (with `daemon` viz-state), one `process` node per process (with `daemon` viz-state), and `"supervises"` edges from the hub to each.
6. There is **no** `"self"` node in daemon mode — the `daemon` hub is the center. The frontend does NOT call `withYouNode()` for this mode.
7. No community detection. No `views` field.

The backend serves this at `GET /daemon/graph` (polled only while daemon mode is active).

---

## The "You" Self Node

The `"you"` hub is entirely a frontend construct, injected by `withYouNode()` in `app/src/graph/youNode.ts`.

```ts
export function withYouNode(g: GraphData, openContents: string[]): GraphData
```

- `g` — the already-filtered graph for the current mode (after sub-view filtering, before rendering).
- `openContents` — the list of content ids for all open tabs/panes (note paths, sentinel ids like `"::graph"`, terminal ids, etc.).

What it does:

1. Builds a `Set` of all current node ids in `g`.
2. Iterates `openContents`. Each entry is run through `contentToNodeId()`:
   - Entries starting with `"::"` (sentinels — settings, graph, terminals, etc.) → `null`, skipped.
   - Other entries: strip `.md` suffix → vault-path-style note id.
3. For each non-null id that exists in the graph's node set and hasn't already been linked, emit an `"open"` edge `{ from: "::you", to: id, kind: "open" }`.
4. Prepend a `GraphNode { id: "::you", label: "You", kind: "self", position: [0,0,0], position2d: [0,0] }` to the node list.

The self node is pinned at the layout origin. The renderer also fixes it there (`fx`/`fy`/`fz` in d3-force) and gives it an enlarged collision radius so a "clearing" of physics space opens around it.

**The self node is NOT injected in daemon mode.** The daemon hub (`"::daemon"`) serves as the center there.

---

## Backend-Precomputed 2D/3D Layout

Bismuth never runs a force simulation in the browser. All positions are computed on the backend, attached to nodes, and served via `/graph`. The frontend only morphs between them.

### Algorithm (`layout.ts`)

Two stages:

1. **PivotMDS** (`pivotMDS(adj, n, dim, numPivots)`) — deterministic, global placement from graph-theoretic BFS distances.
   - Selects `k` pivot nodes via max-min (k-center) sweep for spread.
   - BFS from each pivot → distance matrix.
   - Double-centers the squared-distance matrix, builds the `k×k` Gram matrix, finds top `dim` eigenvectors via power iteration with Gram-Schmidt deflation.
   - Projects all nodes onto the eigenvectors → `n×dim` coordinates.
   - Scales to a target RMS radius of 100 and adds a tiny deterministic jitter (LCG seeded at `0x85ebca6b`) to prevent coincident nodes.

2. **d3-force-3d refinement** — short force simulation seeded from PivotMDS output (or `initialPositions` for warm starts), same constants as the WebGL renderer.

Default constants (the `DEFAULTS` object in `layout.ts`):
```
numPivots:    50   (PivotMDS pivot count; O(k²·n) so halved from 100 for speed)
refineTicks:  150  (force ticks after PivotMDS seed; 120 in the cache path — REFINE_TICKS)
repulsion:    -10  (forceManyBody strength)
linkDistance: 5    (forceLink base distance; see small-graph boost + ×1.8 in 2D mode below)
centering:    0.13 (forceX/Y/Z strength toward origin)
linkStrength: 0.18 (LINK_STRENGTH; real edges only)
collideIterations: 6  (COLLIDE_ITERATIONS — must match renderer)
manybodyTheta:     1.5 (MANYBODY_THETA — Barnes-Hut approximation)
```

Plus the disconnected-component reel-in tuning (also in `DEFAULTS`):
```
virtualLinkStrength: 1.2  (tether-link strength; > LINK_STRENGTH so a stray is held in)
virtualAnchors:      4    (tether links per stray node; 0 disables the reel-in)
virtualDistMult:     0.8  (tether rest length = linkDist × this; short so it wins over repulsion)
```

#### Small-graph link-distance boost

The effective link distance is scaled **up** as the graph shrinks, so a handful of nodes (e.g. the daemon graph, or a fresh vault) spreads into an airy field instead of collapsing into a tight knot:

```ts
const smallBoost = n > 0 ? Math.min(8, Math.max(1, 400 / n)) : 1;
const linkDist   = o.linkDistance * smallBoost * (dim === 2 ? MODE_2D_SPACING : 1);
const collideFloor = linkDist * COLLIDE_RATIO;
```

The boost is ~8× at a few nodes and decays to 1× by ~400 nodes (large vaults unchanged). It is computed once in `prepareLayout` so the collide floor **and** the virtual-tether rest length share one spacing budget. This same formula is mirrored verbatim in the renderer's `WebGLRenderer.linkDist()` — both the precomputed layout and any live re-settle agree on spacing, so the renderer's warm-skip doesn't re-scramble the backend layout.

#### Reeling in disconnected components

A note with no in-view links is its own connected component; left alone, many-body repulsion flings it into an empty angular direction at the cloud's edge (and the recoil shoves the main mass off-center, so the pinned "you" hub drifts away). `prepareLayout` fixes this by tethering every node of a **small, non-main** component to a few anchors in the main mass via layout-only **virtual links** fed to the same force sim:

- `connectedComponents()` finds the components; the largest (ties → lowest member index) is the main mass.
- A component at or above the gate `max(4, mainSize × 0.25)` is a genuine island and is left alone — a legitimately multi-topic vault keeps its distinct clusters.
- For each small-component node, `virtualAnchors` (4) anchors are chosen deterministically via `fnv1a("<id>:<a>") % mainSize`. Each adds a `{ source, target, virtual: true }` link (rest length `linkDist × virtualDistMult`, strength `virtualLinkStrength`) and an entry in the BFS adjacency (so the PivotMDS seed places it near the mass too, not at a cap-distance fling).
- Virtual links are **layout-only** — never emitted as graph edges. The collide force resolves overlaps as the stray settles in (no teleport), so the emitted layout has no overlaps the warm renderer can't fix.
- Collide-radius degree uses `realDeg` (real edges only, captured before the tethers) so a tethered orphan isn't drawn/spaced as a hub.

Per-node collision radius is degree-scaled (hub nodes repel as the circles they are drawn as, not as points):
```ts
degreeScale(deg) = min(6, 0.4 + 0.45 * sqrt(deg))
drawnNodeRadius(scale) = (NODE_SIZE * scale * tan(FOV/2)) / 2
collideRadius(node, i) = max(linkDistance * 1.25, drawnNodeRadius(degreeScale(adj[i].length)) * 1.55)
```

### Caching (`layout-cache.ts`)

Two-tier:

1. **In-memory**: `Map<sig, Layout>` within a server run.
2. **On-disk**: JSON files in `os.tmpdir()/oa-layout/<sig>.json`, versioned by `CACHE_VERSION` (currently `"v8"`).

`CACHE_VERSION` **must be bumped whenever the layout output changes** (constants, the small-graph boost, the reel-in) — a stale cached layout computed under different rules would mismatch what the renderer settles to. The version comments record the history: `v5` = collide iterations 3→6 + padding 1.25→1.55; `v6` = small-graph linkDist boost added; `v7` = stronger `400/n` (cap 8) boost; `v8` = reel disconnected components into the main mass via virtual tether links.

Cache key (`graphSig`): SHA-1 of `vaultKey + sorted node ids + sorted "from|to|kind" edges`. Retargeting a wikilink (same node set, same edge count, different endpoint) still busts the cache.

**Warm starts**: the last full-graph layout per vault is kept in `lastFullLayout`. On a structural edit, the new layout is seeded from the prior positions (`initialPositions`), skipping PivotMDS. Unchanged nodes barely move — the layout stays stable across edits.

**2D seeded from 3D**: the 2D layout is seeded from the flattened 3D positions (`initialPositions: pos3d`) so the two stay geometrically aligned. A 2D/3D morph flattens in place rather than scrambling.

**Sub-view layouts**: brain-subset layouts (2nd = note+tag, 3rd = memory) are only recomputed when needed. `attachLayout()` includes them in the `/graph` response only if already cached (cheap peek). If absent, they're computed on demand via `GET /graph/views`; the frontend uses full-graph positions as a fallback until the sub-view positions arrive.

**Server hot path**: `computeLayoutAsync()` yields to the event loop every 16 force ticks (via `setImmediate`) so a large graph settle doesn't block concurrent requests. Output is numerically identical to the sync path.

### Attaching Positions

`attachLayout(graph, vaultKey)` mutates each node to add `position: [x,y,z]` and `position2d: [x,y]`. The `position2d` field is always two elements (the trailing `z=0` is stripped). Nodes not in the layout (e.g. the `"self"` node added client-side) keep no position fields and are pinned at `[0,0,0]` by the renderer.

---

## Graph Atmosphere (`GraphAtmosphere.tsx`)

`GraphAtmosphere` is the shared CSS overlay that gives every graph its iridescent cluster-glow + depth vignette. It is extracted into one component so the main `GraphView` and the first-run intro graph render the same atmosphere instead of duplicating the divs + glow wiring.

```tsx
export function GraphAtmosphere(props: { renderer: WebGLRenderer; mode?: string }): JSX.Element
```

- Render it as a **sibling after** the renderer's `<canvas>` inside a positioned container; it fills that container (`inset: 0`). Styling lives in `graphAtmosphere.css`.
- It emits two divs: `.graph-glow` (carries the `data-mode` attribute, so a mode can theme its glow) and `.graph-vignette`.
- On mount it calls `renderer.setGlowCallback(...)`. Each frame the renderer projects the centroids of the **3 largest clusters** to screen percentages and pushes them as `{ lobes }`; the callback writes them onto the glow element as `--glow-x{1..3}` / `--glow-y{1..3}` CSS variables. The glow lobes thus ride the clusters as they orbit, idle-spin, and zoom. The renderer pads the lobe list to 3 entries so all three CSS variables always have a target.

---

## Daemon Node Visual Encoding (`daemonViz.ts`)

The `nodeVisualState(state, now?)` function is the single dial that maps a `cron`/`process` node's `DaemonVizState` to visual tokens. It is **pure** and used only for daemon-mode nodes.

### Inputs

```ts
interface DaemonVizState {
  enabled: boolean;
  running: boolean;
  lastResult: string | null;   // "success" | "failed" | "unknown" | null
  lastFiredMs: number | null;  // epoch-ms of last run, or null
  schedule?: string;           // cron expression, cron nodes only
}
```

**Only `enabled` and `running` drive the visual output.** `lastResult`, `lastFiredMs`, and `schedule` are present for display in the sidebar but are intentionally NOT used by `nodeVisualState`.

### Output Tokens

```ts
type DaemonFill   = "base" | "bg" | "palette";
type DaemonBorder = "palette" | "none";

interface DaemonVisual {
  fill:    DaemonFill;
  border:  DaemonBorder;
  opacity: number;  // 0..1
}
```

Tokens are abstract — the renderer resolves them against the live theme and the node's stable per-id palette color:

- `fill "base"` — the muted default daemon fill (resolved from `daemonNeutral`).
- `fill "bg"` — the canvas background (`--bg`); the node reads as a hollow outline (only the border ring is visible).
- `fill "palette"` — a stable per-node palette color (running node, solid).
- `border "palette"` — a crisp ring in the node's stable palette color.
- `border "none"` — no border ring.

### Three Visual States (Precedence: first match wins)

| Condition | fill | border | opacity | Description |
|---|---|---|---|---|
| `enabled === false` | `"base"` | `"none"` | `0.15` | Disabled — dim, hollow, greyed out. Wins over all other conditions. |
| `running === true` | `"palette"` | `"none"` | `1` | Running — solid palette color. Overrides plain-enabled. |
| `enabled && !running` | `"bg"` | `"palette"` | `1` | Enabled-idle — hollow dot (background fill) with a crisp palette-colored border ring. |

**Disabled wins even if `running` is also `true`** — a disabled cron can't meaningfully be running.

```ts
// Concrete examples from the test suite:
nodeVisualState({ enabled: false, running: false, ...})
// → { fill: "base", border: "none", opacity: 0.15 }

nodeVisualState({ enabled: false, running: true, ... })
// → { fill: "base", border: "none", opacity: 0.15 }  // disabled wins

nodeVisualState({ enabled: true, running: false, ... })
// → { fill: "bg", border: "palette", opacity: 1 }

nodeVisualState({ enabled: true, running: true, ... })
// → { fill: "palette", border: "none", opacity: 1 }
```

The `now` parameter is accepted for call-site stability / future use but is currently unused.

---

## Utility Functions

### `subgraphByKinds(g, kinds)` (`graph.ts`)

Pure function. Returns a new `GraphData` containing only nodes whose `kind` is in `kinds`, and only edges whose both endpoints survived the filter. Used by `layout-cache.ts` to compute sub-view layouts and by the frontend mode filter.

```ts
subgraphByKinds(g, new Set(["note", "tag"]))  // → second-brain subgraph
subgraphByKinds(g, new Set(["memory"]))        // → third-brain subgraph
```

### `mergeGraphs(graphs)` (`graph.ts`)

Pure function. Concatenates node arrays (first-seen wins for duplicate ids) and concatenates all edges (including duplicates). Used by `engine.ts` to combine vault + memory graphs.

```ts
// Duplicate nodes: first graph wins
mergeGraphs([
  { nodes: [{ id: "x", label: "First", kind: "note" }], edges: [] },
  { nodes: [{ id: "x", label: "Second", kind: "note" }], edges: [] },
])
// → nodes: [{ id: "x", label: "First", ... }]  — "First" preserved
```

### `emptyGraph()` (`graph.ts`)

Returns `{ nodes: [], edges: [] }`.

### `graphSig(graph, vaultKey)` (`layout-cache.ts`)

Returns a string cache key `"v8-<16-char-sha1>"` from the node id set, edge `from|to|kind` triples, and vault path. Stable across content-only file edits (which don't change node/edge structure).

---

## Graph Builder Pipeline Summary

```
vault/               memory/
buildVaultGraph()    buildMemoryGraph()
      |                    |
      +----engine.ts-------+
      |    buildGraph()
      |    + about edges
      |    + stampCommunities()
      |
  attachLayout()  (layout-cache.ts)
      |
  GET /graph      (core/src/server.ts)
      |
  withYouNode()   (app/src/graph/youNode.ts)  [frontend]
      |
  WebGLRenderer + LabelLayer
```

For daemon mode:

```
~/.claude-bot/crons/*.md
~/.claude-bot/processes/*.md
~/.claude-bot/.last-fired.json
      |
  daemonSnapshot()   (daemonGraph.ts)
  buildDaemonGraph()
      |
  GET /daemon/graph
      |
  DaemonList + WebGLRenderer  [frontend, no withYouNode()]
```

For agents mode:

```
terminal tab (PTY) → relay plugin hooks
      |
  relay.ts registry (registerSession, startSubagent, stopSubagent, prune)
      |
  buildAgentGraph()  (agents.ts)
      |
  GET /agent-graph
      |
  withYouNode()   [frontend, connects hub to root session nodes]
      |
  WebGLRenderer + LabelLayer
```

---

## Key Invariants and Gotchas

- **The `"self"` node is frontend-only.** Never emitted by backend graph builders. Injected by `withYouNode()` at render time. Not present in agents mode or daemon mode.
- **Layout is backend-only.** The browser never runs a force simulation. Positions come from `position` / `position2d` fields on nodes. The renderer morphs between them.
- **Sub-view layouts may be absent on first load.** `GET /graph` only includes `views.second`/`views.third` if already cached. The frontend falls back to full-graph positions until `GET /graph/views` responds.
- **Cache is written to `os.tmpdir()`, not the vault.** Writing inside the vault would trigger the fs watcher and cause an infinite invalidate→rebuild loop.
- **`mergeGraphs` keeps duplicate edges.** Two memory notes can both reference the same vault note and both produce `"about"` edges to it — this is by design.
- **Agent graph drops closed-tab sessions.** A session whose terminal tab is closed is dropped at `GET /agent-graph` read time (prune against live PTY ids). There is no terminal-close hook in Claude Code; cleanup happens lazily.
- **Wikilink resolution is basename-first.** `[[My Note]]` matches `My Note.md` anywhere in the vault. `[[reading/My Note]]` matches by full path first, then falls back to basename. Ambiguous basename matches are undefined.
- **`CACHE_VERSION` must be bumped when layout output changes** — not just force constants, but the small-graph boost and the disconnected-component reel-in too. The current version is `"v8"`. A stale cached layout computed under different rules would mismatch the renderer's forces.
- **`now` in `nodeVisualState` is a no-op.** `lastResult` and `lastFiredMs` do not drive the visual encoding — only `enabled` and `running` matter.

---

Source: `core/src/graph.ts`, `core/src/layout.ts`, `core/src/layout-cache.ts`, `core/src/engine.ts`, `core/src/daemonViz.ts`, `core/src/daemonGraph.ts`, `core/src/agents.ts`, `app/src/graph/youNode.ts`, `app/src/graph/WebGLRenderer.ts`, `app/src/graph/GraphAtmosphere.tsx`, `core/src/relay.ts`, `core/src/vault.ts`, `core/test/graph.test.ts`, `core/test/daemonViz.test.ts`, `core/test/agents.test.ts`, `core/test/engine.test.ts`
