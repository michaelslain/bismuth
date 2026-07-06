// app/src/graph/CanvasGraphRenderer.ts
//
// The knowledge-graph renderer. It does the 3D camera math (orbit + zoom + perspective) by hand in
// JS and rasterizes the whole graph — nodes, edges, and labels — onto a single 2D <canvas>. NOT
// WebGL/GPU and NOT CSS/DOM nodes: a plain Canvas-2D context. One draw pass scales to thousands of
// nodes + edges, and Canvas-2D gives crisp text labels for free (which WebGL would not).
//
// 3D coords come off the backend layout (`node.position` / `position2d`), de-cluttered once by a
// d3-force settle. Each frame the camera projects every node to a screen pixel + depth; near nodes
// are bigger and opaque, far nodes smaller and faded (the depth cue). 2D mode uses the flat
// `position2d` layout; the 2D<->3D toggle interpolates (morphs) between the two coordinate sets.

import "./graphCanvas.css";
import type { GraphData, GraphNode, NodeKind } from "../../../core/src/graph";

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
  transparent?: boolean;
}

/** The node currently under the cursor, surfaced to GraphView for the hover readout. */
export interface HoverNode {
  id: string;
  label: string;
  kind: NodeKind;
  folder?: string;
}
import { nodeVisualState } from "../../../core/src/daemonViz";
import { computeAlwaysOnSet } from "./labelSelection";
import { hashKey, intToHex } from "../themeColors";

const FOV_DEG = 60; // matches the old PerspectiveCamera so framing carries over
const FIT_FRACTION = 0.42; // graph's resting on-screen radius as a fraction of min(W,H)
const DRAG_THRESHOLD = 5; // px of motion before a press becomes an orbit/pan (vs. a click)
const GLIDE = 0.16; // per-frame easing toward the camera goal (focus/frame fly-to)
const MODE_MORPH_MS = 500; // 2D<->3D flatten/expand glide
const ORBIT_SPEED = 0.005; // rad per px of drag

// --- scale tuning (easy to nudge) ---
const LINK_SPREAD = 6;        // CONSTANT link-distance multiplier — does NOT change with node count
const SPIN_MAX_NODES = 350;   // idle-spin only for graphs this small
const NODE_SIZE_SCALE = 0.5;  // overall node-size multiplier (tuning knob; lower = smaller dots)
const NODE_LEAF_FRAC = 0.2;   // node diameter as a fraction of on-screen link spacing (a 0-degree leaf)
const NODE_DEG_GAIN = 0.10;   // extra diameter fraction per sqrt(degree) — degree is read clearly in size
const NODE_MAX_FRAC = 0.6;    // cap: a hub never exceeds ~0.6 of the spacing
const SELF_FRAC = 0.5;        // the "you" hub's diameter as a fraction of spacing
const MIN_DOT_PX = 1.6;       // below this projected diameter a node is hidden
const MAX_DOT_PX = 60;        // cap the resting diameter so tiny graphs (1 "you" node) don't blow up
// Breathing room kept clear around the "you" hub (see clearAroundSelf). The RADIUS is a
// world-space quantity — expressed as a fraction of the fitted graph radius and projected
// through the hub's own perspective scale — so the cleared region zooms WITH the graph like any
// other world geometry (a fixed screen-px ring warped neighbours differently at every zoom
// level, reading as the hub's space "growing and shrinking on zoom"). The nodes' DRAWN radii
// are still added in screen px as a pure anti-overlap floor, so a big-drawn dot in a sparse,
// zoomed-in graph can never graze the hub's circle. This is the ONLY clear-zone pass.
const SELF_CLEAR_FRAC = 0.05;
// Zoom-in label discovery: once a node's projected dot grows past this many px (i.e. the user
// has zoomed in toward it), reveal its filename label so zooming in progressively surfaces names.
const LABEL_REVEAL_DOT_PX = 18;
const DEPTH_MIN_OPACITY = 0.04; // farthest node's opacity (strong depth cue)
const DEPTH_CURVE = 2.4;      // >1 = back fades faster (stronger depth cue)
const BACK_INTERACT_CUTOFF = 0.18; // 3D nodes whose depth rank is below this aren't hover/click targets
const GOLDEN_ANGLE_RAD = 2.39996323; // golden angle (rad) → even angular distribution for coincident/origin nodes
// Dense-graph edge thinning is per-mode: 2D thins hard (flat view clutters fast), 3D keeps more
// (depth fade already declutters). Each edge has a stable rank; we draw it if rank < the mode's frac.
const EDGE_BUDGET_2D = 600; const EDGE_FLOOR_2D = 0.06;   // aggressive
const EDGE_BUDGET_3D = 2200; const EDGE_FLOOR_3D = 0.45;  // gentle

const DEFAULT_PALETTE = [0xf0509b, 0x9b53e8, 0x3f6bf0, 0x27c7d9, 0x43d49a, 0xf2c53d];

const DEFAULT_CONFIG: GraphConfig = {
  spin: true, spinSpeed: 0.0015, palette: DEFAULT_PALETTE, repulsion: -10, linkDistance: 5,
  centering: 0.13, nodeSize: 6, viewMode: "3d", showGraphLabels: true, graphLabelHubCount: 10,
  nodeSizeMinMult: 0.4, nodeSizeDegreeGain: 0.45, nodeSizeMaxMult: 6, edgeColor: 0xaeb4c2,
  edgeOpacity: 0.32, backgroundColor: 0x14151b, labelTextColor: "rgba(232,232,238,0.95)",
  labelBgColor: "rgba(14,14,17,0.6)", selfColor: 0xffffff, daemonAccent: 0x3f6bf0,
  daemonNeutral: 0xaeb4c2, daemonFg: 0xffffff,
};

type Vec3 = [number, number, number];

interface NodeView {
  node: GraphNode;
  p3: Vec3; // centered world coords (3D layout, Y flipped to screen-up)
  p2: Vec3; // centered world coords (flat 2D layout, z=0)
  colorInt: number; colorHex: string;
  deg: number; // undirected degree (drives node size)
  scale: number; // degree-based collision multiplier (for the settle)
  baseDiameter: number; // resting (pre-perspective) diameter — cached per fit(), see computeBaseDiameters
  sx: number; sy: number; depth: number; pscale: number; onScreen: boolean; // per-frame scratch
  dr: number; // per-frame depth rank (0 far..1 near), precomputed once in projectPositions — see depthRank()
  lastZi: number; lastDotSize: number; shown: boolean;
  labelW: number; // cached ctx.measureText(text).width for this node's label; -1 = needs (re)measuring
}
interface EdgeView { a: NodeView; b: NodeView; kr: number; } // kr = stable 0..1 rank for per-mode thinning

// The backend layout (core/layout.ts) settles at linkDistance × smallBoost (smallBoost = 400/n clamped
// 1..8, and ×1.8 in 2D). This renderer draws node sizes tuned for a WIDER, node-count-independent
// spacing of linkDistance × LINK_SPREAD (×1.4 in 2D) — which is why it used to re-run a force sim to
// re-spread the backend coords. These mirror those backend constants so we can reproduce that spread
// with a plain uniform scale instead of a sim.
const BACKEND_SMALL_BOOST = (n: number) => Math.min(8, Math.max(1, 400 / n));
const BACKEND_2D_SPACING = 1.8;
const RENDERER_2D_SPACING = 1.4;

/** Reposition nodes from the backend's precomputed layout WITHOUT a force sim — the slow part of a
 *  mode switch (~1.2s at 2k nodes). The backend layout is already fully settled (PivotMDS + 120 force
 *  ticks); it's just spaced tighter than this renderer draws, so we scale it by the ratio of the two
 *  spacing models (reproducing the spread the old client re-settle produced) in O(n).
 *
 *  Centering matters: scaling multiplies every node's distance from the scaling origin, so we scale
 *  about the CONTENT centroid (excluding the injected "you" hub, which sits at the backend origin and
 *  would bias it) and pin "you" there. Otherwise any offset between the origin and the cloud's real
 *  center of mass is amplified ~scale×, flinging the cloud off-center — most visible in 3rd-brain,
 *  where "you" isn't linked to the memory nodes and sits far from their centroid. Mutates p3/p2 in
 *  place and returns a snapshot for the per-signature cache. */
function scaleToSpacing(nodes: NodeView[], dim: 2 | 3): Map<string, Vec3> {
  const smallBoost = BACKEND_SMALL_BOOST(Math.max(1, nodes.length));
  const scale = dim === 3
    ? LINK_SPREAD / smallBoost
    : (LINK_SPREAD * RENDERER_2D_SPACING) / (smallBoost * BACKEND_2D_SPACING);
  let cx = 0, cy = 0, cz = 0, cnt = 0;
  for (const nv of nodes) {
    if (nv.node.kind === "self") continue; // "you" sits at origin; don't let it bias the centroid
    const p = dim === 3 ? nv.p3 : nv.p2;
    cx += p[0]; cy += p[1]; cz += dim === 3 ? p[2] : 0; cnt++;
  }
  if (cnt) { cx /= cnt; cy /= cnt; cz /= cnt; }
  // "you" is pinned at the origin (the cloud's center). The clear zone around the hub is NOT carved
  // here in world space — it's the SINGLE source of truth of the per-frame screen-space pass
  // (clearAroundSelf), which knows each dot's ACTUAL drawn radius and so holds a fixed-px gap at any
  // zoom. A world-space pre-spread can't: it projects through worldScale × perspective(zoom), so it
  // grows/shrinks with zoom and reads as a hard ring. This pass therefore only does the uniform
  // centroid-scale; the lone special case is a node that maps EXACTLY onto the origin (a zero vector
  // has no radial direction for clearAroundSelf to push it out along), which gets a tiny
  // deterministic golden-angle nudge so the screen-space fan-out has a distinct bearing per node. O(n).
  const store = new Map<string, Vec3>();
  let originIdx = 0; // distinct bearing for any node that lands EXACTLY on the origin (see below)
  for (const nv of nodes) {
    let np: Vec3;
    if (nv.node.kind === "self") {
      np = [0, 0, 0]; // pin "you" at the cloud's center so the layout stays balanced around it
    } else {
      const p = dim === 3 ? nv.p3 : nv.p2;
      np = [(p[0] - cx) * scale, (p[1] - cy) * scale, dim === 3 ? (p[2] - cz) * scale : 0];
      const r = Math.hypot(np[0], np[1], dim === 3 ? np[2] : 0);
      if (r === 0) {
        // The node maps exactly onto the origin where "you" sits — e.g. the sole neighbour in a
        // self+1 graph, whose self-excluded centroid IS its own position. A zero vector has no
        // direction for clearAroundSelf to push along, so apply a tiny epsilon offset on a
        // golden-angle bearing (distinct per coincident node) — just enough to give each a unique
        // direction, NOT a fixed clearance radius. The screen-space pass then fans them out so they
        // don't stack on the hub, with a gap that's constant in px at any zoom.
        const a = originIdx++ * GOLDEN_ANGLE_RAD;
        // Offset by one `scale` unit — the same per-edge spacing the whole layout uses — so a
        // degenerate graph (e.g. self+1, whose only neighbour lands exactly on the centroid) frames
        // like a normal one-hop graph instead of collapsing onto the fit floor as a tiny dot. This
        // is NOT the old fixed clearance ring: it touches ONLY nodes landing EXACTLY on the origin
        // (near-origin nodes keep their scaled positions), so it never re-creates the zoom-scaling ring.
        const eps = scale;
        np = [eps * Math.cos(a), eps * Math.sin(a), 0];
      }
    }
    if (dim === 3) nv.p3 = np; else nv.p2 = np;
    store.set(nv.node.id, np);
  }
  return store;
}

function easeInOutCubic(t: number): number { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function lerpInt(a: number, b: number, t: number): number {
  const ch = (sh: number) => { const av = (a >> sh) & 0xff, bv = (b >> sh) & 0xff; return Math.round(av + (bv - av) * t) & 0xff; };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export class CanvasGraphRenderer {
  private host?: HTMLElement;
  private viewport!: HTMLDivElement;
  private edgeCanvas!: HTMLCanvasElement;
  private edgeCtx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private ro?: ResizeObserver;

  private cfg: GraphConfig = { ...DEFAULT_CONFIG };
  private nodes: NodeView[] = [];
  private byId = new Map<string, NodeView>();
  private edges: EdgeView[] = [];
  private drawOrder: NodeView[] = []; // persistent scratch for the depth-sorted draw order (avoids a per-frame filter() alloc)
  private edgeBands: EdgeView[][] = [[], [], [], [], [], []]; // persistent scratch: 3D no-hover depth-band buckets (size = BANDS)
  private selfNode: NodeView | null = null; // cached "you" node — this.nodes only changes in build()
  private adjacency = new Map<string, Set<string>>();
  private sig = "";
  private colorSig = ""; // gate node recolouring so mode toggles don't rewrite 2k colours
  private p3Cache = new Map<string, Map<string, Vec3>>(); // settled 3D positions per graph signature
  private p2Cache = new Map<string, Map<string, Vec3>>(); // settled 2D positions per graph signature
  private radius3 = 1; private radius2 = 1; // layout extent per view
  private scale3 = 1; private scale2 = 1;   // world-units -> px fit per view
  private fitPx = 1;                          // on-screen fit radius (px); node size derives from DENSITY, not layout scale
  private glowCentroids: Vec3[] = [];        // cached top-3 community centroids (glow lobes)
  private minZ = 0; private maxZ = 1;        // last frame's projected depth range

  // viewport geometry
  private W = 1; private H = 1; private cx = 0.5; private cy = 0.5; private P = 1; private worldScale = 1;
  private fitMargin = 1; private viewOffsetY = 0; // extra fit zoom-out + vertical offset (used by the intro graph)

  // camera: orbit (rx/ry) + zoom (translateZ px, >0 = toward viewer) + pan + look-at target (centered world units)
  private rx = -0.5; private ry = 0; private zoom = 0; private panX = 0; private panY = 0;
  private target: Vec3 = [0, 0, 0];
  private goalZoom = 0; private goalTarget: Vec3 = [0, 0, 0]; private goalPanX = 0; private goalPanY = 0;

  // 2D<->3D morph (0 = full 3D, 1 = full 2D)
  private morph = 0;
  private morphAnim: { from: number; to: number; start: number } | null = null;
  private settled2D = false; // the 2D layout is force-settled lazily on first switch to 2D

  // interaction
  private pressed = false; private dragging = false; private movedFar = false;
  private lastX = 0; private lastY = 0; private downX = 0; private downY = 0;
  private userTook = false; // user grabbed the camera -> stop idle spin until reset

  // selection / highlight
  private activeFile: string | null = null;
  private hoveredId: string | null = null;
  private searchMatches = new Set<string>();
  private highlightSet: Set<string> | null = null;
  private alwaysOn = new Set<string>();

  // callbacks
  private onNodeClick: (id: string) => void = () => {};
  private onHover: (n: HoverNode | null) => void = () => {};
  private onFps?: (fps: number) => void;
  private onGlow?: (g: { lobes: { x: number; y: number }[] }) => void;
  /** Fired when an empty-space click clears a persistent highlight — lets the view (e.g. the
   *  cluster legend's selected row) drop its own selection state in sync. */
  onHighlightCleared?: () => void;

  // loop
  private raf = 0; private running = false; private visible = true; private dirty = true;
  private lastFrameT = 0; private fpsAccum = 0; private fpsFrames = 0; private nowMs = 0;

  // label fonts (hoisted so the label loop doesn't rebuild the font string every label every frame)
  private readonly FONT_SELF = "700 14px ui-sans-serif, system-ui, -apple-system, sans-serif";
  private readonly FONT_NODE = "500 11px ui-sans-serif, system-ui, -apple-system, sans-serif";

  // ---- lifecycle -----------------------------------------------------------

  mount(el: HTMLElement, onNodeClick: (id: string) => void, onHover?: (n: HoverNode | null) => void, _labelOverlay?: HTMLElement) {
    this.host = el;
    this.onNodeClick = onNodeClick;
    if (onHover) this.onHover = onHover;

    this.viewport = document.createElement("div");
    this.viewport.className = "graph-viewport";
    this.edgeCanvas = document.createElement("canvas");
    this.edgeCanvas.className = "graph-edges";
    this.edgeCtx = this.edgeCanvas.getContext("2d");
    this.viewport.append(this.edgeCanvas);
    el.appendChild(this.viewport);

    this.applyHostVars();
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
    this.setSelectionSuppressed(false); // never leave the page unselectable if torn down mid-drag
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
  setGlowCallback(cb: (g: { lobes: { x: number; y: number }[] }) => void) { this.onGlow = cb; }
  setVisible(visible: boolean) { this.visible = visible; if (visible) { this.dirty = true; this.start(); } else this.stop(); }
  /** Zoom the resting fit out by this factor (>1 = smaller graph). Used by the intro graph. */
  setFitMargin(m: number) { this.fitMargin = Math.max(0.2, m); this.fit(); }
  /** Shift the whole view down by this fraction of the viewport height. Used by the intro graph. */
  setFrameOffsetY(frac: number) { this.viewOffsetY = frac; this.dirty = true; }

  // ---- data ----------------------------------------------------------------

  render(g: GraphData) {
    if (!this.host) return;
    const nextSig = this.signature(g);
    if (nextSig === this.sig && this.nodes.length) { this.restyle(); return; }
    this.sig = nextSig;
    this.build(g);
  }

  private signature(g: GraphData): string {
    let h = 0;
    for (const e of g.edges) {
      let x = 2166136261; const s = e.from + "\0" + e.to;
      for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
      h = (h + (x >>> 0)) >>> 0;
    }
    // Fold node positions into the signature too. The renderer now uses the backend layout directly
    // (no client re-settle), so a positions-ONLY change — most importantly the 2nd/3rd-brain VIEW
    // layout arriving async after the structure (same nodes + edges, new coords) — must trigger a
    // rebuild, or the view would keep the stale fallback positions. O(n), only on graph updates.
    let ph = 2166136261;
    for (const n of g.nodes) {
      const p = n.position, q = n.position2d;
      ph = Math.imul(ph ^ (p ? p[0] | 0 : 0), 16777619);
      ph = Math.imul(ph ^ (p ? p[1] | 0 : 0), 16777619);
      ph = Math.imul(ph ^ (p ? p[2] | 0 : 0), 16777619);
      ph = Math.imul(ph ^ (q ? q[0] | 0 : 0), 16777619);
      ph = Math.imul(ph ^ (q ? q[1] | 0 : 0), 16777619);
    }
    const ds = g.nodes.map((n) => (n.daemon ? `${n.id}:${n.daemon.enabled ? 1 : 0}${n.daemon.running ? 1 : 0}` : n.id)).join(",");
    return `${g.nodes.length}|${g.edges.length}|${h}|${ph >>> 0}|${ds}`;
  }

  private build(g: GraphData) {
    this.measure();
    // adjacency + degree
    this.adjacency.clear();
    const deg = new Map<string, number>();
    for (const e of g.edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
      this.link(e.from, e.to); this.link(e.to, e.from);
    }

    // Center on the CONTENT centroid EXCLUDING the injected "you" hub — NOT self.position. The hub
    // is injected at the backend origin [0,0,0] (youNode.ts), so centering on it would frame the
    // empty origin instead of the real cloud's center of mass. The exclusion mirrors scaleToSpacing,
    // which scales about the same self-excluded centroid; using the same origin here keeps the
    // initial p3/p2 centered on the cloud before any rescale runs (most visible in 3rd-brain, where
    // "you" isn't linked to the memory nodes and sits far from their centroid). Falls back to the
    // all-node centroid when there are no non-self nodes.
    const c3 = this.centroid(g.nodes.filter((n) => n.kind !== "self").map((n) => n.position ?? [0, 0, 0]));
    const c2 = this.centroid2(g.nodes.filter((n) => n.kind !== "self").map((n) => n.position2d ?? [0, 0]));

    // hovered/highlight state is stale across modes
    this.hoveredId = null; this.highlightSet = null;
    const mkNode = (node: GraphNode): NodeView => {
      const p = node.position ?? [0, 0, 0];
      const p2 = node.position2d ?? [p[0], p[1]];
      const d = deg.get(node.id) ?? 0;
      return {
        node, p3: [p[0] - c3[0], -(p[1] - c3[1]), p[2] - c3[2]], p2: [p2[0] - c2[0], -(p2[1] - c2[1]), 0],
        colorInt: 0, colorHex: "#888", deg: d, scale: this.collideScale(node, d), baseDiameter: 0,
        sx: 0, sy: 0, depth: 0, pscale: 1, onScreen: true, dr: 0, lastZi: -1, lastDotSize: -1, shown: true,
        labelW: -1,
      };
    };
    // Nodes (and edges) are rendered entirely on the canvas — there are no per-node DOM elements,
    // which is what keeps load + mode-switch cheap at any graph size. We just (re)build the data array.
    this.nodes = g.nodes.map(mkNode);
    this.byId = new Map(this.nodes.map((nv) => [nv.node.id, nv]));
    this.selfNode = this.nodes.find((nv) => nv.node.kind === "self") ?? null;

    // Each edge gets a stable 0..1 rank; the draw loop keeps those below the current mode's fraction.
    this.edges = [];
    for (const e of g.edges) {
      const a = this.byId.get(e.from), b = this.byId.get(e.to);
      if (a && b) this.edges.push({ a, b, kr: (hashKey(e.from + "\0" + e.to) % 1000) / 1000 });
    }

    this.settled2D = false;
    this.settlePositions();
    // Eagerly settle the 2D layout too (not lazily on first 2D reveal). A mode switch can happen
    // WHILE the renderer is already showing 2D — if p2/radius2 were still stale at that point the
    // flat view would morph using the previous graph's center/extent and look unbalanced. Running
    // ensure2D's exact pass here (same n>=2 + no-intentional-layout + cache guards) makes radius2/p2
    // correct immediately. radius2 below is then recomputed from the settled p2 (not the seed).
    this.ensure2D();

    let r3 = 1, r2 = 1;
    for (const nv of this.nodes) {
      r3 = Math.max(r3, Math.hypot(nv.p3[0], nv.p3[1], nv.p3[2]));
      r2 = Math.max(r2, Math.hypot(nv.p2[0], nv.p2[1], nv.p2[2]));
    }
    this.radius3 = r3; this.radius2 = r2;

    this.alwaysOn = computeAlwaysOnSet(g.nodes, g.edges.map((e) => ({ source: e.from, target: e.to })), this.activeFile, this.cfg.graphLabelHubCount);
    this.glowCentroids = [...this.getCommunityCentroids().values()].sort((a, b) => b.count - a.count).slice(0, 3).map((c) => c.centroid);
    this.restyle();
    this.fit();
    this.dirty = true;
  }

  private link(a: string, b: string) {
    let s = this.adjacency.get(a);
    if (!s) { s = new Set(); this.adjacency.set(a, s); }
    s.add(b);
  }

  private centroid(ps: Vec3[]): Vec3 {
    const c: Vec3 = [0, 0, 0];
    for (const p of ps) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    const n = Math.max(1, ps.length);
    return [c[0] / n, c[1] / n, c[2] / n];
  }
  private centroid2(ps: [number, number][]): [number, number] {
    let x = 0, y = 0;
    for (const p of ps) { x += p[0]; y += p[1]; }
    const n = Math.max(1, ps.length);
    return [x / n, y / n];
  }

  /** Position the 3D layout from the backend's precomputed coords — no client force sim (that was the
   *  slow part of a mode switch, ~1.2s at 2k nodes). The backend layout is already fully settled
   *  (PivotMDS + 120 force ticks, core/layout.ts); we just rescale it to this renderer's wider spacing
   *  (scaleToSpacing). agents/daemon arrive pre-laid-out by GraphView, so they're left untouched.
   *  Cached per signature so re-visiting a mode is free. */
  private settlePositions() {
    const n = this.nodes.length;
    if (n < 2 || this.hasIntentionalLayout()) return; // agents/daemon arrive pre-laid-out
    const hit = this.p3Cache.get(this.sig); // re-visiting a mode -> reuse its positions
    if (hit) { for (const nv of this.nodes) { const p = hit.get(nv.node.id); if (p) nv.p3 = [p[0], p[1], p[2]]; } return; }
    const store = scaleToSpacing(this.nodes, 3);
    this.cachePut(this.p3Cache, this.sig, store);
  }

  private cachePut(cache: Map<string, Map<string, Vec3>>, key: string, val: Map<string, Vec3>) {
    cache.set(key, val);
    if (cache.size > 8) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest); }
  }

  /** Settle the flat 2D layout the same way (constant, slightly-wider link distance + collision),
   *  seeded from the backend `position2d`. Lazy — only runs the first time 2D is shown, so the
   *  initial 3D load stays fast. */
  private hasIntentionalLayout(): boolean {
    return this.nodes.some((nv) => nv.node.kind === "agent" || nv.node.kind === "daemon" || nv.node.kind === "cron" || nv.node.kind === "process");
  }

  private ensure2D() {
    if (this.settled2D) return;
    this.settled2D = true;
    const n = this.nodes.length;
    const hit = this.p2Cache.get(this.sig);
    if (hit) {
      for (const nv of this.nodes) { const p = hit.get(nv.node.id); if (p) nv.p2 = [p[0], p[1], p[2]]; }
    } else if (n >= 2 && !this.hasIntentionalLayout()) {
      // Same as the 3D path: rescale the backend's precomputed 2D layout (node.position2d) to this
      // renderer's spacing instead of re-running a force sim (~0.9s at 2k nodes).
      const store = scaleToSpacing(this.nodes, 2);
      this.cachePut(this.p2Cache, this.sig, store);
    }
    let r2 = 1;
    for (const nv of this.nodes) r2 = Math.max(r2, Math.hypot(nv.p2[0], nv.p2[1], nv.p2[2]));
    this.radius2 = r2;
    this.scale2 = (Math.min(this.W, this.H) * FIT_FRACTION) / Math.max(1, this.radius2);
    this.dirty = true;
  }

  private collideScale(node: GraphNode, d: number): number {
    if (node.kind === "self") return 1.8;
    let s = Math.min(this.cfg.nodeSizeMaxMult, this.cfg.nodeSizeMinMult + this.cfg.nodeSizeDegreeGain * Math.sqrt(d));
    if ((node.kind === "cron" || node.kind === "process") && node.daemon?.running) s *= 1.5;
    return s;
  }

  private nodeFrac(nv: NodeView): number {
    if (nv.node.kind === "self") return SELF_FRAC;
    return Math.min(NODE_MAX_FRAC, NODE_LEAF_FRAC + NODE_DEG_GAIN * Math.sqrt(nv.deg));
  }

  // ---- styling -------------------------------------------------------------

  setConfig(cfg: GraphConfig) {
    const prevMode = this.cfg.viewMode;
    this.cfg = { ...cfg, palette: cfg.palette?.length ? cfg.palette : DEFAULT_PALETTE };
    this.applyHostVars();
    // Only re-colour the nodes when colours actually changed — NOT on every mode toggle (that was
    // 2k --dot-color writes per toggle, which made 2D<->3D feel slow).
    const cs = `${this.cfg.palette.join(",")}|${this.cfg.selfColor}|${this.cfg.daemonAccent}|${this.cfg.daemonNeutral}|${this.cfg.backgroundColor}`;
    if (cs !== this.colorSig) { this.colorSig = cs; this.restyle(); }
    if (cfg.viewMode === "2d") this.ensure2D();
    if (this.host && cfg.viewMode !== prevMode) this.startModeMorph(cfg.viewMode);
    else if (!this.morphAnim) this.morph = cfg.viewMode === "2d" ? 1 : 0;
    this.dirty = true;
  }

  private applyHostVars() {
    const h = this.host;
    if (!h) return;
    h.style.setProperty("--label-text", this.cfg.labelTextColor);
    h.style.setProperty("--label-bg", this.cfg.labelBgColor);
    h.style.setProperty("--bg", intToHex(this.cfg.backgroundColor));
  }

  private restyle() {
    for (const nv of this.nodes) {
      nv.colorInt = this.colorFor(nv.node);
      nv.colorHex = intToHex(nv.colorInt);
      nv.lastDotSize = -1;
      nv.labelW = -1; // label text isn't reassigned here, but reset defensively — a re-measure is cheap and yields the same value
    }
    this.dirty = true; // the canvas reads colorHex on the next frame
  }

  private isHollow(node: GraphNode): boolean {
    if (node.kind !== "cron" && node.kind !== "process") return false;
    return nodeVisualState(node.daemon ?? { enabled: true, running: false, lastResult: null, lastFiredMs: null }).border === "palette";
  }

  private paletteColor(key: string): number {
    const pal = this.cfg.palette;
    return pal[hashKey(key) % pal.length];
  }

  private colorFor(n: GraphNode): number {
    switch (n.kind) {
      case "note": return n.community != null ? this.paletteColor("community:" + n.community) : this.paletteColor("folder:" + (n.folder ?? "(root)"));
      case "tag": return this.paletteColor("tag:" + n.label);
      case "memory": return n.community != null ? this.paletteColor("community:" + n.community) : this.paletteColor("mem:" + n.label);
      case "agent": return n.community != null ? this.paletteColor("community:" + n.community) : this.paletteColor("agent:" + n.label);
      case "self": return this.cfg.selfColor;
      case "daemon": return this.cfg.daemonAccent ?? this.cfg.selfColor;
      case "cron":
      case "process": return this.daemonColor(n);
      default: return this.cfg.palette[2] ?? this.cfg.palette[0] ?? 0x3f6bf0;
    }
  }

  private daemonColor(n: GraphNode): number {
    const vs = nodeVisualState(n.daemon ?? { enabled: true, running: false, lastResult: null, lastFiredMs: null });
    // running fills with palette; enabled-idle draws a palette RING (hollow, via isHollow on the
    // canvas) — both want the per-node palette colour.
    if (vs.fill === "palette" || vs.border === "palette") return this.paletteColor(n.id);
    return lerpInt(this.cfg.daemonNeutral ?? 0xaeb4c2, this.cfg.backgroundColor, 1 - vs.opacity); // disabled: faded
  }

  // ---- projection ----------------------------------------------------------

  private project(p: Vec3): { x: number; y: number; z: number; s: number } {
    const s = this.worldScale;
    const x = (p[0] - this.target[0]) * s, y = (p[1] - this.target[1]) * s, z = (p[2] - this.target[2]) * s;
    const cy = Math.cos(this.ry), sy = Math.sin(this.ry);
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    const cx = Math.cos(this.rx), sx = Math.sin(this.rx);
    const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
    const zc = z2 + this.zoom;
    const persp = this.P / Math.max(1, this.P - zc);
    return { x: x1 * persp, y: y2 * persp, z: zc, s: persp };
  }

  /** Compute screen pos + depth for every node (no DOM writes). Inlines project() plus the old
   *  coordFor() morph-lerp (now folded in here, since this was its only caller) with the
   *  per-frame-constant trig/target/origin values hoisted out of the loop, and no per-node result
   *  object allocated. Arithmetic, operand order, and branch structure are identical to
   *  project()/the old coordFor() — just evaluated inline. project() itself is kept intact above
   *  (still used by emitGlow). */
  private projectPositions() {
    const s = this.worldScale;
    const tx = this.target[0], ty = this.target[1], tz = this.target[2];
    const cyr = Math.cos(this.ry), syr = Math.sin(this.ry), cxr = Math.cos(this.rx), sxr = Math.sin(this.rx);
    const P = this.P, zoom = this.zoom, m = this.morph;
    const ox = this.cx + this.panX;
    const oy = this.cy + this.panY + this.viewOffsetY * this.H;
    let minZ = Infinity, maxZ = -Infinity;
    for (const nv of this.nodes) {
      let px: number, py: number, pz: number;
      if (m <= 0) { px = nv.p3[0]; py = nv.p3[1]; pz = nv.p3[2]; }
      else if (m >= 1) { px = nv.p2[0]; py = nv.p2[1]; pz = nv.p2[2]; }
      else { px = nv.p3[0] + (nv.p2[0] - nv.p3[0]) * m; py = nv.p3[1] + (nv.p2[1] - nv.p3[1]) * m; pz = nv.p3[2] + (nv.p2[2] - nv.p3[2]) * m; }
      const x = (px - tx) * s, y = (py - ty) * s, z = (pz - tz) * s;
      const x1 = x * cyr + z * syr, z1 = -x * syr + z * cyr;
      const y2 = y * cxr - z1 * sxr, z2 = y * sxr + z1 * cxr;
      const zc = z2 + zoom;
      const persp = P / Math.max(1, P - zc);
      nv.sx = ox + x1 * persp;
      nv.sy = oy + y2 * persp;
      nv.depth = zc; nv.pscale = Math.max(0.05, persp);
      nv.onScreen = persp > 0.05 && zc < P * 0.985; // cull nodes at/behind the camera plane (zoom-in)
      if (zc < minZ) minZ = zc;
      if (zc > maxZ) maxZ = zc;
    }
    this.minZ = minZ; this.maxZ = maxZ;
    // Precompute per-node depth rank ONCE per frame (same formula as depthRank()) — reused below by
    // the 3D edge bands and depthFade instead of recomputing it ~2x per edge + once per node.
    const span = this.maxZ - this.minZ;
    const flat = span < 1;
    for (const nv of this.nodes) nv.dr = flat ? 1 : (nv.depth - this.minZ) / span;
    this.clearAroundSelf();
  }

  /** Open a clear ZONE around the "you" hub — the SINGLE source of truth for the hub's breathing
   *  room (scaleToSpacing carves nothing in world space). The zone's RADIUS behaves like world
   *  geometry: SELF_CLEAR_FRAC of the fitted graph radius, scaled by the hub's perspective, so
   *  zooming scales the clearing with the graph instead of holding a fixed px ring (which warped
   *  neighbours differently at each zoom level — "the space around you grows/shrinks on zoom").
   *  Each node's ACTUAL drawn radius is still added in px as an anti-overlap floor: how big a dot
   *  is DRAWN depends on zoom, so a one-link neighbour in a sparse, zoomed-in graph could
   *  otherwise graze the hub's circle even though its center clears the world radius. Only nodes
   *  actually inside the zone are pushed, so it stays a clearing, not a forced ring. Runs every
   *  frame across 2D, 3D, and the morph; the hub is pinned at the cloud centre, so the push
   *  direction is stable. Coincident nodes (resolving to the same screen point) fan out on
   *  golden-angle bearings so they don't stack. Edges, dots, and labels all read sx/sy, so they
   *  follow the nudge. O(n). */
  private clearAroundSelf() {
    const self = this.selfNode;
    if (!self || !self.onScreen) return;
    const rSelf = this.nodeDiameter(self) / 2;
    // World-space breathing room, projected like any node position: fraction of the fitted
    // graph radius × the hub's own perspective scale. Zooming scales it with the graph, so the
    // hub's clear zone stays geometrically stable instead of pulsing with zoom.
    const projectedClear = SELF_CLEAR_FRAC * this.fitPx * self.pscale;
    let coincident = 0;
    for (const nv of this.nodes) {
      if (nv === self || !nv.onScreen) continue;
      const minDist = rSelf + this.nodeDiameter(nv) / 2 + projectedClear;
      let dx = nv.sx - self.sx, dy = nv.sy - self.sy;
      let d = Math.hypot(dx, dy);
      if (d >= minDist) continue;
      if (d < 0.01) {
        // Exactly on the hub — fan coincident nodes out on a golden-angle bearing so they don't stack.
        const a = (coincident++) * GOLDEN_ANGLE_RAD;
        dx = Math.cos(a); dy = Math.sin(a); d = 1;
      }
      const f = minDist / d;
      nv.sx = self.sx + dx * f;
      nv.sy = self.sy + dy * f;
    }
  }

  private depthRank(nv: NodeView): number { const span = this.maxZ - this.minZ; return span < 1 ? 1 : (nv.depth - this.minZ) / span; } // 0 far, 1 near; flat/single -> 1
  private depthMin(): number { return DEPTH_MIN_OPACITY; }
  private depthFade(nv: NodeView, is2d: boolean): number { if (is2d) return 1; const m = this.depthMin(); return m + (1 - m) * Math.pow(nv.dr, DEPTH_CURVE); }
  /** Resting (pre-perspective) diameter for every node — depends only on fitPx, nodes.length, and
   *  each node's kind/degree, all constant between fit()/build() calls, so it's computed ONCE per
   *  fit() (see computeBaseDiameters) instead of every frame per node in nodeDiameter's hot path. */
  private computeBaseDiameters() {
    // Size by node DENSITY, not by the layout's absolute scale. The on-screen node spacing is roughly
    // (2·fitPx)/√n (n nodes filling a disk of on-screen radius fitPx), and nodeFrac is a node's diameter
    // as a fraction of that spacing. This is invariant to the layout radius — so it no longer changes
    // when the backend layout's extent shifts (e.g. as nodes are added), which made dots balloon before.
    const spacing = (2 * this.fitPx) / Math.sqrt(Math.max(1, this.nodes.length));
    for (const nv of this.nodes) {
      nv.baseDiameter = Math.min(MAX_DOT_PX, NODE_SIZE_SCALE * spacing * this.nodeFrac(nv)); // cap resting size
    }
  }

  private nodeDiameter(nv: NodeView): number {
    // Floor at MIN_DOT_PX so zooming out keeps nodes as tiny dots instead of making them
    // vanish (perspective shrinks every dot; without a floor the small ones drop out).
    return Math.max(MIN_DOT_PX, nv.baseDiameter * nv.pscale);
  }

  // ---- camera / fit --------------------------------------------------------

  private measure() {
    if (!this.host) return;
    const r = this.host.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.cx = this.W / 2; this.cy = this.H / 2;
    this.P = (this.H / 2) / Math.tan((FOV_DEG * Math.PI) / 360);
    this.dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    if (this.edgeCanvas) {
      this.edgeCanvas.width = Math.round(this.W * this.dpr);
      this.edgeCanvas.height = Math.round(this.H * this.dpr);
      this.edgeCanvas.style.width = `${this.W}px`;
      this.edgeCanvas.style.height = `${this.H}px`;
    }
    this.dirty = true;
  }

  private fit() {
    const fitPx = (Math.min(this.W, this.H) * FIT_FRACTION) / this.fitMargin;
    this.fitPx = fitPx; // node size derives from this (density-based), independent of layout radius
    this.scale3 = fitPx / Math.max(1, this.radius3);
    this.scale2 = fitPx / Math.max(1, this.radius2);
    this.worldScale = this.scale3 + (this.scale2 - this.scale3) * this.morph;
    this.zoom = 0; this.goalZoom = 0;
    this.target = [0, 0, 0]; this.goalTarget = [0, 0, 0];
    this.panX = 0; this.panY = 0; this.goalPanX = 0; this.goalPanY = 0; this.userTook = false;
    this.computeBaseDiameters();
    this.dirty = true;
  }

  private startModeMorph(mode: "2d" | "3d") {
    this.morphAnim = { from: this.morph, to: mode === "2d" ? 1 : 0, start: this.nowMs };
    if (mode === "2d") { this.userTook = false; }
    else { this.rx = -0.5; this.ry = 0; }
    this.dirty = true;
  }

  // ---- render loop ---------------------------------------------------------

  private start() { if (this.running || !this.visible || !this.host) return; this.running = true; this.raf = requestAnimationFrame(this.tick); }
  private stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  private tick = (t: number) => {
    if (!this.running) return;
    this.nowMs = t;
    if (this.lastFrameT) {
      this.fpsAccum += t - this.lastFrameT; this.fpsFrames++;
      if (this.fpsAccum >= 500) { this.onFps?.(Math.round((this.fpsFrames * 1000) / this.fpsAccum)); this.fpsAccum = 0; this.fpsFrames = 0; }
    }
    this.lastFrameT = t;

    if (this.morphAnim) {
      const k = Math.min(1, (t - this.morphAnim.start) / MODE_MORPH_MS);
      const e = easeInOutCubic(k);
      this.morph = this.morphAnim.from + (this.morphAnim.to - this.morphAnim.from) * e;
      if (this.morphAnim.to === 1) { this.rx *= 1 - e; this.ry *= 1 - e; }
      if (k >= 1) { this.morph = this.morphAnim.to; this.morphAnim = null; if (this.morph === 1) { this.rx = 0; this.ry = 0; } }
      this.dirty = true;
    }

    const is2d = this.morph > 0.5;
    if (this.cfg.spin && this.nodes.length <= SPIN_MAX_NODES && !is2d && !this.userTook && !this.dragging) {
      this.ry += this.cfg.spinSpeed; this.dirty = true;
    }
    this.worldScale = this.scale3 + (this.scale2 - this.scale3) * this.morph;

    if (Math.abs(this.goalZoom - this.zoom) > 0.3 ||
        Math.hypot(this.goalTarget[0] - this.target[0], this.goalTarget[1] - this.target[1], this.goalTarget[2] - this.target[2]) > 0.3 ||
        Math.abs(this.goalPanX - this.panX) > 0.3 || Math.abs(this.goalPanY - this.panY) > 0.3) {
      this.zoom += (this.goalZoom - this.zoom) * GLIDE;
      for (let i = 0; i < 3; i++) this.target[i] += (this.goalTarget[i] - this.target[i]) * GLIDE;
      this.panX += (this.goalPanX - this.panX) * GLIDE;
      this.panY += (this.goalPanY - this.panY) * GLIDE;
      this.dirty = true;
    }

    // Everything renders on the canvas — nodes, edges, labels — in one pass.
    if (this.dirty) {
      this.projectPositions();
      this.drawCanvas(true, is2d);
      this.emitGlow();
      this.dirty = false;
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  /** Draw edges (always) and, when `withNodes`, the node dots on the canvas (the moving state). */
  private drawCanvas(withNodes: boolean, is2d: boolean) {
    const ctx = this.edgeCtx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    // edges — width scales with zoom: thin when zoomed out (declutters the hairball), thicker zoomed in
    ctx.strokeStyle = intToHex(this.cfg.edgeColor);
    const zoomScale = this.P / Math.max(1, this.P - this.zoom);
    ctx.lineWidth = Math.max(0.08, Math.min(1.6, 0.4 * zoomScale));
    const op = this.cfg.edgeOpacity;
    // per-mode edge thinning: 2D aggressive, 3D gentle
    const budget = is2d ? EDGE_BUDGET_2D : EDGE_BUDGET_3D, floor = is2d ? EDGE_FLOOR_2D : EDGE_FLOOR_3D;
    const keepFrac = this.edges.length > budget ? Math.max(floor, budget / this.edges.length) : 1;
    const focus = this.focusSet();
    const strokeEdges = (alpha: number, pred?: (a: NodeView, b: NodeView) => boolean) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (const e of this.edges) {
        if (e.kr >= keepFrac) continue; // per-mode dense-graph thinning
        const { a, b } = e;
        if (!a.onScreen || !b.onScreen) continue;
        if (pred && !pred(a, b)) continue;
        ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy);
      }
      ctx.stroke();
    };
    if (this.hoveredId) {
      // hover = ONE degree: only edges directly incident to the hovered node light up
      const hov = this.hoveredId;
      strokeEdges(op * 0.05, (a, b) => a.node.id !== hov && b.node.id !== hov);
      strokeEdges(Math.min(0.9, op * 2.2), (a, b) => a.node.id === hov || b.node.id === hov);
    } else if (focus) {
      // persistent cluster highlight: edges within the set
      strokeEdges(op * 0.05, (a, b) => !(focus.has(a.node.id) || focus.has(b.node.id)));
      strokeEdges(op, (a, b) => focus.has(a.node.id) || focus.has(b.node.id));
    } else if (is2d) {
      strokeEdges(op);
    } else {
      // 3D: fade edges by depth (back edges recede) — banded so it stays a few batched strokes.
      // Single bucketing pass over this.edges (same keep/onScreen filters + band test as the
      // old per-band strokeEdges() calls), then one stroke per band — avoids rescanning all
      // edges BANDS times.
      const BANDS = 6;
      const dm = this.depthMin();
      const bands = this.edgeBands;
      for (const arr of bands) arr.length = 0;
      for (const e of this.edges) {
        if (e.kr >= keepFrac) continue; // per-mode dense-graph thinning
        const { a, b } = e;
        if (!a.onScreen || !b.onScreen) continue;
        const m = (a.dr + b.dr) / 2;
        for (let bi = 0; bi < BANDS; bi++) {
          const lo = bi / BANDS, hi = (bi + 1) / BANDS + (bi === BANDS - 1 ? 0.01 : 0);
          if (m >= lo && m < hi) { bands[bi].push(e); break; }
        }
      }
      for (let bi = 0; bi < BANDS; bi++) {
        const fade = dm + (1 - dm) * Math.pow((bi + 0.5) / BANDS, DEPTH_CURVE);
        ctx.globalAlpha = op * fade;
        ctx.beginPath();
        for (const e of bands[bi]) { ctx.moveTo(e.a.sx, e.a.sy); ctx.lineTo(e.b.sx, e.b.sy); }
        ctx.stroke();
      }
    }
    // nodes (canvas state) — depth-sorted far→near so near dots paint over far ones
    if (withNodes) {
      this.drawOrder.length = 0;
      for (const nv of this.nodes) { if (nv.onScreen) this.drawOrder.push(nv); }
      this.drawOrder.sort((a, b) => a.depth - b.depth);
      const order = this.drawOrder;
      for (const nv of order) {
        const ds = this.nodeDiameter(nv);
        let alpha = this.depthFade(nv, is2d);
        if (focus && !focus.has(nv.node.id)) alpha *= 0.13; // dim non-focus on hover/highlight
        else if (this.hoveredId && focus?.has(nv.node.id)) alpha = Math.max(alpha, 0.95); // connected nodes pop to full brightness on hover
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(nv.sx, nv.sy, ds / 2, 0, Math.PI * 2);
        if (nv.node.kind === "self" || this.isHollow(nv.node)) {
          ctx.lineWidth = Math.max(1.5, ds * 0.12); ctx.strokeStyle = nv.colorHex; ctx.stroke();
        } else {
          ctx.fillStyle = nv.colorHex; ctx.fill();
        }
      }
      // hovered node: a bright ring; its neighbours: a thinner ring so connected NODES read as
      // highlighted, not just the incident edges
      if (this.hoveredId) {
        if (focus) {
          ctx.lineWidth = 1.25;
          for (const id of focus) {
            if (id === this.hoveredId) continue;
            const nb = this.byId.get(id);
            if (!nb || !nb.onScreen) continue;
            const nds = this.nodeDiameter(nb);
            ctx.globalAlpha = 0.85; ctx.strokeStyle = nb.colorHex;
            ctx.beginPath(); ctx.arc(nb.sx, nb.sy, nds / 2 + 2.5, 0, Math.PI * 2); ctx.stroke();
          }
        }
        const nv = this.byId.get(this.hoveredId);
        if (nv && nv.onScreen) {
          const ds = this.nodeDiameter(nv);
          ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.strokeStyle = nv.colorHex;
          ctx.beginPath(); ctx.arc(nv.sx, nv.sy, ds / 2 + 3, 0, Math.PI * 2); ctx.stroke();
        }
      }
      // labels (canvas) — only the visible set (hubs + active + hovered + neighbours), so it's cheap
      ctx.globalAlpha = 1; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineWidth = 1;
      for (const nv of this.nodes) {
        if (!nv.onScreen || !this.labelVisible(nv)) continue;
        const self = nv.node.kind === "self";
        ctx.font = self ? this.FONT_SELF : this.FONT_NODE;
        const text = self ? "You" : nv.node.label;
        const ds = this.nodeDiameter(nv);
        if (nv.labelW < 0) { nv.labelW = ctx.measureText(text).width; }
        const tw = nv.labelW;
        const fh = self ? 14 : 11, padX = 6, padY = 2;
        const bx = nv.sx - tw / 2 - padX, by = nv.sy + ds / 2 + 4, bw = tw + padX * 2, bh = fh + padY * 2;
        ctx.fillStyle = this.cfg.labelBgColor;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 5); else ctx.rect(bx, by, bw, bh);
        ctx.fill();
        ctx.fillStyle = this.cfg.labelTextColor;
        ctx.fillText(text, nv.sx, by + padY);
      }
    }
    ctx.globalAlpha = 1;
  }

  private labelVisible(nv: NodeView): boolean {
    if (nv.node.kind === "self") return true;
    if (!this.cfg.showGraphLabels) return false;
    const id = nv.node.id;
    if (this.alwaysOn.has(id) || this.searchMatches.has(id) || id === this.activeFile || id === this.hoveredId) return true;
    if (this.highlightSet?.has(id)) return true;
    if (this.hoveredId != null && (this.adjacency.get(this.hoveredId)?.has(id) ?? false)) return true;
    // Zoom-in discovery: once the user has zoomed in (zoom > 0), reveal the label of any node
    // whose dot has grown past the threshold — so zooming in progressively surfaces names while
    // the resting framing keeps its curated hub-only set.
    return this.zoom > 0 && this.nodeDiameter(nv) >= LABEL_REVEAL_DOT_PX;
  }

  private emitGlow() {
    if (!this.onGlow) return;
    const lobes = this.glowCentroids.map((c) => {
      const pr = this.project(c);
      return { x: ((this.cx + this.panX + pr.x) / this.W) * 100, y: ((this.cy + this.panY + this.viewOffsetY * this.H + pr.y) / this.H) * 100 };
    });
    while (lobes.length < 3) lobes.push({ x: 50, y: 50 });
    this.onGlow({ lobes });
  }

  // ---- interaction ---------------------------------------------------------

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.pressed = true; this.movedFar = false;
    this.downX = this.lastX = e.clientX; this.downY = this.lastY = e.clientY;
    // Suppress native text/element selection for the whole press. The drag tracks on `window`
    // (pointermove/up are window-level), so an orbit started in the viewport sweeps over the
    // sidebar/cluster-legend/other chrome — none of which carry the viewport's `user-select:
    // none` — and the browser highlights them. That stray selection is what makes nodes blink
    // out mid-rotate. `user-select: none` on the viewport alone can't cover elements outside it,
    // so gate it page-wide for the press and restore it on release. (A plain click sets+clears it
    // within one tick — harmless.)
    this.setSelectionSuppressed(true);
  };

  /** Toggle page-wide text-selection suppression (see onPointerDown). Idempotent + restores the
   *  prior inline value so we never clobber an existing body style. */
  private prevUserSelect: string | null = null;
  private setSelectionSuppressed(on: boolean): void {
    const body = typeof document !== "undefined" ? document.body : null;
    if (!body) return;
    if (on) {
      if (this.prevUserSelect === null) this.prevUserSelect = body.style.userSelect;
      body.style.userSelect = "none";
      (body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";
    } else {
      body.style.userSelect = this.prevUserSelect ?? "";
      (body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = this.prevUserSelect ?? "";
      this.prevUserSelect = null;
    }
  }

  private onPointerLeave = () => { if (this.hoveredId) this.setHover(null); this.dirty = true; };

  /** Nearest on-screen node under the cursor (JS hit-test on cached positions — works in canvas mode
   *  where the DOM dots are hidden). Faded back nodes aren't pickable in 3D. */
  private pick(clientX: number, clientY: number): NodeView | null {
    const r = this.viewport.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    const is2d = this.morph > 0.5;
    let best: NodeView | null = null, bestD = Infinity;
    for (const nv of this.nodes) {
      if (!nv.onScreen) continue;
      if (!is2d && this.depthRank(nv) < BACK_INTERACT_CUTOFF) continue; // back layer isn't interactive
      const rad = Math.max(this.nodeDiameter(nv) / 2, 8); // generous hit target
      const dx = nv.sx - x, dy = nv.sy - y, d2 = dx * dx + dy * dy;
      if (d2 <= rad * rad && d2 < bestD) { bestD = d2; best = nv; }
    }
    return best;
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
      // Clear any selection that slipped in before user-select:none took hold on press.
      if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
    }
    if (!this.dragging) return;
    if (this.morph > 0.5) { this.panX += dx; this.panY += dy; this.goalPanX = this.panX; this.goalPanY = this.panY; }
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
    this.viewport.classList.remove("is-dragging");
    this.setSelectionSuppressed(false); // re-enable text selection now the press is over
    this.dirty = true; // restore the crisp DOM after a drag
    if (wasDrag) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (hit) {
      this.onNodeClick(hit.node.id);
    } else if (this.highlightSet) {
      // Click on empty space deselects a persistent cluster highlight (the legend sets it) —
      // without this there was no way OFF a selected cluster short of picking another one.
      this.clearHighlight();
      this.onHighlightCleared?.();
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.userTook = true;
    // drive the GOAL (not zoom directly) so the glide animates it. Upper bound near P lets you zoom
    // all the way in (P itself is the camera plane / singularity, so stop just short of it).
    this.goalZoom = Math.max(-this.P * 4, Math.min(this.P * 0.94, this.goalZoom - e.deltaY * 0.5));
    this.dirty = true;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (!this.host || this.host.offsetParent === null) return; // graph isn't the visible pane
    if (e.key === "Escape") this.resetView();
    // `z`: frame the node under the cursor + its neighbours; with nothing hovered, zoom to overview
    else if (e.key === "z" || e.key === "Z") { if (this.hoveredId) this.focusNode(this.hoveredId); else this.resetView(); }
  };

  private setHover(id: string | null) {
    if (id === this.hoveredId) return;
    const nv = id ? this.byId.get(id) : undefined;
    this.onHover(nv ? { id: nv.node.id, label: nv.node.label, kind: nv.node.kind, folder: nv.node.folder } : null);
    // The highlight + neighbour-dim is rendered on the canvas (one cheap pass, reading focusSet()),
    // so a hover just flags the id and asks for a redraw — no O(n) DOM toggles or reproject.
    this.hoveredId = id;
    this.dirty = true;
  }

  // ---- highlight / selection ----------------------------------------------

  setActiveFile(id: string | null) {
    this.activeFile = id;
    this.alwaysOn = computeAlwaysOnSet(this.nodes.map((n) => n.node), this.edges.map((e) => ({ source: e.a.node.id, target: e.b.node.id })), this.activeFile, this.cfg.graphLabelHubCount);
    this.dirty = true; // the canvas reflects the active file (label + emphasis) on the next frame
  }

  setSearchMatches(ids: Set<string>) {
    this.searchMatches = ids;
    this.dirty = true; // matches are drawn on the canvas via labelVisible()
  }

  highlightNodes(ids: string[]) { this.highlightSet = ids.length ? new Set(ids) : null; this.dirty = true; }
  clearHighlight() { this.highlightSet = null; this.dirty = true; }

  // The hovered/highlighted node plus its neighbours — read by drawCanvas to emphasise that set
  // and dim the rest in a single canvas pass.
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

  frameSubset(ids: string[]) {
    const views = ids.map((i) => this.byId.get(i)).filter(Boolean) as NodeView[];
    if (!views.length) return;
    const use3d = this.morph <= 0.5;
    const pts = views.map((v) => (use3d ? v.p3 : v.p2));
    const c = this.centroid(pts);
    let r = 1;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
    this.goalTarget = c;
    const wantPx = Math.min(this.W, this.H) * 0.3;
    const onScreen = r * this.worldScale;
    this.goalZoom = Math.max(-this.P * 2, Math.min(this.P * 0.7, this.P * (1 - onScreen / Math.max(1, wantPx))));
    this.userTook = true;
    this.dirty = true;
  }

  /** Smoothly glide back to the whole-graph overview (used by `z`/Escape on the background). */
  resetView() {
    this.clearHighlight();
    this.goalZoom = 0; this.goalTarget = [0, 0, 0]; this.goalPanX = 0; this.goalPanY = 0;
    this.userTook = false; this.dirty = true;
  }

  // ---- UI data accessors ---------------------------------------------------

  getNodesForUI(): { id: string; label: string; folder?: string; community?: number; communityLabel?: string }[] {
    return this.nodes.filter((n) => n.node.kind !== "self").map((n) => ({
      id: n.node.id, label: n.node.label, folder: n.node.folder, community: n.node.community, communityLabel: n.node.communityLabel,
    }));
  }

  getCommunityCentroids(): Map<number, { label: string; ids: string[]; color: string; centroid: Vec3; count: number }> {
    const groups = new Map<number, NodeView[]>();
    for (const nv of this.nodes) {
      const c = nv.node.community;
      if (c == null) continue;
      let arr = groups.get(c);
      if (!arr) { arr = []; groups.set(c, arr); }
      arr.push(nv);
    }
    const out = new Map<number, { label: string; ids: string[]; color: string; centroid: Vec3; count: number }>();
    for (const [c, members] of groups) {
      if (members.length < 2) continue;
      out.set(c, {
        label: members[0].node.communityLabel ?? `Cluster ${c}`,
        ids: members.map((m) => m.node.id),
        color: intToHex(members[0].colorInt || this.colorFor(members[0].node)),
        centroid: this.centroid(members.map((m) => m.p3)),
        count: members.length,
      });
    }
    return out;
  }
}
