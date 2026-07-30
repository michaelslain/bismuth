# MERGE-NOTES — the two graph renderers, inventoried before merging

Working document for Part 2b. Deleted when the merge lands.

`AsciiGraphRenderer.ts` = 2090 lines. `CanvasGraphRenderer.ts` = 1884 lines. This file is the map so
the merge doesn't drop capability silently. Everything below was read out of the source, not assumed.

**Baseline:** `bun test app/src/graph/` → **245 pass / 0 fail across 11 files** (481ms).

---

## 0. Headline corrections to the plan's assumptions

Read these first — four of the plan brief's premises are wrong against the code as it stands.

| Brief says | Actually |
|---|---|
| "Canvas only: vector edges" | **Wrong.** ASCII vector-strokes its edges too (`strokeEdges()`, `AsciiGraphRenderer.ts:1594-1648`) — real `beginPath/moveTo/lineTo/stroke`, batched one path per alpha tier, ported *from* Canvas. Character edges survive only for the LOD aggregate connectors. |
| "Canvas only: the hand-rolled 3D camera (orbit rx/ry, dolly zoom, perspective divide)" | **Half wrong.** ASCII has the orbit (`rx`/`ry`, `ORBIT_SPEED` 0.005), the same `FOV_DEG` 60, and the same perspective divide — lifted verbatim (`projectNodes()`, `:1347-1388`). Only the **dolly** is Canvas-only: ASCII pins `zc = z2` where Canvas has `zc = z2 + zoom`. |
| "Canvas only: depth banding" | **Wrong.** ASCII has both tiers: node depth via `DEPTH_BANDS = 3` (glyph-ramp shift) + `depthAlpha`, and edge depth via `EDGE_DEPTH_BANDS = 6` with Canvas's own `DEPTH_MIN_OPACITY`/`DEPTH_CURVE` constants copied across. |
| "Canvas only: `LabelLayer.ts`" | **Wrong — it is dead.** 468 lines imported by *nobody*. It is the sole consumer of `labelSelection`'s `renderedPixelRadius`/`selectVisibleLabels`. `docs/graph/overview.md` already calls it dead. Delete it; don't port it. |
| "`lodLevels`/`buildLodIndex` … is it reachable today?" | **Reachable AND ON by default.** See §2.1 — three code comments claim the opposite and are stale. |
| "`AsciiGraphRenderer.test.ts` is 1295 lines / 63 tests" | 1295 lines, **55** tests. |
| "the `GraphRenderer` interface (18 methods)" | 16 required methods + 1 optional property + 2 optional methods = **19 members**. |

Two more that the brief didn't raise:

- `ClusterLegend.tsx` is also unused (GraphView's own comment says so).
- `GraphConfig.transparent` is set by `VaultIntro.tsx:171` and **read by nothing**. Dead config field.

---

## 1. The seam — `graphRenderer.ts` (67 lines), member by member

`?` = optional. "Differ" = same signature, materially different behaviour.

| # | Member | Ascii | Canvas | Differ? | Notes |
|---|---|---|---|---|---|
| 1 | `mount(el, onNodeClick, onHover?, labelOverlay?)` | ✅ | ✅ | minor | **Both ignore `labelOverlay`** (`_labelOverlay`) — it is vestigial; drop it from the merged seam. Ascii additionally runs `readTokens()` (CSS custom properties), `applyFont()`, and installs the DEV `window.__asciiGraphStats` hook. Canvas runs `applyHostVars()` (writes `--label-text`/`--label-bg`/`--bg` onto the host). |
| 2 | `destroy()` | ✅ | ✅ | no | Both detach `onBloom`. Ascii also removes the stats hook. |
| 3 | `render(g)` | ✅ | ✅ | **yes** | Same `structuralGraphSig` + `shouldResetView` gate. On an *unchanged* signature Canvas calls `restyle()` (re-derives colours + rebuilds `levelPairs`); Ascii just sets `dirty = true`. |
| 4 | `setConfig(cfg)` | ✅ | ✅ | **yes, materially** | Ascii: re-reads CSS tokens, re-measures the grid, and on a `viewMode` flip **hard-resets** the whole camera (rx/ry/pan/zoom→100%). Canvas: `colorSig`-gated restyle, `ensure2D()`, and `startModeMorph()` — an **animated 500ms 2D↔3D morph** that lerps every node p3→p2. Also: Ascii **ignores every colour field on `GraphConfig`** (palette/edgeColor/backgroundColor/…) and paints from CSS custom properties instead. Canvas is driven entirely by those ints. |
| 5 | `setVisible(v)` | ✅ | ✅ | no | Identical. |
| 6 | `setActiveFile(id)` | ✅ | ✅ | **yes** | Ascii recomputes `computeAlwaysOnSet` (the curated top-degree hub set). Canvas only sets `dirty` — it **deliberately does not consult `alwaysOn`** (`drawLabels()` comment: it's "a zoom-independent rule from before the hierarchy existed"). |
| 7 | `setSearchMatches(ids)` | ✅ | ✅ | no | |
| 8 | `highlightNodes(ids)` | ✅ | ✅ | no | |
| 9 | `clearHighlight()` | ✅ | ✅ | no | |
| 10 | `focusNode(id)` | ✅ | ✅ | no | Both → `frameSubset([id, ...neighbours])`. |
| 11 | `frameSubset(ids)` | ✅ | ✅ | **yes** | Ascii raises `goalRes` (resolution ladder) and resyncs `zoomPct`. Canvas sets `goalZoom` (dolly px). Same intent, incompatible state. |
| 12 | `resetView()` | ✅ | ✅ | minor | Ascii zeroes `panX/panY` **immediately** (not glided); Canvas glides pan via `goalPanX/goalPanY`. |
| 13 | `getNodesForUI()` | ✅ | ✅ | no | Identical projection. |
| 14 | `getCommunityCentroids()` | ✅ | ✅ | **yes (colour)** | Same shape, but `color` comes from Ascii's CSS-token ramp vs Canvas's `intToHex(colorInt)` from the size-ranked palette. Different hex for the same graph. |
| 15 | `setFpsCallback(cb)` | ✅ | ✅ | no | |
| 16 | `setPaintCallback(cb)` | ✅ | ✅ | **yes (semantics)** | Ascii reports the count of `LAYER_NODE` **cells** painted (so a LOD mass inflates it). Canvas reports `drawOrder.length` (on-screen **nodes**). Same callback, different number. |
| 17 | `onHighlightCleared?` (property) | ✅ | ✅ | no | Both fire on an empty-space click that drops a persistent highlight. |
| 18 | `setZoomCallback?(cb)` | ✅ | ❌ | — | **Ascii only.** GraphView calls it optionally and hides the `%` readout when `graphRenderKind() !== "ascii"` (`GraphView.tsx:372, 563`). |
| 19 | `setBloomCallback?(cb)` | ✅ | ✅ | **yes (weight)** | Both emit per frame from the single projection pass. Ascii skips `!projValid` and weights by `depthAlpha(nv.dr)`; Canvas skips `!onScreen` and weights by `max(0.2, nv.pscale)`. **The merge must pick one weight function.** |

### Off-seam public methods

| Method | Owner | Used by | If dropped |
|---|---|---|---|
| `setFitMargin(m)` | Canvas | `VaultIntro.tsx:201` | The intro's cloud fills the frame instead of sitting back. |
| `setFrameOffsetY(frac)` | Canvas | `VaultIntro.tsx:204` | The intro graph can't sit in the upper area while the canvas stays full-bleed. |
| `computeStats(): AsciiGraphStats` | Ascii | `window.__asciiGraphStats` (DEV) + 4 tests | QA loses the numeric frame snapshot (zoom%, ink coverage, label overlaps, notes/edges drawn). |

### Type ownership (a merge chore, not a capability)

`graphRenderer.ts:13` does `import type { CanvasGraphRenderer, GraphConfig, HoverNode } from "./CanvasGraphRenderer"`, and `AsciiGraphRenderer.ts:50` imports them back out of `graphRenderer`. So the flow is **Canvas → graphRenderer → Ascii**. `graphRenderer.ts:67` also asserts `CanvasRendererIsGraphRenderer` as a compile-time conformance proof. Deleting Canvas breaks the type graph until `GraphConfig`/`HoverNode` are rehomed into `graphRenderer.ts`.

---

## 2. Asymmetries — what only ONE renderer has

### 2.1 ⚠️ The stale-comment trap: LOD masses are LIVE, not opt-in

Three code comments say the aggregate-mass LOD is "retained but unreachable from the app — only
`AsciiGraphRenderer.test.ts` / `lod.test.ts` exercise it":

- `lod.ts:5-11` ("STATUS: OPT-IN, not the shipped default")
- `AsciiGraphRenderer.ts:1040, 1093-1097`
- `CanvasGraphRenderer.ts:44-55` (the `showLodMasses?` field doc)

**All three are stale.** `GraphView.tsx:334` sets it live:

```ts
showLodMasses: graphRenderKind() === "ascii" && props.mode !== "local",
```

and `AsciiGraphRenderer.ts:1098` consumes it as
`showLodMasses === true && is2d && levelCount > 0 && entityLevels.length > 0`. The shipped defaults are
`graph.renderer: "ascii"` (`settingsSchema.ts:113`) and view mode `"2d"`
(`GraphView.tsx:57` — "Default is 2D"). **So on a real vault, out of the box, the graph you look at is
aggregate cluster masses.** GraphView's own comment (`:324-333`) confirms this was a deliberate 2026-07-29
fix: *"This was built, unit-tested and then left unreachable — GraphView never set the flag … That is the
version the user found unreadable; the masses are what made it legible."*

Wired in commit `3842b68` (2026-07-29). The comments were not updated. **Fix the comments before the
merge starts**, or someone reads `lod.ts` and deletes the default view.

### 2.2 ASCII-only

| Capability | Reachable today | File(s) / rough size | Lost if dropped |
|---|---|---|---|
| **Glyph node marks** — the `. → o → @` degree ramp, depth-band shifted, constant cell size at every zoom | ✅ always | `asciiGrid.ts` `nodeGlyph()`; `AsciiGraphRenderer.ts:1165-1183` (~20 lines + the grid it needs) | **The app's visual identity.** Non-negotiable per the spec. |
| **The character grid** — `charBuf`/`layerBuf`/`colorBuf`/`alphaBuf`/`cellNode`/`cellEntity`/`labelOccupied`/`noiseBuf` + run-length row paint | ✅ always | `asciiGrid.ts` (393 lines, pure, 50 tests) + `AsciiGraphRenderer.ts:344-355, 1049-1198, 1653-1733` (~350 lines) | Run batching (a 13k-cell field = a few hundred `fillText`, not 13k) **and — more importantly — free density aggregation**: two nodes landing on one cell collapse to one glyph. See §5.3. |
| **Resolution zoom ladder** — `zoomPct`/`res`/`goalRes`/`maxRes`, 10% steps, wheel-notch accumulation (`WHEEL_NOTCH_PX` 120), `+`/`-` keys, cursor-anchored `zoomStepAnchored()` | ✅ always | `asciiGrid.ts` (`resFromPercent`/`resolutionPercent`/`resolutionT`/`snapZoomPercent`/`maxResFor`/`resFromT`) + `AsciiGraphRenderer.ts:994-1014, 1821-1866` (~120 lines) | The whole "zoom is resolution" model. 7 tests pin it. |
| `setZoomCallback` + the 0–100% HUD readout | ✅ always | `AsciiGraphRenderer.ts:527, 958-961`; `GraphView.tsx:563-565` | The only numeric zoom feedback in the app. |
| **LOD aggregate masses** — `lodLevels`/`entityLevels`/`entityFlat`, `buildLodIndex`, `lodMix`, `massRadii`/`massCellAlpha`/`massCellCode`, `projectEntities`, `drawEntityMasses`, `drawAggregateEdges`, `layoutEntityNames`, `pickEntityIdx`, `clickEntity` (expand exactly one level), cluster-as-`HoverNode` | ✅ **ON by default** (§2.1) | `lod.ts` (221 lines, pure, 16 tests) + `AsciiGraphRenderer.ts:1253-1342, 1536-1568, 1770-1777, 1955-1967` (~200 lines) | The default 2D view. 13 tests. This is the spec's "far = territory masses with cluster names". |
| `layoutClusterNames` + `clusterAgg` — per-level eyebrow names at the **members' grid centroid**, greedy grid-occupancy reservation | ✅ (non-LOD path: 3D, local mode, community-less graphs) | `AsciiGraphRenderer.ts:1488-1534` (~47 lines) | Cluster naming wherever LOD is off. Note Canvas has a *differently-shaped* `clusterAgg` — see §2.3. |
| **File labels on the grid** — `labelOccupied` reservation, `fileLabelBudget` ramp, forced-label rules, left/right flip | ✅ always | `AsciiGraphRenderer.ts:1410-1476` (~67 lines) | Canvas deliberately abandoned `fileLabelBudget`. Whichever survives changes label density everywhere. |
| **Pan quantization** — `quantizePan` world-anchored raster + sub-cell paint-time translate (the pan-jitter fix) | ✅ 2D drag | `asciiGrid.ts` `quantizePan` + `AsciiGraphRenderer.ts:1064-1070, 1662-1668` | Lines "wiggle" while dragging. 2 dedicated tests. Only meaningful *with* a grid. |
| **`syncSize()`** — per-frame host-box reconciliation in `tick()` | ✅ always | `AsciiGraphRenderer.ts:861-868` (~8 lines) | **Canvas has no equivalent.** It relies solely on `ResizeObserver` + `measure()` at mount/build. Ascii added this to fix "the field rendered NOTHING while the HUD read 8 nodes · 10 edges" (the graph is a floating element sized from a rAF, so mount+first render both run at 0×0). 1 test. **Port this regardless of merge direction.** |
| `deriveEdgeBaseAlpha` — per-theme edge stroke alpha solved from the resolved `--text-muted`/`--graph-bg`/`--graph-edge` | ✅ always | `AsciiGraphRenderer.ts:193-203` (pure, exported, 4 tests) | Light themes (paper 0.47, riso 0.34) get lines ~2-3× too heavy. |
| `trimSegmentForClearance` — pull edge endpoints back so a line doesn't run through a glyph's counters | ✅ always | `AsciiGraphRenderer.ts:216-224` (pure, 4 tests) | **Only needed because marks are thin glyphs, not opaque discs.** Canvas got away without it. If the merged renderer draws glyphs, it needs this. |
| CSS-custom-property theming (`readTokens`) instead of `GraphConfig` ints | ✅ always | `AsciiGraphRenderer.ts:693-722` | Themes stop being the single source of truth for the graph. |
| 2D bounding-**box** fit (`boundingHalfExtents`/`fitScaleForBox`, per-axis fill) | ✅ 2D | `graphFit.ts` + `AsciiGraphRenderer.ts:883-905` | A 16:9 field wastes its long axis; a wide cloud is over-read by a circumscribing radius (up to √2). Canvas uses the radius law. |
| Noise texture (`graph.backgroundNoise`, default off) | ⚠️ off by default | `ui/ascii/noiseField.ts` + `AsciiGraphRenderer.ts:1071-1089, 2078-2090` | A setting nobody has on. Cheapest thing to drop. |
| `computeStats()` / `window.__asciiGraphStats` (DEV) | ✅ DEV | `AsciiGraphRenderer.ts:56-66, 2021-2067` (~60 lines) | QA can't assert framing/label/LOD criteria numerically. |

### 2.3 Canvas-only

**None of this is covered by any test** — there is no `CanvasGraphRenderer.test.ts`. This whole column is
the silent-drop risk.

| Capability | Reachable today | Location / rough size | Lost if dropped |
|---|---|---|---|
| **Dolly zoom** — `zoom` px along z, `zc = z2 + zoom`, `goalZoom` glide, `zoomT()` log-normalised bridge to `labelSelection`'s curves via `CANVAS_REVEAL_T = 0.62` | ✅ `renderer: "standard"`, intro, embedded blocks | `CanvasGraphRenderer.ts:819-825, 1016-1021, 1770-1777` (~40 lines) | Perspective **approach**: parallax, the cloud opening up as you move into it. The thing that reads as "magnificent". See §6. |
| **2D↔3D morph** — `morph` 0..1, `easeInOutCubic`, `MODE_MORPH_MS` 500, per-node p3→p2 lerp, orbit unwind | ✅ | `:335, 1141-1146, 1162-1169, 1010-1012` (~30 lines) | The flatten/expand animation. Ascii hard-resets the camera instead. Users hit this control constantly. |
| **Node dots sized by degree** — `nodeFrac`/`computeBaseDiameters`/`nodeDiameter`, density-derived spacing, `MIN_DOT_PX`/`MAX_DOT_PX`, hollow rings for self + idle-daemon, hover rings on the node + its neighbours | ✅ | `:695-698, 1079-1094, 1352-1392` (~60 lines) | **Deliberately out of scope** — the spec replaces dots with glyphs. But the *hover/neighbour rings* are a real interaction affordance Ascii has no equivalent for (it dims instead). |
| **Group-level hub edges** — `crossLevel`, `buildLevelEdges`, `levelPairs`, `levelHubs`, `computeEdgeLevelWeights`, weight-bucketed strokes, `MAX_LEVEL_PAIRS` 700 | ✅ | `:859-924, 1247-1270` (~110 lines) | **This is Canvas's answer to LOD and it is edges-only.** One line per connected pair of communities, hub-to-hub, crossfading level to level. It *is* the spec's "mid = backbone edges". Its doc comment records that the naive alternative (filtering member edges) "reads as *some edges are missing* rather than as a graph OF the clusters". |
| **Intra-cluster mesh** — every intra-community edge stroked in the cluster's own colour at `INTRA_EDGE_ALPHA` 0.22, batched by colour, drawn at every zoom | ✅ | `:1271-1306` (~35 lines) | Its comment: *"a cluster's BODY is its internal edges … without it the masses have no substance."* Ascii has nothing like it — the reason its clusters read as dot clouds rather than woven masses. |
| **Size-ranked cluster colours** — `buildColorSlots`: rank communities by member count, assign palette slots by rank, hue-rotate on wrap, `NODE_SAT_BOOST` 1.55 | ✅ | `:761-793` (~33 lines) | Its comment records the measured failure of the hash scheme: *"on the reference vault nearly every big top-level group landed on the same teal, so the field read as one colour and the grouping was invisible."* **Ascii still hashes** (`colorLevelsFor`, `RAMP[hashKey(key) % 5]`). Canvas's approach is strictly better-informed. |
| **Hub-anchored cluster names** — anchored on the community's highest-degree member (not the centroid), lifted by the group's on-screen extent, size-ramped by share of the **visible** field, `CLUSTER_LABEL_MIN_SHARE`/`MIN_MEMBERS` thresholds, `trimDanglingWord`, `fillTracked` | ✅ | `:307-316, 1566-1648` (~95 lines) | Its comment: a 400-node community's centroid *"routinely lands in empty space — the names then read as free-floating text captioning nothing."* **Ascii's `layoutClusterNames` is centroid-anchored.** Same known-bad approach. |
| **`inViewport`** — label/cluster candidates restricted to the actual viewport + 40px, not merely "in front of the camera" | ✅ | `:931-935, 1505, 1571` | *"the file-label budget is spent ranking global hubs that are off-frame, which is why zooming in used to surface no new names."* |
| **`clearAroundSelf`** — screen-space clear zone around the "you" hub, world-scaled radius + per-node drawn radius floor, golden-angle fan for coincident nodes | ✅ agents mode / any self-node graph | `:1034-1071` (~38 lines) | The hub's breathing room. Ascii has nothing. |
| **Workflow lanes (agents mode)** — `drawWorkflowLanes`: rounded backdrop hull + soft glow underlay + dashed accent line per workflow, `WORKFLOW_LANE_PALETTE` | ✅ agents mode | `:1414-1461` (~48 lines) | **A whole feature.** Ascii has zero support for `edge.workflow`. Easiest thing in the codebase to lose silently. |
| **`scaleToSpacing`** + `p3Cache`/`p2Cache` — re-spread the backend layout to a node-count-independent spacing without a force sim; cached per structural signature | ✅ | `:250-301, 649-686` (~90 lines) | Replaced a ~1.2s client force settle at 2k nodes. Ascii consumes the backend coords raw. Different resting spacing → **different-looking graph**. |
| `BACK_INTERACT_CUTOFF` 0.18 — back-layer nodes aren't hover/click targets in 3D | ✅ 3D | `:1722` | Clicking "through" the cloud to a node behind it. |
| Per-mode edge thinning (2D 6000/0.06, 3D 6000/0.45) | ✅ | `:178-179, 1224-1225` | Ascii uses one budget (2600/0.12) — **less than half Canvas's**, so a dense vault draws visibly fewer edges under Ascii. |
| Depth-sorted node draw order (`drawOrder`, far→near) | ✅ 3D | `:1352-1356` | Occlusion correctness. Ascii's grid gives layer-priority instead. |
| Label pills (rounded translucent bg box) | ✅ | `:1541-1547` | Ascii clears a ground-coloured cell rect instead. Cosmetic. |
| `setFitMargin` / `setFrameOffsetY` / `transparent` | intro only (`transparent` is **read by nothing**) | `:521-523, :41` | The intro's framing. |

---

## 3. Every construction site

`grep -rn "new AsciiGraphRenderer\|new CanvasGraphRenderer" app/src` → 3 sites, exactly as expected.

| # | Site | Renderer | Chosen how | Renderer-specific dependencies |
|---|---|---|---|---|
| 1 | `GraphView.tsx:86` (`makeRenderer`), called at `:166` and in the swap effect at `:394-404` | **either** | `settings.graph.renderer` — `"standard"` → Canvas, anything else → Ascii. Schema default `"ascii"` (`settingsSchema.ts:113`). | Calls `setZoomCallback?.()` and gates the `%` HUD on `graphRenderKind() === "ascii"` (`:563`). Sets `showLodMasses` only for ascii (`:334`). The ASCII↔STANDARD swap tears down and re-mounts through `mountRenderer()`, and the bloom is routed through a stable `BloomSink` object *specifically because* a `renderer` prop re-captures the stale instance across that swap (`GraphAtmosphere.tsx:6-31` documents the Solid effect-ordering reason at length). **Once there is one renderer, the swap effect, `mountedKind`, `makeRenderer` and the `%`-readout `<Show>` all go — but the `BloomSink` indirection should stay**, since `VaultIntro` uses the same shape. |
| 2 | `intro/VaultIntro.tsx:186` (inside `IntroGraph`) | **Canvas, hardcoded** | No setting. Two instances mounted (`pose: "full"` and `"condensed"`), cross-faded. | `setFitMargin()`, `setFrameOffsetY()`, `transparent: true`, `showGraphLabels: false`, `spin: true`, `viewMode: "3d"`, and a graph with **no communities**. `applyGraphConfig()` is typed `(renderer: CanvasGraphRenderer, …)` — a concrete-class dependency, not the seam. **This is first-run surface; it has never executed a line of ASCII code.** |
| 3 | `graph/EmbeddedGraph.tsx:126` (a ` ```graph ` note block) | **Canvas, hardcoded** | No setting. | `graphLabelHubCount: 9999` ("always-on labels for every node") — but **Canvas ignores `graphLabelHubCount` entirely** (`drawLabels` uses `MAX_FILE_LABELS` and gates on `fAlpha`), so this expectation is already unmet today. Also `onHighlightCleared`, a capture-phase wheel gate that only lets `Mod`+scroll through to the renderer, its own 2D/3D `SegmentedToggle`, and a graph with **no communities** and **no layout cache**. |

**Hard constraint:** sites 2 and 3 import `CanvasGraphRenderer` by name. The class cannot be deleted until both are migrated. Neither has a test.

---

## 4. The test surface

`AsciiGraphRenderer.test.ts` — 1295 lines, **55 tests** (not 63), 15 `describe` blocks. It drives the
real renderer headlessly under happy-dom with a recording 2D context (captures `fillText` calls *and*
batched `stroke()` calls with their segments) and a manual rAF `frame()`/`settle()` pump. No timing
dependence. **There is no `CanvasGraphRenderer.test.ts`.**

Rest of the directory (all pure, all reusable as-is): `asciiGrid` 50, `labelSelection` 44, `graphFit` 25,
`densityField` 16, `lod` 16, `graphStability` 14, `bloomColor` 7, `collide` 7, `displayGraph` 7,
`localLayoutInput` 4. **245 total, all passing.**

### 4.1 The regression suite the merge must keep green (renderer-agnostic) — 26 tests

These assert behaviour any unified renderer must still satisfy. **This is the merge's real acceptance
gate.**

| Describe | Test | What it actually pins |
|---|---|---|
| field rasterizes | *reports the node count it painted* | `setPaintCallback` fires with > 0 |
| field rasterizes | *emits a per-frame density field … peak exactly 1* | `setBloomCallback` + `buildBloom` normalisation |
| field rasterizes | *detaches its bloom callback on destroy* | no stale sink after teardown |
| field rasterizes | *rasterizes the flat layout in 2D too* | 2D mode draws something |
| field rasterizes | *writes a tag label exactly once* | `#research`, never `##research` |
| field rasterizes | ***picks the host box up from the render loop when no ResizeObserver notification arrives*** | the 0×0-mount blank-graph bug. **Canvas fails this today** — see §2.2 `syncSize`. |
| semantic zoom | *shows cluster names and NO file names at fit* | the label ladder's coarse end |
| semantic zoom | *crossfades to file names as the field zooms in* | the label ladder's fine end |
| semantic zoom | *hover reports the CLUSTER entity … a hovered NOTE is force-named* | hover→`HoverNode`, forced labels beat the fade |
| N-level labels | *shows only the COARSEST level's names at fit* | `clusterLevelAlphas` level 0 |
| N-level labels | *steps down to the sub-level's names before file names appear* | mid-ladder level handover |
| N-level labels | *eventually crossfades all the way to file names* | ladder terminus |
| cluster occupancy | *every drawn cluster label's span disjoint on the same row* | the "soup" overlap regression |
| cluster occupancy | *`computeStats()` reports zero label overlaps + capped max length* | same, via the QA hook |
| THE LAW | *resetView glides back to 100% (fit)* | `resetView` reaches the overview |
| interaction | *hovers the node under the cursor, and a click opens it* | hit test → `onNodeClick` |
| interaction | *orbiting in 3D re-rasterizes, and a drag never opens a note* | orbit + drag/click disambiguation |
| interaction | *panning in 2D moves the field* | 2D pan |
| interaction | *an empty-space click drops a persistent cluster highlight* | `onHighlightCleared` |
| UI accessors | *exposes clusters with colour + member ids, and the search nodes* | `getCommunityCentroids` + `getNodesForUI` |
| UI accessors | *survives an empty graph* | 0 nodes → paint 0, no clusters, no throw |
| edge clipping | *keeps n0's local edges numerous at maximum zoom* | an edge with one off-screen endpoint still strokes (gate on projection validity, not both-on-screen) |
| vector-edge | *safeDepthBand* × 3 | NaN depth must not throw inside the rAF tick and kill the loop |
| vector-edge | *hover dims by strict incidence at the EDGE constant* | hover dimming is edge-incidence, not the neighbour-expanded focus set, and uses the edge alpha not the node's |

### 4.2 ASCII-specific — 29 tests

Keep these **if and only if** the grid survives the merge. They are the identity's own guard rail.

- **Grid/glyph vocabulary (2):** *strokes edges as vector lines and draws the node degree ramp as glyphs*
  (asserts no fill run is pure edge glyphs `-|/\+`, and the node layer draws **only** `. o @`);
  *names nodes on the grid — labels are cells, not a DOM overlay*.
- **THE LAW — zoom is resolution (6):** type size byte-identical across a wheel zoom; re-rasterizes at
  the finer grid; character advance pinned via `letterSpacing`; reads 100%→0% in 10% steps; the
  degenerate-ladder regression (`maxRes <= 1` collapsing all 11 stops onto one); `frameSubset` raises
  resolution instead of scaling.
- **LOD masses (7):** every node draws as a glyph at fit with the flag off; one named entity per coarsest
  community with the flag on; aggregate connectors; stepping in expands to children in place; deep stops
  dissolve entities into real notes; the cursor-anchored world point stays fixed within a cell across
  consecutive steps; **3D never draws entities even with the flag on**.
- **LOD interaction (3):** clicking an entity expands rather than opening a note; clicking the coarsest
  entity expands exactly one level; `computeStats()` shows entities instead of notes at fit.
- **Pan quantization (2):** raster byte-identical across sub-cell pans; shifts exactly one column on a
  one-cell pan.
- **Pure exported helpers (9):** `deriveEdgeBaseAlpha` × 4 (per-theme edge alpha, incl. measured
  ink/cathode/paper/riso values), `trimSegmentForClearance` × 4, edge width follows the resolution stop.

*(These 9 are "ASCII-specific" only by ownership — the helpers themselves survive any merge that draws
glyphs. `deriveEdgeBaseAlpha` in particular should be adopted regardless.)*

### 4.3 What has no coverage at all

Everything in §2.3. Concretely, zero tests exist for: the dolly camera and `zoomT`, the 2D↔3D morph,
`buildLevelEdges`/`levelPairs`, the intra-cluster mesh, `buildColorSlots`, hub-anchored cluster names,
`trimDanglingWord`, `inViewport`, `clearAroundSelf`, `drawWorkflowLanes`, `scaleToSpacing` + the position
caches, `BACK_INTERACT_CUTOFF`, `setFitMargin`/`setFrameOffsetY`, `VaultIntro`, `EmbeddedGraph`.

---

## 5. Merge order

### 5.1 Recommendation: **ASCII is the base.** This contradicts the plan brief.

The brief reasoned that Canvas is the likelier base because it holds "the 3D camera and vector edges".
It holds neither exclusively. Scored against the target design:

| Target property | Ascii | Canvas |
|---|---|---|
| Glyph node marks whenever an individual node is drawn | ✅ **is this** | ❌ dots — would have to be replaced wholesale |
| Constant mark size across zoom levels | ✅ THE LAW, 6 tests | ❌ dots scale with the dolly |
| Vector edges | ✅ `strokeEdges()` | ✅ |
| Labels as type | ✅ (grid-quantised) | ✅ (free-positioned) |
| Orbit + perspective 3D camera | ✅ verbatim copy | ✅ + dolly |
| Depth banding (nodes and edges) | ✅ | ✅ |
| Zoom changes density/aggregation, not visual language | ✅ **is this** | ❌ dolly = scale |
| Far = territory masses with cluster names | ✅ LOD, on by default | ⚠️ group-level *edges* only, no masses |
| Test harness | ✅ 55 tests | ❌ zero |

**One line:** ASCII already implements every property the target design names, including the two the
brief thought were Canvas's; Canvas holds *features*, not the visual language — and features port more
safely than an identity does.

The corollary is uncomfortable and should be said plainly: **more code moves Canvas→Ascii than the plan
anticipated**, and much of it is code whose comments record measured failures of the exact approach
ASCII still uses (hash colours, centroid-anchored names, all-nodes label ranking). Canvas is not the
legacy renderer — it is the one that has been tuned against a real 2k-note vault more recently.

### 5.2 Sequence

Each step ends green on `bun test app/src/graph/`.

| Step | Work | Risk |
|---|---|---|
| **0** | **Fix the stale comments** in `lod.ts`, `AsciiGraphRenderer.ts:1040/1093`, `CanvasGraphRenderer.ts:44-55`. Delete `LabelLayer.ts` (dead, 468 lines) and `GraphConfig.transparent` (unread). | none — pure clarity |
| **1** | **Write characterization tests for the Canvas-only column (§2.3).** The ASCII harness (recording ctx + manual `frame()`) is renderer-agnostic in shape and drops straight onto Canvas. Cover at minimum: workflow lanes, `clearAroundSelf`, `buildLevelEdges` weights, `buildColorSlots` distinctness, hub-anchored names, `inViewport`, `scaleToSpacing`, the dolly's `zoomT`, the morph. | **This is the step that prevents the silent capability drop.** Do not skip it. |
| **2** | Rehome `GraphConfig`/`HoverNode`/`NodeKind` into `graphRenderer.ts`; drop the vestigial `labelOverlay` param; drop the `CanvasRendererIsGraphRenderer` assertion. | low |
| **3** | Port Canvas's **naming + colour intelligence** onto Ascii: `buildColorSlots` (size-ranked, hue-rotating) replacing the hash; hub anchors replacing centroids in `layoutClusterNames`; `trimDanglingWord`; `inViewport` candidate filtering. These are drop-in improvements with no camera coupling. | low-medium — changes what every cluster looks like; needs a visual check |
| **4** | Port Canvas's **edge intelligence**: `crossLevel`/`buildLevelEdges`/`levelPairs`/`levelHubs`/`computeEdgeLevelWeights` (hub-to-hub backbone) and the colour-tinted intra-cluster mesh. Reconcile with ASCII's grid-traced `drawAggregateEdges` — see §5.4. Adopt Canvas's edge budgets (6000, vs Ascii's 2600). | **medium-high** — this is "mid = backbone edges", and the two designs genuinely disagree |
| **5** | Port `clearAroundSelf`, `BACK_INTERACT_CUTOFF`, `scaleToSpacing` + `p3Cache`/`p2Cache`. | medium — `scaleToSpacing` changes resting spacing, i.e. how the graph *looks* |
| **6** | Port `drawWorkflowLanes` (agents mode). Needs `edge.workflow` on `EdgeView` and a screen-space hull pass over the grid. | medium — no ASCII precedent for a non-cell primitive of this shape |
| **7** | **The camera.** Resolve the zoom model (§6): keep `res` as the single user-facing control; derive a 3D dolly from it. Unify `frameSubset`/`resetView`/`focusNode` onto the result. Decide the 2D↔3D transition: adopt Canvas's 500ms morph or keep ASCII's hard reset. | **highest** — see §5.5 |
| **8** | Migrate `VaultIntro` (needs `setFitMargin`/`setFrameOffsetY` on the unified renderer, plus a look-check: the intro graph has no communities, so no masses and no cluster names) and `EmbeddedGraph` (needs an all-labels mode that actually works — the current `graphLabelHubCount: 9999` is already a no-op). | **high** — first-run surface, zero tests |
| **9** | Delete `CanvasGraphRenderer.ts`, `graphCanvas.css`, `ClusterLegend.tsx`, the `graph.renderer` setting, GraphView's swap effect, and this file. | low *if* steps 1 and 8 were done honestly |

### 5.3 How coupled is ASCII's rendering to the character grid? (the brief's inversion question)

Answered directly, because it decides whether the direction can flip.

**Glyphs do not need the grid.** A glyph is a `fillText` at a screen px; you can draw one at
`nv.sx, nv.sy` with no cells involved. The run-length batching the grid buys (one `fillText` per
colour+alpha run per row) is a real but non-decisive win — Canvas already issues ~2k `arc`+`fill` per
frame at 2k nodes without trouble.

**But the grid is the aggregation mechanism, and that is the whole point.** `this.charBuf[idx] = glyph`
means two nodes projecting onto the same cell collapse into one mark. Zoom out and the field thins
*automatically*; zoom in and cells separate and every node reappears. That is *literally* "zoom changes
density, not visual language" — implemented for free, as a property of the raster rather than as a
policy someone has to write. Three further things fall out of it: the `cellNode`/`nearestCellNode` hit
test, the `labelOccupied` reservation that makes label overlap **impossible rather than unlikely**, and
`quantizePan` (which only exists because a grid can re-phase).

Take Canvas as the base and port glyphs on and you get *glyph-shaped dots*: the mark changes but the
aggregation doesn't, so density has to be re-invented as an explicit thinning policy, and label overlap
goes back to being a rejection test rather than a structural guarantee.

**So the coupling runs the other way from what the brief feared.** The grid isn't a liability the glyphs
are stuck to; it is the mechanism the target design is asking for. **This is the strongest single
argument for ASCII as the base**, and it does not invert.

*(One honest cost: the grid quantises label positions to cell rows, which is why ASCII's cluster names
sit at member centroids rather than on hubs. Step 3 has to place hub-anchored names on the grid, which
means the anchor is a hub's cell rather than a hub's exact pixel. Acceptable.)*

### 5.4 The specific conflict to resolve at step 4

Two incompatible implementations of "the coarse view":

- **Ascii:** *masses.* Aggregate cluster blobs sized by member count, joined by Bresenham connectors on
  the char grid between cluster **centroids**, with the leaf pass fully skipped. `O(clusters)` per frame.
- **Canvas:** *no masses, aggregated edges only.* Real member nodes always draw; only the **edges**
  aggregate, hub-to-hub, weight-bucketed, with the intra-cluster mesh drawn at every zoom so a group
  "has substance".

The spec wants **both**: "far = territory masses with cluster names, mid = individual glyphs with
backbone edges". So this is not a pick-one — it is: ASCII's masses own the *far* band, Canvas's
hub-to-hub backbone owns the *mid* band, and they hand over at a level boundary. Both already key off
the same `clusterLevelAlphas` partition of unity from `labelSelection.ts`, so the crossfade machinery
exists. The work is making the handover a designed three-band ladder instead of two systems that each
assume they own the whole range.

### 5.5 The riskiest step

**Step 9 — the commit that deletes `CanvasGraphRenderer.ts`** — not step 7.

Risk is probability × cost-of-*silent*-failure. The camera unification (step 7) fails loudly: the graph
blanks, or 3D can't approach anything. The intro migration (step 8) fails visibly. What fails **silently**
is the entire §2.3 column: workflow lanes, `clearAroundSelf`, the intra-cluster mesh, size-ranked
colours, hub-anchored names, `inViewport`, `scaleToSpacing`, `BACK_INTERACT_CUTOFF`. Every one is
untested, several are reachable only in modes nobody looks at daily (agents mode especially), and every
one is a plausible "we'll get to it" that quietly never happens. That is exactly the failure this
project has already shipped once at 1/40th the scale.

**Mitigation is step 1 and it is not optional:** write the Canvas characterization tests *before* any
renderer code moves. If a Canvas-only behaviour has no test when step 9 lands, it will be gone and
nobody will notice for months.

Runner-up risks, in order: step 7 (camera), step 8 (intro/embedded — first-run surface, zero coverage),
step 4 (the far/mid handover above).

---

## 6. The central design tension — zoom as resolution vs zoom as dolly

**My read: keep ASCII's resolution model as the *control*, and give 3D a dolly *derived from it*. They
are not mutually exclusive — the current code just never wired them together.**

The two models today:

- **Ascii:** `zc = z2`. The dolly is pinned at zero; `res` (world-units-per-cell) is the only zoom.
  A wheel notch moves 10% along an 11-stop ladder; the field re-rasterizes at a finer world→cell mapping.
  Marks never change size. In 3D this means **orbiting works but approaching does not** — you can spin
  the cloud, but you can't move *into* it. Perspective is computed and then handed a constant camera
  distance, so it produces almost no parallax.
- **Canvas:** `zc = z2 + zoom`. The wheel drives `goalZoom` toward `P * 0.94`; magnification is
  `P / (P - zoom)`, ~17× at the stop. Nodes get bigger, the cloud opens, near/far separate. `zoomT()`
  then *log-normalises that dolly back into the 0..1 progress `labelSelection`'s curves expect* — i.e.
  Canvas already contains an adapter between the two models, in one function, `:819-825`.

The spec is unambiguous that zoom must change *density and aggregation, never visual language*, which
rules out Canvas's model **as the semantic**. But the user's "magnificent" is not about dots getting
bigger — it is about **perspective approach**: parallax, the cloud opening around you, near and far
separating. And that is a property of the *camera*, not of the marks.

So the merged renderer should:

1. Keep `res`/`zoomPct` as the single durable zoom state and the single user-facing control (10% steps,
   0–100 readout, cursor-anchored in 2D). Everything semantic — LOD level, label ladder, node colour
   level, edge-level weights — keys off `resolutionT(res, maxRes)`, exactly as it does now.
2. In 3D, **derive** the camera dolly from that same state: `zoom = f(res)`, monotonic, so one wheel
   notch simultaneously raises resolution *and* moves the camera in. Canvas's `zoomT()` is the same
   mapping run backwards and can be inverted rather than invented.
3. Keep the glyph a constant cell size regardless (THE LAW holds — a dolly moves *positions*, not mark
   size). The 6 `THE LAW` tests stay green because they assert `ctx.font` and `letterSpacing`
   invariance, not position invariance.
4. In 2D, `f(res) = 0` — a flat view has nothing to dolly toward, exactly as today.

Net: zoom stays *resolution* semantically (one number, aggregation-driving, spec-compliant) and becomes
*dolly* optically in 3D (parallax, approach, the magnificent part). One control, two effects, no second
zoom axis to keep in sync.

**Failure mode to watch (this is why step 7 is high-risk):** `projValid` gates on
`persp > 0.05 && zc < P * 0.985`, and Canvas's `onWheel` clamps `goalZoom` to `P * 0.94` precisely to
stay off that singularity. A naive `f(res)` that lets the dolly approach `P` pushes near nodes through
the near plane and they vanish. `f` must be clamped against `MAX_ZOOM_FRAC` on the way in, and
`frameSubset` (which today sets `goalRes` directly) must go through the same clamp.

**Open question for the controller, not for me:** whether 2D keeps a dolly of exactly zero forever, or
whether the eventual "brains as places" camera-slide work (Part 2c) wants 2D to acquire one too. Worth
deciding before step 7 rather than after.

---

## 7. Bloom field resolution (`densityField.ts`)

`FIELD_W = 64`, `FIELD_H = 40` → a 2560-cell `Float32Array`. `buildBloom` =
`normalise(blur(accumulate(pts, 64, 40), 64, 40, radius = 6))`; peak cell always normalises to exactly 1.

`GraphAtmosphere.tsx` writes it into a canvas sized **exactly 64×40** and `putImageData`s at native size.
**The upscale is pure CSS** — `.graph-bloom { width: 100%; height: 100%; image-rendering: auto }`
(`graphAtmosphere.css:9-20`), i.e. the browser's bilinear filter. There is no JS `drawImage` upscale
anywhere. Alpha is `255 * min(1, v⁴)` and RGB is a constant theme-derived triple.

At the intro's ~3200×2000 device px that is a **~50× upscale of a 64-wide source**. Bilinear
interpolation across 50px spans is piecewise-linear, so the C¹ discontinuities at cell boundaries become
visible Mach bands — the rectangular blocking. It is not a bug in the field; it is bilinear doing
exactly what bilinear does at that ratio.

**Recommendation for the merge: raise the field resolution, don't blur in screen space.**

- Cost is trivially bounded and known: `accumulate` is `O(points)` regardless of grid size, `blur` is
  separable (`O(w·h)`), `normalise` is `O(w·h)`. Going 64×40 → 192×120 is 2560 → 23040 cells, still a
  rounding error against a 2k-node projection pass, and `GraphAtmosphere`'s per-cell `ImageData` loop
  scales the same way. Keep the blur radius proportional (6 → 18) so the falloff's *world* size is
  unchanged; otherwise the bloom visibly tightens.
- Screen-space blurring is the worse option here: it means either a CSS `filter: blur()` on a
  `mix-blend-mode: screen` layer (expensive, and compositing-order fragile) or a second offscreen canvas
  pass per frame. The field is already a blur — running a second one to hide the first one's sampling
  artefacts is treating the symptom.
- 16 tests in `densityField.test.ts` pass `w`/`h` explicitly (`blur` throws if `field.length !== w*h`),
  so the constants are not baked into the test fixtures. This is a low-risk change.
- Watch: `bloom opacity 0.85 → 0.45` was tuned very recently (`95b57e7`, 2026-07-30) against the
  *current* blocky field. A smoother field reads slightly brighter at the same opacity — re-check the
  opacity after raising the resolution, and re-run the ink/luminance probe whose numbers are recorded in
  `GraphAtmosphere.tsx:106-114`.

Also unify while in here: the two renderers weight bloom points differently — Ascii uses
`depthAlpha(nv.dr)`, Canvas uses `max(0.2, nv.pscale)`. Under one renderer that choice has to be made
once. `depthAlpha` is the right one: it is the same curve the marks themselves fade by, so the
atmosphere stays *emitted by* the field rather than being a second, independently-tuned depth cue.

---

## 8. Task 3 confirmations (writing `CanvasGraphRenderer.test.ts`)

Re-verified while writing the characterization suite — restated here because Task 3's own brief
(`task-3-brief.md`) repeated some of the plan's original, already-superseded claims:

- **`LabelLayer.ts` is dead code**, not Canvas-only as the plan originally assumed (§0/§2.2 above
  already correct this — restated for anyone reading only this task's diff). It is imported by
  nobody; delete it in the merge rather than porting it to either renderer.
- **`VaultIntro.tsx` and `EmbeddedGraph.tsx` depend on `CanvasGraphRenderer` by concrete class**,
  through off-seam methods (`setFitMargin`, `setFrameOffsetY`, `applyGraphConfig(renderer:
  CanvasGraphRenderer, …)`) that aren't part of the `GraphRenderer` interface — and **neither has a
  single test**. This task did not add coverage for them (out of scope: they're first-run/embedded
  surfaces, not the Canvas-only renderer behaviours this task was scoped to), so they remain exactly
  as risky for the merge's step 8 as §3/§5.5 already describe.
- **`syncSize()` is ASCII-only.** Canvas has no equivalent per-frame host-box reconciliation in
  `tick()` — it relies solely on `ResizeObserver` + `measure()` at mount/build. Confirmed directly:
  porting AsciiGraphRenderer.test.ts's "picks the host box up from the render loop when no
  ResizeObserver notification arrives" test onto `CanvasGraphRenderer` as-is would fail (Canvas stays
  blank at the degenerate 0×0 box forever, since nothing re-measures without an RO callback). Not
  added to `CanvasGraphRenderer.test.ts` — it characterizes an ASCII behaviour Canvas doesn't have,
  not a Canvas-only behaviour, and this task's brief scoped it to the latter.
- **The ASCII test file has 55 tests, not the 63 this task's own brief claimed** (`task-3-brief.md`
  reproduced the plan's stale count verbatim). §0/§4 above already have the corrected number;
  `CanvasGraphRenderer.test.ts` adds 7 more, bringing `app/src/graph/` to 252 passing tests total
  across 12 files (`bun test app/src/graph/`).
