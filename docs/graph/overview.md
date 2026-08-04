# Graph Overview

This document is the canonical reference for Bismuth's knowledge graph data model: the eight node kinds, six edge kinds, the graph modes (2nd/3rd/both/daemon/local), backend-precomputed 2D/3D layout, and the daemon-mode node-visual encoding. Read this before adding a node/edge kind, changing a graph mode, tuning the force layout, or touching the renderer.

The graph is a shared data structure built by backend modules in `core/src/` and rendered by `AsciiGraphRenderer` (`app/src/graph/AsciiGraphRenderer.ts`) — the sole renderer, drawn on a plain `getContext("2d")` canvas (not WebGL/GPU, not DOM nodes). It renders the graph as a fixed-size CHARACTER GRID: nodes and labels rasterize as monospace glyphs on the grid, cluster/node color carries the community structure, and edges are the one exception — real anti-aliased vector strokes drawn beneath the glyphs, not characters.

All three consumers (`GraphView.tsx`, `intro/VaultIntro.tsx`, `graph/EmbeddedGraph.tsx`) hold it only as the `GraphRenderer` seam type (`app/src/graph/graphRenderer.ts`), never the concrete class; that file's header carries an EPITAPH section describing the renderer this replaced (`CanvasGraphRenderer.ts`, a dot-and-line Canvas2D renderer, deleted) and exactly which four of its capabilities did not carry over — see "Rendering" below.

> **The "agents" graph mode was removed.** `buildAgentGraph`, `GET /agent-graph`, `app/src/graph/AgentsGraph.tsx`, `app/src/graph/agentLayout.ts`, and `app/src/graph/agentOrg.ts` are all gone; `GraphMode` no longer has an `"agents"` value. (`core/src/agents.ts` itself still exists, reduced to the `ChatAgentSession`/`ChatAgentSubagent` types `chat.ts` uses for per-chat subagent tracking.) The `"agent"` node kind and the `"open"`/`"message"`-for-agents edge usage described below still exist in the TYPE system, but nothing in the current app produces an `agent` node or a `"self"` node for the live knowledge graph anymore — see "The 'You' Self Node" below.

## What's in here

- **Data Types** — the `GraphNode`/`GraphEdge`/`GraphData`/`ViewLayout` shapes every consumer works with.
- **Node Kinds** — the eight node kinds, including the two that are vestigial (type-level only, never produced).
- **Edge Kinds** — the six edge kinds, what connects to what, and which backend step creates each.
- **Node Kind Sets by Brain View** — which kinds belong to the 2nd-brain and 3rd-brain sub-views.
- **Graph Modes** — the five modes (`both`/`2nd`/`3rd`/`daemon`/`local`) and how each is built.
- **The "You" Self Node** — why no live mode injects one today, and what still references it.
- **Backend-Precomputed 2D/3D Layout** — the PivotMDS + force-sim pipeline, tuning constants, caching, warm starts.
- **Rendering** (`AsciiGraphRenderer`) — the character-grid renderer: zoom, camera, interaction, labels, what didn't carry over from the old renderer.
- **Graph Atmosphere** (`GraphAtmosphere.tsx`) — the density-field phosphor bloom effect.
- **Daemon Node Visual Encoding** (`daemonViz.ts`) — how cron/process state maps to fill/border/opacity.
- **Utility Functions** — `subgraphByKinds`, `mergeGraphs`, `emptyGraph`, `graphSig`.
- **Graph Builder Pipeline Summary** — end-to-end diagrams for each mode's data flow.
- **Key Invariants and Gotchas** — the things worth re-reading before you rely on them.

---

## Data Types

### `GraphNode`

Every node in the graph carries these fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | Unique identifier. Note nodes: vault-relative path without `.md` (e.g. `"reading/My Note"`). Tag nodes: `"tag:<name>"`. Memory nodes: `"mem:<basename>"`. Daemon hub: `"::daemon"`. Crons: `"cron:<name>"`. Processes: `"process:<name>"`. Self: `"::you"` (vestigial — see "The 'You' Self Node"). Agent sessions/subagents (`"agent:sess:<sessionId>"` / `"agent:sub:<agentId>"`) are a vestigial id format too — nothing produces `agent` nodes anymore. |
| `label` | `string` | yes | Human-readable display name. |
| `kind` | `NodeKind` | yes | One of eight values (see Node Kinds below); `"agent"` and `"self"` are currently vestigial (type-level only, never produced for the live graph). |
| `state` | `"idle" \| "awake"` | no | Live activity state; was used on `agent` nodes only, which no longer occur. |
| `folder` | `string` | no | Top-level folder name for `note` nodes (e.g. `"reading"` for `reading/quotes/x.md`). Root-level notes get `"(root)"`. |
| `parent` | `string` | no | Was `agent` subagent nodes only: the node id of the spawning session node. No longer occurs. |
| `position` | `[number, number, number]` | no | Precomputed 3D layout coordinate `[x,y,z]`, attached by the backend (see Layout section). Integer-rounded. |
| `position2d` | `[number, number]` | no | Precomputed flat 2D coordinate `[x,y]` (z is always 0 and is dropped), for a smooth 2D/3D morph. |
| `community` | `number` | no | Louvain community id — a stable integer used as a color/group key. Absent on the daemon subgraph. |
| `communityLabel` | `string` | no | Label of the highest-degree member of the node's community (the exemplar). Absent on the daemon subgraph. |
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

`views` carries per-brain-view precomputed layouts (see Layout section). Absent on the daemon-mode graph response.

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

### `"self"` (vestigial)

The synthetic "you" hub that used to represent the user in the graph. **No live mode injects it anymore.** It used to appear in "2nd"/"3rd"/"both" via a `withYouNode()` helper (`app/src/graph/youNode.ts`, now deleted — it read as frontend noise next to real vault/memory structure), and later, after that removal, in "agents" mode only (`layoutAgentGraph()`); the "agents" mode itself was subsequently removed too. `app/src/graph/displayGraph.ts`'s header comment states the current invariant directly: "NO mode carries a 'you'/self node."

- **id**: `"::you"` (the exported constant `SELF_NODE_ID`, still exported from `core/src/graph.ts`).
- **label**: `"You"`.
- **position**: `[0, 0, 0]` — the center of the graph, when present.
- **position2d**: `[0, 0]`.
- `AsciiGraphRenderer` still special-cases `kind === "self"` nodes, but only for a handful of purely cosmetic choices, not layout: it draws the glyph `"@"` instead of the usual degree ramp, colors it with the plain foreground token (`C_FG`, bypassing the cluster-color ramp — self has no community), and always forces its label to draw regardless of the zoom-driven label budget (same treatment as the hovered/active/search-matched set). It is excluded from `getNodesForUI()`. It is **not** pinned to the origin and gets no special centroid/spacing treatment — `AsciiGraphRenderer.build()` explicitly does not filter it out when computing spacing, with a comment noting the old centroid-exclusion behavior no longer applies now that no live mode injects the node; and `app/src/graph/respace.ts`'s header explicitly records that the old renderer's "pin `self` at the origin + golden-angle-nudge coincident points" behavior was a deliberate, caller-side omission when that logic was ported out — a caller wanting it back would have to re-apply it around `scaleToSpacing()`, and none does. The screen-space "push overlapping nodes away from the hub" pass (`clearAroundSelf`) was also not ported: `graphRenderer.ts`'s EPITAPH records it as dead code before the merge even began, since removing the "agents" graph mode (commit `a6687c0`) already took out the only code path that ever injected a `"self"` node. `app/src/intro/VaultIntro.tsx` hand-builds one literal `self` node for its static first-run demo graph. That demo use is the only place a `"self"` node is constructed anywhere in the app today; no backend builder and no live graph-mode path emits one.

### `"agent"` (vestigial)

Used to represent a Claude Code session or subagent running inside one of Bismuth's terminal tabs, created by `buildAgentGraph()` in `core/src/agents.ts` for the now-removed "agents" graph mode. `buildAgentGraph()` and its test file (`core/test/agents.test.ts`) are both gone. `core/src/agents.ts` itself remains and is **not** orphaned — it now holds only the `ChatAgentSubagent` / `ChatAgentSession` types, which `core/src/chat.ts` imports for visual-chat subagent tracking. `NodeKind` still includes `"agent"`, but nothing in the current app produces one. The id/label/state shape below is preserved here for historical/type reference only:

- **Session nodes** — id: `"agent:sess:<sessionId>"`. Label: `basename(cwd)`, falling back to `terminalId`. No `parent` field.
- **Subagent nodes** — id: `"agent:sub:<agentId>"`. Label: the `agentType` string (e.g. `"Explore"`, `"Plan"`, `"general-purpose"`). `parent` is the session's node id.
- **state**: `"awake"` if the session heartbeat within the last 10 minutes OR has a running (non-done) subagent; `"idle"` otherwise. Subagents: `"awake"` if not done, `"idle"` if done.
- No `community`, no `daemon`, no `folder`.

The relay registry that used to feed this (`core/src/relay.ts` — `RelaySession`/`RelaySubagent`, populated by the relay plugin's hooks POSTing to `/relay/*`) is still alive and still populated/pruned (see `docs/terminal/overview.md`); it simply has no reader now that `buildAgentGraph()`/`GET /agent-graph` are gone.

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
| `"message"` | `memory` | `memory` | An inter-memory edge built by `buildMemoryGraph()`. Was also used for `agent session → subagent` edges in the now-removed "agents" mode; that usage is vestigial. |
| `"about"` | `memory` | `note` | A cross-brain edge from a memory node to a vault note. Created when a memory note's wikilinks resolve to vault note ids. Resolution follows the same `byPath` then `byBase` logic as vault wikilinks. |
| `"open"` | `self` | `agent` | Vestigial — was created on the frontend by `layoutAgentGraph()` (agents mode only, now removed) from the self node to every root session. No mode currently produces `"open"` edges (no mode has a self node — see "The 'You' Self Node"). |
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

The frontend renders this graph as-is — no `"self"` node is added in "both" mode.

### Mode 2: `"2nd"` — Second Brain (Vault Only)

The backend builds the full "both" graph, then the frontend filters to nodes with `kind` in `SECOND_BRAIN_KINDS` (`"note"`, `"tag"`) using the `subgraphByKinds()` utility. The backend precomputes a dedicated sub-view layout via `computeViewLayouts()` — returned in `GraphData.views.second` — so positions are correct for the isolated note+tag set.

No `"self"` node is added in "2nd" mode either — the filtered graph is rendered directly.

### Mode 3: `"3rd"` — Third Brain (Memory Only)

Analogous to 2nd-brain mode. The backend's full "both" graph is filtered by `THIRD_BRAIN_KINDS` (`"memory"`). Sub-view layout is in `GraphData.views.third`. No `"self"` node is added here either.

> There used to be a Mode 4, `"agents"` (live Claude terminal sessions, built by `buildAgentGraph()` in `agents.ts` over a `RelaySnapshot`). It was removed along with `GET /agent-graph` and its frontend rendering path (`layoutAgentGraph()`, `AgentsGraph.tsx`). See the note at the top of this document and `docs/terminal/overview.md`.

### Mode 4: `"daemon"` — Per-Vault Daemon

Built by `daemonGraph()` in `daemonGraph.ts` from the daemon's on-disk state files. Never throws; degrades gracefully to an empty/partial snapshot on missing or malformed files. Crons/processes are read from the active vault's `.daemon` dir (`<home>` = `vaultDaemonDir(vault)`); the daemon's liveness pid is **machine-level** (`daemonMachineDir()/daemon.pid` = `~/.bismuth/daemon/daemon.pid`), since one machine process multiplexes every vault's brain.

1. Read `daemonMachineDir()/daemon.pid` (machine-level) and check PID liveness → hub node `running` flag.
2. Read each `<home>/crons/*.md` for cron definitions (name, schedule, enabled).
3. Read `<home>/crons/.last-fired.json` and `.running.json` for runtime state.
4. Read each `<home>/processes/*.md` for process definitions.
5. `buildDaemonGraph(snapshot)` emits: one `daemon` hub node, one `cron` node per cron (with `daemon` viz-state), one `process` node per process (with `daemon` viz-state), and `"supervises"` edges from the hub to each.
6. There is **no** `"self"` node in daemon mode — the `daemon` hub is the center.
7. No community detection. No `views` field.

The backend serves this at `GET /daemon/graph` (polled only while daemon mode is active).

### Mode 5: `"local"` — Open Note's Neighbourhood

Unlike the other four, `"local"` is not a brain view — it is a **lens** over whichever brain view was active, narrowing the field to the currently-open note and what it connects to. `GraphMode` (`app/src/commands.ts`) is `"2nd" | "3rd" | "both" | "daemon" | "local"`.

Selection is entirely client-side, in `app/src/graph/displayGraph.ts`'s `selectDisplayGraph()`:

```ts
case "local":
  return localSubgraph(subgraphByKinds(sources.graph, SECOND_BRAIN_KINDS), sources.activeId ?? "");
```

1. `subgraphByKinds(graph, SECOND_BRAIN_KINDS)` narrows to `note`/`tag` nodes (local mode is always over the 2nd brain, regardless of what mode was active before the lens was switched on).
2. `localSubgraph(g, centerId, depth = 1)` (`core/src/graph.ts`) keeps `centerId` (the open note's graph id) and, by BFS over `g.edges` in **both** directions (outbound links and backlinks alike), every node within `depth` hops — one hop by default. It **strips** `community`/`communityPath`/`communityPathLabels` from every surviving node: a dozen notes coloured by the whole vault's community structure said nothing at this scale (see the function's own doc comment). If `centerId` isn't in `g` (e.g. nothing is open), it returns `emptyGraph()`.

The full-vault positions on the surviving nodes are meaningless at neighbourhood scale (a dozen notes scattered across the whole vault's ±2000-unit world), so `GraphView.tsx` re-lays the subgraph out **client-side** rather than rendering it as-is:

```ts
const LOCAL_REFINE_TICKS = 120; // a neighbourhood is tens of nodes, settles in a few ms
const input = localLayoutInput(g, props.communitySource);
const pos3 = computeLayout(input, { refineTicks: LOCAL_REFINE_TICKS });
const pos2 = computeLayout(input, { dimensions: 2, refineTicks: LOCAL_REFINE_TICKS, initialPositions: pos3 });
```

This is the pure `computeLayout()` (the same function `attachLayout()` calls on the backend, and the same one `EmbeddedGraph.tsx` uses for a ` ```graph ` block) run directly on the main thread — no backend round-trip, no cache, 3D first then 2D seeded from it so the 2D/3D morph stays aligned, exactly like the backend pipeline.

`localLayoutInput()` (`app/src/graph/localLayoutInput.ts`) looks up each surviving node's `community`/`communityPath` from `props.communitySource` (the full, un-stripped graph) and re-attaches them **only to the layout input**, never to what gets rendered:

```ts
export function localLayoutInput(g: GraphData, source?: GraphData): LayoutInput {
  const byId = new Map(source?.nodes.map((n) => [n.id, n]));
  return {
    nodes: g.nodes.map((n) => {
      const src = byId.get(n.id);
      return { id: n.id, community: src?.community, communityPath: src?.communityPath };
    }),
    edges: g.edges.map((e) => ({ from: e.from, to: e.to })),
  };
}
```

So `computeLayout`'s community-aware gravity still applies — a neighbour that shares the focused note's community settles closer than a neighbour that's only a cross-community bridge — without the rendered nodes ever carrying `community` again. The renderer stays exactly as flat/uncoloured in local mode as if the fields were never looked up: `GraphConfig.showLodMasses` is separately forced off whenever `mode === "local"` (there is no community hierarchy to summarize into aggregate masses at this scale).

**UI**: local is a toggle, not a switcher segment — it doesn't appear in `MODE_SHORT`/`MODE_ICON`'s rendered options and isn't a sibling of "2nd"/"3rd"/"both"/"daemon" in the mode-switcher UI. It only exists in the sidebar mini-graph (`props.mini`): a `LOCAL` text button at the bottom-right toggles it on and off over whatever mode was active (`toggleLocal()` remembers that mode as `beforeLocal` and restores it when toggled off). If the mini-graph is ever promoted to a full pane while local is on, an effect drops back to `beforeLocal` automatically — the full-pane switcher has no `"local"` segment to show as selected.

Like every other mode, `"local"` never carries a `"self"` node (see "The 'You' Self Node" below).

---

## The "You" Self Node

**No graph mode injects a self node today.** `app/src/graph/displayGraph.ts` (the pure per-mode graph selector behind `App.tsx`'s `displayGraph` memo) states the current invariant directly in its header comment: "NO mode carries a 'you'/self node."

History, for context: there used to be a shared `withYouNode()` helper (`app/src/graph/youNode.ts`, now deleted) that injected the hub into "2nd"/"3rd"/"both", plus an `"open"` edge to every open note tab/pane; it was removed because the hub read as noise floating at the origin of otherwise-real vault/memory structure. After that removal, "agents" mode was, for a time, the one remaining place a self node appeared — `layoutAgentGraph()` (`app/src/graph/agentLayout.ts`) manufactured its own literal self node and linked it to every root session. The "agents" mode itself was subsequently removed too, taking that last live producer with it.

`core/src/graph.ts` still exports `SELF_NODE_ID = "::you"` and `NodeKind` still includes `"self"`. `AsciiGraphRenderer` gives a `"self"` node a distinct glyph (`"@"`), a fixed non-cluster color, and a forced label, but it does **not** pin it to the origin, exclude it from the content centroid, or push overlapping nodes away from it — the old renderer's origin-pinning and screen-space "clear a gap around the hub" behavior (`clearAroundSelf()`) were not ported when its logic was extracted into `app/src/graph/respace.ts`; that module's header records the omission explicitly, and `app/src/graph/graphRenderer.ts`'s EPITAPH notes `clearAroundSelf` was already dead code before the rewrite even started, since removing the "agents" graph mode had already taken out the only thing that ever injected a `"self"` node. None of this currently fires on the live knowledge graph anyway, since no `"self"` node reaches it. The one place a `"self"` node is still constructed at all is `app/src/intro/VaultIntro.tsx`'s static first-run demo graph — cosmetic, not real data.

**The self node is NOT injected in "2nd", "3rd", "both", or "daemon" mode** (nor any other current mode). In daemon mode the daemon hub (`"::daemon"`) serves as the center instead.

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

2. **d3-force-3d refinement** — short force simulation seeded from PivotMDS output (or `initialPositions` for warm starts). The renderer does **not** mirror this stage's spacing constants (see `app/src/graph/respace.ts` below) — it measures the settled output's own spacing instead.

Default constants (the `DEFAULTS` object in `layout.ts`):
```
numPivots:    50   (PivotMDS pivot count; O(k²·n) so halved from 100 for speed)
refineTicks:  150  (force ticks after PivotMDS seed; 240 in the cache path — REFINE_TICKS)
repulsion:    -7   (forceManyBody strength; was -10 — see "Link attraction..." below)
linkDistance: 5    (forceLink base distance; see small-graph boost + ×1.8 in 2D mode below)
centering:    0.13 (forceX/Y/Z strength toward origin)
linkStrength: 0.18 (LINK_STRENGTH; real edges only, "spring" model)
collideIterations: 6  (COLLIDE_ITERATIONS — must match renderer)
manybodyTheta:     1.5 (MANYBODY_THETA — Barnes-Hut approximation)
```

`refineTicks` defaults to 150 for a direct `computeLayout()` call (e.g. local mode's client-side settle — see "Mode 5" above), but the backend's precompute path (`layout-cache.ts`) always passes the higher, exported `REFINE_TICKS = 240` explicitly. It was raised from 120 in the same pass that widened `COMMUNITY_SEP_MULT` (1.6→2.4, see "Caching" below): at the wider separation target, 120 ticks no longer converged (measured 2D separation ratio on the reference vault: 0.851→0.884 at 120 ticks, i.e. worse, but 0.700 at 240 — clearly better than the pre-change baseline). The incremental "add-only" rebuild path (pinning pre-existing nodes, see "Warm starts" below) uses a much lower `REFINE_TICKS_INCREMENTAL = 60`, since only the newly-added nodes need to settle.

Plus the disconnected-component reel-in tuning (also in `DEFAULTS`):
```
virtualLinkStrength: 1.2  (tether-link strength; > LINK_STRENGTH so a stray is held in)
virtualAnchors:      4    (tether links per stray node; 0 disables the reel-in)
virtualDistMult:     0.8  (tether rest length = linkDist × this; "spring" model only — see below)
```

### Link attraction, degree-scaled repulsion, and community-aware forces

Two `LayoutOptions` govern the force model's shape, both defaulted in `withDefaults()` (`layout-cache.ts`'s "v20" bump):

- **`energyModel: "spring" | "linlog"`, default `"linlog"`.** Under `"linlog"` (Noack's LinLog), link attraction grows only as `ln(1+d)` instead of proportionally (a Hooke spring) — a meaningful share of cluster separation becomes a property of the energy model itself. `"spring"` is the pre-2026-07 `forceLink`-based behaviour. Several options are **inert under the shipped `"linlog"` default** because LinLog has no rest-length concept, only strength: `virtualDistMult`, `communityIntraDist`, `communityInterDist` all only take effect if `energyModel` is explicitly set back to `"spring"`.
- **`degreeRepulsion: boolean`, default `true`.** Scales many-body repulsion by `(degree + 1)` per node (ForceAtlas2-style) instead of the uniform `repulsion` value for every node — a vault is scale-free, and uniform repulsion crushes leaf nodes against their hubs ("forests of leaves").

Community-aware clustering forces (gated on `community` present on 2+ distinct communities; `communityForces: false` reproduces the community-unaware layout exactly, for A/B measurement) default to:
```
communityForces:     true
communityIntraLink:  1.8   (LINK_STRENGTH multiplier for intra-community edges — live under both models)
communityInterLink:  0.2   (LINK_STRENGTH multiplier for inter-community edges — live under both models)
communityIntraDist:  1.0   (link rest-length multiplier — "spring" model only, inert under "linlog")
communityInterDist:  2.6   (link rest-length multiplier — "spring" model only, inert under "linlog")
communityGravity:    0.6   (per-tick pull toward the node's own community centroid, packing-floor gated)
communitySeparation: 0.85  (community-level collide strength, pushing whole communities apart)
communityLevelDecay: 0.4   (COMMUNITY_LEVEL_DECAY — per-ancestor-level falloff for the nested/hierarchical forces)
```
Three forces cooperate: anisotropic link strength/distance (above), centroid gravity (compacts a community; gated by a packing floor so it gathers strays without over-squeezing an already-jammed core), and a community-level collide (pushes whole communities apart until their packing radii clear — the piece that opens visible lanes between clusters). All three are measurably load-bearing even under LinLog, not just "spring" — deleting community-level separation alone regressed the reference vault's d2 NP-degree statistic by 7.9% and roughly doubled a tag-hub-heavy synthetic fixture's clustering error.

#### Small-graph link-distance boost

The effective link distance is scaled **up** as the graph shrinks, so a handful of nodes (e.g. the daemon graph, or a fresh vault) spreads into an airy field instead of collapsing into a tight knot:

```ts
const smallBoost = n > 0 ? Math.min(8, Math.max(1, 400 / n)) : 1;
const linkDist   = o.linkDistance * smallBoost * (dim === 2 ? MODE_2D_SPACING : 1);
const collideFloor = linkDist * COLLIDE_RATIO;
```

The boost is ~8× at a few nodes and decays to 1× by ~400 nodes (large vaults unchanged). It is computed once in `prepareLayout` so the collide floor **and** the virtual-tether rest length share one spacing budget.

The renderer (`AsciiGraphRenderer`, via `app/src/graph/respace.ts`'s `scaleToSpacing()`) does **not** mirror this small-graph boost, or any of this backend module's spacing constants, by copy — the old `CanvasGraphRenderer` did (`BACKEND_SMALL_BOOST`/`BACKEND_2D_SPACING` constants duplicating `layout.ts`'s own tuning), and `respace.ts`'s header calls that out explicitly as the thing it was written to stop doing, since the two files' magic numbers only stay correct as long as they don't drift independently. Instead `scaleToSpacing()` **measures** the median nearest-neighbour distance of whatever position cloud it's handed and solves for the single uniform scale that makes the cloud hit a fixed target spacing (`RESPACE_TARGET_SPACING = 14.0` in `AsciiGraphRenderer.ts`) — a rescale about the cloud's own centroid, which is provably order-preserving (a uniform positive scalar can't flip which of two pairwise distances is smaller) regardless of node count or which algorithm produced the input. This still reproduces the backend's already-relaxed SHAPE with a plain O(n) rescale rather than re-running a force sim — that property is unchanged from the old renderer — but the target spacing itself is independent of the backend's small-graph boost, not a copy of it.

#### Reeling in disconnected components

A note with no in-view links is its own connected component; left alone, many-body repulsion flings it into an empty angular direction at the cloud's edge (and the recoil shoves the main mass off-center, so the pinned "you" hub drifts away). `prepareLayout` fixes this by tethering every node of a **small, non-main** component to a few anchors in the main mass via layout-only **virtual links** fed to the same force sim:

- `connectedComponents()` finds the components; the largest (ties → lowest member index) is the main mass.
- A component at or above the gate `max(4, mainSize × 0.25)` is a genuine island and is left alone — a legitimately multi-topic vault keeps its distinct clusters.
- For each small-component node, `virtualAnchors` (4) anchors are chosen deterministically via `fnv1a("<id>:<a>") % mainSize`. Each adds a `{ source, target, virtual: true }` link (rest length `linkDist × virtualDistMult`, strength `virtualLinkStrength`) and an entry in the BFS adjacency (so the PivotMDS seed places it near the mass too, not at a cap-distance fling).
- Virtual links are **layout-only** — never emitted as graph edges. The collide force resolves overlaps as the stray settles in (no teleport), so the emitted layout has no overlaps the warm renderer can't fix.
- Collide-radius degree uses `realDeg` (real edges only, captured before the tethers) so a tethered orphan isn't drawn/spaced as a hub.

Per-node collision radius is degree-scaled (hub nodes repel as the circles they are drawn as, not as points), and additionally shrunk in 2D so real link/community structure — not the collide floor — sets local spacing:
```ts
degreeScale(deg) = min(6, 0.4 + 0.45 * sqrt(deg))                          // SIZE_MAX_MULT/MIN_MULT/DEGREE_GAIN
drawnNodeRadius(scale) = (NODE_SIZE * scale * tan(FOV/2)) / 2               // NODE_SIZE = 6, FOV = 60°
collideFloor = linkDist * COLLIDE_RATIO                                    // COLLIDE_RATIO = 1.25; linkDist already
                                                                             // includes the small-graph boost + 2D ×1.8
collideMult = dim === 2 ? MODE_2D_COLLIDE_MULT : 1                         // 0.65 in 2D, 1 in 3D
collideRadius(node, i) = collideMult *
  max(collideFloor, drawnNodeRadius(degreeScale(realDeg[i])) * COLLIDE_SIZE_PADDING)  // COLLIDE_SIZE_PADDING = 1.55
```
`realDeg` is each node's real-edge degree, captured **before** the reel-in's virtual tether links are added below, so a tethered orphan isn't drawn/spaced as a hub. `MODE_2D_COLLIDE_MULT` was tuned down from 1.2 to 0.65 (layout-cache.ts's "v12" note): at 1.2, the extra padding on top of an already-larger 2D collide floor forced nearly every leaf node in a real 2246-node vault to the same collide radius (coefficient of variation 0.25, a near-regular grid); at 0.65 real structure sets the spacing instead (CV 0.42) while the 2D collide-floor minimum stays comfortably respected.

### Caching (`layout-cache.ts`)

Two-tier:

1. **In-memory**: `Map<sig, Layout>` within a server run.
2. **On-disk**: JSON files in `~/.bismuth/layout-cache/<sig>.json` (durable app dir, not `os.tmpdir()`; override with `BISMUTH_LAYOUT_CACHE_DIR`), versioned by `CACHE_VERSION` (currently `"v20"`).

`CACHE_VERSION` **must be bumped whenever the layout output changes** (constants, the small-graph boost, the reel-in, the incremental-rebuild scheme) — a stale cached layout computed under different rules would mismatch what the renderer settles to. The version comments record the full history in `layout-cache.ts` itself (not duplicated here, to avoid this doc drifting stale again): `v5` = collide iterations 3→6 + padding 1.25→1.55; `v6` = small-graph linkDist boost added; `v7` = stronger `400/n` (cap 8) boost; `v8` = reel disconnected components into the main mass via virtual tether links; `v9` = incremental "add-only" rebuilds pin pre-existing nodes; `v10`–`v20` = disc-flatten bias, repulsion/collide tuning, community-aware clustering forces, and — most recently — the LinLog energy model + degree-proportional repulsion default (`v20`; see `layout-cache.ts`'s inline history for each step and exactly what it changed).

> **Also note**: `app/src/App.tsx`'s `GRAPH_CACHE_KEY` (a separate, frontend-only localStorage cache of the last-rendered graph, used to instant-paint on boot) must be bumped in lockstep whenever a `CACHE_VERSION` bump moves positions — otherwise the first launch after the bump instant-paints stale cached coordinates before the fresh `/graph` fetch lands, and the renderer's structural-signature dedup (which deliberately ignores positions) can drop the incoming new layout. See the comment at `GRAPH_CACHE_KEY`'s definition.

Cache key (`graphSig`): SHA-1 of `vaultKey + sorted node ids + sorted "from|to|kind" edges`. Retargeting a wikilink (same node set, same edge count, different endpoint) still busts the cache.

**Warm starts**: the last full-graph layout per vault is kept in `lastFullLayout`. On a structural edit, the new layout is seeded from the prior positions (`initialPositions`), skipping PivotMDS. Unchanged nodes barely move — the layout stays stable across edits. A pure add (new note(s), no other structural change) instead takes the **incremental "add-only" rebuild**: every pre-existing node is pinned exactly where it was (`fixedIds`) and only the new node(s) settle in among them, at a much lower `REFINE_TICKS_INCREMENTAL = 60` tick budget (vs the full `REFINE_TICKS = 240`) since there's far less to converge. This path is capped to batches of at most `INCREMENTAL_MAX_ADD` (25) new nodes or `INCREMENTAL_MAX_FRAC` (10%) of the graph, whichever is smaller — a larger batch import is better re-optimized globally by the full warm rebuild instead.

**2D seeded from 3D**: the 2D layout is seeded from the flattened 3D positions (`initialPositions: pos3d`) so the two stay geometrically aligned. A 2D/3D morph flattens in place rather than scrambling.

**Sub-view layouts**: brain-subset layouts (2nd = note+tag, 3rd = memory) are only recomputed when needed. `attachLayout()` includes them in the `/graph` response only if already cached (cheap peek). If absent, they're computed on demand via `GET /graph/views`; the frontend uses full-graph positions as a fallback until the sub-view positions arrive.

**Server hot path**: `computeLayoutAsync()` yields to the event loop every 16 force ticks (via `setImmediate`) so a large graph settle doesn't block concurrent requests. Output is numerically identical to the sync path.

### Attaching Positions

`attachLayout(graph, vaultKey)` mutates each node to add `position: [x,y,z]` and `position2d: [x,y]`. The `position2d` field is always two elements (the trailing `z=0` is stripped). Nodes not in the backend's computed layout get no position from this step. Unlike the old `CanvasGraphRenderer`, `AsciiGraphRenderer` does not special-case a `"self"` node's position at all in this step — see "The 'You' Self Node" above.

---

## Rendering (`AsciiGraphRenderer`)

`app/src/graph/AsciiGraphRenderer.ts` is the single renderer for every graph mode (2nd/3rd/both/daemon/local) and every host: the full-pane graph, the sidebar mini-graph, the first-run Vault Intro (`app/src/intro/VaultIntro.tsx`), and the embedded ` ```graph ` note block (`app/src/graph/EmbeddedGraph.tsx`). All consumers hold it only as the `GraphRenderer` seam type (`app/src/graph/graphRenderer.ts`), never the concrete class. It is a **plain Canvas-2D context** (`canvas.getContext("2d")`) — explicitly **not WebGL/GPU and not DOM nodes** — but the thing it draws is a fixed-size **character grid**, not a dot-and-line diagram: nodes and labels rasterize as monospace glyphs snapped onto grid cells; edges are the one exception, drawn as real anti-aliased vector strokes (`strokeEdges()`) beneath the glyphs, not as characters. This replaced an earlier dot-and-line Canvas2D renderer (`CanvasGraphRenderer.ts`) that has since been deleted — see `graphRenderer.ts`'s header for a full EPITAPH of what that renderer was and exactly which of its capabilities did and didn't carry over. Of the four the EPITAPH originally listed as not carried over, two were later **restored**: the animated 2D↔3D morph (`modeMorph.ts`, Task 22 — see "Camera & projection" below) and depth-ordered cell arbitration in 3D (Task 23 — see "Interaction" below). A third, rounded label pills, was replaced with a different, bug-fixed mechanism rather than ported as-is (a `strokeText` halo, Task 21 — see "Labels" below). The fourth, filled dots sized by degree plus a hover ring, remains a real gap: the dots are out of scope by design (the glyph ramp replaces them), but the hover ring genuinely isn't ported — hover instead dims everything else, a weaker affordance. This section describes what shipped, not what was replaced; cite `graphRenderer.ts` rather than this doc for the history.

### THE LAW: zoom is resolution, not scale

A cell is a constant on-screen size at every zoom level — nothing here ever does `ctx.scale` or a CSS transform on glyphs. What changes with zoom is the world-units-per-cell ratio: 100% ("fit") shows the whole graph's own bounding radius on the grid; 0% ("deepest") is a fixed absolute resolution where every note is individually distinguishable, the same physical world-per-cell regardless of graph size (`asciiGrid.ts`'s `DEEPEST_WORLD_PER_CELL`/`maxResFor`). The wheel (or `+`/`-` keys) steps this resolution in fixed 10-point notches (`ZOOM_STEP_PCT` = 10), and the field glides toward each stop — a time-based ease (`GLIDE_TAU_MS` = 110ms, converged regardless of frame rate), re-rasterizing at a finer world→cell mapping every frame of the glide, rather than jumping straight to the target.

### No client-side force simulation

`render(g)` computes a structural-only signature (`structuralGraphSig()`, `app/src/graph/graphStability.ts`) and, if it's unchanged from the last build, skips a rebuild entirely (`shouldResetView()`, same module, decides separately whether the camera should reset) — a benign re-fetch with nudged coordinates never re-shapes the field or snaps the camera. On a real structural change, `build(g)` centers and rescales the backend's `position`/`position2d` via `respace.ts`'s `scaleToSpacing()` (see "Backend-Precomputed 2D/3D Layout" above) — no self-node exclusion from the centroid, unlike the old renderer, since respace.ts is deliberately kind-agnostic. `agent`/`daemon`/`cron`/`process` nodes (a graph that "arrives pre-laid-out") are handled by feeding `scaleToSpacing()` a non-positive target spacing instead of skipping the call — its own degenerate-target fallback already does exactly "recenter on the cloud's own centroid, no rescale" for those. Rescaled positions are memoized per structural signature, so revisiting a mode is free.

### Camera & projection

`cameraModel.ts`'s header calls out the renderer merge's central design tension — zoom-as-resolution vs. zoom-as-camera-dolly — and how it was resolved: `res`/`zoomPct` stays the one durable, user-facing zoom state (see THE LAW above); a 3D camera dolly is derived FROM the resolution progress (`dollyForT`) rather than tracked as an independent value, so one wheel notch both raises resolution and moves the camera. The underlying 3D projection math (rotate by `rx`/`ry` orbit angles, perspective-divide by a focal length derived from a 60° FOV) is lifted verbatim from the old renderer's `project()`/`projectPositions()`, so framing carries over unchanged.

**The animated 2D↔3D morph was restored** (`app/src/graph/modeMorph.ts`, Task 22 — `graphRenderer.ts`'s EPITAPH item 1). A `viewMode` flip no longer hard-resets the camera; it eases across `MODE_MORPH_MS` (500ms) toward the arrival mode's resting state (orbit back to the fixed starting tilt, pan zeroed, resolution back to 100%/fit — the same end state the old hard reset landed on, just no longer reached in a single frame). `morphProgress`/`blendPosition` are the pure, unit-tested extractions (`modeMorph.test.ts`); every blended quantity (the flatten fraction and each orbit angle) is captured from its **live** value the instant a transition starts, not a fixed reference — this is what fixes two defects a first pass got wrong: LOD masses not moving during the transition (they now share one `cameraFrame()` with node projection), and a second flip arriving before the first transition finished restarting from a hardcoded endpoint instead of wherever the field currently was. `setConfig()` decides whether to morph at all: if there is no prior rendered view to animate from (`hasConfigured` is false, or no node has been populated yet), a flip settles instantly instead of queueing a transition. Two accepted gaps: spin is effectively suppressed for the whole duration of an entering-3D transition (the morph lerp overwrites the orbit angle every frame, discarding what the idle-spin block added the frame before), and a structural graph reload mid-morph discards an in-flight transition outright rather than letting it finish or re-targeting it.

### The three-band zoom ladder

Per `AsciiGraphRenderer.ts`'s header and `backbone.ts`'s `bandsForT`, the ladder runs in three bands as resolution deepens: **far** (aggregate territory masses + cluster names, joined by aggregate connectors — `lod.ts`, opt-in via `GraphConfig.showLodMasses`, on by default outside "local" mode), **mid** (individual glyphs, joined by a hub-to-hub BACKBONE over the active community hierarchy level — `backbone.ts`), and **near** (individual glyphs joined by their real member edges). The two handovers are crossfades, not switches, driven by the same continuous zoom progress `t` that drives the label ladder (`labelSelection.ts`). A colour-tinted intra-cluster mesh (every intra-community edge, in the cluster's own colour) draws underneath at every stop where glyphs are visible.

### Interaction

- **Orbit / pan** (`onPointerMove`): dragging rotates `rx`/`ry` in 3D or pans `panX`/`panY` in 2D. A press only becomes a drag once it exceeds `DRAG_THRESHOLD` (5px) — below that it's treated as a click.
- **Hit-testing** (`pick()`): converts the cursor position to a grid cell (`pxToCell`) and searches outward up to `HIT_RADIUS_CELLS` (2) for the nearest node recorded in that frame's cell→node buffer (`nearestCellNode`) — a grid lookup, not a per-node distance search. **Depth-ordered cell arbitration was restored** (Task 23, `graphRenderer.ts`'s EPITAPH item 2): before a node claims a cell, it checks its depth fraction `nv.dr` (0 far..1 near) against whichever node currently owns the cell and skips the write when it is not at least as near (`occupant >= 0 && nv.dr < this.nodes[occupant].dr` → skip). `>=`, not `>`, so a genuine tie still falls through to array order — in 2D, and any flat/degenerate 3D frame, every node's `dr` is the same `1`, so every comparison ties and the pre-fix "later node in array order wins" behaviour is unchanged there; only a real depth *difference* changes the outcome. Because `pick()` resolves through the same `cellNode` buffer the raster pass writes, this fixes the hit test for free — whichever node's glyph a cell shows is also the one a click there opens. Depth is still cued by glyph weight/alpha rather than occlusion; this only decides which of two *contesting* nodes' cue is the one shown.
- **Zoom**: the wheel accumulates `deltaY` into fixed-size notches (`WHEEL_NOTCH_PX`) and steps the resolution ladder one `ZOOM_STEP_PCT` per notch, cursor-anchored in 2D (the world point under the cursor keeps its pixel position across the step). `+`/`-` keys step the same ladder, centered instead of anchored.
- **Keyboard** (`onKeyDown`): `z` frames the hovered node + its neighbours (`focusNode()`), or resets the camera if nothing is hovered; `Escape` always resets.
- **Camera commands**: `focusNode(id)` / `frameSubset(ids)` compute a bounding centroid + radius for a node set and glide the camera to frame it (used by search "fly to"); `resetView()` glides back to the whole-graph overview.
- **Idle spin**: `ry` auto-increments in 3D while the graph has ≤350 nodes, the user hasn't grabbed the camera, and nothing is being dragged.

### Depth cue, node sizing, glyphs

- **Degree ramp**: a node's weight is its GLYPH, never a change in size — `nodeGlyph()` (`asciiGrid.ts`) maps degree + depth band to one of `"."` (leaf) / `"o"` (linked) / `"@"` (hub), shifted between three depth bands in 3D (`DEPTH_BANDS`). A `"self"` node always draws `"@"` regardless of degree (see "The 'You' Self Node" above).
- **Depth fade** (`depthAlpha()`, `asciiGrid.ts`): in 3D, a node's opacity falls off from 1 (nearest) toward a floor via a power curve on its normalized depth rank; flat (always opaque) in 2D. Edges get an analogous depth-banded alpha falloff (`EDGE_DEPTH_BANDS` = 6) so 3D edge-fade stays a handful of batched `ctx.stroke()` calls instead of one draw per edge.
- **No filled dots, no hover ring**: the old renderer drew dots sized by degree plus a ring around the hovered node and its neighbours; neither was ported, and this is the one EPITAPH item that's still a real gap rather than something later restored or corrected (deliberately out of scope for the dots — the glyph ramp replaces them; the rings are a real capability gap, not a design choice — see `graphRenderer.ts`'s EPITAPH item 3). Hover instead dims everything except the hovered glyph and its one-degree-incident edges (`DIM_ALPHA`, `EDGE_DIM_ALPHA`) and accents the hovered glyph's colour.
- **No screen-space hub clearance**: the old renderer's `clearAroundSelf()` (pushing nodes that would overlap the "you" hub's circle radially outward) was not ported — see "The 'You' Self Node" above. It was already dead code before the merge: removing the "agents" graph mode had already removed the only path that ever injected a `"self"` node.
- **Edge-budget thinning**: each edge gets a stable hash-based rank; when a mode has more edges than its budget (`EDGE_BUDGET_2D`/`EDGE_BUDGET_3D`), only edges below a computed keep-fraction (floored at `EDGE_FLOOR_2D`/`EDGE_FLOOR_3D`) are drawn.

### Labels

Labels are drawn as canvas text (`ctx.fillText`) — not on a rounded pill; the old renderer's label pills were not ported as literal pills (`graphRenderer.ts`'s EPITAPH item 4). What replaced them changed once, and the doc history is worth knowing: an early pass cleared each label's own ground-coloured `fillRect` first, but that was found to be a real bug (Task 21) — an *opaque* rect painted after `strokeEdges()` erased every edge running behind a label, and at a convergence point (many spokes meeting near one hub) that reads as the graph's own structure lying. The fix (still shipped today) splits the plate's job in two: field **glyphs** are suppressed at the source (`reserveLabelCells()` blanks `charBuf` under a label's reserved cells before the leaf raster pass ever draws into them, so nothing is drawn-then-covered), and **edges** get a `strokeText` halo instead — the ground colour stroked under the fill (`LABEL_HALO_EM = 0.2`, floored at `LABEL_HALO_MIN_PX = 2`px) so only each letterform's own outline clears, not a bounding band; a line passing behind a name still reads as a continuous line, just nicked at each glyph rather than severed. The halo carries the label's own alpha, so a crossfading name never leaves a dark ghost stroked at full strength over the field it's fading out of. A node's label is forced on regardless of budget if it's hovered, active, a search match, a highlighted node, a neighbour of the hovered node, or (see above) a `"self"` node. Otherwise visibility is driven by `labelSelection.ts`'s zoom-ladder math: below `FILE_LABEL_REVEAL_T` cluster names own the field (`clusterLabelAlpha`/`clusterLevelAlphas`, one crossfade per hierarchy level via `levelBoundaries`); past that point file labels crossfade in (`fileLabelAlpha`) and their per-frame budget (`fileLabelBudget`) ramps from a handful of top-ranked hubs up to every on-grid candidate near `FILE_LABEL_FULL_T`. `computeAlwaysOnSet()` (pure, unions the top-`hubCount` nodes by undirected degree with the active file) still exists and still feeds the same rank as a tie-break, but on its own contributes nothing at "fit" zoom, where the file-label budget is zero. `GraphConfig.labelEveryNode` (opt-in, used by the embedded ` ```graph ` block) bypasses both the budget and the crossfade so every node is labeled at every zoom — a hand-authored diagram's labels ARE its content.

`labelSelection.ts` has many live exports (`computeAlwaysOnSet`, `fileLabelBudget`, `fileLabelAlpha`, `clusterLabelAlpha`, `levelBoundaries`, `clusterLevelAlphas`, `clusterLabelText`, `eyebrowWidthCells`, and the `FILE_LABEL_*`/`CLUSTER_LABEL_MAX_CHARS` constants) — the zoom-driven label-ladder half of the module is very much alive. Only its old `renderedPixelRadius()`/`selectVisibleLabels()` helpers (and `LabelCandidate`/`LabelSelectOpts` types) were deleted, along with their sole consumer `graph/LabelLayer.ts` and `graph/collide.ts` — see "Vestigial and removed code" below.

### Vestigial and removed code

`app/src/graph/LabelLayer.ts` (a DOM-overlay label layer built on `THREE.Vector3` screen projection, from the pre-Canvas2D era) and `app/src/graph/collide.ts` (per-node collision-radius helpers) are **deleted**, along with `collide.ts`'s test and `labelSelection.ts`'s two now-orphaned exports that only they consumed. The only remaining trace is a comment in `app/src/App.css` noting that the `.graph-labels`/`.graph-label` CSS rules that used to live there belonged to `LabelLayer.ts` and were deleted with it.

The `three` npm package has been removed from `app/package.json`, along with the `three` half of the manual Vite chunk-splitting rule (`app/vite.config.ts`) — nothing under `app/src` ever imported it (the current renderer is Canvas 2D). `d3-force-3d` is still listed and still has a manual chunk rule, now named `"d3-force-3d"` since it's the only package left that the rule matches: it IS imported from `app/src` — `AsciiGraphRenderer.ts` itself doesn't use `THREE.*` or `d3-force-3d` (the frontend's own `d3-force-3d.d.ts` type-declaration file, `app/src/graph/d3-force-3d.d.ts`, is itself unreferenced), but `app/src/GraphView.tsx` and `app/src/graph/EmbeddedGraph.tsx` both import `computeLayout` from `core/src/layout.ts`, which imports `d3-force-3d` directly (server-side force refinement — see "Backend-Precomputed 2D/3D Layout" above); its own type stub is `core/src/d3-force-3d.d.ts`. `app/src/App.tsx` carries a comment explaining why `GraphView` is still lazy-loaded despite `three` being gone: it pulls in `d3-force-3d` via `core/src/layout.ts`, and the comment now says so — noting `three` no longer factors in and that task 25 deleted both the package and its `vite.config.ts` chunk rule.

---

## Graph Atmosphere (`GraphAtmosphere.tsx`)

`GraphAtmosphere` is no longer a cluster-lobe CSS glow — it is a **density-field phosphor bloom**, painted from where the nodes actually are, plus the depth vignette. It replaced an earlier atmosphere of three CSS radial-gradients parked at cluster centroids, tuned against the old saturated category ramp; the redesign's desaturated ramp made that same 26%-alpha screen blend read as a whisper, and soft competing hues (iridescence) also clashed with the ASCII aesthetic's single-hue phosphor look. It is extracted into one component so `GraphView` and the first-run `VaultIntro` render the same atmosphere instead of duplicating the canvas + wiring, and both a hypothetical STANDARD renderer and the shipped `AsciiGraphRenderer` can feed it identically.

```tsx
export interface BloomSink { current?: (field: DensityField) => void }
export function GraphAtmosphere(props: { sink?: BloomSink; mode?: string }): JSX.Element
```

**No `renderer` prop, deliberately.** `GraphAtmosphere.tsx`'s file header explains why a `renderer` prop was tried and rejected as a real bug magnet: Solid compiles a bare-identifier JSX prop (`renderer={renderer}`) to a **static** value, not a reactive getter — `babel-plugin-jsx-dom-expressions` only generates getters for call/member/JSX expressions. `GraphView.tsx`'s `renderer` is a `let` reassigned by a swap effect whenever the ASCII/STANDARD setting changes, which (because the client always boots on the schema default before fetched settings can override it) happens on nearly every load. A keyed `<Show>` remounting the component doesn't fix it either — `Show` re-mounts children in Solid's pure/Updates phase, which runs *before* the swap effect (a user effect, Effects phase) reassigns `renderer`, so the remount faithfully re-captures the about-to-be-destroyed instance. It's also a race (depends on whether the settings fetch resolves before first paint), so it can look correct in one run and silently regress in the next.

Instead the caller (`GraphView.tsx`'s `mountRenderer()`, `VaultIntro.tsx`'s `IntroGraph`) owns a stable `BloomSink` object (`const bloomSink: BloomSink = {}`) and wires `renderer.setBloomCallback((field) => bloomSink.current?.(field))` itself, wherever it (re)assigns `renderer`. `GraphAtmosphere` registers its paint function into `sink.current` exactly once, on mount; every renderer instance that ever exists — past, present, or future — forwards through that same stable object. No remount, no getter, no dependency on Solid's effect-ordering internals.

- Render it as a **sibling after** the renderer's `<canvas>` inside a positioned container; it fills that container (`inset: 0`). Styling lives in `graphAtmosphere.css`.
- It renders a `<canvas class="graph-bloom" data-mode={props.mode}>` (the `data-mode` attribute lets a mode theme its glow) plus a `.graph-vignette` div.
- Each frame the renderer computes a per-node-density field via `densityField.ts`'s `buildBloom()` (see below) and pushes it as a `DensityField` (a `Float32Array`, optionally carrying an `rgb` channel) through the sink. `GraphAtmosphere` paints it onto a small `FIELD_W × FIELD_H` (`64×40`, `densityField.ts`) canvas via `ImageData` and lets the browser's own smoothing scale it up — cheap, and exactly the soft falloff the effect wants.
- **Colour is theme-derived, never hardcoded.** `resolveBloomRgb()` reads an explicit `--bloom-rgb` custom property ("r, g, b", e.g. from a future per-theme override) first if it parses (`bloomColor.ts`'s `parseRgbTriple`); otherwise the active theme's `--accent` hex colour (`parseHexColor`); otherwise a literal CRT-phosphor teal fallback (`FALLBACK_RGB = [150, 230, 216]`) for the rare case neither resolves (stylesheet not yet loaded). Both parsers return `null` on malformed input rather than a NaN channel — a NaN channel coerces to 0 in `Uint8ClampedArray`/canvas `ImageData`, which silently paints invisible black. Because Bismuth themes switch live (`App.tsx` re-applies `settingsToCssVars` via `documentElement.style.setProperty` on every settings change), a `MutationObserver` on `document.documentElement`'s `style` attribute re-resolves the base colour on an actual theme switch (never per frame — `getComputedStyle` has no business on the rAF path) and repaints the last field under the new colour.
- **Territory colour.** Brightness is density; hue is *whose* density it is. Each emitter may carry the community colour it's already drawn in (`AsciiGraphRenderer`'s `slotBloomRgb`/`nodeBloomRgb`, off the size-ranked `clusterVisual.buildColorSlots` slots), so the ground reads as a soft map of territories rather than one flat haze. `bloomColor.ts`'s `tintTerritory(base, r, g, b)` mixes a cell's territory colour into the base phosphor hue by `TERRITORY_TINT = 0.72`, first renormalising the territory colour to the base hue's own luma (Rec. 709 weights) so a territory can change what colour a region is but never how bright it is. A field with no colour at all (a community-less graph, e.g. an embedded ` ```graph ` block) paints in the base hue exactly.
- **Building the field** (`densityField.ts`): `buildBloom(points, radius = 6)` bins `BloomPoint`s (`{x, y, weight?, rgb?}`, screen fractions 0..1) into the `FIELD_W×FIELD_H` grid (`accumulate`/`accumulateColor`), applies a 3-pass separable box blur (`BOX_PASSES = 3` — converges to a Gaussian per the CLT; a single pass leaves a flat-topped square with hard corners), then `normalise()`s so the peak cell is exactly 1. If any point carries an `rgb`, three more weight×channel grids ride through the identical kernel and are divided by the blurred weight afterward to recover the per-cell weighted mean emitter colour (`COLOR_EPS = 1e-6` floors near-zero weight to colour `0` rather than amplifying rounding noise into speckle) — the intensity channel is bit-for-bit identical with or without colour, which is what makes territory colour a hue change and never a brightness change.
- **Summarized clusters emit a cloud, not a point.** A renderer that summarizes many nodes into one LOD aggregate mass can't emit that mass as a single weighted point — `blur` conserves total mass but not peak, so one point's light concentrates far more than the same weight spread over the members' real footprint, and past a certain zoom the summary out-peaks everything else and `normalise()` crushes the rest to black. `pushCloud()` instead spreads an aggregate's weight over `rings` (`CLOUD_MIN_RINGS`/`CLOUD_MAX_RINGS` = 2/8) of `perRing` (`CLOUD_MIN_PER_RING`/`CLOUD_MAX_PER_RING` = 6/16) evenly spaced points, sized against the blur radius by `CLOUD_SPACING_CELLS = 5` (`cloudGrid()`), so a summarized cluster reads as the same light, in the same place, at the same spread as the individual points it stands for.
- **Alpha curve**: `GraphAtmosphere`'s paint loop maps each cell's normalized density `v` to canvas alpha via `v⁴` (`Math.round(255 * Math.min(1, v * v * v * v))`), crushing the mid-range so only genuinely dense regions light up — chosen over `v²`/`v³` after a comparison sweep found `v²` read as fog over the whole graph.

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

Returns a string cache key `"v20-<16-char-sha1>"` from the node id set, edge `from|to|kind` triples, and vault path. Stable across content-only file edits (which don't change node/edge structure).

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
  AsciiGraphRenderer   [frontend — no self-node injection for 2nd/3rd/both]
```

For `"local"` mode, everything above still runs to fetch the full "both" graph once — the difference is entirely client-side, after `/graph` has already landed:

```
GraphData (from /graph)
      |
  selectDisplayGraph("local", ...)   (app/src/graph/displayGraph.ts)
  subgraphByKinds(graph, SECOND_BRAIN_KINDS)
  localSubgraph(g, activeId)         (core/src/graph.ts — strips community fields)
      |
  localLayoutInput(g, communitySource)   (app/src/graph/localLayoutInput.ts — re-attaches
      |                                   community/communityPath to the LAYOUT INPUT only)
  computeLayout()  ×2 (3D, then 2D seeded from it)   — same pure function as the backend,
      |                                                run on the main thread, no cache
  AsciiGraphRenderer
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
  DaemonList + AsciiGraphRenderer  [frontend, no self node]
```

The relay registry (`core/src/relay.ts`) is still populated the same way (terminal tab → relay plugin hooks → `registerSession`/`startSubagent`/`stopSubagent`/`prune`), but nothing downstream of it builds or serves a graph anymore — `buildAgentGraph()` (`agents.ts`), `GET /agent-graph`, and the frontend `layoutAgentGraph()`/`AgentsGraph` overlay pipeline that used to consume it are all gone. See `docs/terminal/overview.md`.

---

## Key Invariants and Gotchas

- **No graph mode currently injects a `"self"` node.** `NodeKind` still has `"self"` and `core/src/graph.ts` still exports `SELF_NODE_ID`, but no backend graph builder and no live frontend mode-selection path (`displayGraph.ts`) emits one — see "The 'You' Self Node". The renderer's `"self"`-handling (pinning to origin, hub clearance) is dead code on the live render path; the only place a `"self"` node is actually constructed is `app/src/intro/VaultIntro.tsx`'s static demo graph.
- **Layout is backend-only for the vault/memory graph.** The browser never runs a force simulation over it — `AsciiGraphRenderer` only rescales the backend's settled positions (`respace.ts`'s `scaleToSpacing()`); a 2D↔3D mode switch is a hard camera reset, not an animated morph (see "Rendering" above).
- **`app/src/graph/LabelLayer.ts` and `app/src/graph/collide.ts` are deleted**, not merely unused — don't look for them on disk. The `three`/`d3-force-3d` npm packages are still declared in `app/package.json` but nothing under `app/src` imports either anymore; `core/src/layout.ts` is the only remaining live consumer of `d3-force-3d` in the app (server-side force refinement). `core/src/agents.ts` and the `"agent"` node kind are dead in the same sense as before — see "Node Kinds" above.
- **Sub-view layouts may be absent on first load.** `GET /graph` only includes `views.second`/`views.third` if already cached. The frontend falls back to full-graph positions until `GET /graph/views` responds.
- **Cache is written to `~/.bismuth/layout-cache/`, not the vault.** Writing inside the vault would trigger the fs watcher and cause an infinite invalidate→rebuild loop. The durable app dir (not `os.tmpdir()`, which macOS purges) keeps reopens as cache hits; override with `BISMUTH_LAYOUT_CACHE_DIR`.
- **`mergeGraphs` keeps duplicate edges.** Two memory notes can both reference the same vault note and both produce `"about"` edges to it — this is by design.
- **Wikilink resolution is basename-first.** `[[My Note]]` matches `My Note.md` anywhere in the vault. `[[reading/My Note]]` matches by full path first, then falls back to basename. Ambiguous basename matches are undefined.
- **`CACHE_VERSION` must be bumped when layout output changes** — not just force constants, but the small-graph boost and the disconnected-component reel-in too. The current version is `"v20"`. A stale cached layout computed under different rules would mismatch the renderer's forces.
- **`now` in `nodeVisualState` is a no-op.** `lastResult` and `lastFiredMs` do not drive the visual encoding — only `enabled` and `running` matter.

---

Source: `core/src/graph.ts`, `core/src/layout.ts`, `core/src/layout-cache.ts`, `core/src/engine.ts`, `core/src/daemon.ts`, `core/src/daemonViz.ts`, `core/src/daemonGraph.ts`, `app/src/graph/AsciiGraphRenderer.ts`, `app/src/graph/graphRenderer.ts`, `app/src/graph/respace.ts`, `app/src/graph/backbone.ts`, `app/src/graph/clusterVisual.ts`, `app/src/graph/cameraModel.ts`, `app/src/graph/lod.ts`, `app/src/graph/asciiGrid.ts`, `app/src/graph/graphFit.ts`, `app/src/graph/graphStability.ts`, `app/src/graph/GraphAtmosphere.tsx`, `app/src/graph/densityField.ts`, `app/src/graph/bloomColor.ts`, `app/src/graph/displayGraph.ts`, `app/src/graph/localLayoutInput.ts`, `app/src/graph/labelSelection.ts`, `app/src/GraphView.tsx`, `app/src/App.tsx`, `app/src/commands.ts`, `app/src/intro/VaultIntro.tsx`, `app/src/graph/EmbeddedGraph.tsx`, `core/src/relay.ts`, `core/src/vault.ts`, `core/test/graph.test.ts`, `core/test/daemonViz.test.ts`, `core/test/engine.test.ts` (`core/src/agents.ts` no longer contributes to the graph — it now holds only the chat-subagent types; see "Node Kinds" above)
