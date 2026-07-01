# Graph Overview

This document is the canonical reference for Bismuth's knowledge graph data model: the eight node kinds, six edge kinds, five graph modes (2nd/3rd/both/agents/daemon), the "you" self hub, backend-precomputed 2D/3D layout, and the daemon-mode node-visual encoding. The graph is a shared data structure built by backend modules in `core/src/` and rendered by the Canvas-2D `CanvasGraphRenderer` in `app/src/graph/` (a plain `getContext("2d")` canvas — not WebGL/GPU, not DOM nodes; nodes, edges, and labels are all rasterized in one draw pass per frame). "Agents" mode additionally gets a small pure-DOM overlay (`AgentsGraph.tsx`) layered on top of the canvas for its status card + organization picker — it draws no graph itself.

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

A note from the daemon's memory directory (`<vault>/.daemon/memory`). Created by `buildMemoryGraph()` in `memory.ts`.

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

The per-vault daemon hub node. Created by `buildDaemonGraph()` in `daemonGraph.ts`. There is exactly one per daemon graph.

- **id**: `"::daemon"` (the exported constant `DAEMON_NODE_ID`).
- **label**: the daemon's name (`snap.daemon.label`), which defaults to `"daemon"` — read from `<vault>/.daemon/identity.md`'s `name:` frontmatter via `daemonIdentityName()`.
- No `daemon` viz-state (that field is for `cron`/`process` children only).

### `"cron"`

A cron job managed by the per-vault daemon. One per `*.md` file under `<home>/crons/` (where `<home>` = the vault's `.daemon` dir, `vaultDaemonDir(vault)`).

- **id**: `"cron:<name>"` (e.g. `"cron:daily-briefing"`).
- **label**: the cron's name from frontmatter (falls back to filename).
- **daemon** field is always present:
  - `enabled`: from frontmatter `enabled:` (default `true` when absent).
  - `running`: `true` if the cron's name appears in `.running.json`.
  - `lastResult`: from `.last-fired.json` (e.g. `"success"`, `"failed"`, `"unknown"`), or `null` if never run.
  - `lastFiredMs`: epoch-ms of last fire from `.last-fired.json`, or `null`.
  - `schedule`: the cron expression string from frontmatter (e.g. `"0 8 * * *"`).

### `"process"`

A process managed by the per-vault daemon. One per `*.md` file under `<home>/processes/`.

- **id**: `"process:<name>"` (e.g. `"process:file-watcher"`).
- **label**: name from frontmatter.
- **daemon** field is always present:
  - `enabled`: from frontmatter.
  - `running`: always `false` (the daemon does not expose a per-process liveness file).
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
7. **The `"self"` node is NOT injected via `withYouNode()` in agents mode** — `App.tsx`'s per-mode content switch hands `GraphView` the raw agent graph straight from `GET /agent-graph` for `"agents"` (no `self`, no positions). Instead `GraphView`'s `rendererGraph()` runs it through `layoutAgentGraph()` (`app/src/graph/agentLayout.ts`), which manufactures its own literal `self` node and lays out every session/subagent explicitly (pyramid in 2D, cone/tree in 3D) before handing the result to the renderer. See "Agents Mode Layout & Overlay" below for the full pipeline.

**No community detection** is run on the *backend* agents graph (`buildAgentGraph()`). No `community`/`communityLabel` fields, no `views` field on the `GET /agent-graph` response. (`layoutAgentGraph()` does stamp a sequential `community` index on the frontend afterward, but only as a palette-index hack for per-agent coloring — not Louvain detection.)

**Node ids are stable** for a given session/subagent pair. Session nodes: `"agent:sess:<sessionId>"`. Subagent nodes: `"agent:sub:<agentId>"`.

### Mode 5: `"daemon"` — Per-Vault Daemon

Built by `daemonGraph()` in `daemonGraph.ts` from the daemon's on-disk state files. Never throws; degrades gracefully to an empty/partial snapshot on missing or malformed files. Crons/processes are read from the active vault's `.daemon` dir (`<home>` = `vaultDaemonDir(vault)`); the daemon's liveness pid is **machine-level** (`daemonMachineDir()/daemon.pid` = `~/.bismuth/daemon/daemon.pid`), since one machine process multiplexes every vault's brain.

1. Read `daemonMachineDir()/daemon.pid` (machine-level) and check PID liveness → hub node `running` flag.
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

The self node is pinned at the layout origin. There is no client-side force simulation to fix it in place with (that's backend-only, `core/src/layout.ts`) — instead `CanvasGraphRenderer`'s `scaleToSpacing()` special-cases `kind === "self"` and always maps it to `[0, 0, 0]` regardless of its (absent) backend position, while every other node is rescaled about the self-excluded content centroid. The "clearing" around the hub is a **screen-space** pass, not a physics collision radius: every frame, `clearAroundSelf()` pushes any node whose drawn circle would overlap the hub's (plus a constant `SELF_CLEAR_GAP` px) radially outward until it clears — see "Rendering" below.

**The self node is NOT injected in daemon mode.** The daemon hub (`"::daemon"`) serves as the center there. **In agents mode it isn't injected by `withYouNode()` either** — `layoutAgentGraph()` manufactures its own literal self node instead (see "Agents Mode Layout & Overlay").

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

2. **d3-force-3d refinement** — short force simulation seeded from PivotMDS output (or `initialPositions` for warm starts); its spacing constants are mirrored in `CanvasGraphRenderer` so the renderer reproduces the same spread without re-simulating.

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

The boost is ~8× at a few nodes and decays to 1× by ~400 nodes (large vaults unchanged). It is computed once in `prepareLayout` so the collide floor **and** the virtual-tether rest length share one spacing budget. The same backend spacing constants are mirrored in `CanvasGraphRenderer` (the `BACKEND_SMALL_BOOST`/`BACKEND_2D_SPACING` constants feeding `scaleToSpacing()`) — so the renderer reproduces the backend's spread with a plain uniform rescale instead of re-running a force sim, and never re-scrambles the backend layout.

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
2. **On-disk**: JSON files in `~/.bismuth/layout-cache/<sig>.json` (durable app dir, not `os.tmpdir()`; override with `BISMUTH_LAYOUT_CACHE_DIR`), versioned by `CACHE_VERSION` (currently `"v9"`).

`CACHE_VERSION` **must be bumped whenever the layout output changes** (constants, the small-graph boost, the reel-in, the incremental-rebuild scheme) — a stale cached layout computed under different rules would mismatch what the renderer settles to. The version comments record the history: `v5` = collide iterations 3→6 + padding 1.25→1.55; `v6` = small-graph linkDist boost added; `v7` = stronger `400/n` (cap 8) boost; `v8` = reel disconnected components into the main mass via virtual tether links; `v9` = incremental "add-only" rebuilds pin pre-existing nodes (`layout.ts` `fixedIds`) so only newly-added nodes settle — different output than the old whole-graph warm re-settle.

Cache key (`graphSig`): SHA-1 of `vaultKey + sorted node ids + sorted "from|to|kind" edges`. Retargeting a wikilink (same node set, same edge count, different endpoint) still busts the cache.

**Warm starts**: the last full-graph layout per vault is kept in `lastFullLayout`. On a structural edit, the new layout is seeded from the prior positions (`initialPositions`), skipping PivotMDS. Unchanged nodes barely move — the layout stays stable across edits.

**2D seeded from 3D**: the 2D layout is seeded from the flattened 3D positions (`initialPositions: pos3d`) so the two stay geometrically aligned. A 2D/3D morph flattens in place rather than scrambling.

**Sub-view layouts**: brain-subset layouts (2nd = note+tag, 3rd = memory) are only recomputed when needed. `attachLayout()` includes them in the `/graph` response only if already cached (cheap peek). If absent, they're computed on demand via `GET /graph/views`; the frontend uses full-graph positions as a fallback until the sub-view positions arrive.

**Server hot path**: `computeLayoutAsync()` yields to the event loop every 16 force ticks (via `setImmediate`) so a large graph settle doesn't block concurrent requests. Output is numerically identical to the sync path.

### Attaching Positions

`attachLayout(graph, vaultKey)` mutates each node to add `position: [x,y,z]` and `position2d: [x,y]`. The `position2d` field is always two elements (the trailing `z=0` is stripped). Nodes not in the backend's computed layout (i.e. the `"self"` node, added client-side after `attachLayout()` has already run) get no position from this step — but the frontend constructs that inject them (`youNode.ts`, `layoutAgentGraph()`) set their own explicit `position`/`position2d` fields directly (`[0,0,0]`/`[0,0]` for `youNode.ts`'s self; a full pyramid layout for `layoutAgentGraph()`'s nodes). `CanvasGraphRenderer` additionally special-cases `kind === "self"` in `scaleToSpacing()` to always resolve to the origin regardless of whatever position field it carries in.

---

## Rendering (`CanvasGraphRenderer`)

`app/src/graph/CanvasGraphRenderer.ts` is the single renderer for every graph mode (2nd/3rd/both/agents/daemon) and both graph hosts (the full-pane graph and the sidebar mini-graph). It is a **plain Canvas-2D context** (`canvas.getContext("2d")`) — explicitly **not WebGL/GPU and not DOM nodes** (`CanvasGraphRenderer.ts:1-6`). It hand-rolls the 3D camera math (orbit + zoom + perspective) in JS and rasterizes nodes, edges, and labels onto one `<canvas>` in a single pass per frame.

### No client-side force simulation

The renderer never runs a physics settle. `render(g)` (`:306`) computes a structural+position signature (`signature()`, `:314-336`) and, on change, calls `build(g)` (`:338-404`), which:

1. Builds an adjacency map + undirected degree per node (`:340-347`).
2. Centers node coordinates on the content centroid, **excluding** the injected `"self"` node — it sits at the backend's origin and would bias the centroid (`:349-370`).
3. Calls `settlePositions()` (`:425-437`), which — for ordinary vault/memory graphs — rescales the backend's already-settled `position`/`position2d` via `scaleToSpacing()` (`:123-185`) instead of re-running a force sim. `scaleToSpacing()` uniformly scales every non-self node about the centroid by the ratio of the renderer's wider, node-count-independent spacing (`linkDistance × LINK_SPREAD`) to the backend's `linkDistance × smallBoost` spacing (mirroring `BACKEND_SMALL_BOOST`/`BACKEND_2D_SPACING`, `:119-121`, which copy `core/src/layout.ts`'s own constants), then pins `"self"` at `[0, 0, 0]`. Settled positions are cached per graph signature (`p3Cache`/`p2Cache`, capped at 8 entries, `:439-442`), so revisiting a mode is free.
4. `agent`/`daemon`/`cron`/`process` nodes are treated as having an "intentional" pre-supplied layout (`hasIntentionalLayout()`, `:447-449`) — for those, `settlePositions()`/`ensure2D()` are no-ops and the node's own `position`/`position2d` (set by `layoutAgentGraph()` or the daemon graph builder) are used verbatim.

This is why a 2D↔3D mode switch, which used to re-run a client force sim (~1.2s at 2k nodes), is now an O(n) rescale.

### Camera & projection

A hand-rolled perspective camera (`project()`, `:550-560`): world coordinates are rotated by `rx`/`ry` (orbit angles), translated by `zoom` (dolly, px), and perspective-divided by a focal length `P` derived from a 60° FOV (`FOV_DEG`, `:54` — matches the old `THREE.PerspectiveCamera` so framing carries over unchanged). `coordFor()` (`:562-567`) linearly interpolates between the 3D (`p3`) and 2D (`p2`) coordinate sets by a `morph` value (0 = full 3D, 1 = full 2D), so toggling the 2D/3D setting plays a 500ms eased flatten/expand animation (`MODE_MORPH_MS`, `startModeMorph()`, `:664-669`) rather than a hard cut. Every frame, `projectPositions()` (`:570-583`) projects each node to screen `sx`/`sy` + `depth`, culls nodes at/behind the camera plane, and tracks the frame's depth range for the depth-fade calculation below.

### Interaction

- **Orbit / pan** (`onPointerMove`, `:891-911`): dragging rotates `rx`/`ry` in 3D or pans `panX`/`panY` in 2D. A press only becomes a drag once it exceeds `DRAG_THRESHOLD` px (`:56`) — below that it's treated as a click.
- **Hit-testing** (`pick()`, `:876-889`): a plain JS nearest-node search over cached screen positions (no canvas `isPointInPath` calls) — this is what makes hover/click work despite there being no DOM element per dot. Nodes whose 3D depth rank falls below `BACK_INTERACT_CUTOFF` (`:83`) aren't pickable, so faded background nodes don't steal clicks from nearer ones.
- **Zoom**: the mouse wheel drives a `goalZoom` (`onWheel`, `:924-931`) that the render loop glides toward every frame (`GLIDE`, `:57`), not an instant jump.
- **Keyboard** (`onKeyDown`, `:933-940`): `z` frames the hovered node + its neighbours (`focusNode()`), or resets the camera if nothing is hovered; `Escape` always resets.
- **Camera commands**: `focusNode(id)` / `frameSubset(ids)` (`:981-1000`) compute a bounding centroid + radius for a node set and glide the camera's target/zoom to frame it (used by cluster-legend clicks and search "fly to"); `resetView()` (`:1002-1007`) glides back to the whole-graph overview.
- **Idle spin**: `ry` auto-increments in 3D while the graph has ≤`SPIN_MAX_NODES` (350) nodes, the user hasn't grabbed the camera, and nothing is being dragged (`:695-697`) — disabled outright in agents mode by `GraphView` (`spin: props.mode === "agents" ? false : gs.spin`, `GraphView.tsx:184`) so the pyramid/molecule shape holds still.

### Depth cue, node sizing, hub clearance

- **Depth fade** (`depthFade()`, `:621`): in 3D, a node's opacity falls off from 1 (nearest) to `DEPTH_MIN_OPACITY` (0.04, farthest) via a `DEPTH_CURVE` (2.4) power curve on its normalized depth rank; flat (always opaque) in 2D. Edges get the same treatment banded into 6 depth bands (`:759-768`) so 3D edge-fade stays a handful of batched `ctx.stroke()` calls instead of one draw per edge.
- **Density-based node sizing** (`nodeDiameter()`, `:622-632`): a node's on-screen diameter is derived from graph **density** — `(2·fitPx)/√n`, the expected on-screen spacing for `n` nodes filling the fit radius — not from the layout's absolute world scale, so dots don't balloon or shrink just because the backend layout's extent shifted as nodes were added/removed. Diameter is `nodeFrac(nv)` (a degree-scaled fraction of that spacing, `:478-481`, capped at `NODE_MAX_FRAC` = 0.6; self = `SELF_FRAC` = 0.5) times the per-frame perspective scale, floored at `MIN_DOT_PX` (1.6px) and capped at `MAX_DOT_PX` (60px).
- **Screen-space hub clearance** (`clearAroundSelf()`, `:585-617`): after projection, every frame, any non-self node whose drawn circle would overlap the `"you"` hub's circle (plus a constant `SELF_CLEAR_GAP` = 16px) is pushed radially outward in screen space until it clears. This is the **only** clearing pass — `scaleToSpacing()` carves no clearance in world space, because a world-space gap projects through zoom and reads as a hard ring that grows/shrinks as you zoom; a screen-space, actual-drawn-radius pass instead holds a constant px gap at any zoom. Nodes that land exactly on the hub, or exactly on the centroid before projection (`scaleToSpacing()`'s `r === 0` case, `:163-179`), are fanned out on golden-angle bearings so they don't stack.
- **Edge-budget thinning** (`drawCanvas()`, `:733-734`): each edge gets a stable hash-based rank `kr ∈ [0,1)` (`:380`); when a mode has more edges than its budget (`EDGE_BUDGET_2D` = 600 / `EDGE_BUDGET_3D` = 2200), only edges below a computed keep-fraction (floored at `EDGE_FLOOR_2D` = 0.06 / `EDGE_FLOOR_3D` = 0.45) are drawn. 2D thins aggressively (a flat view clutters fast); 3D keeps far more of its edges (depth fade already declutters it).

### Labels

Labels are drawn as canvas text (`ctx.fillText`), not DOM, each with a rounded background pill (`:794-811`). `labelVisible()` (`:816-827`) gates which nodes get one:

- The `"self"` node's label ("You") is always shown, bold at 14px vs. 11px for every other node.
- Otherwise: gated on the `showGraphLabels` setting, then shown if the node is in the "always-on" hub set (`computeAlwaysOnSet()` from `labelSelection.ts`, recomputed on graph rebuild `:399` and on `setActiveFile()` `:956`), a search match, the active file, the hovered node, or a neighbour of the hovered node.
- **Zoom-in label discovery**: once the user has zoomed in (`zoom > 0`) and a node's projected dot has grown past `LABEL_REVEAL_DOT_PX` (18px), its label is revealed too — so zooming in progressively surfaces names beyond the curated resting hub set.

`computeAlwaysOnSet()` (`labelSelection.ts:23-55`) is pure: it unions the top-`hubCount` nodes by undirected degree (ties broken by id, ascending) with the current active file. It is the **only** live export of `labelSelection.ts` — its `renderedPixelRadius()`/`selectVisibleLabels()` helpers, and all of `collide.ts`, are vestigial: referenced only by the dead `LabelLayer.ts` (below), not by `CanvasGraphRenderer` or `GraphView`.

### Vestigial code

`app/src/graph/LabelLayer.ts` — a DOM-overlay label layer built on `THREE.Vector3` screen projection — and the `three`/`d3-force-3d` npm packages still exist on disk but are **dead code**: `LabelLayer.ts` is not imported by `CanvasGraphRenderer` or `GraphView.tsx`; the only remaining reference to it is a stale comment in `app/src/App.css:649`. `GraphView` still passes a `labelsEl` DOM ref into `renderer.mount(...)` (`GraphView.tsx:149-154`), but `CanvasGraphRenderer.mount()` accepts and ignores it (the `_labelOverlay` parameter, `:254`) — a leftover from the old DOM-overlay design.

---

## Agents Mode Layout & Overlay

Agents mode routes through the *same* `CanvasGraphRenderer` as every other mode, but its graph is built and laid out differently before it ever reaches the renderer:

1. `App.tsx` does **not** call `withYouNode()` for `"agents"` mode — it hands `GraphView` the raw `agents()` signal straight from `GET /agent-graph` (session/subagent nodes only: no `self`, no positions) (`App.tsx:463-464`).
2. `GraphView`'s `rendererGraph()` (`GraphView.tsx:165-167`) instead runs the graph through `layoutAgentGraph(raw, org)` (`app/src/graph/agentLayout.ts`) whenever `mode === "agents"`. This function:
   - Manufactures its own literal `"self"` node, pinned at the world origin (`position: [0, 0, 0]`, `position2d: [0, 0]`, `:29`) — the pyramid's apex.
   - Gives every session and subagent an explicit `position`/`position2d` (`:35-50`): a flat top-down pyramid in 2D (sessions spread along a row below the apex, each session's subagents fanned in a narrower row below that) and a cone/tree in 3D (sessions on a ring below the apex, subagents on a wider ring below each session, fanned by angle). Supplying explicit positions for every node keeps `CanvasGraphRenderer` in its "intentional layout" path (`hasIntentionalLayout()` returns `true` for `agent` nodes) — no rescale, no force sim.
   - Assigns each session/subagent a sequential `community` index (`palIdx`, `:33-47`) purely so the renderer's per-community palette coloring (`colorFor()`, `CanvasGraphRenderer.ts:526-538`) gives every agent a visually distinct color — this is **not** Louvain community detection, just a palette-index counter.
   - Emits the ownership edges itself (`:40,48`): `"open"` from `self` to each root session, `"message"` from each session to its own subagents.
   - Adds extra `"message"` edges for the chosen organization's communication channels via `commChannels()` (`:52-54`, `app/src/graph/agentOrg.ts`): `"democracy"` = every session/subagent pair (full mesh), `"republic"` = sessions mesh with each other + each session's own subagents mesh with each other (no cross-session links), `"dictatorship"` = no extra channels (only the ownership tree survives).
3. `AgentsGraph.tsx` is a **pure-DOM overlay** layered on top of the canvas (`GraphView.tsx:301-303`, shown only `when={props.mode === "agents"}`) — it draws no graph itself. It renders:
   - An "Agent Network" status card: live counts of terminal sessions vs. subagents, and how many sessions are `"awake"` vs `"idle"`.
   - An "Organization" picker (democracy / republic / dictatorship, `ORGS` in `AgentsGraph.tsx:11-15`) that flips the `agentOrg` signal (`GraphView.tsx:165`), causing `layoutAgentGraph()` to re-run with the new channel set on the next render effect.
   - A footer showing the active organization's name + its live channel count (via the same `commChannels()`).
4. Idle spin is disabled outright in agents mode (`GraphView.tsx:184`) so the pyramid/molecule shape holds still instead of orbiting.

---

## Graph Atmosphere (`GraphAtmosphere.tsx`)

`GraphAtmosphere` is the shared CSS overlay that gives every graph its iridescent cluster-glow + depth vignette. It is extracted into one component so the main `GraphView` and the first-run intro graph render the same atmosphere instead of duplicating the divs + glow wiring.

```tsx
type GlowRenderer = { setGlowCallback(cb: (g: { lobes: { x: number; y: number }[] }) => void): void };
export function GraphAtmosphere(props: { renderer: GlowRenderer; mode?: string }): JSX.Element
```

The `renderer` prop is a **structural** type — any renderer exposing `setGlowCallback(...)` works (not tied to a concrete renderer class).

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

Returns a string cache key `"v9-<16-char-sha1>"` from the node id set, edge `from|to|kind` triples, and vault path. Stable across content-only file edits (which don't change node/edge structure).

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
  CanvasGraphRenderer
```

For daemon mode (`<home>` = `<vault>/.daemon`, the per-vault brain; the pid is machine-level):

```
<vault>/.daemon/crons/*.md
<vault>/.daemon/processes/*.md
<vault>/.daemon/crons/.last-fired.json
~/.bismuth/daemon/daemon.pid   (machine-level liveness)
      |
  daemonSnapshot()   (daemonGraph.ts)
  buildDaemonGraph()
      |
  GET /daemon/graph
      |
  DaemonList + CanvasGraphRenderer  [frontend, no withYouNode()]
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
  layoutAgentGraph()   [frontend, agentLayout.ts — builds its own self node + pyramid/cone positions + org channels]
      |
  AgentsGraph overlay (status card + org picker)  +  CanvasGraphRenderer
```

---

## Key Invariants and Gotchas

- **The `"self"` node is frontend-only.** Never emitted by backend graph builders. Injected by `withYouNode()` for 2nd/3rd/both modes; **in agents mode it's instead manufactured by `layoutAgentGraph()`** (its own literal `self` node, pinned to the pyramid apex — see "Agents Mode Layout & Overlay"). Not present in daemon mode at all.
- **Layout is backend-only for the vault/memory graph.** The browser never runs a force simulation over it — `CanvasGraphRenderer` only rescales the backend's settled positions (`scaleToSpacing()`) or morphs between the 3D/2D coordinate sets. Agents-mode positions are the one exception: they're computed entirely on the frontend by `layoutAgentGraph()` (a fixed pyramid/cone formula, not a force sim either).
- **`app/src/graph/LabelLayer.ts` and the `three`/`d3-force-3d` npm packages are dead code**, left over from the pre-Canvas2D renderer. Nothing in `CanvasGraphRenderer.ts` or `GraphView.tsx` imports them; don't assume they're on the live render path.
- **Sub-view layouts may be absent on first load.** `GET /graph` only includes `views.second`/`views.third` if already cached. The frontend falls back to full-graph positions until `GET /graph/views` responds.
- **Cache is written to `~/.bismuth/layout-cache/`, not the vault.** Writing inside the vault would trigger the fs watcher and cause an infinite invalidate→rebuild loop. The durable app dir (not `os.tmpdir()`, which macOS purges) keeps reopens as cache hits; override with `BISMUTH_LAYOUT_CACHE_DIR`.
- **`mergeGraphs` keeps duplicate edges.** Two memory notes can both reference the same vault note and both produce `"about"` edges to it — this is by design.
- **Agent graph drops closed-tab sessions.** A session whose terminal tab is closed is dropped at `GET /agent-graph` read time (prune against live PTY ids). There is no terminal-close hook in Claude Code; cleanup happens lazily.
- **Wikilink resolution is basename-first.** `[[My Note]]` matches `My Note.md` anywhere in the vault. `[[reading/My Note]]` matches by full path first, then falls back to basename. Ambiguous basename matches are undefined.
- **`CACHE_VERSION` must be bumped when layout output changes** — not just force constants, but the small-graph boost and the disconnected-component reel-in too. The current version is `"v9"`. A stale cached layout computed under different rules would mismatch the renderer's forces.
- **`now` in `nodeVisualState` is a no-op.** `lastResult` and `lastFiredMs` do not drive the visual encoding — only `enabled` and `running` matter.

---

Source: `core/src/graph.ts`, `core/src/layout.ts`, `core/src/layout-cache.ts`, `core/src/engine.ts`, `core/src/daemon.ts`, `core/src/daemonViz.ts`, `core/src/daemonGraph.ts`, `core/src/agents.ts`, `app/src/graph/youNode.ts`, `app/src/graph/CanvasGraphRenderer.ts`, `app/src/graph/GraphAtmosphere.tsx`, `app/src/graph/AgentsGraph.tsx`, `app/src/graph/agentLayout.ts`, `app/src/graph/agentOrg.ts`, `app/src/graph/labelSelection.ts`, `app/src/GraphView.tsx`, `app/src/App.tsx`, `core/src/relay.ts`, `core/src/vault.ts`, `core/test/graph.test.ts`, `core/test/daemonViz.test.ts`, `core/test/agents.test.ts`, `core/test/engine.test.ts`
