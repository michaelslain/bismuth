// app/src/graph/graphRenderer.ts
//
// The renderer seam every consumer talks to. THREE of them now — GraphView (the knowledge-graph
// pane), intro/VaultIntro (the first-run cloud) and EmbeddedGraph (a ` ```graph ` note block) —
// and all three hold their renderer as a `GraphRenderer`, never as a concrete class. That is what
// makes the surviving implementation swappable, and it is what unblocked deleting the other one.
//
// Two implementations satisfy it today:
//   • AsciiGraphRenderer — the character-grid renderer the app ships (ASCII redesign). The one
//     every consumer above constructs.
//   • CanvasGraphRenderer — the previous dot-and-line Canvas2D renderer. Its last construction
//     site is GraphView's `settings.graph.renderer === "standard"` branch; the intro and the graph
//     block no longer name it. Deleted in Task 14 along with that branch, the type assertion at the
//     bottom, and the GraphConfig/HoverNode ownership below.
// The type assertion at the bottom fails the build the moment either drifts out of the contract.
//
// Types shared with the old renderer (GraphConfig, HoverNode) are re-exported from it by a TYPE-only
// import — erased at compile time, so nothing here pulls graphCanvas.css into the bundle.
import type { GraphData } from "../../../core/src/graph";
import type { CanvasGraphRenderer, GraphConfig as LegacyGraphConfig, HoverNode } from "./CanvasGraphRenderer";
import type { DensityField } from "./densityField";

export type { HoverNode };

/**
 * The config every consumer passes through `setConfig`. Still structurally the legacy renderer's
 * interface (Task 14 rehomes the whole shape here when `CanvasGraphRenderer.ts` is deleted), plus
 * the fields only the surviving ASCII renderer understands. Declared as an intersection HERE rather
 * than added to the legacy interface so the doomed file stays untouched and the extra fields land
 * in the file that will own the type outright.
 */
export type GraphConfig = LegacyGraphConfig & {
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
   * the legacy renderer ignored the field outright.
   *
   * "Every node" is literal, and the cost is stated rather than hidden: placement still prefers a
   * free span (right of the node, then left), but a label with nowhere free DRAWS ANYWAY instead of
   * being dropped. Each label clears its own ground rect first, so the overlap reads as the later
   * name winning its cells, not as a smear — and an unnamed box in a hand-drawn diagram is worse
   * than a clipped one. The knowledge graph keeps the opposite trade-off; that is why this is a
   * per-mount flag and not a new default.
   */
  labelEveryNode?: boolean;
};

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
  mount(el: HTMLElement, onNodeClick: (id: string) => void, onHover?: (n: HoverNode | null) => void, labelOverlay?: HTMLElement): void;
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
  /** Fired when an empty-space click drops a persistent highlight (the legend's selected row). */
  onHighlightCleared?: () => void;
  /** ASCII renderer only: the 0–100 resolution readout ("zoom is resolution"). */
  setZoomCallback?(cb: (pct: number) => void): void;
  /** Per-frame node-density field for the phosphor bloom (see densityField.ts). Optional: a
   *  renderer that omits it simply gets no bloom. Values are 0..1 over a FIELD_W×FIELD_H grid.
   *  Pass `undefined` to detach — `destroy()` on both renderers does this itself, so a torn-down
   *  instance never holds a callback into a consumer that may no longer exist. */
  setBloomCallback?(cb: ((field: DensityField) => void) | undefined): void;
}

// Compile-time proof the legacy renderer still satisfies the seam. It is unused by GraphView but
// must keep compiling (the Vault Intro and the embedded graph card mount it).
type SatisfiesRenderer<T extends GraphRenderer> = T;
export type CanvasRendererIsGraphRenderer = SatisfiesRenderer<CanvasGraphRenderer>;
