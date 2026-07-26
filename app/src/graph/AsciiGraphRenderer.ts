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
//   the world-units-per-cell ratio — 0% fits the whole graph on the grid, 100% is maximum
//   resolution with every note named. No transform: scale, no ctx.scale on glyphs; a wheel event
//   re-rasterizes the field at a finer world→cell mapping.
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
import { computeAlwaysOnSet } from "./labelSelection";
import { hashKey } from "../themeColors";
import { isUsableBox, finiteVec3, boundingRadius } from "./graphFit";
import { structuralGraphSig, shouldResetView } from "./graphStability";
import { noiseField, DEFAULT_NOISE_SEED } from "../ui/ascii/noiseField";
import type { CommunityCentroid, GraphConfig, GraphRenderer, HoverNode, NodeForUI, Vec3 } from "./graphRenderer";
import {
  CELL_H, CELL_H_DENSE, CELL_W, CELL_W_DENSE, FONT_PX, FONT_PX_DENSE,
  LAYER_EDGE, LAYER_NODE, LAYER_NOISE, PAD_X, PAD_Y,
  depthAlpha, fitPxPerWorld, gridMetrics, mergeEdgeCode, nearestCellNode, nodeGlyph,
  pxToCell, resolutionPercent, traceEdge, type GridMetrics,
} from "./asciiGrid";

const FOV_DEG = 60;              // same camera as the old renderer, so framing carries over
const ORBIT_SPEED = 0.005;       // rad per px of drag (copied)
const DRAG_THRESHOLD = 5;        // px before a press becomes an orbit/pan rather than a click
const GLIDE = 0.18;              // per-frame easing toward the camera goal
const MAX_RES = 16;              // 100% zoom = 16x the fit resolution
const RES_EPS = 0.002;           // below this the resolution glide is considered settled
const NOISE_DENSITY = 0.08;      // texture, never the signal (the design card defaults GLYPHS to 0%)
const NOISE_ALPHA = 0.45;        // tokens/ascii.css --field-noise-op
const DEPTH_BANDS = 3;           // "." far / "o" mid / "@" near — the ramp shift, not a font change
const DIM_ALPHA = 0.28;          // non-focus dimming on hover / cluster highlight
const EDGE_ALPHA_2D = 0.7;
const EDGE_BUDGET = 2600;        // dense-graph edge thinning (stable per-edge rank, like the old renderer)
const EDGE_FLOOR = 0.12;
const LABEL_MIN = 6;             // labels shown at 0% zoom (the curated hub set)
const HIT_RADIUS_CELLS = 2;      // cells searched outward from the cursor for a node

// Colour slots. Every colour is a CSS custom property read off the host, so a theme switch is a
// re-read (the old renderer took ints through setConfig; here the tokens ARE the source).
const C_G0 = 0, C_G1 = 1, C_G2 = 2, C_G3 = 3, C_G4 = 4;
const C_FG = 5, C_MUTED = 6, C_FAINT = 7, C_ACCENT = 8;
const COLOR_VARS = ["--graph-0", "--graph-1", "--graph-2", "--graph-3", "--graph-4", "--fg", "--text-muted", "--faint", "--accent"];
const COLOR_FALLBACK = ["#f0509b", "#9b53e8", "#3f6bf0", "#27c7d9", "#43d49a", "#e8e8ee", "#9aa0b4", "#6b7086", "#3f6bf0"];
const RAMP = [C_G0, C_G1, C_G2, C_G3, C_G4];

const DEFAULT_CONFIG: Partial<GraphConfig> = {
  viewMode: "3d", showGraphLabels: true, graphLabelHubCount: 10, spin: true, spinSpeed: 0.0015,
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
interface LabelDraw { text: string; col: number; row: number; color: number; accent: boolean }

/** Wikilink/tag flavouring so a label reads like the vault does (design's `[[note name]]`). */
function labelText(n: GraphNode): string {
  if (n.kind === "tag") return "#" + n.label;
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
  private dense = false;

  // graph data
  private nodes: NodeView[] = [];
  private byId = new Map<string, NodeView>();
  private edges: EdgeView[] = [];
  private adjacency = new Map<string, Set<string>>();
  private sig = "";
  private radius3 = 1; private radius2 = 1;

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
  private boxReady = false;

  // camera — rx/ry orbit (3D), res = THE zoom (resolution), pan in px (2D)
  private rx = -0.5; private ry = 0;
  private res = 1; private goalRes = 1;
  private target: Vec3 = [0, 0, 0]; private goalTarget: Vec3 = [0, 0, 0];
  private panX = 0; private panY = 0;
  private pxPerWorld = 1; private P = 1;
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
    this.host?.replaceChildren();
    this.nodes = []; this.edges = []; this.byId.clear();
  }

  setFpsCallback(cb: (fps: number) => void) { this.onFps = cb; }
  setPaintCallback(cb: (nodeCount: number) => void) { this.onPaint = cb; }
  setZoomCallback(cb: (pct: number) => void) { this.onZoom = cb; }
  setVisible(visible: boolean) { this.visible = visible; if (visible) { this.dirty = true; this.start(); } else this.stop(); }

  /** The sidebar mini-graph draws on the DENSE 7px cell (tokens/ascii.css --cell-*-dense). */
  setDense(dense: boolean) {
    if (dense === this.dense) return;
    this.dense = dense;
    this.cellW = dense ? CELL_W_DENSE : CELL_W;
    this.cellH = dense ? CELL_H_DENSE : CELL_H;
    this.fontPx = dense ? FONT_PX_DENSE : FONT_PX;
    this.measure();
    this.fit();
  }

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

    this.edges = [];
    for (const e of g.edges) {
      const a = this.byId.get(e.from), b = this.byId.get(e.to);
      if (a && b) this.edges.push({ a, b, kr: (hashKey(e.from + "\0" + e.to) % 1000) / 1000 });
    }

    this.radius3 = boundingRadius(this.nodes.map((nv) => nv.p3));
    this.radius2 = boundingRadius(this.nodes.map((nv) => nv.p2));
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
    this.restyle();
    // 2D and 3D fit different layouts (radius2 vs radius3), so a dimension flip re-fits — and
    // returns the field to 0% so the flipped view opens on the whole graph, not a stale crop.
    if (cfg.viewMode !== prevMode) {
      this.rx = -0.5; this.ry = 0;
      this.panX = 0; this.panY = 0;
      this.res = 1; this.goalRes = 1;
      this.target = [0, 0, 0]; this.goalTarget = [0, 0, 0];
      this.userTook = false;
      this.fit();
    }
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
    const want = this.dense ? CELL_W_DENSE : CELL_W;
    const supported = typeof ls.letterSpacing === "string";
    if (supported) ls.letterSpacing = "0px";
    const natural = ctx.measureText("0".repeat(64)).width / 64;
    if (supported && natural > 0) {
      ls.letterSpacing = `${(want - natural).toFixed(4)}px`;
      this.cellW = want;
    } else {
      this.cellW = natural > 0 ? natural : want;
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
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
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
      this.labelOccupied = new Uint8Array(cells);
      this.noiseBuf = buildNoise(m.cols, m.rows);
    }
    this.m = m;
    // Perspective focal length — the old renderer's (H/2)/tan(FOV/2), against the grid's own box.
    this.P = ((m.rows * m.cellH) / 2) / Math.tan((FOV_DEG * Math.PI) / 360);
    this.dirty = true;
  }

  /** Recompute the world→px fit ("res = 1 fits the whole graph on the grid"). */
  private fit(resetCamera = false) {
    if (!this.boxReady) return;
    const is2d = this.cfg.viewMode === "2d";
    const radius = Math.max(1e-6, is2d ? this.radius2 : this.radius3);
    this.pxPerWorld = fitPxPerWorld(this.m.cols, this.m.rows, this.m, radius);
    if (resetCamera) {
      this.res = 1; this.goalRes = 1;
      this.target = [0, 0, 0]; this.goalTarget = [0, 0, 0];
      this.panX = 0; this.panY = 0; this.userTook = false;
      this.rx = -0.5; this.ry = 0;
    }
    this.dirty = true;
  }

  // ---- render loop ---------------------------------------------------------

  private start() { if (this.running || !this.visible || !this.host) return; this.running = true; this.raf = requestAnimationFrame(this.tick); }
  private stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  private tick = (t: number) => {
    if (!this.running) return;
    if (this.lastFrameT) {
      this.fpsAccum += t - this.lastFrameT; this.fpsFrames++;
      if (this.fpsAccum >= 500) { this.onFps?.(Math.round((this.fpsFrames * 1000) / this.fpsAccum)); this.fpsAccum = 0; this.fpsFrames = 0; }
    }
    this.lastFrameT = t;

    const is2d = this.cfg.viewMode === "2d";
    if (!is2d && this.cfg.spin && this.nodes.length <= 350 && !this.userTook && !this.dragging) {
      this.ry += this.cfg.spinSpeed ?? 0.0015; this.dirty = true;
    }
    // Smooth-glide the world-per-cell ratio (the old renderer's goalZoom glide, in resolution space).
    if (Math.abs(this.goalRes - this.res) > RES_EPS) { this.res += (this.goalRes - this.res) * GLIDE; this.dirty = true; }
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
    const pct = resolutionPercent(this.res, MAX_RES);
    if (pct !== this.lastZoomPct) { this.lastZoomPct = pct; this.onZoom?.(pct); }
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

  /** Project every node onto the grid, then draw the four layers into the cell buffers. */
  private rasterize(is2d: boolean) {
    const m = this.m;
    const cells = m.cols * m.rows;
    const noiseA = Math.round(NOISE_ALPHA * 255);
    // Layer 1 — the noise field. Static per grid size + seed, laid down first so edges and nodes
    // can CLEAR it (writing a higher layer over the same cell).
    for (let i = 0; i < cells; i++) {
      const ch = this.noiseBuf[i];
      this.charBuf[i] = ch;
      this.layerBuf[i] = ch ? LAYER_NOISE : 0;
      this.colorBuf[i] = C_FAINT;
      this.alphaBuf[i] = noiseA;
      this.cellNode[i] = -1;
    }

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
      this.edgeColor = incident ? C_ACCENT : C_MUTED;
      this.edgeAlpha = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
      traceEdge(a.col, a.row, b.col, b.row, this.putEdge);
    }

    // Layer 3 — nodes. Weight is the glyph (degree ramp, shifted by depth band in 3D), colour is
    // the cluster; the hovered / active node takes the accent.
    for (let i = 0; i < this.nodes.length; i++) {
      const nv = this.nodes[i];
      if (!nv.onGrid) continue;
      const idx = nv.row * m.cols + nv.col;
      const id = nv.node.id;
      const hot = id === this.hoveredId || id === this.activeFile || this.searchMatches.has(id);
      let alpha = is2d ? 1 : depthAlpha(nv.dr);
      if (focus && !focus.has(id)) alpha *= DIM_ALPHA;
      if (nv.dim) alpha *= 0.45;
      if (hot) alpha = 1;
      const glyph = nv.node.kind === "self" ? "@" : nodeGlyph(nv.deg, nv.dr, !is2d, DEPTH_BANDS);
      this.charBuf[idx] = glyph.charCodeAt(0);
      this.layerBuf[idx] = LAYER_NODE;
      this.colorBuf[idx] = hot ? C_ACCENT : nv.color;
      this.alphaBuf[idx] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
      this.cellNode[idx] = i;
    }

    this.layoutLabels(is2d);
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

  /** Which labels to draw, and where. Labels sit to the node's right on the SAME grid; a label that
   *  would run off the field flips to the node's left, and one whose cells are already taken by a
   *  neighbour's label is dropped (unless it's forced — active/hovered/search). The budget grows
   *  with resolution: 0% keeps the curated hub set, 100% names every node on the grid. */
  private layoutLabels(is2d: boolean) {
    this.labels.length = 0;
    if (this.cfg.showGraphLabels === false) return;
    const m = this.m;
    this.labelOccupied.fill(0);
    // Reused scratch array — layoutLabels runs every frame, so it must not allocate one per frame.
    const ordered = this.labelScratch;
    ordered.length = 0;
    for (const nv of this.nodes) if (nv.onGrid) ordered.push(nv);
    const t = MAX_RES > 1 ? Math.log(Math.max(1, this.res)) / Math.log(MAX_RES) : 0;
    const budget = Math.round(LABEL_MIN + Math.max(0, Math.min(1, t)) * ordered.length);

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
      this.labels.push({ text, col, row, color: accent ? C_ACCENT : is2d ? C_MUTED : nv.dr > 0.55 ? C_MUTED : C_FAINT, accent });
      drawn++;
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
    // read through the field behind it.
    ctx.globalAlpha = 1;
    for (const l of this.labels) {
      const x = m.padX + l.col * m.cellW;
      const y = m.padY + l.row * m.cellH;
      ctx.fillStyle = this.groundColor;
      ctx.fillRect(x - m.cellW * 0.5, y, (l.text.length + 1) * m.cellW, m.cellH);
      ctx.fillStyle = this.colors[l.color] ?? "#888";
      ctx.globalAlpha = l.accent ? 1 : 0.9;
      ctx.fillText(l.text, x, y + m.cellH / 2);
      ctx.globalAlpha = 1;
    }
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

  private onPointerLeave = () => { if (this.hoveredId) this.setHover(null); this.dirty = true; };

  /** Cell under the cursor → the node that owns it (or a node within a couple of cells). */
  private pick(clientX: number, clientY: number): NodeView | null {
    if (!this.viewport) return null;
    const r = this.viewport.getBoundingClientRect();
    const { col, row } = pxToCell(clientX - r.left, clientY - r.top, this.m);
    const idx = nearestCellNode(col, row, this.m, this.cellNode, HIT_RADIUS_CELLS);
    return idx >= 0 ? this.nodes[idx] ?? null : null;
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) this.setHover(this.pick(e.clientX, e.clientY)?.node.id ?? null);
    if (!this.pressed) return;
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
    if (!this.movedFar && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > DRAG_THRESHOLD) {
      this.movedFar = true; this.dragging = true; this.userTook = true;
      this.viewport.classList.add("is-dragging");
      if (this.hoveredId) this.setHover(null);
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
    else if (this.highlightSet) { this.clearHighlight(); this.onHighlightCleared?.(); }
  };

  /** THE LAW: the wheel changes RESOLUTION, never the glyph size. The field re-rasterizes at a
   *  finer world→cell mapping; the cell stays exactly as big as it was. */
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.userTook = true;
    this.goalRes = Math.max(1, Math.min(MAX_RES, this.goalRes * Math.exp(-e.deltaY * 0.0016)));
    this.dirty = true;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (!this.host || this.host.offsetParent === null) return;
    if (e.key === "Escape") this.resetView();
    else if (e.key === "z" || e.key === "Z") { if (this.hoveredId) this.focusNode(this.hoveredId); else this.resetView(); }
  };

  private setHover(id: string | null) {
    if (id === this.hoveredId) return;
    const nv = id ? this.byId.get(id) : undefined;
    this.onHover(nv ? { id: nv.node.id, label: nv.node.label, kind: nv.node.kind, folder: nv.node.folder } : null);
    this.hoveredId = id;
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
    this.goalRes = Math.max(1, Math.min(MAX_RES, (whole / r) * 0.55));
    this.userTook = true;
    this.dirty = true;
  }

  resetView() {
    this.clearHighlight();
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
