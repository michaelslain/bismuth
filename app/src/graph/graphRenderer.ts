// app/src/graph/graphRenderer.ts
//
// The renderer seam GraphView talks to. Two implementations satisfy it:
//   • AsciiGraphRenderer — the character-grid renderer the app ships (ASCII redesign).
//   • CanvasGraphRenderer — the previous dot-and-line Canvas2D renderer, kept in-tree
//     (still used by the first-run Vault Intro and the embedded graph card).
// Declaring the surface here means GraphView depends on the seam, not on either class, and the
// type assertion at the bottom fails the build the moment one of them drifts out of the contract.
//
// Types shared with the old renderer (GraphConfig, HoverNode) are re-exported from it by a TYPE-only
// import — erased at compile time, so nothing here pulls graphCanvas.css into the bundle.
import type { GraphData } from "../../../core/src/graph";
import type { CanvasGraphRenderer, GraphConfig, HoverNode } from "./CanvasGraphRenderer";
import type { DensityField } from "./densityField";

export type { GraphConfig, HoverNode };

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
