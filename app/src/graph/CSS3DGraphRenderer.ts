// app/src/graph/CSS3DGraphRenderer.ts
//
// A web-NATIVE knowledge-graph renderer. At rest, every node is a real HTML <div> and every label
// native text, so the graph reads as crisp DOM UI (sharp fonts/circles) instead of "off". Edges
// always draw on one <canvas> (one call, not thousands of elements). It's a drop-in replacement for
// WebGLRenderer, mirroring that class's public surface.
//
// Scaling to a real vault (2k+ nodes): the cost is reprojecting thousands of DOM nodes per frame.
// So for large graphs we draw the NODES on the canvas while the camera is MOVING (orbit/zoom/morph
// — smooth, GPU-cheap) and swap the crisp DOM nodes back in the instant it comes to REST. You get
// HTML when you're reading it and 60fps when you're spinning it. Small graphs keep full DOM the
// whole time (they're cheap), including hover-dimming and idle spin.
//
// 3D coords come off the backend layout (`node.position` / `position2d`), de-cluttered once by a
// d3-force settle. Each frame the camera (orbit + zoom + perspective) projects nodes to a screen
// pixel + depth; near nodes are bigger and opaque, far nodes smaller and faded (the depth cue).
// No `transform: scale` is used (it blurs) — dot diameters are set in real pixels.

import "./css3d.css";
import { forceSimulation, forceManyBody, forceLink, forceCollide, forceX, forceY, forceZ, type SimNode } from "d3-force-3d";
import type { GraphData, GraphNode, NodeKind } from "../../../core/src/graph";
import { SELF_NODE_ID } from "../../../core/src/graph";

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
const COLLIDE_RATIO = 1.25;   // collision floor = link distance × this
const SELF_CLEAR = 2.6;       // "you" hub's collision radius multiplier (the clearing around it)
const HEAVY_NODES = 600;      // above this: canvas-while-moving, no hover-dim, no idle spin
const SPIN_MAX_NODES = 350;   // idle-spin only for graphs this small
const NODE_LEAF_FRAC = 0.2;   // node diameter as a fraction of on-screen link spacing (a 0-degree leaf)
const NODE_DEG_GAIN = 0.06;   // extra diameter fraction per sqrt(degree)
const NODE_MAX_FRAC = 0.55;   // cap: a hub never exceeds ~half the spacing
const SELF_FRAC = 0.5;        // the "you" hub's diameter as a fraction of spacing
const MIN_DOT_PX = 1.6;       // below this projected diameter a node is hidden
const MAX_DOT_PX = 60;        // cap the resting diameter so tiny graphs (1 "you" node) don't blow up
// Zoom-in label discovery: once a node's projected dot grows past this many px (i.e. the user
// has zoomed in toward it), reveal its filename label so zooming in progressively surfaces names.
const LABEL_REVEAL_DOT_PX = 18;
const DEPTH_MIN_OPACITY = 0.04; // farthest node's opacity in a BIG graph (strong depth cue)
const DEPTH_MIN_OPACITY_SMALL = 0.5; // small graphs (daemon/agents/small vaults) fade gently so every node stays readable
const DEPTH_CURVE = 2.4;      // >1 = back fades faster (stronger depth cue)
const BACK_INTERACT_CUTOFF = 0.18; // 3D nodes whose depth rank is below this aren't hover/click targets
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
  el?: HTMLDivElement;   // DOM elements exist only for SMALL graphs; heavy graphs render on canvas
  dot?: HTMLDivElement;
  label?: HTMLSpanElement;
  p3: Vec3; // centered world coords (3D layout, Y flipped to screen-up)
  p2: Vec3; // centered world coords (flat 2D layout, z=0)
  colorInt: number; colorHex: string;
  deg: number; // undirected degree (drives node size)
  scale: number; // degree-based collision multiplier (for the settle)
  sx: number; sy: number; depth: number; pscale: number; onScreen: boolean; // per-frame scratch
  lastZi: number; lastDotSize: number; shown: boolean;
}
interface EdgeView { a: NodeView; b: NodeView; kr: number; } // kr = stable 0..1 rank for per-mode thinning

function easeInOutCubic(t: number): number { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function lerpInt(a: number, b: number, t: number): number {
  const ch = (sh: number) => { const av = (a >> sh) & 0xff, bv = (b >> sh) & 0xff; return Math.round(av + (bv - av) * t) & 0xff; };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export class CSS3DGraphRenderer {
  private host?: HTMLElement;
  private viewport!: HTMLDivElement;
  private world!: HTMLDivElement;
  private edgeCanvas!: HTMLCanvasElement;
  private edgeCtx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private ro?: ResizeObserver;

  private cfg: GraphConfig = { ...DEFAULT_CONFIG };
  private nodes: NodeView[] = [];
  private byId = new Map<string, NodeView>();
  private edges: EdgeView[] = [];
  private adjacency = new Map<string, Set<string>>();
  private sig = "";
  private colorSig = ""; // gate node recolouring so mode toggles don't rewrite 2k colours
  private p3Cache = new Map<string, Map<string, Vec3>>(); // settled 3D positions per graph signature
  private p2Cache = new Map<string, Map<string, Vec3>>(); // settled 2D positions per graph signature
  private radius3 = 1; private radius2 = 1; // layout extent per view
  private scale3 = 1; private scale2 = 1;   // world-units -> px fit per view
  private collideR = 50;                     // world-space link spacing (constant); drives node size
  private glowCentroids: Vec3[] = [];        // cached top-3 community centroids (glow lobes)
  private heavy = false;                     // large graph -> canvas-while-moving + reduced interaction
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

  // loop
  private raf = 0; private running = false; private visible = true; private dirty = true;
  private lastFrameT = 0; private fpsAccum = 0; private fpsFrames = 0; private nowMs = 0;

  // ---- lifecycle -----------------------------------------------------------

  mount(el: HTMLElement, onNodeClick: (id: string) => void, onHover?: (n: HoverNode | null) => void, _labelOverlay?: HTMLElement) {
    this.host = el;
    this.onNodeClick = onNodeClick;
    if (onHover) this.onHover = onHover;

    this.viewport = document.createElement("div");
    this.viewport.className = "css3d-viewport";
    this.edgeCanvas = document.createElement("canvas");
    this.edgeCanvas.className = "css3d-edges";
    this.edgeCtx = this.edgeCanvas.getContext("2d");
    this.world = document.createElement("div");
    this.world.className = "css3d-world";
    this.viewport.append(this.edgeCanvas, this.world);
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
    const ds = g.nodes.map((n) => (n.daemon ? `${n.id}:${n.daemon.enabled ? 1 : 0}${n.daemon.running ? 1 : 0}` : n.id)).join(",");
    return `${g.nodes.length}|${g.edges.length}|${h}|${ds}`;
  }

  private build(g: GraphData) {
    this.measure();
    this.heavy = g.nodes.length > HEAVY_NODES;
    // adjacency + degree
    this.adjacency.clear();
    const deg = new Map<string, number>();
    for (const e of g.edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
      this.link(e.from, e.to); this.link(e.to, e.from);
    }

    const self = g.nodes.find((n) => n.id === SELF_NODE_ID || n.kind === "self");
    const c3 = self?.position ?? this.centroid(g.nodes.map((n) => n.position ?? [0, 0, 0]));
    const c2 = self?.position2d ?? this.centroid2(g.nodes.map((n) => n.position2d ?? [0, 0]));

    // hovered/highlight state is stale across modes
    this.hoveredId = null; this.highlightSet = null;
    const mkNode = (node: GraphNode): NodeView => {
      const p = node.position ?? [0, 0, 0];
      const p2 = node.position2d ?? [p[0], p[1]];
      const d = deg.get(node.id) ?? 0;
      return {
        node, p3: [p[0] - c3[0], -(p[1] - c3[1]), p[2] - c3[2]], p2: [p2[0] - c2[0], -(p2[1] - c2[1]), 0],
        colorInt: 0, colorHex: "#888", deg: d, scale: this.collideScale(node, d),
        sx: 0, sy: 0, depth: 0, pscale: 1, onScreen: true, lastZi: -1, lastDotSize: -1, shown: true,
      };
    };
    if (this.heavy) {
      // BIG graph: NO DOM node elements (this is the load/switch cost). Render everything on the
      // canvas. Just (re)build the data array — no createElement, no reconcile, no layout thrash.
      if (this.world.childElementCount) this.world.replaceChildren();
      this.nodes = g.nodes.map(mkNode);
      this.byId = new Map(this.nodes.map((nv) => [nv.node.id, nv]));
    } else {
      // SMALL graph: real DOM nodes, reconciled (reuse divs for ids shared across a mode switch).
      const prev = this.byId;
      const next = new Map<string, NodeView>();
      const nodes: NodeView[] = [];
      for (const node of g.nodes) {
        const text = node.kind === "self" ? "You" : node.label;
        let nv = prev.get(node.id);
        const fresh = mkNode(node);
        if (nv && nv.el) {
          prev.delete(node.id);
          nv.node = node; nv.deg = fresh.deg; nv.scale = fresh.scale; nv.p3 = fresh.p3; nv.p2 = fresh.p2;
          nv.lastDotSize = -1; nv.lastZi = -1;
          if (nv.label!.textContent !== text) nv.label!.textContent = text;
          nv.el.classList.toggle("css3d-node--self", node.kind === "self");
          nv.el.classList.remove("is-hover", "is-active", "is-match", "is-dim");
          if (!nv.shown) { nv.el.style.display = ""; nv.shown = true; }
        } else {
          nv = fresh;
          nv.el = document.createElement("div");
          nv.dot = document.createElement("div");
          nv.label = document.createElement("span");
          nv.el.className = node.kind === "self" ? "css3d-node css3d-node--self" : "css3d-node";
          nv.dot.className = "css3d-dot";
          nv.dot.dataset.id = node.id;
          nv.label.className = "css3d-label";
          nv.label.textContent = text;
          nv.el.append(nv.dot, nv.label);
          this.world.appendChild(nv.el);
        }
        nodes.push(nv); next.set(node.id, nv);
      }
      for (const old of prev.values()) old.el?.remove();
      this.nodes = nodes; this.byId = next;
    }

    // Each edge gets a stable 0..1 rank; the draw loop keeps those below the current mode's fraction.
    this.edges = [];
    for (const e of g.edges) {
      const a = this.byId.get(e.from), b = this.byId.get(e.to);
      if (a && b) this.edges.push({ a, b, kr: (hashKey(e.from + "\0" + e.to) % 1000) / 1000 });
    }

    this.settled2D = false; // 2D layout is settled lazily on first switch to 2D
    this.settlePositions();

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

  /** Pre-settle the 3D layout once (charge + link + collision + centering), seeded from the backend
   *  positions, with a CONSTANT link distance so spacing doesn't collapse as the graph grows. Tick
   *  count + Barnes-Hut theta are tuned down for large graphs so load stays quick. */
  private settlePositions() {
    const n = this.nodes.length;
    const linkDist = this.cfg.linkDistance * LINK_SPREAD;
    this.collideR = linkDist * COLLIDE_RATIO;
    if (n < 2 || this.hasIntentionalLayout()) return; // agents/daemon arrive pre-laid-out
    const hit = this.p3Cache.get(this.sig); // re-visiting a mode -> reuse its settled positions (no re-settle)
    if (hit) { for (const nv of this.nodes) { const p = hit.get(nv.node.id); if (p) nv.p3 = [p[0], p[1], p[2]]; } return; }
    const collideR = this.collideR;
    type SN = SimNode & { kind: string; scale: number };
    const simNodes: SN[] = this.nodes.map((nv) => {
      const s: SN = { id: nv.node.id, kind: nv.node.kind, scale: nv.scale, x: nv.p3[0], y: nv.p3[1], z: nv.p3[2] };
      if (nv.node.kind === "self") { s.fx = 0; s.fy = 0; s.fz = 0; }
      return s;
    });
    const links = this.edges.map((e) => ({ source: e.a.node.id, target: e.b.node.id }));
    const sim = forceSimulation<SN>(simNodes, 3)
      .force("charge", forceManyBody<SN>().strength(this.cfg.repulsion).theta(this.heavy ? 1.6 : 0.9))
      .force("link", forceLink<SN>(links).id((d) => d.id as string).distance(linkDist).strength(0.18))
      .force("collide", forceCollide<SN>((d) => (d.kind === "self" ? collideR * SELF_CLEAR : collideR * (1 + d.scale * 0.08))).iterations(this.heavy ? 1 : 2))
      .force("x", forceX<SN>(0).strength(this.cfg.centering))
      .force("y", forceY<SN>(0).strength(this.cfg.centering))
      .force("z", forceZ<SN>(0).strength(this.cfg.centering))
      .stop();
    const ticks = this.heavy ? 45 : Math.min(360, 200 + n); // fewer ticks on big graphs -> fast load
    for (let t = 0; t < ticks; t++) sim.tick();
    const store = new Map<string, Vec3>();
    for (let k = 0; k < this.nodes.length; k++) {
      const s = simNodes[k];
      this.nodes[k].p3 = [s.x ?? 0, s.y ?? 0, s.z ?? 0];
      store.set(this.nodes[k].node.id, this.nodes[k].p3);
    }
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
      const linkDist = this.cfg.linkDistance * LINK_SPREAD * 1.4; // 2D spreads a touch wider
      const collideR = linkDist * COLLIDE_RATIO;
      type SN2 = SimNode & { kind: string; scale: number };
      const sn: SN2[] = this.nodes.map((nv) => {
        const s: SN2 = { id: nv.node.id, kind: nv.node.kind, scale: nv.scale, x: nv.p2[0], y: nv.p2[1] };
        if (nv.node.kind === "self") { s.fx = 0; s.fy = 0; }
        return s;
      });
      const links = this.edges.map((e) => ({ source: e.a.node.id, target: e.b.node.id }));
      const sim = forceSimulation<SN2>(sn, 2)
        .force("charge", forceManyBody<SN2>().strength(this.cfg.repulsion).theta(this.heavy ? 1.6 : 0.9))
        .force("link", forceLink<SN2>(links).id((d) => d.id as string).distance(linkDist).strength(0.18))
        .force("collide", forceCollide<SN2>((d) => (d.kind === "self" ? collideR * SELF_CLEAR : collideR * (1 + d.scale * 0.08))).iterations(this.heavy ? 1 : 2))
        .force("x", forceX<SN2>(0).strength(this.cfg.centering))
        .force("y", forceY<SN2>(0).strength(this.cfg.centering))
        .stop();
      const ticks = this.heavy ? 45 : Math.min(360, 200 + n);
      for (let t = 0; t < ticks; t++) sim.tick();
      const store = new Map<string, Vec3>();
      for (let k = 0; k < this.nodes.length; k++) { const s = sn[k]; this.nodes[k].p2 = [s.x ?? 0, s.y ?? 0, 0]; store.set(this.nodes[k].node.id, this.nodes[k].p2); }
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
      if (nv.el) { // DOM nodes (small graphs) — heavy graphs read colorHex on the canvas
        nv.el.style.setProperty("--dot-color", nv.colorHex);
        nv.el.classList.toggle("css3d-node--hollow", this.isHollow(nv.node));
      }
    }
    this.applyDimming();
    this.updateLabels();
    this.dirty = true;
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
    // running fills with palette; enabled-idle draws a palette RING (hollow) — both want the per-node
    // palette colour (the `--bg` fill of a hollow dot comes from the .css3d-node--hollow CSS).
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

  private coordFor(nv: NodeView): Vec3 {
    if (this.morph <= 0) return nv.p3;
    if (this.morph >= 1) return nv.p2;
    const m = this.morph;
    return [nv.p3[0] + (nv.p2[0] - nv.p3[0]) * m, nv.p3[1] + (nv.p2[1] - nv.p3[1]) * m, nv.p3[2] + (nv.p2[2] - nv.p3[2]) * m];
  }

  /** Compute screen pos + depth for every node (no DOM writes). */
  private projectPositions() {
    let minZ = Infinity, maxZ = -Infinity;
    for (const nv of this.nodes) {
      const pr = this.project(this.coordFor(nv));
      nv.sx = this.cx + this.panX + pr.x;
      nv.sy = this.cy + this.panY + this.viewOffsetY * this.H + pr.y;
      nv.depth = pr.z; nv.pscale = Math.max(0.05, pr.s);
      nv.onScreen = pr.s > 0.05 && pr.z < this.P * 0.985; // cull nodes at/behind the camera plane (zoom-in)
      if (pr.z < minZ) minZ = pr.z;
      if (pr.z > maxZ) maxZ = pr.z;
    }
    this.minZ = minZ; this.maxZ = maxZ;
  }

  private depthRank(nv: NodeView): number { const span = this.maxZ - this.minZ; return span < 1 ? 1 : (nv.depth - this.minZ) / span; } // 0 far, 1 near; flat/single -> 1
  private depthMin(): number { return this.heavy ? DEPTH_MIN_OPACITY : DEPTH_MIN_OPACITY_SMALL; } // small graphs fade gently
  private depthFade(nv: NodeView, is2d: boolean): number { if (is2d) return 1; const m = this.depthMin(); return m + (1 - m) * Math.pow(this.depthRank(nv), DEPTH_CURVE); }
  private nodeDiameter(nv: NodeView): number {
    const base = Math.min(MAX_DOT_PX, this.collideR * this.worldScale * this.nodeFrac(nv)); // cap resting size
    // Floor at MIN_DOT_PX so zooming out keeps nodes as tiny dots instead of making them
    // vanish (perspective shrinks every dot; without a floor the small ones drop out).
    return Math.max(MIN_DOT_PX, base * nv.pscale);
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
    this.scale3 = fitPx / Math.max(1, this.radius3);
    this.scale2 = fitPx / Math.max(1, this.radius2);
    this.worldScale = this.scale3 + (this.scale2 - this.scale3) * this.morph;
    this.zoom = 0; this.goalZoom = 0;
    this.target = [0, 0, 0]; this.goalTarget = [0, 0, 0];
    this.panX = 0; this.panY = 0; this.goalPanX = 0; this.goalPanY = 0; this.userTook = false;
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

    // Big graphs render entirely on the canvas (no DOM node elements at all — that's what makes
    // load + mode-switch fast). Small graphs render as real DOM nodes + a canvas edge layer.
    if (this.dirty) {
      this.projectPositions();
      if (this.heavy) {
        this.drawCanvas(true, is2d);
      } else {
        this.applyDomNodes(is2d);
        this.drawCanvas(false, is2d);
      }
      this.emitGlow();
      this.dirty = false;
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  /** Write each node's DOM transform + pixel size + depth fade + interactivity (rest state). */
  private applyDomNodes(is2d: boolean) {
    for (const nv of this.nodes) {
      const el = nv.el, dot = nv.dot;
      if (!el || !dot) continue; // heavy graphs have no DOM nodes
      const ds = this.nodeDiameter(nv);
      const hide = !nv.onScreen; // off-screen / behind the camera only — zoomed-out dots stay (floored)
      if (hide) { if (nv.shown) { el.style.display = "none"; nv.shown = false; } continue; }
      if (!nv.shown) { el.style.display = ""; nv.shown = true; }
      el.style.transform = `translate(${nv.sx.toFixed(1)}px,${nv.sy.toFixed(1)}px)`;
      if (Math.abs(ds - nv.lastDotSize) > 0.4) {
        dot.style.width = `${ds.toFixed(1)}px`;
        dot.style.height = `${ds.toFixed(1)}px`;
        el.style.setProperty("--r", `${(ds / 2).toFixed(1)}px`);
        nv.lastDotSize = ds;
      }
      const rank = this.depthRank(nv);
      const zi = Math.round(rank * 10000);
      if (zi !== nv.lastZi) { el.style.zIndex = String(zi); nv.lastZi = zi; }
      el.style.opacity = String(this.depthFade(nv, is2d));
      // Re-evaluate label visibility every frame so zoom-in reveal tracks the live camera.
      nv.label?.classList.toggle("is-shown", this.labelVisible(nv));
    }
  }

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
      // 3D: fade edges by depth (back edges recede) — banded so it stays a few batched strokes
      const BANDS = 6;
      const dm = this.depthMin();
      for (let bi = 0; bi < BANDS; bi++) {
        const lo = bi / BANDS, hi = (bi + 1) / BANDS + (bi === BANDS - 1 ? 0.01 : 0);
        const fade = dm + (1 - dm) * Math.pow((bi + 0.5) / BANDS, DEPTH_CURVE);
        strokeEdges(op * fade, (a, b) => { const m = (this.depthRank(a) + this.depthRank(b)) / 2; return m >= lo && m < hi; });
      }
    }
    // nodes (canvas state) — depth-sorted far→near so near dots paint over far ones
    if (withNodes) {
      const order = this.nodes.filter((n) => n.onScreen).sort((a, b) => a.depth - b.depth);
      for (const nv of order) {
        const ds = this.nodeDiameter(nv);
        let alpha = this.depthFade(nv, is2d);
        if (focus && !focus.has(nv.node.id)) alpha *= 0.13; // dim non-focus on hover/highlight
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(nv.sx, nv.sy, ds / 2, 0, Math.PI * 2);
        if (nv.node.kind === "self" || this.isHollow(nv.node)) {
          ctx.lineWidth = Math.max(1.5, ds * 0.12); ctx.strokeStyle = nv.colorHex; ctx.stroke();
        } else {
          ctx.fillStyle = nv.colorHex; ctx.fill();
        }
      }
      // hovered node: a bright ring
      if (this.hoveredId) {
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
        ctx.font = (self ? "700 14px " : "500 11px ") + "ui-sans-serif, system-ui, -apple-system, sans-serif";
        const text = self ? "You" : nv.node.label;
        const ds = this.nodeDiameter(nv);
        const tw = ctx.measureText(text).width;
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
    if (hit) this.onNodeClick(hit.node.id);
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
    if (this.heavy) {
      // Big graph: the highlight + neighbour-dim is rendered on the canvas (one cheap pass), so a
      // hover just flags the id and asks for a redraw — NO O(n) DOM class toggles or reproject.
      this.hoveredId = id;
      this.dirty = true;
      return;
    }
    // Small graph: rich DOM highlight (cheap at this size).
    if (this.hoveredId) this.byId.get(this.hoveredId)?.el?.classList.remove("is-hover");
    this.hoveredId = id;
    nv?.el?.classList.add("is-hover");
    this.applyDimming();
    this.updateLabels();
  }

  // ---- highlight / selection ----------------------------------------------

  setActiveFile(id: string | null) {
    if (this.activeFile) this.byId.get(this.activeFile)?.el?.classList.remove("is-active");
    this.activeFile = id;
    if (id) this.byId.get(id)?.el?.classList.add("is-active");
    this.alwaysOn = computeAlwaysOnSet(this.nodes.map((n) => n.node), this.edges.map((e) => ({ source: e.a.node.id, target: e.b.node.id })), this.activeFile, this.cfg.graphLabelHubCount);
    this.updateLabels();
    this.dirty = true; // heavy graphs reflect the active file on the canvas
  }

  setSearchMatches(ids: Set<string>) {
    for (const nv of this.nodes) nv.el?.classList.toggle("is-match", ids.has(nv.node.id));
    this.searchMatches = ids;
    this.updateLabels();
    this.dirty = true;
  }

  highlightNodes(ids: string[]) { this.highlightSet = ids.length ? new Set(ids) : null; this.applyDimming(); this.updateLabels(); this.dirty = true; }
  clearHighlight() { this.highlightSet = null; this.applyDimming(); this.updateLabels(); this.dirty = true; }

  private focusSet(): Set<string> | null {
    if (this.hoveredId) {
      const s = new Set<string>([this.hoveredId]);
      for (const nb of this.adjacency.get(this.hoveredId) ?? []) s.add(nb);
      return s;
    }
    return this.highlightSet;
  }

  private applyDimming() {
    const focus = this.focusSet();
    for (const nv of this.nodes) nv.el?.classList.toggle("is-dim", !!focus && !focus.has(nv.node.id));
  }

  private updateLabels() {
    if (this.heavy) return; // heavy graphs draw labels on the canvas via labelVisible()
    // Immediate refresh on state changes (hover/search/active); applyDomNodes also runs this
    // every frame so zoom-in reveal stays live. Single source of truth: labelVisible().
    for (const nv of this.nodes) nv.label?.classList.toggle("is-shown", this.labelVisible(nv));
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
