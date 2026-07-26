// app/src/graph/AsciiGraphRenderer.ts
//
// The knowledge graph as a CHARACTER FIELD. Same job as the old CanvasGraphRenderer (project a
// graph, orbit it, hover/click it) but the output is a fixed grid of monospace characters:
// "- | / \ +" for edges, the degree ramp "." leaf → "o" linked → "@" hub for nodes, a sparse
// deterministic noise texture underneath, and plain text labels on the grid. It still draws onto a
// Canvas2D context — one fillText per colour RUN per row — so it keeps canvas performance while
// looking like a terminal. Nothing is ever CSS/ctx-scaled.
//
// THE LAW (design/ascii/design-system/guidelines/ascii-zoom.card.html, PORTING.md §4):
//   ZOOM IS RESOLUTION. The cell is a constant size at every zoom level. What zooming changes is
//   the world-units-per-cell ratio — 100% fits the whole graph on the grid (graph-size RELATIVE:
//   the fit scale is derived from the graph's own bounding radius), 0% is a FIXED absolute
//   resolution where every note is individually distinguishable, identical world-per-cell
//   regardless of graph size (see asciiGrid.ts DEEPEST_WORLD_PER_CELL/maxResFor). No transform:
//   scale, no ctx.scale on glyphs; zoom moves in 10% steps (wheel notches / +- keys) that the field
//   glides toward, re-rasterizing at a finer world→cell mapping each frame of the glide.
//
// The 3D mode is the same grid: the camera math is lifted verbatim from CanvasGraphRenderer's
// project()/projectPositions() (worldScale/target subtract → yaw → pitch → perspective divide),
// and the projected points are snapped onto cells and re-rasterized every frame. Depth is encoded
// by shifting the DEGREE RAMP between bands and fading alpha — never by changing the font size.
//
// The pure arithmetic (grid sizing, world→cell snapping, the glyph ramp, the Bresenham trace with
// "+" junctions, the cell hit test) lives in ./asciiGrid.ts and is unit-tested there.

import "./asciiGraph.css";
import type { GraphData, GraphNode } from "../../../core/src/graph";
import { nodeVisualState } from "../../../core/src/daemonViz";
import {
  clusterLabelAlpha, clusterLabelText, clusterLevelAlphas, computeAlwaysOnSet, eyebrowWidthCells,
  fileLabelAlpha, fileLabelBudget,
} from "./labelSelection";
import { hashKey } from "../themeColors";
import { isUsableBox, finiteVec3, boundingRadius, boundingHalfExtents, fitScaleForBox } from "./graphFit";
import { structuralGraphSig, shouldResetView } from "./graphStability";
import { noiseField, DEFAULT_NOISE_SEED } from "../ui/ascii/noiseField";
import {
  AGG_EDGE_ALPHA_MIN, AGG_EDGE_DOUBLE_W, LOD_ALPHA_EPS, buildLodIndex, lodMix, massCellAlpha,
  massCellCode, massRadii, type LodLevel,
} from "./lod";
import type { CommunityCentroid, GraphConfig, GraphRenderer, HoverNode, NodeForUI, Vec3 } from "./graphRenderer";

/** Numeric per-frame snapshot for QA (`window.__asciiGraphStats`, DEV builds only) — lets the
 *  redesign's fit/LOD/label criteria be asserted against directly instead of eyeballed off a
 *  screenshot. See `AsciiGraphRenderer.computeStats()`. */
export interface AsciiGraphStats {
  zoomPct: number;         // 100 = fit .. 0 = deepest (resolutionPercent)
  entitiesDrawn: number;   // aggregate cluster masses actually rasterized this frame
  labelsDrawn: number;     // this.labels.length (file + cluster names combined)
  labelOverlaps: number;   // count of label PAIRS on the same row whose [col, col+widthCells] spans intersect
  maxLabelChars: number;   // longest label's text.length this frame
  notesOnScreen: number;   // leaf (real) nodes rasterized this frame
  edgesDrawn: number;      // real + aggregate edges traced this frame
  inkCoverage: number;     // bounding-box area of non-empty cells / (cols*rows)
}
import {
  CELL_H, CELL_W, FONT_PX,
  LAYER_EDGE, LAYER_NODE, LAYER_NOISE, PAD_X, PAD_Y, ZOOM_STEP_PCT,
  depthAlpha, fitPxPerWorld, gridMetrics, maxResFor, mergeEdgeCode, nearestCellNode, nodeGlyph,
  pxToCell, resFromPercent, resolutionPercent, resolutionT, snapZoomPercent, traceEdge,
  type GridMetrics,
} from "./asciiGrid";

const FOV_DEG = 60;              // same camera as the old renderer, so framing carries over
const ORBIT_SPEED = 0.005;       // rad per px of drag (copied)
const DRAG_THRESHOLD = 5;        // px before a press becomes an orbit/pan rather than a click
const GLIDE = 0.18;              // per-frame easing toward the camera goal
const FALLBACK_MAX_RES = 16;     // pre-fit() bootstrap value for `maxRes` (real one is graph/box-derived — see fit())
const WHEEL_NOTCH_PX = 120;      // one physical mouse-wheel click (the Windows WHEEL_DELTA convention most
                                  // browsers report a notch as); each notch moves ZOOM_STEP_PCT, trackpad
                                  // deltas simply accumulate toward the next notch instead of firing every event
const RES_EPS = 0.002;           // below this the resolution glide is considered settled
const NOISE_DENSITY = 0.08;      // texture, never the signal (the design card defaults GLYPHS to 0%)
const NOISE_ALPHA = 0.45;        // tokens/ascii.css --field-noise-op
const DEPTH_BANDS = 3;           // "." far / "o" mid / "@" near — the ramp shift, not a font change
const DIM_ALPHA = 0.28;          // non-focus dimming on hover / cluster highlight
const EDGE_ALPHA_2D = 0.7;
const EDGE_BUDGET = 2600;        // dense-graph edge thinning (stable per-edge rank, like the old renderer)
const EDGE_FLOOR = 0.12;
const HIT_RADIUS_CELLS = 2;      // cells searched outward from the cursor for a node
const CLUSTER_LABEL_TRACKING_EM = 0.14; // tokens/typography.css --ls-eyebrow, applied via ctx.letterSpacing

// Colour slots. Every colour is a CSS custom property read off the host, so a theme switch is a
// re-read (the old renderer took ints through setConfig; here the tokens ARE the source).
const C_G0 = 0, C_G1 = 1, C_G2 = 2, C_G3 = 3, C_G4 = 4;
const C_FG = 5, C_MUTED = 6, C_FAINT = 7, C_ACCENT = 8;
const COLOR_VARS = ["--graph-0", "--graph-1", "--graph-2", "--graph-3", "--graph-4", "--fg", "--text-muted", "--faint", "--accent"];
const COLOR_FALLBACK = ["#f0509b", "#9b53e8", "#3f6bf0", "#27c7d9", "#43d49a", "#e8e8ee", "#9aa0b4", "#6b7086", "#3f6bf0"];
const RAMP = [C_G0, C_G1, C_G2, C_G3, C_G4];

const DEFAULT_CONFIG: Partial<GraphConfig> = {
  viewMode: "3d", showGraphLabels: true, graphLabelHubCount: 10, spin: true, spinSpeed: 0.0015,
  backgroundNoise: false,
};

interface NodeView {
  node: GraphNode;
  p3: Vec3;
  p2: Vec3;
  deg: number;
  color: number;   // index into this.colors
  dim: boolean;    // daemon-disabled → drawn faint
  // per-frame scratch
  sx: number; sy: number; depth: number; dr: number;
  col: number; row: number; onGrid: boolean;
}
interface EdgeView { a: NodeView; b: NodeView; kr: number }
/** One LOD aggregate entity on the field — a hierarchy-level community rendered as a single ASCII
 *  mass. Built once per graph build (structure) with per-frame screen scratch, mirroring NodeView. */
interface EntityView {
  flat: number;          // index into entityFlat (what cellEntity stores)
  level: number;
  community: number;
  count: number;
  wx: number; wy: number; // members' 2D world centroid (same space as NodeView.p2)
  color: number;          // ramp slot — the SAME key layoutClusterNames uses, so mass == name colour
  name: string;
  rowR: number; colR: number; // uncapped mass radii in cells (sqrt scaling — lod.ts massRadii)
  memberIds: string[];
  // per-frame scratch
  sx: number; sy: number; col: number; row: number; onGrid: boolean;
  drawnRowR: number; drawnColR: number; // grid-capped radii for this frame
}
interface LabelDraw {
  text: string; col: number; row: number; color: number; accent: boolean;
  alpha: number;      // crossfade multiplier — forced file labels and cluster names ignore this differently (see paint())
  eyebrow?: boolean;  // cluster name: uppercase + tracked, drawn at full brightness × alpha
  // Real drawn width in cells (eyebrowWidthCells for a tracked cluster name, plain text.length for a
  // file label) — the SAME span the occupancy reservation used, so debug/QA instrumentation
  // (window.__asciiGraphStats) can check for overlaps without recomputing tracking math.
  widthCells: number;
}

/** A node's hierarchy path, coarsest → finest — `communityPath` when the backend sent one, else the
 *  single-element fallback `[community]` so a node/graph with no hierarchy data (legacy, or simply
 *  never rebuilt against the new detector) reads as exactly a 1-level graph, unchanged from before
 *  communityPath existed. `undefined` when the node carries no community at all. */
function nodePath(n: GraphNode): number[] | undefined {
  if (n.communityPath && n.communityPath.length) return n.communityPath;
  return n.community != null ? [n.community] : undefined;
}

/** The exemplar name per level, mirroring `nodePath`'s fallback. */
function nodePathLabels(n: GraphNode): string[] | undefined {
  if (n.communityPathLabels && n.communityPathLabels.length) return n.communityPathLabels;
  return n.community != null ? [n.communityLabel ?? `cluster ${n.community}`] : undefined;
}

/** Wikilink/tag flavouring so a label reads like the vault does (design's `[[note name]]`). */
function labelText(n: GraphNode): string {
  // vault.ts already builds a tag node's label WITH its "#" (`label: \`#${tag}\``), so prefixing
  // unconditionally printed "##research" on the field.
  if (n.kind === "tag") return n.label.startsWith("#") ? n.label : "#" + n.label;
  if (n.kind === "note" || n.kind === "memory") return "[[" + n.label + "]]";
  return n.label;
}

export class AsciiGraphRenderer implements GraphRenderer {
  private host?: HTMLElement;
  private viewport!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private ro?: ResizeObserver;
  private dpr = 1;

  private cfg: GraphConfig = { ...DEFAULT_CONFIG } as GraphConfig;

  // graph data
  private nodes: NodeView[] = [];
  private byId = new Map<string, NodeView>();
  private edges: EdgeView[] = [];
  private adjacency = new Map<string, Set<string>>();
  private sig = "";
  private radius3 = 1; private radius2 = 1;
  // 2D-only bounding-BOX half-extents (see graphFit.ts boundingHalfExtents/fitScaleForBox) — the
  // fit-to-100% law for a rectangular field fills each AXIS to FIT_FILL_FRACTION independently,
  // rather than reading a single circumscribing radius (which over-reads a wide/short cloud and
  // only considers the field's shorter axis). 3D keeps radius2/radius3-style fitting (see fit()).
  private half2 = { hx: 1, hy: 1 };

  // grid + buffers (reused across frames — nothing is allocated in the hot loop)
  private m: GridMetrics = gridMetrics(1, 1, CELL_W, CELL_H);
  private W = 1; private H = 1;
  private charBuf = new Uint16Array(1);
  private layerBuf = new Uint8Array(1);
  private colorBuf = new Uint8Array(1);
  private alphaBuf = new Uint8Array(1);
  private cellNode = new Int32Array(1);
  private noiseBuf = new Uint16Array(1);
  private labelOccupied = new Uint8Array(1);
  private labels: LabelDraw[] = [];
  private labelScratch: NodeView[] = [];
  private clusterAgg = new Map<number, { colSum: number; rowSum: number; n: number }>();
  // Per-level community → its display name, resolved once per build() (communityPathLabels is
  // static graph data, not a per-frame thing) so layoutClusterNames() never has to search for a
  // representative member. Index = hierarchy level (0 = coarsest); length = levelCount.
  private communityNamesByLevel: Map<number, string>[] = [];
  // Deepest hierarchy depth any node carries (1..4 typically; see core/src/graph.ts communityPath).
  // 0 means no node carries a community at all (no cluster names to draw).
  private levelCount = 0;
  private boxReady = false;

  // LOD (2D only — see lod.ts): the per-level aggregate structure, built once per build().
  private lodLevels: LodLevel[] = [];
  private entityLevels: EntityView[][] = [];
  private entityFlat: EntityView[] = [];
  private cellEntity = new Int32Array(1);  // cell → entityFlat index (-1 none), rebuilt per raster
  // Per-frame LOD state (written at the top of rasterize, read by the label + hit-test paths).
  private lodOn = false;
  private leafAlpha = 1;
  private hoverEntityIdx = -1;

  // Per-frame QA/debug counters (see computeStats/window.__asciiGraphStats) — reset + incremented in
  // rasterize()'s existing passes, never a separate loop.
  private entitiesDrawnFrame = 0;
  private notesOnScreenFrame = 0;
  private edgesDrawnFrame = 0;

  // camera — rx/ry orbit (3D), res = THE zoom (resolution), pan in px (2D)
  private rx = -0.5; private ry = 0;
  private res = 1; private goalRes = 1;
  private target: Vec3 = [0, 0, 0]; private goalTarget: Vec3 = [0, 0, 0];
  private panX = 0; private panY = 0;
  private pxPerWorld = 1; private P = 1;
  // The zoom LADDER, recomputed every fit() from the graph's own bounding radius (see
  // asciiGrid.ts maxResFor) — a bigger graph needs a bigger multiplier to reach the same fixed
  // absolute (0%) detail. `zoomPct` is the durable HUD-facing state (100=fit .. 0=deepest, snapped
  // to ZOOM_STEP_PCT); `goalRes`/`res` are always DERIVED from it via resFromPercent so a resize or
  // rebuild that changes `maxRes` keeps the user's chosen PERCENT stable rather than the raw
  // multiplier. Camera commands that aren't zoom "steps" (frameSubset/resetView) set goalRes
  // directly and then resync zoomPct to match.
  private maxRes = FALLBACK_MAX_RES;
  private zoomPct = 100;
  private wheelAccum = 0;
  private userTook = false;

  // interaction
  private pressed = false; private dragging = false; private movedFar = false;
  private lastX = 0; private lastY = 0; private downX = 0; private downY = 0;

  // selection
  private activeFile: string | null = null;
  private hoveredId: string | null = null;
  private searchMatches = new Set<string>();
  private highlightSet: Set<string> | null = null;
  private alwaysOn = new Set<string>();

  // theme tokens
  private colors: string[] = [...COLOR_FALLBACK];
  private groundColor = "#0b0c11";
  private fontStack = '"Monaspace Xenon", ui-monospace, monospace';
  private cellW = CELL_W; private cellH = CELL_H; private fontPx = FONT_PX;
  // The pinned per-cell letterSpacing applyFont() computed (so glyphs land exactly on the grid) —
  // cluster (eyebrow) labels borrow the same ctx property for real tracking, then paint() restores
  // this value so the next row of field glyphs isn't shorn off its cells.
  private pinnedLetterSpacing = "0px";
  private letterSpacingSupported = false;

  // callbacks
  private onNodeClick: (id: string) => void = () => {};
  private onHover: (n: HoverNode | null) => void = () => {};
  private onFps?: (fps: number) => void;
  private onPaint?: (nodeCount: number) => void;
  private onZoom?: (pct: number) => void;
  onHighlightCleared?: () => void;

  // loop
  private raf = 0; private running = false; private visible = true; private dirty = true;
  private lastFrameT = 0; private fpsAccum = 0; private fpsFrames = 0;
  private lastZoomPct = -1;
  private statsHookInstalled = false;

  // ---- lifecycle -----------------------------------------------------------

  mount(el: HTMLElement, onNodeClick: (id: string) => void, onHover?: (n: HoverNode | null) => void, _labelOverlay?: HTMLElement) {
    this.host = el;
    this.onNodeClick = onNodeClick;
    if (onHover) this.onHover = onHover;

    this.viewport = document.createElement("div");
    this.viewport.className = "asc-graph-viewport asc-field";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "asc-graph-canvas";
    this.ctx = this.canvas.getContext("2d");
    this.viewport.append(this.canvas);
    el.appendChild(this.viewport);

    this.readTokens();
    this.measure();
    this.ro = new ResizeObserver(() => { this.measure(); this.fit(); });
    this.ro.observe(el);

    this.viewport.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    this.viewport.addEventListener("wheel", this.onWheel, { passive: false });
    this.viewport.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("keydown", this.onKeyDown);

    // DEV-only QA hook (see AsciiGraphStats/computeStats) — the LAST mounted instance wins if more
    // than one field is on the page (main + sidebar mini-graph); harmless, since QA always targets
    // the one visible field. Guarded so a non-Vite runtime (Bun's test runner has no `import.meta.env`)
    // never throws — `?.` short-circuits straight to `undefined`, which is falsy.
    if (typeof window !== "undefined" && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
      (window as unknown as { __asciiGraphStats?: () => AsciiGraphStats }).__asciiGraphStats = () => this.computeStats();
      this.statsHookInstalled = true;
    }

    this.start();
  }

  destroy() {
    this.stop();
    this.setSelectionSuppressed(false);
    this.ro?.disconnect();
    this.viewport?.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.viewport?.removeEventListener("wheel", this.onWheel);
    this.viewport?.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("keydown", this.onKeyDown);
    if (this.statsHookInstalled && typeof window !== "undefined") {
      delete (window as unknown as { __asciiGraphStats?: unknown }).__asciiGraphStats;
      this.statsHookInstalled = false;
    }
    this.host?.replaceChildren();
    this.nodes = []; this.edges = []; this.byId.clear();
  }

  setFpsCallback(cb: (fps: number) => void) { this.onFps = cb; }
  setPaintCallback(cb: (nodeCount: number) => void) { this.onPaint = cb; }
  setZoomCallback(cb: (pct: number) => void) { this.onZoom = cb; }
  setVisible(visible: boolean) { this.visible = visible; if (visible) { this.dirty = true; this.start(); } else this.stop(); }

  // ---- data ----------------------------------------------------------------

  render(g: GraphData) {
    if (!this.host) return;
    // Same stability guarantee as the old renderer: key on STRUCTURE only, so a benign re-fetch
    // (identical nodes/edges, nudged coordinates) never re-shapes the field or snaps the camera.
    const struct = structuralGraphSig(g);
    if (struct === this.sig && this.nodes.length) { this.dirty = true; return; }
    const resetCamera = shouldResetView(new Set(this.byId.keys()), g.nodes);
    this.sig = struct;
    this.build(g, resetCamera);
  }

  private build(g: GraphData, resetCamera: boolean) {
    this.measure();
    this.adjacency.clear();
    const deg = new Map<string, number>();
    for (const e of g.edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
      this.link(e.from, e.to); this.link(e.to, e.from);
    }

    // Centre on the CONTENT centroid excluding the injected "you" hub (which sits at the origin and
    // would bias it) — same reasoning as CanvasGraphRenderer.build().
    const c3 = centroid3(g.nodes.filter((n) => n.kind !== "self").map((n) => finiteVec3(n.position)));
    const c2 = centroid3(g.nodes.filter((n) => n.kind !== "self").map((n) => {
      const v = finiteVec3(n.position2d); return [v[0], v[1], 0] as Vec3;
    }));

    this.hoveredId = null; this.highlightSet = null;
    this.nodes = g.nodes.map((node) => {
      const p = finiteVec3(node.position);
      const p2 = finiteVec3(node.position2d, [p[0], p[1], 0]);
      return {
        node,
        p3: [p[0] - c3[0], -(p[1] - c3[1]), p[2] - c3[2]] as Vec3,
        p2: [p2[0] - c2[0], -(p2[1] - c2[1]), 0] as Vec3,
        deg: deg.get(node.id) ?? 0,
        color: C_FG, dim: false,
        sx: 0, sy: 0, depth: 0, dr: 1, col: -1, row: -1, onGrid: false,
      } satisfies NodeView;
    });
    this.byId = new Map(this.nodes.map((nv) => [nv.node.id, nv]));

    // Hierarchy depth + per-level exemplar names, resolved once here (not per-frame): `nodePath`
    // falls back to the single-element `[community]` for pre-hierarchy/legacy nodes, so a graph with
    // no communityPath at all still gets exactly the original one-tier cluster-name behaviour.
    this.levelCount = 0;
    for (const nv of this.nodes) {
      const path = nodePath(nv.node);
      if (path && path.length > this.levelCount) this.levelCount = path.length;
    }
    this.communityNamesByLevel = Array.from({ length: this.levelCount }, () => new Map<number, string>());
    for (const nv of this.nodes) {
      const path = nodePath(nv.node);
      if (!path) continue;
      const labels = nodePathLabels(nv.node);
      for (let L = 0; L < path.length; L++) {
        const id = path[L];
        const map = this.communityNamesByLevel[L];
        if (id == null || !map || map.has(id)) continue;
        map.set(id, labels?.[L] ?? `cluster ${id}`);
      }
    }

    this.edges = [];
    for (const e of g.edges) {
      const a = this.byId.get(e.from), b = this.byId.get(e.to);
      if (a && b) this.edges.push({ a, b, kr: (hashKey(e.from + "\0" + e.to) % 1000) / 1000 });
    }

    // Recentre 2D on the bounding-BOX centre (not the centroid computed above) so a lopsided cloud
    // doesn't leave a dead margin on one side at 100% fit: `c2` above only zeroes the MEAN position,
    // which a skewed cloud still leaves asymmetric against a rectangular field — 92% of the box
    // isn't really 92% if the cloud itself sits off-centre inside its own bounding box. Done BEFORE
    // buildLodIndex/boundingHalfExtents below consume `nv.p2`, so the LOD centroids and the fit
    // radius both already see the recentred coordinates. 3D (`p3`) is untouched — the orbit camera
    // has no "box" to speak of, only a target point.
    if (this.nodes.length) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const nv of this.nodes) {
        const x = nv.p2[0], y = nv.p2[1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
      if (Number.isFinite(midX) && Number.isFinite(midY)) {
        for (const nv of this.nodes) { nv.p2[0] -= midX; nv.p2[1] -= midY; }
      }
    }

    // LOD structure (2D aggregate entities + aggregate edges), precomputed HERE — per graph build,
    // never per frame. Cluster world centroids use the same centred/flipped p2 space the projector
    // consumes, so per-frame entity projection is the same two multiplies a node costs.
    this.lodLevels = buildLodIndex(
      this.nodes.map((nv) => ({ id: nv.node.id, path: nodePath(nv.node), x: nv.p2[0], y: nv.p2[1] })),
      g.edges.map((e) => ({ from: e.from, to: e.to })),
    );
    this.entityFlat = [];
    this.entityLevels = this.lodLevels.map((lv, L) => lv.clusters.map((c) => {
      const isFinest = L === this.lodLevels.length - 1;
      const key = isFinest ? "community:" + c.community : `community:L${L}:${c.community}`;
      const { rowR, colR } = massRadii(c.count, this.cellW, this.cellH);
      const ev: EntityView = {
        flat: this.entityFlat.length, level: L, community: c.community, count: c.count,
        wx: c.wx, wy: c.wy,
        color: RAMP[hashKey(key) % RAMP.length],
        name: this.communityNamesByLevel[L]?.get(c.community) ?? `cluster ${c.community}`,
        rowR, colR, memberIds: c.memberIds,
        sx: 0, sy: 0, col: -1, row: -1, onGrid: false, drawnRowR: rowR, drawnColR: colR,
      };
      this.entityFlat.push(ev);
      return ev;
    }));
    this.hoverEntityIdx = -1;

    this.radius3 = boundingRadius(this.nodes.map((nv) => nv.p3));
    this.radius2 = boundingRadius(this.nodes.map((nv) => nv.p2));
    this.half2 = boundingHalfExtents(this.nodes.map((nv) => nv.p2));
    this.alwaysOn = computeAlwaysOnSet(
      g.nodes, g.edges.map((e) => ({ source: e.from, target: e.to })), this.activeFile, this.cfg.graphLabelHubCount ?? 10,
    );
    this.restyle();
    this.fit(resetCamera);
  }

  private link(a: string, b: string) {
    let s = this.adjacency.get(a);
    if (!s) { s = new Set(); this.adjacency.set(a, s); }
    s.add(b);
  }

  // ---- styling -------------------------------------------------------------

  setConfig(cfg: GraphConfig) {
    const prevMode = this.cfg.viewMode;
    this.cfg = cfg;
    // A theme switch reaches us through setConfig (the palette/background change), so that is where
    // the CSS tokens are re-read — the same trigger point the old renderer used for applyHostVars().
    // Note the colour fields on GraphConfig (palette/edgeColor/backgroundColor/…) are IGNORED here:
    // the ASCII field paints from the CSS custom properties directly, which is the single source of
    // truth for the redesign's four theme scopes.
    this.readTokens();
    // readTokens() may have picked up a changed --cell-h (the shared --row-h unit) — re-measure so
    // the grid's row count follows it before fit() recomputes the fit resolution against it.
    this.measure();
    // 2D and 3D fit different layouts (radius2 vs radius3), so a dimension flip re-fits — and
    // returns the field to 0% so the flipped view opens on the whole graph, not a stale crop.
    if (cfg.viewMode !== prevMode) {
      this.rx = -0.5; this.ry = 0;
      this.panX = 0; this.panY = 0;
      this.zoomPct = 100;
      this.res = 1; this.goalRes = 1;
      this.target = [0, 0, 0]; this.goalTarget = [0, 0, 0];
      this.userTook = false;
    }
    this.restyle();
    this.fit();
    this.dirty = true;
  }

  private readTokens() {
    const h = this.host;
    if (!h || typeof getComputedStyle !== "function") return;
    const cs = getComputedStyle(h);
    const read = (name: string, fallback: string) => {
      const v = cs.getPropertyValue(name).trim();
      return v || fallback;
    };
    this.colors = COLOR_VARS.map((v, i) => read(v, COLOR_FALLBACK[i]));
    // The label's cleared ground. --graph-bg may still be a gradient on a non-ASCII theme, and a
    // gradient string is not a valid fillStyle — fall back to the flat page background there.
    const gb = read("--graph-bg", "");
    this.groundColor = gb && !gb.includes("gradient") ? gb : read("--bg", "#0b0c11");
    this.fontStack = read("--ui-font-stack", this.fontStack);
    // The grid row unit — asciiGraph.css's --cell-h resolves to the app-wide --row-h token (ui.css),
    // so the field's line box (both the main pane AND the sidebar mini-graph — there is no denser
    // cell any more) always matches the sidebar tree / tabs / tables rhythm. GRID LAW: line-height
    // == cell height, so this is the ONLY thing that ever changes the row pitch — never the font size.
    const rowH = parseFloat(read("--cell-h", `${CELL_H}px`));
    if (Number.isFinite(rowH) && rowH > 0) this.cellH = rowH;
    this.applyFont();
  }

  /**
   * Pin the character advance to the design's cell width. Canvas letter-spacing (a) makes a run of
   * text land on exactly the cell grid regardless of the font's natural advance, and (b) disables
   * the font's optional ligatures — Monaspace would otherwise fuse "//" or "|-" and shear the
   * drawing off its cells. Where letterSpacing isn't supported we adopt the font's MEASURED advance
   * as the cell width instead: the grid then matches the font, which is the same guarantee.
   */
  private applyFont() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.font = `${this.fontPx}px ${this.fontStack}`;
    const ls = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    const want = CELL_W;
    const supported = typeof ls.letterSpacing === "string";
    if (supported) ls.letterSpacing = "0px";
    const natural = ctx.measureText("0".repeat(64)).width / 64;
    if (supported && natural > 0) {
      ls.letterSpacing = `${(want - natural).toFixed(4)}px`;
      this.cellW = want;
      this.pinnedLetterSpacing = ls.letterSpacing;
      this.letterSpacingSupported = true;
    } else {
      this.cellW = natural > 0 ? natural : want;
      this.letterSpacingSupported = false;
    }
  }

  private restyle() {
    for (const nv of this.nodes) {
      nv.color = this.colorSlot(nv.node);
      nv.dim = this.isDimmed(nv.node);
    }
    this.dirty = true;
  }

  private colorSlot(n: GraphNode): number {
    switch (n.kind) {
      case "self": return C_FG;
      case "daemon": return C_ACCENT;
      case "cron":
      case "process": {
        const vs = nodeVisualState(n.daemon ?? { enabled: true, running: false, lastResult: null, lastFiredMs: null });
        return vs.fill === "palette" || vs.border === "palette" ? RAMP[hashKey(n.id) % RAMP.length] : C_FAINT;
      }
      case "tag": return RAMP[hashKey("tag:" + n.label) % RAMP.length];
      default: {
        const key = n.community != null ? "community:" + n.community : (n.kind === "note" ? "folder:" + (n.folder ?? "(root)") : n.kind + ":" + n.label);
        return RAMP[hashKey(key) % RAMP.length];
      }
    }
  }

  private isDimmed(n: GraphNode): boolean {
    if (n.kind !== "cron" && n.kind !== "process") return false;
    return !(n.daemon?.enabled ?? true);
  }

  // ---- geometry ------------------------------------------------------------

  private measure() {
    if (!this.host || !this.ctx) return;
    const r = this.host.getBoundingClientRect();
    if (!isUsableBox(r.width, r.height)) { if (!this.boxReady) this.dirty = true; return; }
    this.boxReady = true;
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    // Only touch the backing store when it actually changes: assigning canvas.width/height CLEARS
    // the canvas (and resets the 2D context state) even when the value is identical. measure() is
    // called unconditionally from setConfig(), which GraphView fires on every theme/settings change
    // — so an unguarded reassign blanks the field, and if the rAF loop happens to be paused at that
    // moment (backgrounded tab, hidden mini-graph) nothing repaints it until the loop resumes.
    const bw = Math.round(this.W * this.dpr), bh = Math.round(this.H * this.dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) { this.canvas.width = bw; this.canvas.height = bh; }
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.applyFont();

    const m = gridMetrics(this.W, this.H, this.cellW, this.cellH, PAD_X, PAD_Y);
    const cells = m.cols * m.rows;
    if (m.cols !== this.m.cols || m.rows !== this.m.rows || this.charBuf.length !== cells) {
      this.charBuf = new Uint16Array(cells);
      this.layerBuf = new Uint8Array(cells);
      this.colorBuf = new Uint8Array(cells);
      this.alphaBuf = new Uint8Array(cells);
      this.cellNode = new Int32Array(cells);
      this.cellEntity = new Int32Array(cells);
      this.labelOccupied = new Uint8Array(cells);
      this.noiseBuf = buildNoise(m.cols, m.rows);
    }
    this.m = m;
    // Perspective focal length — the old renderer's (H/2)/tan(FOV/2), against the grid's own box.
    this.P = ((m.rows * m.cellH) / 2) / Math.tan((FOV_DEG * Math.PI) / 360);
    this.dirty = true;
  }

  /**
   * Reconcile the grid with the host's CURRENT box, once per frame.
   *
   * measure() is also driven by mount()/render()/the ResizeObserver, but every one of those is a
   * one-shot: the knowledge graph is a SINGLE floating element that App re-places and re-sizes
   * across slots (`.graph-floater`, sized inline from a rAF), so mount() and the first render()
   * both routinely run while the host is still 0×0 — and then the field is pinned to its 1×1
   * bootstrap grid until a ResizeObserver notification happens to arrive. Any frame that skips
   * that delivery (a coalesced resize, an observation delivered while the box was still degenerate,
   * a throttled/occluded window) left the renderer permanently unmeasured: every node off-grid,
   * every cell empty — a blank canvas under a perfectly populated HUD and cluster legend, which is
   * exactly the bug this guards. The rAF loop is the one thing that keeps running, so the size is
   * reconciled here instead of being trusted to arrive.
   *
   * Cheap: one getBoundingClientRect of an element whose geometry nothing in the frame has
   * invalidated (the loop only writes to the canvas), and measure()/fit() only run when the box
   * actually differs from the grid we last built.
   */
  private syncSize() {
    if (!this.host) return;
    const r = this.host.getBoundingClientRect();
    if (!isUsableBox(r.width, r.height)) return;
    if (this.boxReady && Math.abs(r.width - this.W) < 0.5 && Math.abs(r.height - this.H) < 0.5) return;
    this.measure();
    this.fit();
  }

  /** Recompute the world→px fit ("res = 1 fits the whole graph on the grid", i.e. 100%) and the
   *  deepest-zoom ceiling (`maxRes`, i.e. 0% — see asciiGrid.ts maxResFor). The ceiling is
   *  graph/box-derived, so it can shift on every resize or rebuild; `zoomPct` (not `goalRes`) is the
   *  durable state, so a shifted ceiling re-derives `goalRes` to land back on the SAME percent
   *  instead of silently changing what "the user's current zoom" means.
   *
   *  FIT LAW: 2D fills each screen AXIS to FIT_FILL_FRACTION of the graph's own bounding-box
   *  half-extents (`fitScaleForBox`/`half2`) — the binding axis lands at exactly that fraction, so a
   *  16:9 field no longer wastes its long axis, and a rectangular node cloud is no longer over-read
   *  by a circumscribing radius (which reads up to sqrt(2) too large against its own bounding box).
   *  3D keeps the original radius-based `fitPxPerWorld` (a fraction of the shorter screen axis) —
   *  the orbiting camera has no fixed box to fill, only a distance to keep the whole cloud in frame
   *  regardless of yaw/pitch. */
  private fit(resetCamera = false) {
    if (!this.boxReady) return;
    const is2d = this.cfg.viewMode === "2d";
    if (is2d) {
      this.pxPerWorld = fitScaleForBox(
        this.m.cols * this.m.cellW, this.m.rows * this.m.cellH, this.half2.hx, this.half2.hy,
      );
    } else {
      const radius = Math.max(1e-6, this.radius3);
      this.pxPerWorld = fitPxPerWorld(this.m.cols, this.m.rows, this.m, radius);
    }
    this.maxRes = maxResFor(this.pxPerWorld, this.cellW);
    if (resetCamera) {
      this.zoomPct = 100;
      this.res = 1; this.goalRes = 1;
      this.target = [0, 0, 0]; this.goalTarget = [0, 0, 0];
      this.panX = 0; this.panY = 0; this.userTook = false;
      this.rx = -0.5; this.ry = 0;
    } else {
      this.goalRes = resFromPercent(this.zoomPct, this.maxRes);
    }
    this.dirty = true;
  }

  // ---- render loop ---------------------------------------------------------

  private start() { if (this.running || !this.visible || !this.host) return; this.running = true; this.raf = requestAnimationFrame(this.tick); }
  private stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  private tick = (t: number) => {
    if (!this.running) return;
    this.syncSize();
    if (this.lastFrameT) {
      this.fpsAccum += t - this.lastFrameT; this.fpsFrames++;
      if (this.fpsAccum >= 500) { this.onFps?.(Math.round((this.fpsFrames * 1000) / this.fpsAccum)); this.fpsAccum = 0; this.fpsFrames = 0; }
    }
    this.lastFrameT = t;

    const is2d = this.cfg.viewMode === "2d";
    if (!is2d && this.cfg.spin && this.nodes.length <= 350 && !this.userTook && !this.dragging) {
      this.ry += this.cfg.spinSpeed ?? 0.0015; this.dirty = true;
    }
    // Smooth-glide the world-per-cell ratio (the old renderer's goalZoom glide, in resolution space),
    // then SNAP the last sub-epsilon sliver. An asymptotic ease never actually arrives, and `res` is
    // what the HUD percent is derived from — leaving it permanently `RES_EPS` short of the step the
    // user selected reads out as 91% for a 90% stop (worse the shorter the ladder, since RES_EPS is
    // absolute while a step's size shrinks with `maxRes`). Landing exactly makes the readout the
    // step, without giving up the animated approach.
    if (Math.abs(this.goalRes - this.res) > RES_EPS) { this.res += (this.goalRes - this.res) * GLIDE; this.dirty = true; }
    else if (this.res !== this.goalRes) { this.res = this.goalRes; this.dirty = true; }
    if (Math.hypot(this.goalTarget[0] - this.target[0], this.goalTarget[1] - this.target[1], this.goalTarget[2] - this.target[2]) > 0.3) {
      for (let i = 0; i < 3; i++) this.target[i] += (this.goalTarget[i] - this.target[i]) * GLIDE;
      this.dirty = true;
    }

    if (this.dirty) {
      this.rasterize(is2d);
      this.paint();
      this.emitZoom();
      this.dirty = false;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private emitZoom() {
    const pct = resolutionPercent(this.res, this.maxRes);
    if (pct !== this.lastZoomPct) { this.lastZoomPct = pct; this.onZoom?.(pct); }
  }

  // ---- cursor-anchored zoom (2D) -------------------------------------------

  /**
   * Take one zoom-ladder step ANCHORED at viewport px (ax, ay): move the percent state as
   * `setZoomPercent` does, then re-aim `goalTarget` so the world point sitting at that px keeps
   * exactly that px through the step. Everything is computed in GOAL space (goalRes/goalTarget,
   * not the mid-glide res/target), so consecutive wheel notches COMPOSE exactly — the settled
   * post-step camera puts the anchored world point back under the cursor to the pixel, whatever
   * the glide did in between. Pan is untouched (it stays the drag's). 3D falls back to the plain
   * step: the orbit camera has no meaningful cursor point to pin.
   */
  private zoomStepAnchored(pct: number, ax: number, ay: number) {
    const before = this.goalRes;
    this.setZoomPercent(pct);
    const after = this.goalRes;
    if (this.cfg.viewMode !== "2d" || after === before) return;
    const sB = this.pxPerWorld * before, sA = this.pxPerWorld * after;
    if (!(sB > 0) || !(sA > 0)) return;
    const m = this.m;
    const ox = m.padX + (m.cols / 2) * m.cellW + this.panX;
    const oy = m.padY + (m.rows / 2) * m.cellH + this.panY;
    // World point under the anchor px at the goal-before camera … stays put at the goal-after one.
    const wx = this.goalTarget[0] + (ax - ox) / sB;
    const wy = this.goalTarget[1] + (ay - oy) / sB;
    this.goalTarget = [wx - (ax - ox) / sA, wy - (ay - oy) / sA, this.goalTarget[2]];
  }

  /** Keyboard zoom (and any cursorless step) anchors the CENTRE of the grid. */
  private zoomStepCentered(pct: number) {
    const m = this.m;
    this.zoomStepAnchored(pct, m.padX + (m.cols * m.cellW) / 2, m.padY + (m.rows * m.cellH) / 2);
  }

  // ---- rasterization -------------------------------------------------------

  // Scratch read by putEdge (see rasterize) — the alternative was a closure per edge per frame.
  private edgeColor = C_MUTED;
  private edgeAlpha = 255;
  private putEdge = (x: number, y: number, ch: string) => {
    const m = this.m;
    if (x < 0 || x >= m.cols || y < 0 || y >= m.rows) return;
    const i = y * m.cols + x;
    if (this.layerBuf[i] > LAYER_EDGE) return;                      // a node owns this cell
    const wasEdge = this.layerBuf[i] === LAYER_EDGE;
    // Code-level merge: `ch` is one of traceEdge's five interned literals, so charCodeAt costs
    // nothing, and no string is materialised for the ~600k cells a dense frame touches.
    this.charBuf[i] = mergeEdgeCode(this.charBuf[i], ch.charCodeAt(0), wasEdge);
    this.layerBuf[i] = LAYER_EDGE;                                  // clears the noise underneath
    this.colorBuf[i] = this.edgeColor;
    if (!wasEdge || this.alphaBuf[i] < this.edgeAlpha) this.alphaBuf[i] = this.edgeAlpha;
  };

  /** Project every ACTIVE primitive onto the grid, then draw the layers into the cell buffers.
   *
   *  LEVEL OF DETAIL (2D + a community hierarchy): the zoom ladder maps onto the hierarchy —
   *  coarse stops rasterize the active level's AGGREGATE ENTITIES + AGGREGATE EDGES only (a frame
   *  costs O(clusters + inter-cluster connectors)); the leaf passes below — per-node projection,
   *  the real edge loop, the real node loop — simply do not run until `lodMix`'s leaf alpha comes
   *  up near the deep stops. Crossfades between adjacent levels (and between the finest level and
   *  the leaves) reuse the exact alphas of the cluster-name/file-name label crossfade, so geometry
   *  and naming always move together. 3D keeps the original full-detail path untouched. */
  private rasterize(is2d: boolean) {
    const m = this.m;
    const cells = m.cols * m.rows;
    const noiseA = Math.round(NOISE_ALPHA * 255);
    // QA/debug instrumentation counters (see computeStats/window.__asciiGraphStats) — reset once per
    // rasterize() and incremented in the SAME passes below that already walk these collections, so
    // the hot loop pays for nothing extra beyond a few integer increments.
    this.entitiesDrawnFrame = 0;
    this.notesOnScreenFrame = 0;
    this.edgesDrawnFrame = 0;
    // Layer 1 — the noise field (graph.backgroundNoise, off by default — settingsSchema.ts). Static
    // per grid size + seed, laid down first so edges and nodes can CLEAR it (writing a higher layer
    // over the same cell). When the setting is off the buffers are just reset to empty — cellNode
    // still needs clearing every frame regardless, since the hit test reads it.
    const showNoise = this.cfg.backgroundNoise === true;
    for (let i = 0; i < cells; i++) {
      if (showNoise) {
        const ch = this.noiseBuf[i];
        this.charBuf[i] = ch;
        this.layerBuf[i] = ch ? LAYER_NOISE : 0;
        this.colorBuf[i] = C_FAINT;
        this.alphaBuf[i] = noiseA;
      } else {
        this.charBuf[i] = 0;
        this.layerBuf[i] = 0;
      }
      this.cellNode[i] = -1;
      this.cellEntity[i] = -1;
    }

    const lodOn = is2d && this.levelCount > 0 && this.entityLevels.length > 0;
    this.lodOn = lodOn;
    const mix = lodOn ? lodMix(resolutionT(this.res, this.maxRes), this.levelCount) : null;
    const leafA = mix ? mix.leafAlpha : 1;
    this.leafAlpha = leafA;

    // ---- LEAF passes (real notes + real edges) — skipped wholesale at coarse LOD stops. --------
    if (leafA > LOD_ALPHA_EPS) {
      this.projectNodes(is2d);

      const focus = this.focusSet();
      // Layer 2 — edges. Bresenham between the two snapped cells; crossing runs merge into "+".
      // `putEdge` is a single hoisted closure reading two scratch fields, so the per-frame edge loop
      // allocates nothing (2.6k closures a frame was the obvious thing to get wrong here).
      const keepFrac = this.edges.length > EDGE_BUDGET ? Math.max(EDGE_FLOOR, EDGE_BUDGET / this.edges.length) : 1;
      for (const e of this.edges) {
        if (e.kr >= keepFrac) continue;
        const { a, b } = e;
        if (!a.onGrid || !b.onGrid) continue;
        const incident = this.hoveredId != null && (a.node.id === this.hoveredId || b.node.id === this.hoveredId);
        const inFocus = !focus || focus.has(a.node.id) || focus.has(b.node.id);
        let alpha = is2d ? EDGE_ALPHA_2D : EDGE_ALPHA_2D * depthAlpha((a.dr + b.dr) / 2);
        if (focus && !inFocus) alpha *= DIM_ALPHA;
        if (incident) alpha = 1;
        alpha *= leafA;
        this.edgeColor = incident ? C_ACCENT : C_MUTED;
        this.edgeAlpha = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
        traceEdge(a.col, a.row, b.col, b.row, this.putEdge);
        this.edgesDrawnFrame++;
      }

      // Layer 3 — nodes. Weight is the glyph (degree ramp, shifted by depth band in 3D), colour is
      // the cluster; the hovered / active node takes the accent.
      for (let i = 0; i < this.nodes.length; i++) {
        const nv = this.nodes[i];
        if (!nv.onGrid) continue;
        this.notesOnScreenFrame++;
        const idx = nv.row * m.cols + nv.col;
        const id = nv.node.id;
        const hot = id === this.hoveredId || id === this.activeFile || this.searchMatches.has(id);
        let alpha = is2d ? 1 : depthAlpha(nv.dr);
        if (focus && !focus.has(id)) alpha *= DIM_ALPHA;
        if (nv.dim) alpha *= 0.45;
        if (hot) alpha = 1;
        alpha *= leafA;
        const glyph = nv.node.kind === "self" ? "@" : nodeGlyph(nv.deg, nv.dr, !is2d, DEPTH_BANDS);
        this.charBuf[idx] = glyph.charCodeAt(0);
        this.layerBuf[idx] = LAYER_NODE;
        this.colorBuf[idx] = hot ? C_ACCENT : nv.color;
        this.alphaBuf[idx] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
        this.cellNode[idx] = i;
      }
    }

    // ---- AGGREGATE passes (entities + inter-cluster connectors), active levels only. -----------
    if (mix) {
      for (let L = 0; L < this.entityLevels.length; L++) {
        const a = mix.levelAlphas[L] ?? 0;
        if (a <= LOD_ALPHA_EPS) continue;
        this.projectEntities(L);
        this.drawAggregateEdges(L, a);
        this.drawEntityMasses(L, a);
      }
    }

    this.layoutLabels(is2d);
  }

  /** Project one level's entities (2D only — the flat pipeline with rx = ry = 0, i.e. two
   *  multiplies per entity). O(clusters), allocation-free: scratch lives on the prebuilt views. */
  private projectEntities(level: number) {
    const m = this.m;
    const s = this.pxPerWorld * this.res;
    const tx = this.target[0], ty = this.target[1];
    const ox = m.padX + (m.cols / 2) * m.cellW + this.panX;
    const oy = m.padY + (m.rows / 2) * m.cellH + this.panY;
    const capRow = Math.max(1, (m.rows / 7) | 0);
    const capCol = Math.max(2, (m.cols / 7) | 0);
    for (const ev of this.entityLevels[level]) {
      ev.sx = ox + (ev.wx - tx) * s;
      ev.sy = oy + (ev.wy - ty) * s;
      ev.col = Math.round((ev.sx - m.padX) / m.cellW);
      ev.row = Math.round((ev.sy - m.padY) / m.cellH);
      ev.drawnRowR = Math.min(ev.rowR, capRow);
      ev.drawnColR = Math.min(ev.colR, capCol);
      // A mass whose CENTRE is off-grid can still overlap the field by up to its radius.
      ev.onGrid = ev.col >= -ev.drawnColR && ev.col < m.cols + ev.drawnColR
        && ev.row >= -ev.drawnRowR && ev.row < m.rows + ev.drawnRowR;
    }
  }

  /** Aggregate edges for one level: ONE connector per community pair summarizing every real link
   *  between the two member sets. Visual weight = link count → alpha ramp, and the heaviest
   *  connectors draw DOUBLED (a parallel Bresenham trace one cell off, perpendicular to the
   *  dominant axis) — char density, never a wider glyph. Counts precomputed at build. */
  private drawAggregateEdges(level: number, levelAlpha: number) {
    const lv = this.lodLevels[level];
    const evs = this.entityLevels[level];
    if (!lv) return;
    this.edgeColor = C_MUTED;
    for (const e of lv.edges) {
      const a = evs[e.a], b = evs[e.b];
      if (!a.onGrid && !b.onGrid) continue;
      const alpha = EDGE_ALPHA_2D * (AGG_EDGE_ALPHA_MIN + (1 - AGG_EDGE_ALPHA_MIN) * e.w) * levelAlpha;
      this.edgeAlpha = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
      traceEdge(a.col, a.row, b.col, b.row, this.putEdge);
      this.edgesDrawnFrame++;
      if (e.w >= AGG_EDGE_DOUBLE_W) {
        if (Math.abs(b.col - a.col) >= Math.abs(b.row - a.row)) traceEdge(a.col, a.row + 1, b.col, b.row + 1, this.putEdge);
        else traceEdge(a.col + 1, a.row, b.col + 1, b.row, this.putEdge);
      }
    }
  }

  /** One level's entity masses: an elliptical "@ o ." ramp blob per community, sized by member
   *  count (sqrt scaling, grid-capped), in the community's own ramp colour. During the leaf
   *  crossfade a real node glyph already on a cell WINS — members "emerge through" the dissolving
   *  parent instead of being stamped over. Every mass cell registers in cellEntity for the hit
   *  test, whichever glyph won the cell. */
  private drawEntityMasses(level: number, levelAlpha: number) {
    const m = this.m;
    for (const ev of this.entityLevels[level]) {
      if (!ev.onGrid) continue;
      this.entitiesDrawnFrame++;
      const hot = ev.flat === this.hoverEntityIdx;
      const rowR = ev.drawnRowR, colR = ev.drawnColR;
      const invR2 = 1 / (rowR * rowR), invC2 = 1 / (colR * colR);
      for (let dy = -rowR; dy <= rowR; dy++) {
        const row = ev.row + dy;
        if (row < 0 || row >= m.rows) continue;
        const base = row * m.cols;
        for (let dx = -colR; dx <= colR; dx++) {
          const col = ev.col + dx;
          if (col < 0 || col >= m.cols) continue;
          const d2 = dx * dx * invC2 + dy * dy * invR2;
          if (d2 > 1) continue;
          const i = base + col;
          this.cellEntity[i] = ev.flat;
          if (this.layerBuf[i] === LAYER_NODE && this.cellNode[i] >= 0) continue; // a real note owns the cell
          let alpha = massCellAlpha(d2) * levelAlpha;
          if (hot) alpha = Math.min(1, alpha + 0.25);
          this.charBuf[i] = massCellCode(d2);
          this.layerBuf[i] = LAYER_NODE;
          this.colorBuf[i] = ev.color;
          this.alphaBuf[i] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
        }
      }
    }
  }

  /** The copied camera math (CanvasGraphRenderer.project/projectPositions), evaluated inline with
   *  the per-frame constants hoisted. 2D is the same pipeline with rx = ry = 0 over the flat
   *  layout, so perspective resolves to 1. No allocation. */
  private projectNodes(is2d: boolean) {
    const m = this.m;
    const s = this.pxPerWorld * this.res;
    const tx = this.target[0], ty = this.target[1], tz = this.target[2];
    const rx = is2d ? 0 : this.rx, ry = is2d ? 0 : this.ry;
    const cyr = Math.cos(ry), syr = Math.sin(ry), cxr = Math.cos(rx), sxr = Math.sin(rx);
    const P = this.P;
    const ox = m.padX + (m.cols / 2) * m.cellW + this.panX;
    const oy = m.padY + (m.rows / 2) * m.cellH + this.panY;
    let minZ = Infinity, maxZ = -Infinity;
    for (const nv of this.nodes) {
      const p = is2d ? nv.p2 : nv.p3;
      const x = (p[0] - tx) * s, y = (p[1] - ty) * s, z = (p[2] - tz) * s;
      const x1 = x * cyr + z * syr, z1 = -x * syr + z * cyr;
      const y2 = y * cxr - z1 * sxr, z2 = y * sxr + z1 * cxr;
      const zc = z2;                                   // the perspective dolly is 0: zoom is resolution
      const persp = P / Math.max(1, P - zc);
      nv.sx = ox + x1 * persp;
      nv.sy = oy + y2 * persp;
      nv.depth = zc;
      // snapToCell()'s arithmetic, inlined: the pure helper returns an object, and this loop runs
      // once per node per frame. (asciiGrid.test.ts pins the two to the same result.)
      const col = Math.round((nv.sx - m.padX) / m.cellW);
      const row = Math.round((nv.sy - m.padY) / m.cellH);
      nv.col = col; nv.row = row;
      nv.onGrid = persp > 0.05 && zc < P * 0.985 && col >= 0 && col < m.cols && row >= 0 && row < m.rows;
      if (zc < minZ) minZ = zc;
      if (zc > maxZ) maxZ = zc;
    }
    const span = maxZ - minZ;
    const flat = !(span > 1);
    for (const nv of this.nodes) nv.dr = flat ? 1 : (nv.depth - minZ) / span;
  }

  /**
   * Which labels to draw, and where — an N+1-tier zoom-driven system (labelSelection.ts owns the
   * pure curve math):
   *
   *   1. CLUSTER NAMES, per hierarchy LEVEL. Below `FILE_LABEL_REVEAL_T` the field names
   *      communities, not files — walking `communityPath` coarsest → finest as the camera zooms in,
   *      one crossfade per level boundary (`clusterLevelAlphas`), landing on the finest level right
   *      at the reveal point. Each active level's community centroids get their
   *      `communityPathLabels[level]` exemplar in eyebrow register (uppercase + tracked), placed by
   *      the same greedy grid-occupancy the file-label pass below uses, so cluster names — at any
   *      level, even two adjacent levels mid-crossfade — never overlap each other.
   *   2. FILE NAMES. Labels sit to the node's right on the SAME grid; a label that would run off
   *      the field flips to the node's left, and one whose cells are already taken (by a cluster
   *      name or a higher-ranked file label) is dropped unless it's forced (active/hovered/search —
   *      those always draw, at any zoom). The non-forced budget is intentionally conservative right
   *      after the reveal point (only the highest-ranked, i.e. hub, candidates clear it) and only
   *      opens up toward `FILE_LABEL_FULL_T` — "full naming" is a near-max-resolution thing.
   *
   * Every tier crossfades (not switches) across its own span, via `alpha` on each LabelDraw.
   */
  private layoutLabels(is2d: boolean) {
    this.labels.length = 0;
    if (this.cfg.showGraphLabels === false) return;
    const m = this.m;
    this.labelOccupied.fill(0);
    const t = resolutionT(this.res, this.maxRes);
    const cAlpha = clusterLabelAlpha(t);
    const fAlpha = fileLabelAlpha(t);

    if (cAlpha > 0.01 && this.levelCount > 0) {
      const levelAlphas = clusterLevelAlphas(t, this.levelCount);
      for (let L = 0; L < levelAlphas.length; L++) {
        const a = levelAlphas[L] * cAlpha;
        // LOD (2D): a level's name anchors to its ENTITY (already projected — O(clusters)); the
        // 3D / no-hierarchy path keeps the per-node on-grid aggregation.
        if (a > 0.01) { if (this.lodOn) this.layoutEntityNames(L, a); else this.layoutClusterNames(L, a); }
      }
    }

    // At coarse LOD stops the leaf raster passes did not run — there are no note glyphs on the
    // field for a file label (forced or not) to point at, so the file-label pass is skipped
    // entirely (which is also what keeps a coarse frame O(clusters), not O(nodes log nodes)).
    if (this.lodOn && this.leafAlpha <= LOD_ALPHA_EPS) return;

    // Reused scratch array — layoutLabels runs every frame, so it must not allocate one per frame.
    const ordered = this.labelScratch;
    ordered.length = 0;
    for (const nv of this.nodes) if (nv.onGrid) ordered.push(nv);
    const budget = fileLabelBudget(t, ordered.length);

    const forced = (nv: NodeView) => {
      const id = nv.node.id;
      return id === this.hoveredId || id === this.activeFile || nv.node.kind === "self" ||
        this.searchMatches.has(id) || (this.highlightSet?.has(id) ?? false) ||
        (this.hoveredId != null && (this.adjacency.get(this.hoveredId)?.has(id) ?? false));
    };
    const rank = (nv: NodeView) => (forced(nv) ? 1e9 : this.alwaysOn.has(nv.node.id) ? 1e6 + nv.deg : nv.deg + nv.dr);
    ordered.sort((a, b) => rank(b) - rank(a));

    let drawn = 0;
    for (const nv of ordered) {
      const force = forced(nv);
      if (!force && drawn >= budget) break; // forced labels sort to the front, so this can break
      const text = labelText(nv.node);
      const len = text.length;
      let col = nv.col + 2;
      if (col + len > m.cols) col = nv.col - 2 - len;
      if (col < 0) continue;
      const row = nv.row;
      if (row < 0 || row >= m.rows) continue;
      let free = true;
      for (let c = col - 1; c <= col + len && free; c++) {
        if (c < 0 || c >= m.cols) continue;
        if (this.labelOccupied[row * m.cols + c]) free = false;
      }
      if (!free && !force) continue;
      for (let c = col - 1; c <= col + len; c++) {
        if (c >= 0 && c < m.cols) this.labelOccupied[row * m.cols + c] = 1;
      }
      const accent = nv.node.id === this.activeFile || nv.node.id === this.hoveredId || this.searchMatches.has(nv.node.id);
      this.labels.push({
        text, col, row, color: accent ? C_ACCENT : is2d ? C_MUTED : nv.dr > 0.55 ? C_MUTED : C_FAINT,
        accent, alpha: force ? 1 : fAlpha, widthCells: len,
      });
      drawn++;
    }
  }

  /** Cluster-name pass for ONE hierarchy `level` (0 = coarsest): one label per that level's
   *  community, centred on the average grid cell of its currently-on-grid members (so it works in
   *  2D and follows the 3D orbit alike), reserved first so file labels — and any OTHER level's
   *  names drawn the same frame during a level-to-level crossfade — never draw over each other.
   *  Larger communities (more on-grid members) claim contested cells first — same greedy-by-worth
   *  idea as the file-label loop, just ranked by member count instead of renderedPx. Colour is the
   *  level's own community ramp colour: at the FINEST level this is deliberately the exact same key
   *  `colorSlot()` uses for the nodes themselves (so a cluster name matches the colour of the nodes
   *  it names); coarser levels get a level-scoped key so a super-cluster's name doesn't just
   *  coincidentally borrow one of its children's colours. */
  private layoutClusterNames(level: number, alpha: number) {
    const m = this.m;
    const names = this.communityNamesByLevel[level];
    if (!names) return;
    const agg = this.clusterAgg;
    agg.clear();
    for (const nv of this.nodes) {
      if (!nv.onGrid) continue;
      const c = nodePath(nv.node)?.[level];
      if (c == null) continue;
      let g = agg.get(c);
      if (!g) { g = { colSum: 0, rowSum: 0, n: 0 }; agg.set(c, g); }
      g.colSum += nv.col; g.rowSum += nv.row; g.n++;
    }
    if (agg.size === 0) return;

    const isFinest = level === this.levelCount - 1;
    const items = [...agg.entries()].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]);
    for (const [community, g] of items) {
      const row = Math.round(g.rowSum / g.n);
      if (row < 0 || row >= m.rows) continue;
      const text = clusterLabelText(names.get(community) ?? `cluster ${community}`);
      const len = text.length;
      // The tracked (ctx.letterSpacing) draw is wider on screen than `len` cells — reserve the REAL
      // drawn width (eyebrowWidthCells), not `len`, so a neighbouring label can never be painted
      // over by the extra sub-cell tracking gap (the "soup" bug). Reservation range and the
      // free-space check below share the exact same [col-1, col+wCells] bounds — that identity is
      // what makes overlap impossible, not just unlikely.
      const wCells = eyebrowWidthCells(len, CLUSTER_LABEL_TRACKING_EM, this.fontPx, this.cellW);
      const col0 = Math.round(g.colSum / g.n);
      let col = col0 - Math.floor(wCells / 2); // centre by DRAWN width, not raw char count
      if (col < 0) col = 0;
      if (col + wCells > m.cols) col = Math.max(0, m.cols - wCells);
      let free = true;
      for (let c = col - 1; c <= col + wCells && free; c++) {
        if (c < 0 || c >= m.cols) continue;
        if (this.labelOccupied[row * m.cols + c]) free = false;
      }
      if (!free) continue;
      for (let c = col - 1; c <= col + wCells; c++) {
        if (c >= 0 && c < m.cols) this.labelOccupied[row * m.cols + c] = 1;
      }
      const key = isFinest ? "community:" + community : `community:L${level}:${community}`;
      const color = RAMP[hashKey(key) % RAMP.length];
      this.labels.push({ text, col, row, color, accent: false, alpha, eyebrow: true, widthCells: wCells });
    }
  }

  /** LOD variant of the cluster-name pass: one eyebrow label per ON-GRID entity of `level`,
   *  centred under its mass (falling back to above it at the bottom edge). Entities come presorted
   *  largest-first from buildLodIndex, so contested cells go to the biggest community — the same
   *  greedy-by-worth rule as everywhere else. O(clusters), not O(nodes). */
  private layoutEntityNames(level: number, alpha: number) {
    const m = this.m;
    const evs = this.entityLevels[level];
    if (!evs) return;
    for (const ev of evs) {
      if (!ev.onGrid) continue;
      const text = clusterLabelText(ev.name);
      const len = text.length;
      let row = ev.row + ev.drawnRowR + 1;
      if (row >= m.rows) row = ev.row - ev.drawnRowR - 1;
      if (row < 0 || row >= m.rows) continue;
      // Reserve the REAL drawn width (tracking included), not the raw char count — see
      // layoutClusterNames' comment. Reservation and the free-space check share identical bounds.
      const wCells = eyebrowWidthCells(len, CLUSTER_LABEL_TRACKING_EM, this.fontPx, this.cellW);
      let col = ev.col - Math.floor(wCells / 2); // centre by DRAWN width, not raw char count
      if (col < 0) col = 0;
      if (col + wCells > m.cols) col = Math.max(0, m.cols - wCells);
      let free = true;
      for (let c = col - 1; c <= col + wCells && free; c++) {
        if (c < 0 || c >= m.cols) continue;
        if (this.labelOccupied[row * m.cols + c]) free = false;
      }
      if (!free) continue;
      for (let c = col - 1; c <= col + wCells; c++) {
        if (c >= 0 && c < m.cols) this.labelOccupied[row * m.cols + c] = 1;
      }
      this.labels.push({ text, col, row, color: ev.color, accent: false, alpha, eyebrow: true, widthCells: wCells });
    }
  }

  // ---- painting ------------------------------------------------------------

  /** One fillText per colour+alpha RUN per row. Runs keep the character count per call high (a
   *  13k-cell field costs a few hundred calls, not 13k) while staying exactly on the cell grid,
   *  because the advance is pinned by letterSpacing in applyFont(). */
  private paint() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (!this.boxReady) return;
    ctx.font = `${this.fontPx}px ${this.fontStack}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const m = this.m;
    let drawnNodes = 0;
    for (let r = 0; r < m.rows; r++) {
      const y = m.padY + r * m.cellH + m.cellH / 2;
      const base = r * m.cols;
      let run = "";
      let runCol = 0;
      let runColor = -1;
      let runAlpha = -1;
      const flush = () => {
        if (!run) return;
        const trimmed = run.replace(/ +$/, "");
        if (trimmed) {
          ctx.fillStyle = this.colors[runColor] ?? COLOR_FALLBACK[runColor] ?? "#888";
          ctx.globalAlpha = runAlpha / 255;
          ctx.fillText(trimmed, m.padX + runCol * m.cellW, y);
        }
        run = "";
      };
      for (let c = 0; c < m.cols; c++) {
        const i = base + c;
        const code = this.charBuf[i];
        if (!code) { if (run) run += " "; continue; }
        if (this.layerBuf[i] === LAYER_NODE) drawnNodes++;
        // Quantize alpha so near-identical cells share a run (16 buckets is invisible, and it keeps
        // a depth-faded field from degenerating into one fillText per character).
        const a = this.alphaBuf[i] & 0xf0;
        const col = this.colorBuf[i];
        if (run && (col !== runColor || a !== runAlpha)) flush();
        if (!run) { runCol = c; runColor = col; runAlpha = a; }
        run += String.fromCharCode(code);
      }
      flush();
    }

    // Labels last, each on cleared ground (the design's opaque label plate) so a name is never
    // read through the field behind it. Cluster (eyebrow) names borrow the pinned cell letterSpacing
    // for real `--ls-eyebrow` tracking, then hand it back so the next frame's field glyphs (drawn at
    // the top of THIS function, before labels) still land exactly on their cells.
    ctx.globalAlpha = 1;
    const ctxLS = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    const eyebrowLS = `${(this.fontPx * CLUSTER_LABEL_TRACKING_EM).toFixed(2)}px`;
    for (const l of this.labels) {
      if (l.alpha <= 0.01) continue; // fully crossfaded out — skip so its ground-clear box doesn't blank the field
      const x = m.padX + l.col * m.cellW;
      const y = m.padY + l.row * m.cellH;
      ctx.fillStyle = this.groundColor;
      ctx.fillRect(x - m.cellW * 0.5, y, (l.text.length + 1) * m.cellW, m.cellH);
      ctx.fillStyle = this.colors[l.color] ?? "#888";
      ctx.globalAlpha = (l.eyebrow ? 1 : l.accent ? 1 : 0.9) * l.alpha;
      if (this.letterSpacingSupported) ctxLS.letterSpacing = l.eyebrow ? eyebrowLS : this.pinnedLetterSpacing;
      ctx.fillText(l.text, x, y + m.cellH / 2);
      ctx.globalAlpha = 1;
    }
    if (this.letterSpacingSupported) ctxLS.letterSpacing = this.pinnedLetterSpacing;
    this.onPaint?.(drawnNodes);
  }

  // ---- interaction ---------------------------------------------------------

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.pressed = true; this.movedFar = false;
    this.downX = this.lastX = e.clientX; this.downY = this.lastY = e.clientY;
    this.setSelectionSuppressed(true);
  };

  private prevUserSelect: string | null = null;
  private setSelectionSuppressed(on: boolean): void {
    const body = typeof document !== "undefined" ? document.body : null;
    if (!body) return;
    if (on) {
      if (this.prevUserSelect === null) this.prevUserSelect = body.style.userSelect;
      body.style.userSelect = "none";
    } else {
      body.style.userSelect = this.prevUserSelect ?? "";
      this.prevUserSelect = null;
    }
  }

  private onPointerLeave = () => { if (this.hoveredId || this.hoverEntityIdx >= 0) this.applyHover(null, -1); this.dirty = true; };

  /** Cell under the cursor → the node that owns it (or a node within a couple of cells). */
  private pick(clientX: number, clientY: number): NodeView | null {
    if (!this.viewport) return null;
    const r = this.viewport.getBoundingClientRect();
    const { col, row } = pxToCell(clientX - r.left, clientY - r.top, this.m);
    const idx = nearestCellNode(col, row, this.m, this.cellNode, HIT_RADIUS_CELLS);
    return idx >= 0 ? this.nodes[idx] ?? null : null;
  }

  /** Cell under the cursor → the LOD entity whose mass covers it (entityFlat index, -1 none).
   *  Radius 0 extra rings: a mass is many cells wide — nothing to be fuzzy about. */
  private pickEntityIdx(clientX: number, clientY: number): number {
    if (!this.viewport || !this.lodOn) return -1;
    const r = this.viewport.getBoundingClientRect();
    const { col, row } = pxToCell(clientX - r.left, clientY - r.top, this.m);
    return nearestCellNode(col, row, this.m, this.cellEntity, 1);
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) {
      const nv = this.pick(e.clientX, e.clientY);
      this.applyHover(nv, nv ? -1 : this.pickEntityIdx(e.clientX, e.clientY));
    }
    if (!this.pressed) return;
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
    if (!this.movedFar && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > DRAG_THRESHOLD) {
      this.movedFar = true; this.dragging = true; this.userTook = true;
      this.viewport.classList.add("is-dragging");
      if (this.hoveredId || this.hoverEntityIdx >= 0) this.applyHover(null, -1);
      if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
    }
    if (!this.dragging) return;
    if (this.cfg.viewMode === "2d") { this.panX += dx; this.panY += dy; }
    else {
      this.ry += dx * ORBIT_SPEED;
      this.rx += dy * ORBIT_SPEED;
      this.rx = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.rx));
    }
    this.dirty = true;
  };

  private onPointerUp = (e: PointerEvent) => {
    const wasDrag = this.dragging || this.movedFar;
    this.pressed = false; this.dragging = false;
    this.viewport?.classList.remove("is-dragging");
    this.setSelectionSuppressed(false);
    this.dirty = true;
    if (wasDrag) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (hit) this.onNodeClick(hit.node.id);
    else {
      // Clicking an AGGREGATE ENTITY expands it: frame its members, which raises the resolution
      // into the next level of the ladder (never onNodeClick — a cluster id is not a note).
      const evIdx = this.pickEntityIdx(e.clientX, e.clientY);
      if (evIdx >= 0) { this.applyHover(null, -1); this.frameSubset(this.entityFlat[evIdx].memberIds); }
      else if (this.highlightSet) { this.clearHighlight(); this.onHighlightCleared?.(); }
    }
  };

  /** THE LAW: the wheel changes RESOLUTION, never the glyph size — and it does so in
   *  `ZOOM_STEP_PCT` STEPS, not continuously. `wheelAccum` turns however finely a trackpad/mouse
   *  slices its deltaY into discrete notches (`WHEEL_NOTCH_PX`, one per `ZOOM_STEP_PCT`): a real
   *  mouse wheel click is already ~one notch, a trackpad's finer deltas simply accumulate toward
   *  one. The field itself still reads as smooth motion — `setZoomPercent` only moves the STEP
   *  target; `tick()`'s existing per-frame glide eases `res` toward it. */
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.userTook = true;
    // CURSOR-ANCHORED (2D): each notch steps the ladder about the world point under the cursor —
    // zoomStepAnchored re-aims goalTarget so that point keeps its px through the step. An event
    // without usable coordinates (synthetic dispatch) anchors the grid centre, like keyboard zoom.
    const r = this.viewport.getBoundingClientRect();
    let ax = e.clientX - r.left, ay = e.clientY - r.top;
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
      ax = this.m.padX + (this.m.cols * this.m.cellW) / 2;
      ay = this.m.padY + (this.m.rows * this.m.cellH) / 2;
    }
    this.wheelAccum += e.deltaY;
    while (Math.abs(this.wheelAccum) >= WHEEL_NOTCH_PX) {
      // deltaY < 0 (scroll up / pinch in) is the conventional "zoom in" gesture — MORE resolution,
      // i.e. a LOWER percent under the 100%=fit/0%=deepest convention.
      const dir = this.wheelAccum < 0 ? -1 : 1;
      this.wheelAccum -= dir * WHEEL_NOTCH_PX;
      this.zoomStepAnchored(this.zoomPct + dir * ZOOM_STEP_PCT, ax, ay);
    }
  };

  /** Move the zoom ladder to the step nearest `pct` (100=fit .. 0=deepest), and re-derive `goalRes`
   *  from it against the current `maxRes` ceiling. The single place that ever assigns `zoomPct`
   *  outside of a reset, so wheel/keys/frameSubset/resetView all stay in one durable state. */
  private setZoomPercent(pct: number) {
    this.zoomPct = snapZoomPercent(pct);
    this.goalRes = resFromPercent(this.zoomPct, this.maxRes);
    this.dirty = true;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (!this.host || this.host.offsetParent === null) return;
    if (e.key === "Escape") this.resetView();
    else if (e.key === "z" || e.key === "Z") { if (this.hoveredId) this.focusNode(this.hoveredId); else this.resetView(); }
    else if (e.key === "+" || e.key === "=") { this.userTook = true; this.zoomStepCentered(this.zoomPct - ZOOM_STEP_PCT); }
    else if (e.key === "-" || e.key === "_") { this.userTook = true; this.zoomStepCentered(this.zoomPct + ZOOM_STEP_PCT); }
  };

  /** The one place hover state changes: a real node wins over an entity; either surfaces through
   *  `onHover` (an entity as a synthetic "cluster"-kind HoverNode naming the community + size). */
  private applyHover(nv: NodeView | null, evIdx: number) {
    const id = nv?.node.id ?? null;
    if (id === this.hoveredId && evIdx === this.hoverEntityIdx) return;
    this.hoveredId = id;
    this.hoverEntityIdx = evIdx;
    if (nv) this.onHover({ id: nv.node.id, label: nv.node.label, kind: nv.node.kind, folder: nv.node.folder });
    else if (evIdx >= 0) {
      const ev = this.entityFlat[evIdx];
      this.onHover({ id: `cluster:L${ev.level}:${ev.community}`, label: `${ev.name} · ${ev.count} notes`, kind: "cluster" });
    } else this.onHover(null);
    this.dirty = true;
  }

  // ---- highlight / selection ----------------------------------------------

  setActiveFile(id: string | null) {
    this.activeFile = id;
    this.alwaysOn = computeAlwaysOnSet(
      this.nodes.map((n) => n.node),
      this.edges.map((e) => ({ source: e.a.node.id, target: e.b.node.id })),
      this.activeFile, this.cfg.graphLabelHubCount ?? 10,
    );
    this.dirty = true;
  }

  setSearchMatches(ids: Set<string>) { this.searchMatches = ids; this.dirty = true; }
  highlightNodes(ids: string[]) { this.highlightSet = ids.length ? new Set(ids) : null; this.dirty = true; }
  clearHighlight() { this.highlightSet = null; this.dirty = true; }

  private focusSet(): Set<string> | null {
    if (this.hoveredId) {
      const s = new Set<string>([this.hoveredId]);
      for (const nb of this.adjacency.get(this.hoveredId) ?? []) s.add(nb);
      return s;
    }
    return this.highlightSet;
  }

  // ---- camera commands -----------------------------------------------------

  focusNode(id: string) {
    if (!this.byId.has(id)) return;
    this.frameSubset([id, ...(this.adjacency.get(id) ?? [])]);
  }

  /** Frame a subset by RAISING THE RESOLUTION until it fills the grid (and re-centring on it) —
   *  the ASCII equivalent of a dolly-in; no glyph is scaled. */
  frameSubset(ids: string[]) {
    const views = ids.map((i) => this.byId.get(i)).filter(Boolean) as NodeView[];
    if (!views.length) return;
    const is2d = this.cfg.viewMode === "2d";
    const pts = views.map((v) => (is2d ? v.p2 : v.p3));
    const c = centroid3(pts);
    let r = 1e-6;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
    const whole = Math.max(1e-6, is2d ? this.radius2 : this.radius3);
    this.goalTarget = c;
    this.goalRes = Math.max(1, Math.min(this.maxRes, (whole / r) * 0.55));
    // Framing isn't a zoom STEP — it's a continuous camera command — but resync the durable percent
    // state to wherever it landed, so the next wheel notch / +- press steps from there.
    this.zoomPct = resolutionPercent(this.goalRes, this.maxRes);
    this.userTook = true;
    this.dirty = true;
  }

  resetView() {
    this.clearHighlight();
    this.zoomPct = 100;
    this.goalRes = 1;
    this.goalTarget = [0, 0, 0];
    this.panX = 0; this.panY = 0;
    this.userTook = false;
    this.dirty = true;
  }

  // ---- UI data accessors ---------------------------------------------------

  getNodesForUI(): NodeForUI[] {
    return this.nodes.filter((n) => n.node.kind !== "self").map((n) => ({
      id: n.node.id, label: n.node.label, folder: n.node.folder,
      community: n.node.community, communityLabel: n.node.communityLabel,
    }));
  }

  getCommunityCentroids(): Map<number, CommunityCentroid> {
    const groups = new Map<number, NodeView[]>();
    for (const nv of this.nodes) {
      const c = nv.node.community;
      if (c == null) continue;
      let arr = groups.get(c);
      if (!arr) { arr = []; groups.set(c, arr); }
      arr.push(nv);
    }
    const out = new Map<number, CommunityCentroid>();
    for (const [c, members] of groups) {
      if (members.length < 2) continue;
      out.set(c, {
        label: members[0].node.communityLabel ?? `Cluster ${c}`,
        ids: members.map((mm) => mm.node.id),
        color: this.colors[members[0].color] ?? COLOR_FALLBACK[members[0].color] ?? "#888",
        centroid: centroid3(members.map((mm) => mm.p3)),
        count: members.length,
      });
    }
    return out;
  }

  // ---- QA / debug instrumentation ------------------------------------------

  /**
   * A numeric snapshot of the CURRENT frame, for QA to assert against directly instead of
   * eyeballing a screenshot (see `AsciiGraphStats`). The per-frame counts (`entitiesDrawnFrame` etc.)
   * are already tracked for free inside rasterize()'s existing passes; only `inkCoverage` (a
   * bounding-box sweep over `charBuf`) and `labelOverlaps`/`maxLabelChars` (an O(labels²) pass over
   * the — at most a few dozen — labels drawn this frame) do any extra work, and both are deferred to
   * HERE (called on demand, e.g. from `window.__asciiGraphStats()`) rather than every rasterize().
   */
  computeStats(): AsciiGraphStats {
    const cols = this.m.cols, rows = this.m.rows;
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      for (let c = 0; c < cols; c++) {
        if (this.charBuf[base + c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    const inkCoverage = Number.isFinite(minR)
      ? ((maxR - minR + 1) * (maxC - minC + 1)) / Math.max(1, cols * rows)
      : 0;

    let maxLabelChars = 0;
    const byRow = new Map<number, { col: number; w: number }[]>();
    for (const l of this.labels) {
      if (l.text.length > maxLabelChars) maxLabelChars = l.text.length;
      let arr = byRow.get(l.row);
      if (!arr) { arr = []; byRow.set(l.row, arr); }
      arr.push({ col: l.col, w: l.widthCells });
    }
    let labelOverlaps = 0;
    for (const arr of byRow.values()) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          if (a.col <= b.col + b.w && b.col <= a.col + a.w) labelOverlaps++;
        }
      }
    }

    return {
      zoomPct: this.lastZoomPct,
      entitiesDrawn: this.entitiesDrawnFrame,
      labelsDrawn: this.labels.length,
      labelOverlaps,
      maxLabelChars,
      notesOnScreen: this.notesOnScreenFrame,
      edgesDrawn: this.edgesDrawnFrame,
      inkCoverage,
    };
  }
}

function centroid3(ps: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of ps) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  const n = Math.max(1, ps.length);
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** Char codes for the static noise texture. Deterministic per grid size, so it never shimmers. */
function buildNoise(cols: number, rows: number): Uint16Array {
  const text = noiseField(cols, rows, NOISE_DENSITY, DEFAULT_NOISE_SEED);
  const out = new Uint16Array(cols * rows);
  const lines = text.split("\n");
  for (let r = 0; r < rows; r++) {
    const line = lines[r] ?? "";
    for (let c = 0; c < cols; c++) {
      const ch = line.charCodeAt(c);
      out[r * cols + c] = Number.isNaN(ch) || ch === 32 ? 0 : ch;
    }
  }
  return out;
}
