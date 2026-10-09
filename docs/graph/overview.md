# Knowledge graph

The knowledge graph is Bismuth's home tab: every note, tag and (when the daemon is on) memory in your vault drawn as one map, laid out so linked things sit together. This page is for anyone who wants to read or drive that map, and for engineers who change how it is built, laid out or drawn.

In the app, a node is a character on a grid, not a dot: `@` for a hub, `o` for a linked note and `.` for a leaf. The same graph is available as JSON from the shell, here for a vault with `Index.md` and `reading/My Note.md`:

```bash
bismuth graph --vault ~/vault
```

```json
{"nodes":[{"id":"Index","label":"Index","kind":"note","folder":"(root)"},
          {"id":"reading/My Note","label":"My Note","kind":"note","folder":"reading"},
          {"id":"tag:book","label":"#book","kind":"tag"}],
 "edges":[{"from":"Index","to":"tag:book","kind":"tag"},
          {"from":"reading/My Note","to":"Index","kind":"link"},
          {"from":"reading/My Note","to":"tag:book","kind":"tag"}]}
```

The command prints the 2nd-brain graph, plus the memory graph when you pass `--memory <dir>`. It carries no layout positions, which the server adds.

## Open and read the graph

The graph is the first tab of every window, and it reopens if you close every tab. Click a node to open that note. Hover a node to dim everything except it and the edges touching it.

The view bar above the graph holds these controls.

| Control | What it does |
|---|---|
| `2nd` / `3rd` / `both` | Which brain to draw: the vault, the daemon's memory, or both with the links across |
| `2d` / `3d` | Flat birdseye view or an orbit view of the same layout |
| `clusters` | On: notes read as named community groups. Off: every note, with names growing as you zoom |
| `find` | Search the graph's nodes and fly the camera to one |

The `3rd` and `both` modes exist only while the daemon is enabled (`daemon.enabled` in `.settings`). With the daemon off the mode switcher is hidden and the graph shows the vault alone.

The `2d`/`3d` choice and the `clusters` toggle are remembered per browser, not written to `.settings`, so flipping them never rewrites your settings file.

## The three brains

The graph draws up to two sources, called brains. The 2nd brain is your vault: notes, tags and the links between them. The 3rd brain is the daemon's memory graph at `<vault>/.daemon/memory`. The `both` mode draws the union, joined by `about` edges from a memory to the vault note it links.

| Mode | Shows |
|---|---|
| `2nd` | Notes and tags |
| `3rd` | Memory notes only |
| `both` | Everything, plus `about` edges |
| `local` | The open note and its direct neighbours |

Each brain mode has its own layout, so a memory linked to a vault note does not sit stranded far from its own cluster when the vault is hidden.

## Show only the open note's neighbourhood

The `local` mode narrows the 2nd-brain graph to the note you have open and every note one link away, in either direction. It is a lens over the sidebar mini-graph, not a fourth switcher segment. Click `local` at the top of the mini-graph to turn it on and click it again to return to the mode you were in.

The `graph-local` command (**Graph: Local (open note)**) switches to the same lens. If you promote the mini-graph to a full pane while `local` is on, the pane returns to the mode you were in. With no note open, `local` shows an empty graph.

## Zoom, pan and keys

Zoom changes resolution, not size. At 100% (fit) the whole graph's bounding radius fills the grid. At 0% every note is individually distinguishable. The mouse wheel steps the zoom in 10-point notches and the view glides to each stop; a glyph is the same size on screen at every zoom.

| Input | Effect |
|---|---|
| Wheel | Zoom one notch, anchored on the cursor in 2D |
| `=` or `+` / `-` | Zoom in / out one step, centered |
| Drag | Pan in 2D, orbit in 3D (a press under 5 px is a click) |
| `Z` | Frame the hovered node and its neighbours, or reset the camera when nothing is hovered |
| `Escape` | Reset the camera to the whole-graph view |

These are the `graph-zoom-in`, `graph-zoom-out`, `graph-focus-node` and `graph-reset-view` entries in the keybinding catalog, so you can rebind them; see [keybindings](../settings/keybindings.md). In 3D the graph spins slowly while it has 350 nodes or fewer and you have not grabbed the camera (see `graph.spin` below).

## Labels and clusters

As you zoom in, the graph names things in layers. Far out, each community group carries one cluster name (the title of its highest-degree member). Mid-zoom the biggest hubs show their note names. Close in, every note on screen is labelled and collisions drop a name rather than overprint it.

With `clusters` on, the far zoom band draws each community as one aggregate mass. With it off, the graph is a plain every-note field at every zoom. Note names carry no `[[ ]]` and clip at 28 characters with `…`.

Past 200 notes the flat field is quieted: glyph weight follows degree rank (about the top 2% are `@`, the next 25% are `o`), edges into a hub fade, and edges thin out as screen density rises.

## Find a note in the graph

The `find` button opens a search list of the graph's nodes. Typing filters by label and by folder or community (case-insensitive substring). The arrow keys and hover preview a node by lighting its label, without moving the camera. Enter or a click flies the camera to the node and opens it. Escape closes the list.

The Cmd+O switcher also lights its whole result set in the graph while it is open.

## Settings that affect the graph

These `graph` keys in `.settings` change what you see; each has a row in [the settings reference](../settings/reference.md#graph).

| Key | Type | Default | Effect |
|---|---|---|---|
| `graph.gradient` | boolean | `false` | Phosphor glow behind dense regions plus a darkened vignette at the edges |
| `graph.spin` | boolean | `true` | Idle rotation in 3D |
| `graph.spinSpeed` | number | `0.0015` | Idle rotation speed in radians per frame |
| `graph.showGraphLabels` | boolean | `true` | Master switch for in-scene labels |
| `graph.graphLabelHubCount` | number | `10` | Top-degree nodes that always get a label |
| `graph.showFps` | boolean | `false` | Frame-rate counter on the graph |
| `graph.backgroundNoise` | boolean | `false` | Faint ASCII noise texture under the field |

With `graph.gradient` off, the glow canvas and the vignette are not mounted at all. The glow takes its colour from the theme's `--accent` token, tinted per community.

## Embed a graph in a note

A ` ```graph ` fence in a note draws a small hand-authored graph with the same renderer, labelling every node. Its syntax lives in [the graph block page](../editor/graph-block.md).

## How it works

Backend modules in `core/src/` build the graph, lay it out and cache the layout. `AsciiGraphRenderer` in `app/src/graph/` only rescales those positions and draws them. The browser never runs a force simulation for the vault graph.

### Data types

Every consumer works with `GraphNode`, `GraphEdge`, `GraphData` and `ViewLayout` from `core/src/graph.ts`.

| `GraphNode` field | Type | Notes |
|---|---|---|
| `id` | `string` | Note: vault-relative path without `.md`. Tag: `tag:<name>`. Memory: `mem:<relative path>` |
| `label` | `string` | Display name; a tag is `#<name>` |
| `kind` | `NodeKind` | See node kinds below |
| `folder` | `string?` | Note nodes: top-level folder, or `(root)` for a file at the vault root |
| `position`, `position2d` | `[x,y,z]`, `[x,y]` | Layout coordinates attached by the backend |
| `community`, `communityLabel` | `number`, `string` | Finest Louvain community and its exemplar (highest-degree member) |
| `communityPath`, `communityPathLabels` | `number[]`, `string[]` | Nested communities, coarsest to finest; last element equals `community` |
| `daemon` | `DaemonVizState?` | Cron and process nodes only |

`GraphData` is `{ nodes, edges, views? }`. `views.second` and `views.third` are `ViewLayout` records (`pos3d`, `pos2d` keyed by node id) for the brain subsets. The number of community levels grows with graph size: 1 below about 360 nodes, up to 4 beyond about 7,290 (`communityLevelsFor` in `core/src/community.ts`).

### Node and edge kinds

The live knowledge graph produces three node kinds and four edge kinds.

| Node kind | Built by | Id |
|---|---|---|
| `note` | `buildVaultGraph()` in `vault.ts` | path without `.md` |
| `tag` | `buildVaultGraph()` | `tag:<name>` |
| `memory` | `buildMemoryGraph()` in `memory.ts` | `mem:<relative path>` |

| Edge kind | From to | Meaning |
|---|---|---|
| `link` | note to note, memory to memory | A `[[wikilink]]` whose target exists. A path-qualified `[[folder/Note]]` wins over a basename match |
| `tag` | note to tag | The note carries the tag in frontmatter or body |
| `about` | memory to note | A memory's wikilink resolved against vault notes (`engine.ts`) |

`mergeGraphs()` keeps the first node seen for a duplicate id and keeps every edge, so two memories that link the same note both produce an `about` edge. `SECOND_BRAIN_KINDS` (`note`, `tag`) and `THIRD_BRAIN_KINDS` (`memory`) define the brain subsets.

The `agent`, `self`, `message` and `open` kinds are defined in `graph.ts` and nothing in the live graph produces them. `SELF_NODE_ID` (`::you`) is built by hand only in the first-run intro graph (`app/src/intro/vaultIntroGraph.ts`), and `AsciiGraphRenderer` draws a `self` node as `@` in the plain foreground colour.

### Build pipeline

```
buildVaultGraph()   buildMemoryGraph()
        \             /
         buildGraph()          engine.ts: about edges, mergeGraphs, stampCommunities (Louvain)
              |
         attachLayout()        layout-cache.ts: position / position2d on every node
              |
         GET /graph            routes/graph.ts, filtered by visibility
              |
         selectDisplayGraph()  app/src/graph/displayGraph.ts: pick the mode's subgraph
              |
         AsciiGraphRenderer
```

`GET /graph` returns the full `both` graph. The 2nd and 3rd brain modes filter it in the browser with `subgraphByKinds()` and swap in that brain's `ViewLayout`. `views` is included on `/graph` only after it has been computed; `GET /graph/views` computes and caches it, and the frontend uses full-graph positions until it arrives. No mode adds a `self` node.

The `local` mode runs entirely in the browser. `localSubgraph(g, centerId, depth = 1)` keeps the open note and every node within one hop over edges in both directions. It strips community fields from the survivors, so a dozen notes are not coloured by the whole vault's structure. `GraphView.tsx` then re-lays the neighbourhood out in the main thread with `computeLayout()` (120 refine ticks, 3D first and 2D seeded from it). `localLayoutInput()` re-attaches each node's community to the layout input only, so a neighbour in the focused note's community settles closer. `showLodMasses` is forced off in `local`.

### Layout algorithm

`core/src/layout.ts` runs two stages.

1. PivotMDS seeds a deterministic global placement. It picks pivot nodes by a max-min sweep, runs BFS from each, double-centres the distance matrix, finds the top eigenvectors by power iteration, and scales the result to an RMS radius of 100 with a tiny seeded jitter.
2. A `d3-force-3d` refinement settles the seed. Link attraction is LinLog by default (`energyModel: "linlog"`) and many-body repulsion scales with `degree + 1` (`degreeRepulsion: true`).

Key `DEFAULTS` in `layout.ts`:

| Option | Default | Effect |
|---|---|---|
| `numPivots` | `50` | PivotMDS pivot count |
| `refineTicks` | `150` | Force ticks for a direct `computeLayout()` call |
| `repulsion` | `-7` | Many-body strength |
| `linkDistance` | `5` | Base link rest length (spring model only) |
| `centering` | `0.13` | Pull toward the origin |
| `communityForces` | `true` | Enables the community-aware forces below |
| `communityIntraLink` / `communityInterLink` | `1.8` / `0.2` | Link strength multipliers inside and between communities |
| `communityGravity` | `0.6` | Per-tick pull toward the node's community centroid |
| `communitySeparation` | `0.85` | Community-level collide strength, pushing groups apart |
| `communityLevelDecay` | `0.4` | Falloff per ancestor level for nested forces |
| `virtualLinkStrength` / `virtualAnchors` | `1.2` / `4` | Tethers that reel stray components into the main mass |

`communityIntraDist`, `communityInterDist` and `virtualDistMult` only take effect when `energyModel` is set to `"spring"`; LinLog has no rest length.

Three details shape the result:

- A small graph spreads out: the link distance is multiplied by `min(8, max(1, 400 / n))`, so a fresh vault is airy and a graph of 400 nodes or more is unchanged.
- Small disconnected components are tethered to anchors in the main mass by layout-only virtual links, so they do not drift to the edge. A component at or above `max(4, mainSize x 0.25)` is a real island and is left alone. Virtual links are never emitted as graph edges.
- Collision radius scales with degree and shrinks in 2D (`MODE_2D_COLLIDE_MULT = 0.65`) so link and community structure set local spacing.

The 2D layout is seeded from the 3D positions, which keeps the two geometrically aligned for the morph.

### Layout cache and warm starts

`core/src/layout-cache.ts` caches layouts in two tiers. A bounded in-memory map (`MEM_CACHE_MAX`, 16 entries) sits over JSON files in `~/.bismuth/layout-cache/<sig>.json`, keyed by `graphSig` (SHA-1 of the vault key, sorted node ids and sorted `from|to|kind` edge keys) and versioned by `CACHE_VERSION`. Override the directory with `BISMUTH_LAYOUT_CACHE_DIR`. The cache lives outside the vault so a write never triggers the file watcher.

Bump `CACHE_VERSION` whenever layout output changes, and bump `GRAPH_CACHE_KEY` in `app/src/App.tsx` in step with it. That key names the browser's last-rendered graph, which paints instantly on boot; a stale one paints old coordinates before the fresh fetch lands.

On a cache miss, `diffPlan(seed, graph)` (`core/src/layoutDiff.ts`) compares against the last layout kept for the vault and decides how much to compute.

| Edit | Compute |
|---|---|
| Delete a note | None; the seed minus the removed ids |
| Rename or move a note or folder | None, after `renameLayoutIds()` remaps the seed |
| Add or remove a link between two existing notes | Pinned settle of those two notes |
| Create a note | Pinned settle of the new notes |
| More than `max(25, 10%)` movable nodes | Full warm settle from the prior positions |
| No seed | Full settle from PivotMDS |

A pinned settle fixes every other node and runs `REFINE_TICKS_INCREMENTAL` (60) ticks. A full settle runs `REFINE_TICKS` (240).

Cancellation is selective. Only a build that is cheap to redo (pinned or zero-compute) stops when its caller aborts, and a full settle always runs to completion because its seed makes every later build small. A build that predates a rename never writes a seed, guarded by a per-vault rename epoch.

The pure compute is `computeLayoutPair()` in `core/src/layoutCompute.ts`. `core/src/layoutRunner.ts` runs it in one persistent Bun Worker (`layoutWorker.ts`) so a long settle does not starve request handling. It falls back to in-process computing when there is no `Bun` global (the mobile backend), when `BISMUTH_LAYOUT_IN_PROCESS=1`, or when the worker cannot start. The compiled sidecar embeds the worker only because `app/scripts/build-core-sidecar.ts` lists `layoutWorker.ts` as a second entrypoint.

### Renderer

`AsciiGraphRenderer.ts` draws to a plain Canvas 2D context. It is the one renderer behind every host: the full-pane graph, the sidebar mini-graph, the first-run intro and the embedded ` ```graph ` block. Hosts hold it only as the `GraphRenderer` interface in `graphRenderer.ts`. Nodes and labels are glyphs snapped to grid cells, and edges are anti-aliased vector strokes beneath them. In 3D, depth is cued by glyph weight (`glyphTier()` in `asciiGrid.ts`: a far hub drops from `@` to `o`): nodes and edges draw at full alpha at every distance from the camera.

`render(g)` computes `structuralGraphSig()` and skips a rebuild when only coordinates changed. On a structural change, `respace.ts`'s `scaleToSpacing()` measures the median nearest-neighbour distance and applies one uniform scale so the cloud hits `RESPACE_TARGET_SPACING` (14). A uniform scale preserves order, and the renderer shares no spacing constants with the backend.

Zoom is resolution: `asciiGrid.ts` maps a zoom percentage to world units per cell (`ZOOM_STEP_PCT` = 10, `DEEPEST_WORLD_PER_CELL` for 0%). The view glides to each stop with a time-based ease (`GLIDE_TAU_MS` = 110). In 3D a camera dolly is derived from resolution progress (`cameraModel.ts`), so one wheel notch both raises resolution and moves the camera.

The zoom ladder has three bands, crossfaded by one continuous progress value `t`:

| Band | Draws |
|---|---|
| Far | Aggregate community masses, cluster names and aggregate connectors (`lod.ts`, gated by `GraphConfig.showLodMasses`) |
| Mid | Individual glyphs joined by a hub-to-hub backbone over the active community level (`backbone.ts`) |
| Near | Individual glyphs joined by their real edges |

A colour-tinted intra-cluster mesh draws beneath wherever glyphs are visible. Cluster names own the field below `FILE_LABEL_REVEAL_T` (0.75); file labels then crossfade in and reach a full budget near `FILE_LABEL_FULL_T` (0.94). A hovered, active, search-matched or neighbouring node always keeps its label. Labels are `fillText` with a ground-coloured `strokeText` halo, and `reserveLabelCells()` blanks glyphs under a label so nothing is drawn and then covered.

A 2D/3D flip animates over `MODE_MORPH_MS` (500) via `modeMorph.ts`, capturing every blended value from its live state when a transition starts. `pick()` hit-tests by grid cell within `HIT_RADIUS_CELLS` (2), and cell ownership is depth-ordered in 3D so the glyph a cell shows is the node a click there opens. Edges are thinned by a stable hash rank above `EDGE_BUDGET_2D` and `EDGE_BUDGET_3D` (6000 each).

The renderer pauses its animation loop while `document.visibilityState` is `hidden`, so a backgrounded browser tab samples a blank canvas.

### Atmosphere

`GraphAtmosphere.tsx` paints the density-field glow and vignette. The renderer builds a `DensityField` each dirty frame with `buildBloom()` in `densityField.ts` (a `FIELD_W x FIELD_H` grid of 64 x 40, a three-pass box blur, normalised to a peak of 1) and pushes it through a stable `BloomSink` object that `GraphView.tsx` owns. `GraphAtmosphere` registers one paint function on mount and replays `sink.last`, so a remount while the graph is at rest still paints. Cell alpha follows `v^4`, so only dense regions light up. Colour comes from `--accent` via `bloomColor.ts`; `tintTerritory()` mixes each community's colour in at `TERRITORY_TINT` (0.72) while keeping the base luma, so territory changes hue and never brightness.

### Daemon nodes and the CLI

The graph pane draws no daemon nodes. `buildDaemonGraph()` in `core/src/daemonGraph.ts` still builds a `GraphData` of one `daemon` hub (`::daemon`, labelled with the daemon's name), one `cron` node per `crons/*.md` file (`cron:<name>`), and one `process` node per `processes/*.md` file (`process:<name>`), joined by `supervises` edges. `bismuth daemon graph` prints it as JSON, and [the daemon page](../daemon/overview.md#daemon-page) reads a separate snapshot (`GET /daemon/snapshot`). The hub id `::daemon` shares its spelling with the daemon pane sentinel `DAEMON_TAB` in `app/src/tabIds.ts` and nothing else.

Cron and process nodes carry a `daemon` field (`enabled`, `running`, `lastResult`, `lastFiredMs`, and `schedule` on crons). `nodeVisualState()` in `core/src/daemonViz.ts` maps only `enabled` and `running` to a visual:

| Condition | fill | border | opacity |
|---|---|---|---|
| Disabled (wins even if running) | `base` | `none` | `0.15` |
| Running | `palette` | `none` | `1` |
| Enabled and idle | `bg` | `palette` | `1` |

### Gotchas

- `mergeGraphs` keeps duplicate edges by design.
- Wikilink resolution is basename-first for `[[Note]]` and path-first for `[[folder/Note]]`. Two notes sharing a basename make a bare `[[Note]]` ambiguous.
- The layout cache is not in the vault. Writing inside the vault would trigger the file watcher and loop invalidate and rebuild.
- `graph.repulsion`, `graph.linkDistance`, `graph.centering`, `graph.nodeSize` and the three `nodeSize*Mult` keys validate but nothing reads them; the layout uses its own constants.

Source: `core/src/graph.ts`, `core/src/vault.ts`, `core/src/memory.ts`, `core/src/engine.ts`, `core/src/community.ts`, `core/src/layout.ts`, `core/src/layout-cache.ts`, `core/src/layoutDiff.ts`, `core/src/layoutCompute.ts`, `core/src/layoutRunner.ts`, `core/src/routes/graph.ts`, `core/src/daemonGraph.ts`, `core/src/daemonViz.ts`, `app/src/GraphView.tsx`, `app/src/commands.ts`, `app/src/graph/AsciiGraphRenderer.ts`, `app/src/graph/graphRenderer.ts`, `app/src/graph/displayGraph.ts`, `app/src/graph/graphLayers.ts`, `app/src/graph/respace.ts`, `app/src/graph/asciiGrid.ts`, `app/src/graph/cameraModel.ts`, `app/src/graph/modeMorph.ts`, `app/src/graph/backbone.ts`, `app/src/graph/lod.ts`, `app/src/graph/labelSelection.ts`, `app/src/graph/flatField.ts`, `app/src/graph/GraphAtmosphere.tsx`, `app/src/graph/densityField.ts`, `app/src/graph/bloomColor.ts`, `app/src/graph/localLayoutInput.ts`
