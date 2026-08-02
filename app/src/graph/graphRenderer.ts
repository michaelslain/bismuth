// app/src/graph/graphRenderer.ts
//
// The renderer seam every consumer talks to, and the owner of the types that flow across it.
//
// THREE consumers: GraphView (the knowledge-graph pane), intro/VaultIntro (the first-run cloud) and
// EmbeddedGraph (a ` ```graph ` note block). All three hold their renderer as a `GraphRenderer`,
// never as a concrete class. There is exactly ONE implementation — `AsciiGraphRenderer`, the
// character-grid field the app ships. The seam survives the second implementation's deletion on
// purpose: it is what kept the intro and the graph block honest while the merge was in flight, and
// it is what a future renderer would be written against.
//
// ---------------------------------------------------------------------------------------------
// EPITAPH — what `CanvasGraphRenderer.ts` was, and what did NOT come across when it was deleted.
//
// Until 2026-07-31 this file was a seam over TWO renderers, chosen by a `graph.renderer` setting:
// the ASCII field, and a dot-and-line Canvas2D renderer (`CanvasGraphRenderer.ts`, 1885 lines,
// zero tests). Part 2b merged them; the ASCII field is the survivor because it already implemented
// every property the target design names (glyph marks, constant mark size across zoom, zoom as
// DENSITY rather than scale) while the Canvas renderer held features, not a visual language.
//
// Those modules cite the deleted file by line number (`CanvasGraphRenderer.ts:762-794` and the
// like). Those citations are still resolvable — the file's last revision is
//
//     git show 817bad5:app/src/graph/CanvasGraphRenderer.ts
//
// (817bad5 is the commit immediately before the deletion). Every line number in the tree refers to
// that revision.
//
// The Canvas renderer's *intelligence* was ported out first, into pure modules that carry their own
// provenance comments — read those, not this list, for the reasoning:
//
//   respace.ts       node-count-independent resting spacing (`scaleToSpacing` + the p3/p2 memo)
//   clusterVisual.ts size-ranked cluster colours, hub-anchored cluster names, `inViewport`
//   backbone.ts      the hub-to-hub group-level edge backbone + the three-band zoom handover
//   cameraModel.ts   the 3D dolly, derived from the resolution ladder rather than tracked separately
//
// FOUR things did NOT come across, at the time this list was first written. They are recorded here
// rather than in a working document because a deleted file's capabilities are exactly what a
// codebase forgets:
//
//  1. ~~THE ANIMATED 2D<->3D MORPH~~ — RESTORED, Task 22. Canvas's version (`morph` 0..1,
//     `easeInOutCubic`, `MODE_MORPH_MS` 500, a per-node p3->p2 lerp with an orbit unwind) is now
//     `modeMorph.ts`, wired into `AsciiGraphRenderer.setConfig`/`tick`/`projectNodes`. A `viewMode`
//     flip eases across MODE_MORPH_MS instead of cutting — the finished transition still lands
//     exactly where the old hard reset did (same rx/ry/pan/res/target, see setConfig), so the end
//     state this list originally described is unchanged; only the path to it is no longer a single
//     frame. One deliberate, documented divergence from the source: `modeMorph.ts`'s orbit unwind is
//     a closed-form lerp, not Canvas's per-frame `rx *= 1 - e` recurrence — that recurrence is not a
//     pure function of elapsed time (it depends on the actual sequence of frame timestamps a session
//     rendered at), so a "no timers" pure model implements the curve it approximates instead of a
//     shape it cannot literally replicate. See modeMorph.ts's header and `unwindOrbit`'s doc comment.
//
//  2. DEPTH-ORDERED CELL ARBITRATION IN 3D. Canvas drew nodes far->near into a `drawOrder` array, so
//     a near node always painted over a far one and `BACK_INTERACT_CUTOFF` (0.18) additionally
//     excluded back-layer nodes from hover/click. This renderer's node pass writes
//     `cellNode[idx] = i` in ARRAY order with no depth comparison, and the hit test resolves through
//     that same buffer — so when two 3D nodes contest one cell, the later-indexed one wins the glyph
//     AND the click regardless of which is nearer the camera. Depth is cued by glyph weight and
//     `depthAlpha`, not by occlusion. Cell aggregation is the grid's whole point (two nodes on one
//     cell collapsing to one mark is the mechanism behind "zoom changes density, not visual
//     language"), so ordering the collapse by depth is a refinement, not a restoration.
//
//  3. FILLED DOTS SIZED BY DEGREE, and the hover RING on the hovered node and its neighbours.
//     The dots are out of scope by design — the spec replaces them with the glyph degree ramp. The
//     rings are not: this renderer signals hover by DIMMING everything else (`DIM_ALPHA`,
//     `EDGE_DIM_ALPHA`) and accenting the hovered glyph, which is a weaker affordance on a dense
//     field than a positive mark would be.
//
//  4. LABEL PILLS (a rounded translucent background box behind a name) — STALE as written below;
//     corrected by Task 22 to describe the CURRENT mechanism, not the one this list originally
//     recorded. It first read "replaced by a ground-coloured `fillRect` under each label's cells" —
//     true when this list was written, but Task 21 replaced that opaque `fillRect` (which erased
//     every edge running behind a label) with a per-glyph `strokeText` halo (`LABEL_HALO_EM`,
//     `AsciiGraphRenderer.ts`'s paint()) PLUS glyph suppression at the source
//     (`reserveLabelCells` blanks a label's cells before the field-glyph pass ever draws into them,
//     rather than drawing them and covering them). Same job as the pill either way (a name is never
//     read through the field behind it), but the field around a name is no longer plated over —
//     only each letter's own outline gets a cleared ring.
//
// Two more of the deleted renderer's features were DEAD before the merge began and were deleted, not
// dropped: `clearAroundSelf` (a screen-space clear zone around the "you" hub) and `drawWorkflowLanes`.
// Commit `a6687c0` removed the agents graph mode, taking with it `agentLayout.ts` — the only injector
// of the `self` node — and `buildAgentGraph`, the only producer of `edge.workflow`. On any graph the
// app can now build, the first's guard never fires and the second iterates an empty set.
// ---------------------------------------------------------------------------------------------

import type { GraphData, NodeKind } from "../../../core/src/graph";
import type { DensityField } from "./densityField";

/** Live graph settings pushed by GraphView (mirrors settings.graph + appearance tokens). */
export interface GraphConfig {
  spin: boolean;
  spinSpeed: number;
  palette: number[];
  repulsion: number;
  linkDistance: number;
  centering: number;
  nodeSize: number;
  viewMode: "2d" | "3d";
  showGraphLabels: boolean;
  graphLabelHubCount: number;
  nodeSizeMinMult: number;
  nodeSizeDegreeGain: number;
  nodeSizeMaxMult: number;
  edgeColor: number;
  edgeOpacity: number;
  backgroundColor: number;
  labelTextColor: string;
  labelBgColor: string;
  selfColor: number;
  daemonAccent?: number;
  daemonNeutral?: number;
  daemonFg?: number;
  /** Don't paint the field's own opaque ground — let whatever is behind the canvas show through.
   *  Set by the first-run Vault Intro, which cross-fades two full-bleed graph layers over the page's
   *  own `--bg`; an opaque ground there fades the whole page background between `--bg` and
   *  `--graph-bg` on every slide change. See AsciiGraphRenderer's `applyGround()`. */
  transparent?: boolean;
  /** graph.backgroundNoise (settingsSchema.ts) — the faint ASCII noise texture under the field.
   *  Off by default. */
  backgroundNoise?: boolean;
  /**
   * Opt IN to LOD cluster summarization: at coarse zoom stops each community of the active
   * hierarchy level draws as ONE aggregate ASCII mass sized by member count, joined by aggregate
   * edges that summarize every real link between two communities' member sets; stepping the ladder
   * in replaces a parent mass with its children, and only the deepest stops rasterize individual
   * notes and their real edges (lod.ts, backbone.ts `bandsForT`).
   *
   * Not a settings-backed field — no settingsSchema entry. GraphView sets it directly whenever the
   * mode is not "local", which makes it the app's shipped default view. With it off, every node
   * draws as a glyph at every stop and the hierarchy reads through zoom-driven node COLOUR plus the
   * cluster-name ladder instead.
   *
   * "local" mode must keep it OFF: a local neighbourhood carries no community hierarchy by design
   * (displayGraph.ts's `localSubgraph` strips it), and the LOD path suppresses the individual-note
   * raster at coarse zoom on the assumption that masses are covering the field. With no communities
   * there are no masses either, so both passes stay off and the field renders empty.
   */
  showLodMasses?: boolean;
  /**
   * Label EVERY node, at every zoom, ignoring the resolution-driven file-label ladder
   * (`labelSelection.ts` `fileLabelAlpha`/`fileLabelBudget`, which are both **zero at fit** —
   * a graph opened at 100% shows no file names at all without this).
   *
   * For a hand-authored ` ```graph ` diagram (EmbeddedGraph.tsx) the labels ARE the content: a
   * five-box flowchart whose boxes are unnamed until you zoom to 25% is not a diagram. That is a
   * different contract from the knowledge graph's, where hub-only curation is the whole point, so
   * it is opt-in per mount rather than a number to crank.
   *
   * Replaces the old `graphLabelHubCount: 9999` sentinel, which never worked: that number only
   * feeds `computeAlwaysOnSet`'s ranking (a tie-break for a budget that is still 0 at fit), and
   * the deleted Canvas renderer ignored the field outright.
   *
   * "Every node" is literal, and the cost is stated rather than hidden: placement still prefers a
   * free span (right of the node, then left), but a label with nowhere free DRAWS ANYWAY instead of
   * being dropped. Each label clears its own ground rect first, so the overlap reads as the later
   * name winning its cells, not as a smear — and an unnamed box in a hand-drawn diagram is worse
   * than a clipped one. The knowledge graph keeps the opposite trade-off; that is why this is a
   * per-mount flag and not a new default.
   */
  labelEveryNode?: boolean;
}

/** The node currently under the cursor, surfaced to GraphView for the hover readout. "cluster" is
 *  the LOD aggregate entity (a community mass, not a real graph node). */
export interface HoverNode {
  id: string;
  label: string;
  kind: NodeKind | "cluster";
  folder?: string;
}

export type Vec3 = [number, number, number];

export interface CommunityCentroid {
  label: string;
  ids: string[];
  color: string;
  centroid: Vec3;
  count: number;
}

export interface NodeForUI {
  id: string;
  label: string;
  folder?: string;
  community?: number;
  communityLabel?: string;
}

export interface GraphRenderer {
  mount(el: HTMLElement, onNodeClick: (id: string) => void, onHover?: (n: HoverNode | null) => void): void;
  destroy(): void;
  render(g: GraphData): void;
  setConfig(cfg: GraphConfig): void;
  setVisible(visible: boolean): void;
  setActiveFile(id: string | null): void;
  setSearchMatches(ids: Set<string>): void;
  highlightNodes(ids: string[]): void;
  clearHighlight(): void;
  focusNode(id: string): void;
  frameSubset(ids: string[]): void;
  resetView(): void;
  getNodesForUI(): NodeForUI[];
  getCommunityCentroids(): Map<number, CommunityCentroid>;
  /** Extra fit zoom-OUT: the 100% ("fit the whole graph") scale is divided by this, so 1 is the
   *  normal fit and 1.55 leaves the cloud filling ~2/3 of the box. The first-run Vault Intro's only
   *  framing knob besides `setFrameOffsetY` — see VaultIntro.tsx's IntroGraph. */
  setFitMargin(m: number): void;
  /** Shift the GRAPH (not the canvas) vertically by a fraction of the host's height — positive is
   *  down. Lets a full-bleed canvas keep its seamless edges while the cloud sits off-centre. */
  setFrameOffsetY(frac: number): void;
  setFpsCallback(cb: (fps: number) => void): void;
  setPaintCallback(cb: (nodeCount: number) => void): void;
  /** Fired when an empty-space click drops a persistent highlight. */
  onHighlightCleared?: () => void;
  /** The 0-100 resolution readout ("zoom is resolution"). */
  setZoomCallback?(cb: (pct: number) => void): void;
  /** Per-frame node-density field for the phosphor bloom (see densityField.ts). Optional: a
   *  renderer that omits it simply gets no bloom. Values are 0..1 over a FIELD_W×FIELD_H grid.
   *  Pass `undefined` to detach — `destroy()` does this itself, so a torn-down instance never holds
   *  a callback into a consumer that may no longer exist. */
  setBloomCallback?(cb: ((field: DensityField) => void) | undefined): void;
}
