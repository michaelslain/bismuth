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
import { buildBloom, type DensityField } from "./densityField";

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
  /** ASCII renderer only: graph.backgroundNoise (settingsSchema.ts) — the faint ASCII noise texture
   *  under the field. Off by default; unused by this (legacy) Canvas2D renderer. */
  backgroundNoise?: boolean;
  // --- Not a settings-backed field: no settingsSchema entry, and no real caller sets it. Retained
  // implementation of the aggregate-mass LOD; unreachable from the app — only
  // AsciiGraphRenderer.test.ts / lod.test.ts set it. ---
  /** AsciiGraphRenderer only: opt IN to LOD cluster summarization (aggregate entity masses +
   *  aggregate edges) at coarse zoom stops — OFF by default. The shipped ASCII field renders every
   *  individual node as a glyph at every zoom stop instead, with the hierarchy read through
   *  zoom-driven node COLOR + the cluster-name labels (see AsciiGraphRenderer.ts colorLevelsFor /
   *  the LEVEL-DRIVEN COLOR block) rather than an aggregate mass. Retained implementation of the
   *  aggregate-mass LOD; unreachable from the app — only AsciiGraphRenderer.test.ts / lod.test.ts
   *  set it. */
  showLodMasses?: boolean;
}

/** The node currently under the cursor, surfaced to GraphView for the hover readout. "cluster" is
 *  the ASCII renderer's LOD aggregate entity (a community mass, not a real graph node). */
export interface HoverNode {
  id: string;
  label: string;
  kind: NodeKind | "cluster";
  folder?: string;
}
import { nodeVisualState } from "../../../core/src/daemonViz";
import {
  clusterLabelAlpha, clusterLabelText, clusterLevelAlphas, fileLabelAlpha,
} from "./labelSelection";
import { hashKey, intToHex, paletteColorInt } from "../themeColors";
import { isUsableBox, finiteVec3, boundingRadius, fitScale } from "./graphFit";
import { structuralGraphSig, shouldResetView } from "./graphStability";

const FOV_DEG = 60; // matches the old PerspectiveCamera so framing carries over
const FIT_FRACTION = 0.47; // graph's resting on-screen radius as a fraction of min(W,H)
const DRAG_THRESHOLD = 5; // px of motion before a press becomes an orbit/pan (vs. a click)
const GLIDE = 0.16; // per-frame easing toward the camera goal (focus/frame fly-to)
const MODE_MORPH_MS = 500; // 2D<->3D flatten/expand glide
const ORBIT_SPEED = 0.005; // rad per px of drag

// --- scale tuning (easy to nudge) ---
const LINK_SPREAD = 6;        // CONSTANT link-distance multiplier — does NOT change with node count
const SPIN_MAX_NODES = 350;   // idle-spin only for graphs this small
// Widened 2026-07-29: leaves were only ~3x smaller than hubs, so the field read as uniform specks.
// Every reference for this look has hubs several times a leaf's diameter — degree has to be legible
// from size alone.
const NODE_SIZE_SCALE = 0.62; // overall node-size multiplier (tuning knob; lower = smaller dots)
const NODE_LEAF_FRAC = 0.17;  // node diameter as a fraction of on-screen link spacing (a 0-degree leaf)
const NODE_DEG_GAIN = 0.22;   // extra diameter fraction per sqrt(degree) — degree is read clearly in size
const NODE_MAX_FRAC = 1.15;   // cap: a big hub may exceed the local spacing (it is the mass's centre)
const SELF_FRAC = 0.5;        // the "you" hub's diameter as a fraction of spacing
const MIN_DOT_PX = 1.6;       // below this projected diameter a node is hidden
const MAX_DOT_PX = 60;        // cap the resting diameter so tiny graphs (1 "you" node) don't blow up
/** The mono family the graph's labels use (Monaspace Xenon, bundled — see design/ascii). */
const MONO_STACK = '"Monaspace Xenon", ui-monospace, SFMono-Regular, Menlo, monospace';
// Breathing room kept clear around the "you" hub (see clearAroundSelf). The RADIUS is a
// world-space quantity — expressed as a fraction of the fitted graph radius and projected
// through the hub's own perspective scale — so the cleared region zooms WITH the graph like any
// other world geometry (a fixed screen-px ring warped neighbours differently at every zoom
// level, reading as the hub's space "growing and shrinking on zoom"). The nodes' DRAWN radii
// are still added in screen px as a pure anti-overlap floor, so a big-drawn dot in a sparse,
// zoomed-in graph can never graze the hub's circle. This is the ONLY clear-zone pass.
const SELF_CLEAR_FRAC = 0.05;
/** The wheel's zoom-IN stop as a fraction of P (mirrors onWheel's clamp). `zoomT` normalises the
 *  hierarchy ladder over exactly this range, so "fully zoomed in" is t = 1 by construction. */
const MAX_ZOOM_FRAC = 0.94;
/** Ceiling on non-forced file labels drawn in a frame — the ONLY density limit on them now that the
 *  zoom-driven budget ramp is gone (see drawLabels). Also bounds the O(k²) overlap rejection to a few
 *  thousand comparisons. Forced labels (active/hovered/search) are exempt — they always draw. */
const MAX_FILE_LABELS = 140;
/** Cluster-name (eyebrow) type: uppercase + tracked, drawn a step up from file labels so the two
 *  tiers read as different registers rather than same-size text fighting each other. */
/** 11/19 was too big — the coarsest level's names dominated the field. These sit at and just above
 *  the file-label size (11px), so a cluster name reads as a different REGISTER (uppercase + tracked)
 *  rather than by sheer size. */
const CLUSTER_LABEL_MIN_PX = 9;
const CLUSTER_LABEL_MAX_PX = 13;
/** Cap on cluster names drawn per LEVEL per frame, biggest communities first. The detector finds
 *  ~170 communities at the coarsest level of a 2k-node vault — but only ~8 of those are real masses;
 *  the rest is 140-odd singletons and a long tail of 2-6 node scraps. Naming the tail is what made
 *  the field read as scattered text over nothing, so a name must clear BOTH of these. */
/** How far ABOVE its anchor a cluster name is drawn. The anchor is the group's hub — its densest
 *  point — so a centred name lands on top of the dots and neither the name nor the mass reads. */
/** How far the theme's palette saturation is pushed for GRAPH NODE fills only (the theme tokens
 *  themselves are untouched — they are right for chrome). A 2-4px dot on a dark field loses most of its
 *  apparent chroma; the reference look for this graph is saturated cluster colour. */
const NODE_SAT_BOOST = 1.55;
/** Alpha of the intra-cluster mesh. Low, because there are thousands of these lines and they are meant
 *  to accumulate into a tint over the mass rather than read as individual connections. */
const INTRA_EDGE_ALPHA = 0.22;
const CLUSTER_LABEL_LIFT_PX = 10;
/** Ceiling on the extra lift added for the group's own on-screen extent — past this the name has
 *  drifted so far from the mass that it stops reading as its label. */
const CLUSTER_LABEL_MAX_LIFT_PX = 46;
const MAX_CLUSTER_LABELS_BASE = 10;
/** ...plus this many per level as you descend. A deeper level legitimately HAS more groups (11 → 23 →
 *  44 → 59 real ones on the reference vault), and you are zoomed in when you reach it, so a fixed cap
 *  either starves the deep levels or floods the coarse ones. */
const MAX_CLUSTER_LABELS_PER_LEVEL = 6;
/** Cap on GROUP-LEVEL lines drawn per hierarchy level, heaviest first (see buildLevelEdges). Measured
 *  on the reference vault's 5-level hierarchy, the connected-pair count per level is
 *  22 / 75 / 232 / 578 / 1221 — so this only ever truncates the two DEEPEST levels, which are the ones
 *  you are already zoomed into (most of their lines are off-frame) and which are handing over to the
 *  real member edges anyway. The coarse levels, where the whole field is in view and clutter actually
 *  matters, are far below the cap and never truncated. */
const MAX_LEVEL_PAIRS = 700;
/** Minimum share of the visible graph a community needs before it gets a name, and an absolute
 *  floor for small graphs. On the reference vault 1.5% ≈ 32 nodes, which admits exactly the handful
 *  of genuine masses at each level and drops the scraps. */
const CLUSTER_LABEL_MIN_SHARE = 0.015;
const CLUSTER_LABEL_MIN_MEMBERS = 6;
/** Slack (px) outside the canvas within which a node still counts as visible for labelling — a node
 *  just off the edge whose label would still poke in. See `inViewport`. */
const VIEWPORT_LABEL_MARGIN_PX = 40;
/** Where the group ladder ends and individual notes begin, on this renderer's `zoomT` scale.
 *  labelSelection.ts's own default (0.75) was written for the ASCII field's much longer resolution
 *  ladder — ~68× magnification versus this camera's ~17× (the wheel's zoom-in stop; it cannot go much
 *  past MAX_ZOOM_FRAC without pushing nodes through the near plane). At 0.75 the reveal landed at ~8×,
 *  the last few percent of wheel travel, so nearly the whole range showed one grouping and zooming in
 *  appeared to change nothing.
 *  0.62 divides the range as: the hierarchy's levels share [0, 0.62) — with 5 levels that is a
 *  boundary roughly every 1.4× of magnification, so each rung is a short, distinct step — and
 *  individual notes own [0.62, 1], i.e. from ~5.8× to the stop. Passed explicitly to EVERY curve so
 *  the group lines, the node colour and the labels all share one set of boundaries. */
const CANVAS_REVEAL_T = 0.62;
const DEPTH_MIN_OPACITY = 0.04; // farthest node's opacity (strong depth cue)
const DEPTH_CURVE = 2.4;      // >1 = back fades faster (stronger depth cue)
const BACK_INTERACT_CUTOFF = 0.18; // 3D nodes whose depth rank is below this aren't hover/click targets
const GOLDEN_ANGLE_RAD = 2.39996323; // golden angle (rad) → even angular distribution for coincident/origin nodes
// Dense-graph edge thinning is per-mode: 2D thins hard (flat view clutters fast), 3D keeps more
// (depth fade already declutters). Each edge has a stable rank; we draw it if rank < the mode's frac.
// 600 -> 6000 (2026-07-29). At 600 a 4537-edge vault drew 13% of its edges in 2D, which is why the
// clusters rendered as bare dot clouds instead of the woven masses every reference for this look has:
// a cluster's BODY is its own internal edges. Thinning was there to stop a grey hairball — the actual
// fix for that is drawing intra-cluster edges in the CLUSTER'S colour (see the edge pass), so density
// reads as mass rather than noise. Kept as a very high ceiling, not removed, so a pathological graph
// still degrades instead of stalling.
const EDGE_BUDGET_2D = 6000; const EDGE_FLOOR_2D = 0.06;
const EDGE_BUDGET_3D = 6000; const EDGE_FLOOR_3D = 0.45;

const DEFAULT_PALETTE = [0xf0509b, 0x9b53e8, 0x3f6bf0, 0x27c7d9, 0x43d49a, 0xf2c53d];

// Vivid, saturated accents reserved for workflow lanes in agents mode — deliberately
// distinct from the muted grey ordinary edge colour so a workflow's subagent tree reads
// as one grouped lane. Each concurrent workflow hashes to a stable colour from this set.
const WORKFLOW_LANE_PALETTE = [0xf2c53d, 0x27c7d9, 0xf0509b, 0x43d49a, 0x9b53e8];

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
  /** Packed colour per HIERARCHY LEVEL, coarsest → finest — hashed once in restyle(), never per
   *  frame. `colorByLevel[L]` is what this node reads as when level L is the active one; the last
   *  entry is `colorInt`. Length 1 for a node with no hierarchy (self/daemon/cron, or a graph the
   *  detector gave a single level), which every consumer treats as "fixed colour, never blended" —
   *  degenerating to exactly the pre-hierarchy behaviour. See LEVEL-DRIVEN COLOUR. */
  colorByLevel: number[];
  deg: number; // undirected degree (drives node size)
  scale: number; // degree-based collision multiplier (for the settle)
  baseDiameter: number; // resting (pre-perspective) diameter — cached per fit(), see computeBaseDiameters
  sx: number; sy: number; depth: number; pscale: number; onScreen: boolean; // per-frame scratch
  dr: number; // per-frame depth rank (0 far..1 near), precomputed once in projectPositions — see depthRank()
  lastZi: number; lastDotSize: number; shown: boolean;
  labelW: number; // cached ctx.measureText(text).width for this node's label; -1 = needs (re)measuring
}
interface EdgeView {
  a: NodeView; b: NodeView; kr: number; workflow?: string; // kr = stable 0..1 rank for per-mode thinning; workflow = agents-mode workflow-lane group key
  /** SHALLOWEST hierarchy level at which this edge's two endpoints fall in DIFFERENT communities —
   *  i.e. the coarsest zoom at which the edge is a connection BETWEEN the things being shown, rather
   *  than a wire buried inside one of them. `levelCount` means the endpoints share their whole path
   *  (an intra-finest-community edge), which is only "between the things shown" once individual notes
   *  are what's on screen. Because the detector's levels are strictly NESTED, endpoints that differ at
   *  level L also differ at every deeper level — so this single number fully determines visibility:
   *  the edge belongs to every level from `crossLevel` down. See the edge pass in drawCanvas. */
  crossLevel: number;
}

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

/** Words a cluster name must not END on. Exemplar names are real note titles clipped to fit
 *  (`clusterLabelText`), so the clip regularly leaves a dangling conjunction or preposition —
 *  "LUDWIG FEUERBACH AND" reads as a sentence cut off mid-thought rather than as a region's name.
 *  Uppercase because the trim runs AFTER `clusterLabelText` has already cased + clipped. */
const DANGLING_WORDS = new Set([
  "AND", "OR", "OF", "THE", "A", "AN", "IN", "ON", "AT", "TO", "FOR", "WITH", "FROM", "BY", "AS", "IS", "VS",
]);
/** Drop trailing dangling words (repeatedly — "THE LOSS IN THE" loses both). Never returns empty:
 *  a name made only of such words keeps its first word. */
function trimDanglingWord(s: string): string {
  const w = s.split(/\s+/).filter(Boolean);
  while (w.length > 1 && DANGLING_WORDS.has(w[w.length - 1])) w.pop();
  return w.join(" ");
}

/** The hierarchy path used for both colour and edge levels, with the pre-hierarchy fallbacks. */
function pathOf(n: GraphNode): number[] | null {
  if (n.communityPath?.length) return n.communityPath;
  return n.community != null ? [n.community] : null;
}

/** See `EdgeView.crossLevel`. An edge touching a node with no community at all (the "you" hub, the
 *  daemon nodes) belongs to level 0 — those nodes are never inside a cluster, so their connections
 *  are structural and read at every zoom. */
function crossLevelOf(a: GraphNode, b: GraphNode): number {
  const pa = pathOf(a), pb = pathOf(b);
  if (!pa || !pb) return 0;
  const len = Math.min(pa.length, pb.length);
  for (let L = 0; L < len; L++) if (pa[L] !== pb[L]) return L;
  return len; // identical the whole way down — an intra-finest-community edge
}

function easeInOutCubic(t: number): number { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function rgbToHsl(c: number): [number, number, number] {
  const r = ((c >> 16) & 0xff) / 255, g = ((c >> 8) & 0xff) / 255, b = (c & 0xff) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = 0;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, sat, l];
}
function hslToRgb(h: number, sat: number, l: number): number {
  h = ((h % 1) + 1) % 1;
  if (sat === 0) { const v = Math.round(l * 255) & 0xff; return (v << 16) | (v << 8) | v; }
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
  const ch = (t: number) => {
    t = ((t % 1) + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t
      : t < 1 / 2 ? q
      : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6
      : p;
    return Math.round(v * 255) & 0xff;
  };
  return (ch(h + 1 / 3) << 16) | (ch(h) << 8) | ch(h - 1 / 3);
}

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
  private sig = ""; // STRUCTURAL signature (structuralGraphSig): node set + edges + daemon state, NO positions
  private colorSig = ""; // gate node recolouring so mode toggles don't rewrite 2k colours
  // ---- hierarchy (level-driven colour + the cluster-name label ladder) ----
  private levelCount = 1;                      // deepest communityPath in the graph (1 = no hierarchy)
  private hexCache = new Map<number, string>();  // packed int -> "#rrggbb", palette-sized
  private blendCache = new Map<number, string>();// (levelA,levelB) pair -> lerped hex, for the CURRENT w1
  private blendW1 = -1;                          // w1 the blendCache was built for; a change invalidates it
  // per-frame scratch for the cluster-name pass (`hub` = the community's highest-degree visible
  // member, which is what the name anchors to — see drawClusterNames)
  private clusterAgg = new Map<number, { n: number; label: string; color: number; hub: NodeView; rad: number }>();
  private labelScratch: NodeView[] = [];         // per-frame scratch for the ranked file-label candidates
  private labelBoxes: number[] = [];             // per-frame scratch: drawn label boxes (x0,y0,x1,y1 quads)
  private edgeLevelW: number[] = [];             // per-frame visibility weight per hierarchy level
  private intraBuckets = new Map<number, EdgeView[]>(); // per-frame scratch: intra-cluster edges by colour
  /** Per hierarchy level (index = level, coarsest first): the GROUP-LEVEL edges — one entry per pair
   *  of that level's communities that any real edge connects, anchored on each community's hub, with
   *  `count` real edges behind it. This is what "lines between the groups at this zoom" draws. Static
   *  (hubs are highest-degree members, communities don't move), so it is built once per build(). */
  private levelPairs: { a: NodeView; b: NodeView; count: number }[][] = [];
  /** Per hierarchy level: community id → its hub NodeView (highest degree, ties on id). Also what the
   *  cluster-NAME pass anchors on, so a group's name and its lines meet at the same point. */
  private levelHubs: Map<number, NodeView>[] = [];
  /** Per hierarchy level: community id → its packed colour, assigned by size rank (buildColorSlots). */
  private colorSlots: Map<number, number>[] = [];
  private p3Cache = new Map<string, Map<string, Vec3>>(); // settled 3D positions per structural signature
  private p2Cache = new Map<string, Map<string, Vec3>>(); // settled 2D positions per structural signature
  private radius3 = 1; private radius2 = 1; // layout extent per view
  private scale3 = 1; private scale2 = 1;   // world-units -> px fit per view
  private fitPx = 1;                          // on-screen fit radius (px); node size derives from DENSITY, not layout scale
  private minZ = 0; private maxZ = 1;        // last frame's projected depth range

  // viewport geometry
  private W = 1; private H = 1; private cx = 0.5; private cy = 0.5; private P = 1; private worldScale = 1;
  private fitMargin = 1; private viewOffsetY = 0; // extra fit zoom-out + vertical offset (used by the intro graph)
  // True once measure() has seen a real (non-degenerate) host box. The floating graph is re-placed
  // across slots and re-sized twice (once immediately, once ~280ms after a pane transition settles);
  // a measurement taken mid-layout at 0/1px is IGNORED (we keep the last good geometry) rather than
  // fitted to — fitting to a ~0px box collapses every node onto a point ("spacing goes weird before
  // it settles"). Until the first usable box arrives we also skip painting so no collapsed frame
  // shows. See measure()/fit()/drawCanvas().
  private boxReady = false;

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

  // callbacks
  private onNodeClick: (id: string) => void = () => {};
  private onHover: (n: HoverNode | null) => void = () => {};
  private onFps?: (fps: number) => void;
  private onBloom?: (field: DensityField) => void;
  /** Fired when an empty-space click clears a persistent highlight — lets the view (e.g. the
   *  cluster legend's selected row) drop its own selection state in sync. */
  onHighlightCleared?: () => void;
  /** Fired at the end of EVERY drawCanvas pass (i.e. once a usable host box has been measured —
   *  see `boxReady`/drawCanvas), with the number of nodes actually drawn that frame. Called
   *  synchronously, in-line with the draw — no rAF, no allocation, one call per frame. Used by
   *  App's boot splash: a single callback firing doesn't by itself mean "the graph is on screen
   *  with real data" (an early paint can land before the fetch resolves) — the caller correlates
   *  this against its own data-ready state to decide what a paint means. */
  private onPaint?: (nodeCount: number) => void;

  // loop
  private raf = 0; private running = false; private visible = true; private dirty = true;
  private lastFrameT = 0; private fpsAccum = 0; private fpsFrames = 0; private nowMs = 0;

  // label fonts (hoisted so the label loop doesn't rebuild the font string every label every frame)
  private readonly FONT_SELF = `700 14px ${MONO_STACK}`;
  private readonly FONT_NODE = `500 11px ${MONO_STACK}`;

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
    this.onBloom = undefined; // detach — a torn-down renderer must not hold a stale bloom sink
  }

  setFpsCallback(cb: (fps: number) => void) { this.onFps = cb; }
  setBloomCallback(cb: ((field: DensityField) => void) | undefined) { this.onBloom = cb; }
  setPaintCallback(cb: (nodeCount: number) => void) { this.onPaint = cb; }
  setVisible(visible: boolean) { this.visible = visible; if (visible) { this.dirty = true; this.start(); } else this.stop(); }
  /** Zoom the resting fit out by this factor (>1 = smaller graph). Used by the intro graph. */
  setFitMargin(m: number) { this.fitMargin = Math.max(0.2, m); this.fit(); }
  /** Shift the whole view down by this fraction of the viewport height. Used by the intro graph. */
  setFrameOffsetY(frac: number) { this.viewOffsetY = frac; this.dirty = true; }

  // ---- data ----------------------------------------------------------------

  render(g: GraphData) {
    if (!this.host) return;
    // Key the render decision on the graph's STRUCTURE ONLY (nodes + edges + daemon state), NOT its
    // coordinates (structuralGraphSig). When the structure is unchanged, keep the shape + camera we
    // already settled even if the backend handed back different position numbers — the async
    // 2nd/3rd-brain view layout replacing the full-graph fallback, a boot localStorage→server
    // reconcile, or a warm re-settle that nudged a node a few px. This is the stability guarantee:
    // the same graph never spontaneously re-shapes (nor snaps the camera to overview) on a
    // re-fetch/resize/content-edit. Only styling is refreshed. (Positions were previously folded in
    // here, which made every one of those benign re-fetches a jarring rebuild.)
    const struct = structuralGraphSig(g);
    if (struct === this.sig && this.nodes.length) { this.restyle(); return; }
    // A genuinely new/changed graph. Reset the camera back to the whole-graph overview ONLY when the
    // visible node set changed substantially (a mode switch, or the first-ever graph) — an
    // incremental edit to the graph you're already looking at (add/remove a note, open a tab so the
    // "you" hub gains an "open" edge) preserves the user's current zoom/pan/orbit instead of yanking
    // it. `this.byId` still holds the PREVIOUS node set here (build() replaces it below).
    const resetCamera = shouldResetView(new Set(this.byId.keys()), g.nodes);
    this.sig = struct;
    this.build(g, resetCamera);
  }

  private build(g: GraphData, resetCamera = false) {
    this.measure();
    // adjacency + degree
    this.adjacency.clear();
    const deg = new Map<string, number>();
    for (const e of g.edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
      this.link(e.from, e.to); this.link(e.to, e.from);
    }

    // Center on the CONTENT centroid EXCLUDING any "you" hub — NOT self.position. No mode
    // currently injects a self node (see App.tsx displayGraph), but a hub, if one is ever added
    // back, is typically placed at the origin [0,0,0], so centering on it would frame the empty
    // origin instead of the real cloud's center of mass. The exclusion mirrors scaleToSpacing,
    // which scales about the same self-excluded centroid; using the same origin here keeps the
    // initial p3/p2 centered on the cloud before any rescale runs. Falls back to the all-node
    // centroid when there are no non-self nodes.
    // Sanitize every coordinate to a finite triple first: a stray NaN/Infinity (stale localStorage
    // cache, a node still awaiting layout, a diverged force tick) would otherwise poison the centroid
    // and the fit radius, turning worldScale into NaN and blanking/exploding the whole cloud.
    const c3 = this.centroid(g.nodes.filter((n) => n.kind !== "self").map((n) => finiteVec3(n.position)));
    const c2 = this.centroid2(
      g.nodes.filter((n) => n.kind !== "self").map((n) => { const v = finiteVec3(n.position2d); return [v[0], v[1]] as [number, number]; }),
    );

    // hovered/highlight state is stale across modes
    this.hoveredId = null; this.highlightSet = null;
    const mkNode = (node: GraphNode): NodeView => {
      const p = finiteVec3(node.position);
      const p2 = finiteVec3(node.position2d, [p[0], p[1], 0]);
      const d = deg.get(node.id) ?? 0;
      return {
        node, p3: [p[0] - c3[0], -(p[1] - c3[1]), p[2] - c3[2]], p2: [p2[0] - c2[0], -(p2[1] - c2[1]), 0],
        colorInt: 0, colorHex: "#888", colorByLevel: [0], deg: d, scale: this.collideScale(node, d), baseDiameter: 0,
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
      if (a && b) {
        this.edges.push({
          a, b, kr: (hashKey(e.from + "\0" + e.to) % 1000) / 1000, workflow: e.workflow,
          crossLevel: crossLevelOf(a.node, b.node),
        });
      }
    }

    this.settled2D = false;
    this.settlePositions();
    // Eagerly settle the 2D layout too (not lazily on first 2D reveal). A mode switch can happen
    // WHILE the renderer is already showing 2D — if p2/radius2 were still stale at that point the
    // flat view would morph using the previous graph's center/extent and look unbalanced. Running
    // ensure2D's exact pass here (same n>=2 + no-intentional-layout + cache guards) makes radius2/p2
    // correct immediately. radius2 below is then recomputed from the settled p2 (not the seed).
    this.ensure2D();

    // Fit radius per view — floored at 1 and finite-guarded (boundingRadius) so a degenerate or
    // non-finite cloud can never drive worldScale to 0/Infinity/NaN (collapse/explode/blank).
    this.radius3 = boundingRadius(this.nodes.map((nv) => nv.p3));
    this.radius2 = boundingRadius(this.nodes.map((nv) => nv.p2));

    this.restyle();
    this.fit(resetCamera);
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
    this.radius2 = boundingRadius(this.nodes.map((nv) => nv.p2));
    this.scale2 = fitScale(Math.min(this.W, this.H) * FIT_FRACTION, this.radius2);
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
    let levels = 1;
    for (const nv of this.nodes) {
      const p = pathOf(nv.node);
      if (p && p.length > levels) levels = p.length;
    }
    this.levelCount = levels;
    this.buildColorSlots();
    for (const nv of this.nodes) {
      const byLevel = this.colorLevelsFor(nv.node);
      nv.colorByLevel = byLevel;
      nv.colorInt = byLevel[byLevel.length - 1]; // finest level — the pre-hierarchy meaning, unchanged
      nv.colorHex = intToHex(nv.colorInt);
      nv.lastDotSize = -1;
      nv.labelW = -1; // label text isn't reassigned here, but reset defensively — a re-measure is cheap and yields the same value
    }
    this.blendCache.clear(); this.blendW1 = -1;
    // The group-level edge sets and the per-level hubs depend on levelCount, so they are (re)built
    // HERE rather than in build() — restyle() is also the path an incremental rebuild takes.
    this.buildLevelEdges();
    this.dirty = true; // the canvas reads colorHex on the next frame
  }

  /**
   * Per-level colour assignment, by community SIZE RANK rather than by hashing the community id.
   *
   * Hashing (`paletteColor`) was the original scheme and it does not work for a hierarchy: the palette
   * holds 5-6 colours, the coarsest level of a real vault has ~9-11 substantial groups, and independent
   * hashes collide freely — on the reference vault nearly every big top-level group landed on the same
   * teal, so the field read as one colour and the grouping was invisible. Ranking by member count
   * instead GUARANTEES the biggest groups (the ones actually visible as masses) get distinct slots, and
   * assigns them deterministically: same graph, same colours.
   *
   * Groups past the palette length wrap around, and each wrap gets a lightened/darkened variant of the
   * slot so the second and third cycles are still distinguishable from the first rather than exact
   * duplicates. Ranking is by size, ties by community id, so it is stable across rebuilds.
   */
  private buildColorSlots() {
    this.colorSlots = [];
    const pal = this.cfg.palette;
    const palLen = Math.max(1, pal.length);
    for (let L = 0; L < this.levelCount; L++) {
      const size = new Map<number, number>();
      for (const nv of this.nodes) {
        const p = pathOf(nv.node);
        if (!p) continue;
        const c = p[Math.min(L, p.length - 1)];
        size.set(c, (size.get(c) ?? 0) + 1);
      }
      const ranked = [...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const slots = new Map<number, number>();
      ranked.forEach(([c], rank) => {
        const base = pal[rank % palLen] ?? 0x888888;
        const cycle = Math.floor(rank / palLen);
        const [h, sat, l] = rgbToHsl(base);
        // Wrap cycles ROTATE HUE, they do not lighten. Lightening was the first attempt and it is what
        // washed the whole field out to near-white — the theme's ramp is already pastel, so blending it
        // toward white produced pale smears with no colour identity at all. A hue rotation of half a
        // palette step keeps every variant as vivid as the base.
        const hue = h + (cycle * 0.5) / palLen;
        // Node fills are also pushed toward the saturated end of the theme's own hue. The ink ramp sits
        // near 35% saturation, which is right for UI chrome and much too weak for thousands of 2-4px
        // dots on a dark field: the colour has to survive being a speck. Lightness is nudged up a
        // little for the same reason, and both are clamped so a theme's character is intensified rather
        // than replaced.
        slots.set(c, hslToRgb(hue, Math.min(0.85, sat * NODE_SAT_BOOST), Math.min(0.72, l * 1.06)));
      });
      this.colorSlots.push(slots);
    }
  }

  /** Level-by-level colour for one node, coarsest → finest — resolved ONCE in restyle() (never per
   *  frame; the per-frame consumer is `levelColorOf` in the draw pass) from the size-ranked slot table
   *  above. A node with no community — self/daemon/cron, or a graph mode that never stamps one —
   *  returns a length-1 array, i.e. the original fixed colour, never blended. */
  private colorLevelsFor(n: GraphNode): number[] {
    if (n.kind === "self" || n.kind === "daemon" || n.kind === "cron" || n.kind === "process") {
      return [this.colorFor(n)];
    }
    const path = pathOf(n);
    if (!path) return [this.colorFor(n)];
    return path.map((c, L) => this.colorSlots[Math.min(L, this.colorSlots.length - 1)]?.get(c) ?? this.colorFor(n));
  }

  /** The [0,1] zoom progress the whole hierarchy ladder — cluster-name levels, the cluster→file
   *  label crossfade, and the node-colour blend — is keyed off. It is the BRIDGE between this
   *  renderer's continuous perspective dolly and the level curves in labelSelection.ts, which were
   *  written against the ASCII field's discrete resolution ladder.
   *
   *  0 = the resting overview (zoom 0, whole graph fitted — and anything further OUT clamps here);
   *  1 = the wheel's zoom-in stop. LOGARITHMIC in magnification, matching the ladder those curves
   *  assume (`resFromT` = maxRes^t): each equal step of t is an equal MULTIPLE of magnification, so
   *  the hierarchy levels are evenly spaced perceptually rather than all bunching up near the stop
   *  (the dolly's magnification accelerates hard as `zoom` approaches P). On a 3-level vault the
   *  boundaries land at roughly 2×, 4× and 8× magnification, with file names revealing past 8×. */
  private zoomT(): number {
    const zs = this.P / Math.max(1, this.P - this.zoom); // == the dolly magnification, as in drawCanvas
    if (zs <= 1) return 0;
    const maxZs = this.P / Math.max(1, this.P - MAX_ZOOM_FRAC * this.P);
    const t = Math.log(zs) / Math.log(Math.max(1.0001, maxZs));
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /** This node's colour THIS FRAME: the active level's slot, or a lerp of the two levels being
   *  crossfaded. Hex strings are memoised (`blendCache`) — the pair space is palette² ≈ 36 entries,
   *  so the cache is tiny and the per-node cost is one Map lookup instead of an int→hex build. */
  private levelColorOf(nv: NodeView, L0: number, L1: number, w1: number): string {
    const cbl = nv.colorByLevel;
    if (cbl.length <= 1) return nv.colorHex; // no hierarchy — fixed colour, never blended
    const a = cbl[Math.min(L0, cbl.length - 1)];
    if (w1 <= 1e-3) return this.hexOf(a);
    const b = cbl[Math.min(L1, cbl.length - 1)];
    if (a === b) return this.hexOf(a); // same community both sides — nothing to blend
    const key = a * 16777216 + b;
    let hex = this.blendCache.get(key);
    if (hex === undefined) { hex = intToHex(lerpInt(a, b, w1)); this.blendCache.set(key, hex); }
    return hex;
  }

  /**
   * Build the GROUP-LEVEL edge sets — the "lines between the groups at this zoom".
   *
   * For each hierarchy level, every real edge whose endpoints fall in DIFFERENT communities at that
   * level contributes to one group-to-group line, drawn hub-to-hub with the number of real edges
   * behind it as its weight. Edges buried inside a single community at that level contribute nothing
   * — at that zoom they are wires inside a thing, not connections between things.
   *
   * This replaced a first attempt that instead FILTERED the member-level edges (drawing the real
   * node-to-node edges that happened to cross a boundary). That is not the same picture: it still
   * draws hundreds of lines fanning into the middle of blobs, so it reads as "some edges are missing"
   * rather than as a graph OF the clusters — which is why the intended behaviour looked absent.
   *
   * Static: hubs are highest-degree members and communities don't move, so this is build-time work.
   * Cost is O(levels × edges); the pair maps are dropped straight after.
   */
  private buildLevelEdges() {
    const n = this.levelCount;
    this.levelHubs = [];
    this.levelPairs = [];
    for (let L = 0; L < n; L++) {
      // Hubs first — the anchors both the lines and the names use.
      const hubs = new Map<number, NodeView>();
      for (const nv of this.nodes) {
        const path = pathOf(nv.node);
        if (!path) continue;
        const cid = path[Math.min(L, path.length - 1)];
        const cur = hubs.get(cid);
        if (!cur || nv.deg > cur.deg || (nv.deg === cur.deg && nv.node.id < cur.node.id)) hubs.set(cid, nv);
      }
      this.levelHubs.push(hubs);
      // Then the group-to-group pairs, deduped by (lower, higher) community id.
      const pairs = new Map<string, { a: NodeView; b: NodeView; count: number }>();
      for (const e of this.edges) {
        if (e.crossLevel > L) continue; // buried inside one community at this level
        const pa = pathOf(e.a.node), pb = pathOf(e.b.node);
        if (!pa || !pb) continue;
        const ca = pa[Math.min(L, pa.length - 1)], cb = pb[Math.min(L, pb.length - 1)];
        if (ca === cb) continue;
        const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
        const key = `${lo}\0${hi}`;
        const found = pairs.get(key);
        if (found) { found.count++; continue; }
        const ha = hubs.get(lo), hb = hubs.get(hi);
        if (ha && hb) pairs.set(key, { a: ha, b: hb, count: 1 });
      }
      // Heaviest first, capped: the finest levels have hundreds of groups and so potentially thousands
      // of pairs, which would put the hairball straight back. The heaviest pairs are the real
      // structure; a 1-edge link between two 5-node groups is noise at that zoom.
      const list = [...pairs.values()].sort((x, y) => y.count - x.count);
      this.levelPairs.push(list.slice(0, MAX_LEVEL_PAIRS));
    }
  }

  /**
   * Per-frame weight for each hierarchy level's group-edge set, plus the weight of the real
   * member-level edges (stored at index `levelCount`).
   *
   * Straight off the SAME `clusterLevelAlphas` partition of unity the node colour and the cluster
   * names use, so all three cross their boundaries on the same frame: level L's group lines are
   * visible exactly when level L is the grouping being shown, crossfading into level L+1's. The real
   * node-to-node edges ride `fileLabelAlpha` — they arrive with the file names, when individual notes
   * are what is on screen.
   */
  private computeEdgeLevelWeights(t: number) {
    const n = this.levelCount;
    const w = this.edgeLevelW;
    w.length = n + 1;
    if (n <= 1) {
      // No hierarchy to read (a small or community-less graph) — behave exactly as the graph always
      // did: real edges at full strength, no group lines.
      w[0] = 0; w[1] = 1;
      return;
    }
    const levelAlphas = clusterLevelAlphas(t, n, CANVAS_REVEAL_T);
    for (let L = 0; L < n; L++) w[L] = levelAlphas[L];
    w[n] = fileLabelAlpha(t, CANVAS_REVEAL_T);
    // The finest level's group lines and the real edges would otherwise both be up at full zoom
    // (clusterLevelAlphas pins [0,…,0,1] past the reveal point), double-drawing the same structure.
    // Hand the finest level over as the real edges fade in.
    w[n - 1] *= 1 - w[n];
  }

  /** Is this node inside the actual VIEWPORT (not merely in front of the camera)? `onScreen` only
   *  culls by depth, so at any zoom past the overview most of the graph is `onScreen` but far off the
   *  sides. Every label decision has to use this instead: otherwise the file-label budget is spent
   *  ranking global hubs that are off-frame, which is why zooming in used to surface no new names,
   *  and a cluster's member count / anchor would describe nodes the user can't see. */
  private inViewport(nv: NodeView): boolean {
    if (!nv.onScreen) return false;
    const m = VIEWPORT_LABEL_MARGIN_PX;
    return nv.sx >= -m && nv.sx <= this.W + m && nv.sy >= -m && nv.sy <= this.H + m;
  }

  private hexOf(i: number): string {
    let h = this.hexCache.get(i);
    if (h === undefined) { h = intToHex(i); this.hexCache.set(i, h); }
    return h;
  }

  /** Which (at most two) hierarchy levels are active for `levelAlphas` — the SAME partition of unity
   *  driving the cluster-name crossfade — and the blend weight between them. L0 dominates; `w1` is
   *  L1's share renormalised over just the two, so it is exactly the lerp weight even on a frame
   *  where a third level carries a sub-epsilon residual. Collapses to `w1 = 0` (pure L0) whenever one
   *  level owns the frame, which is what `clusterLevelAlphas` returns at/after the reveal point. */
  private activeColorLevels(levelAlphas: number[]): { L0: number; L1: number; w1: number } {
    let L0 = 0, a0 = -1;
    for (let i = 0; i < levelAlphas.length; i++) if (levelAlphas[i] > a0) { a0 = levelAlphas[i]; L0 = i; }
    let L1 = L0, a1 = 0;
    for (let i = 0; i < levelAlphas.length; i++) {
      if (i === L0) continue;
      if (levelAlphas[i] > a1) { a1 = levelAlphas[i]; L1 = i; }
    }
    const total = a0 + a1;
    return { L0, L1, w1: total > 1e-6 ? a1 / total : 0 };
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

  /** Compute screen pos + depth for every node (no DOM writes). Inlines the camera projection
   *  (world -> orbit rotation -> perspective divide) plus the old coordFor() morph-lerp (now
   *  folded in here, since this was its only caller) with the per-frame-constant trig/target/
   *  origin values hoisted out of the loop, and no per-node result object allocated. This is the
   *  single projection pass for the frame — emitBloom() reads the sx/sy/pscale it writes rather
   *  than re-projecting. */
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
    // Ignore a degenerate mid-layout box: fitting to a ~0px box collapses the whole cloud onto a
    // point until the real box arrives (the "weird spacing before it settles" transient). Keep the
    // last good W/H/canvas instead; the ResizeObserver fires again with the real box moments later.
    if (!isUsableBox(r.width, r.height)) { if (!this.boxReady) this.dirty = true; return; }
    this.boxReady = true;
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

  /** Recompute the world→px fit for the current box + layout extent. `resetCamera` (only a genuinely
   *  new graph — first load / mode switch) also snaps the camera back to the whole-graph overview.
   *  A resize or an incremental rebuild passes false, so the user's zoom/pan/orbit is PRESERVED
   *  (positions just rescale to the new box) instead of yanked back to overview on every edit. */
  private fit(resetCamera = false) {
    // Don't fit to a not-yet-measured (degenerate) host box — that would collapse the cloud onto a
    // point. Once measure() has seen a real box the ResizeObserver re-runs fit() with it.
    if (!this.boxReady) return;
    const fitPx = (Math.min(this.W, this.H) * FIT_FRACTION) / this.fitMargin;
    this.fitPx = fitPx; // node size derives from this (density-based), independent of layout radius
    this.scale3 = fitScale(fitPx, this.radius3);
    this.scale2 = fitScale(fitPx, this.radius2);
    this.worldScale = this.scale3 + (this.scale2 - this.scale3) * this.morph;
    if (resetCamera) {
      this.zoom = 0; this.goalZoom = 0;
      this.target = [0, 0, 0]; this.goalTarget = [0, 0, 0];
      this.panX = 0; this.panY = 0; this.goalPanX = 0; this.goalPanY = 0; this.userTook = false;
    }
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
      this.emitBloom();
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
    // Hold the first paint until a real host box has been measured — a fit computed against a
    // degenerate mid-layout box would draw a collapsed (all-nodes-on-a-point) frame. The cleared
    // canvas shows the host background until then; the ResizeObserver triggers a real paint moments
    // later once the box settles.
    if (!this.boxReady) return;
    // The one zoom progress the whole hierarchy reads from — edge levels, node colour and the label
    // ladder all key off THIS value, so they cross their boundaries on the same frame (see zoomT).
    const t = this.zoomT();
    // LEVEL-DRIVEN COLOUR: which hierarchy level(s) everything reads as this frame, off the same
    // partition of unity the group lines and the label ladder use — hoisted here because the
    // intra-cluster edge mesh needs it too, so a node and the wiring around it are never coloured by
    // different levels on the same frame.
    const { L0, L1, w1 } = this.activeColorLevels(clusterLevelAlphas(t, this.levelCount, CANVAS_REVEAL_T));
    if (w1 !== this.blendW1) { this.blendCache.clear(); this.blendW1 = w1; }
    // edges — width scales with zoom: thin when zoomed out (declutters the hairball), thicker zoomed in
    ctx.strokeStyle = intToHex(this.cfg.edgeColor);
    const zoomScale = this.P / Math.max(1, this.P - this.zoom);
    ctx.lineWidth = Math.max(0.08, Math.min(1.6, 0.4 * zoomScale));
    const op = this.cfg.edgeOpacity;
    // per-mode edge thinning: 2D aggressive, 3D gentle
    const budget = is2d ? EDGE_BUDGET_2D : EDGE_BUDGET_3D, floor = is2d ? EDGE_FLOOR_2D : EDGE_FLOOR_3D;
    const keepFrac = this.edges.length > budget ? Math.max(floor, budget / this.edges.length) : 1;
    const focus = this.focusSet();
    const strokeEdges = (list: EdgeView[], alpha: number, pred?: (a: NodeView, b: NodeView) => boolean) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (const e of list) {
        if (e.kr >= keepFrac) continue; // per-mode dense-graph thinning
        const { a, b } = e;
        if (!a.onScreen || !b.onScreen) continue;
        if (pred && !pred(a, b)) continue;
        ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy);
      }
      ctx.stroke();
    };
    // "Only lines between the groups at this zoom." Each hierarchy level has its own GROUP-LEVEL edge
    // set (buildLevelEdges) — one line per connected pair of that level's communities, hub to hub —
    // and only the level currently being shown draws (crossfading into the next as you zoom).
    // The real node-to-node edges are the LAST rung: they fade in with the file names, when individual
    // notes are what is on screen. See computeEdgeLevelWeights.
    this.computeEdgeLevelWeights(t);
    const levelW = this.edgeLevelW;
    const memberW = levelW[this.levelCount] ?? 1;
    for (let L = 0; L < this.levelPairs.length; L++) {
      const lw = levelW[L] ?? 0;
      if (lw <= 0.01) continue;
      const pairs = this.levelPairs[L];
      if (!pairs.length) continue;
      // Heavier group links read heavier — the count is the number of real edges behind the line.
      // Bucketed by weight so this stays a handful of batched strokes rather than one per pair.
      const maxCount = pairs[0].count; // sorted desc in buildLevelEdges
      const WB = 3;
      for (let wb = 0; wb < WB; wb++) {
        const lo = maxCount * (wb / WB), hi = maxCount * ((wb + 1) / WB) + (wb === WB - 1 ? 1 : 0);
        ctx.lineWidth = Math.max(0.25, Math.min(2.4, (0.35 + wb * 0.55) * zoomScale));
        ctx.globalAlpha = op * lw * (0.55 + 0.45 * ((wb + 0.5) / WB));
        ctx.beginPath();
        let any = false;
        for (const p of pairs) {
          if (p.count < lo || p.count >= hi) continue;
          if (!p.a.onScreen || !p.b.onScreen) continue;
          ctx.moveTo(p.a.sx, p.a.sy); ctx.lineTo(p.b.sx, p.b.sy); any = true;
        }
        if (any) ctx.stroke();
      }
    }
    ctx.lineWidth = Math.max(0.08, Math.min(1.6, 0.4 * zoomScale)); // restore the member-edge width
    // INTRA-CLUSTER MESH, in the cluster's own colour. A cluster's BODY is its internal edges — every
    // reference for this look renders each group as a woven mass, not a dot cloud, and the weave is
    // tinted with the group's colour so density reads as mass instead of as grey noise. Drawn at EVERY
    // zoom (unlike the member edges below), because it is what makes a group look like a thing.
    //
    // NOTE this is a partial walk-back of "only lines between the groups at this zoom": the lines
    // BETWEEN groups are still exactly the aggregated group-level ones above, but a group's own
    // internal wiring is now drawn as texture. Without it the masses have no substance.
    //
    // Batched by colour (at most a few dozen distinct cluster colours), so it stays a handful of
    // strokes rather than one per edge.
    if (!this.hoveredId && !focus) {
      const byColor = this.intraBuckets;
      byColor.clear();
      for (const e of this.edges) {
        if (e.kr >= keepFrac) continue;
        const { a, b } = e;
        if (!a.onScreen || !b.onScreen) continue;
        const ca = a.colorByLevel[Math.min(L0, a.colorByLevel.length - 1)];
        const cb = b.colorByLevel[Math.min(L0, b.colorByLevel.length - 1)];
        if (ca !== cb) continue; // crosses groups at this level — the group lines above tell that story
        let arr = byColor.get(ca);
        if (!arr) { arr = []; byColor.set(ca, arr); }
        arr.push(e);
      }
      ctx.lineWidth = Math.max(0.12, Math.min(1.1, 0.3 * zoomScale));
      for (const [col, list] of byColor) {
        ctx.strokeStyle = this.hexOf(col);
        ctx.globalAlpha = INTRA_EDGE_ALPHA;
        ctx.beginPath();
        for (const e of list) { ctx.moveTo(e.a.sx, e.a.sy); ctx.lineTo(e.b.sx, e.b.sy); }
        ctx.stroke();
      }
      ctx.strokeStyle = intToHex(this.cfg.edgeColor);
      ctx.lineWidth = Math.max(0.08, Math.min(1.6, 0.4 * zoomScale));
    }
    // Real member-level edges (the CROSS-group ones, plus everything when hovering). Weighted by
    // memberW, so at coarse zoom the between-group story is told by the aggregated group lines.
    if (this.hoveredId) {
      const hov = this.hoveredId;
      if (memberW > 0.01) strokeEdges(this.edges, op * 0.05 * memberW, (a, b) => a.node.id !== hov && b.node.id !== hov);
      strokeEdges(this.edges, Math.min(0.9, op * 2.2), (a, b) => a.node.id === hov || b.node.id === hov);
    } else if (focus) {
      if (memberW > 0.01) strokeEdges(this.edges, op * 0.05 * memberW, (a, b) => !(focus.has(a.node.id) || focus.has(b.node.id)));
      strokeEdges(this.edges, Math.max(op * 0.5, op * memberW), (a, b) => focus.has(a.node.id) || focus.has(b.node.id));
    } else if (memberW > 0.01) {
      if (is2d) {
        strokeEdges(this.edges, op * memberW);
      } else {
        // 3D: fade edges by depth (back edges recede) — banded so it stays a few batched strokes.
        // One bucketing pass (same keep/onScreen filters + band test as the old per-band
        // strokeEdges() calls), then one stroke per band — no rescanning BANDS times.
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
          if (!bands[bi].length) continue;
          const fade = dm + (1 - dm) * Math.pow((bi + 0.5) / BANDS, DEPTH_CURVE);
          ctx.globalAlpha = op * fade * memberW;
          ctx.beginPath();
          for (const e of bands[bi]) { ctx.moveTo(e.a.sx, e.a.sy); ctx.lineTo(e.b.sx, e.b.sy); }
          ctx.stroke();
        }
      }
    }
    // agents-mode workflow lanes: draw a distinct grouped lane (backdrop + glowing dashed
    // accent connections) for every workflow's subagent tree, over the ordinary edges but
    // under the node dots. No-op unless some edge carries a workflow key.
    this.drawWorkflowLanes(zoomScale);
    // nodes (canvas state) — depth-sorted far→near so near dots paint over far ones
    if (withNodes) {
      this.drawOrder.length = 0;
      for (const nv of this.nodes) { if (nv.onScreen) this.drawOrder.push(nv); }
      this.drawOrder.sort((a, b) => a.depth - b.depth);
      const order = this.drawOrder;
      for (const nv of order) {
        const ds = this.nodeDiameter(nv);
        const colorHex = this.levelColorOf(nv, L0, L1, w1);
        let alpha = this.depthFade(nv, is2d);
        if (focus && !focus.has(nv.node.id)) alpha *= 0.13; // dim non-focus on hover/highlight
        else if (this.hoveredId && focus?.has(nv.node.id)) alpha = Math.max(alpha, 0.95); // connected nodes pop to full brightness on hover
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(nv.sx, nv.sy, ds / 2, 0, Math.PI * 2);
        if (nv.node.kind === "self" || this.isHollow(nv.node)) {
          ctx.lineWidth = Math.max(1.5, ds * 0.12); ctx.strokeStyle = colorHex; ctx.stroke();
        } else {
          ctx.fillStyle = colorHex; ctx.fill();
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
      this.drawLabels(ctx, t);
    }
    ctx.globalAlpha = 1;
    // Paint is signalled HERE — after the frame's edges/nodes/labels are actually stroked, once per
    // draw, with the node count actually drawn (drawOrder is rebuilt above, so its length reflects
    // THIS frame, not a stale one) — not at the top of this method, which would only mean "a frame
    // is about to be drawn". General-purpose instrumentation hook (currently unconsumed: the boot
    // splash gates on the app SHELL's first paint now, not the graph's — see App.tsx's bootGate
    // wiring); any future caller gets the real per-frame drawn-node count via setPaintCallback.
    this.onPaint?.(this.drawOrder.length);
  }

  /**
   * Draw the special-looking workflow-lane connections (agents mode). A workflow's
   * subagents — all sharing an edge `workflow` key — are drawn as ONE grouped lane: a
   * translucent rounded backdrop hull behind the group, plus each session→subagent
   * connection rendered as a soft glow underlay + a crisp DASHED accent line in the
   * workflow's stable colour. This reads as a distinct grouped lane, clearly unlike the
   * thin grey ordinary session→subagent edge (which is untouched). No-op when nothing in
   * the graph carries a workflow key, so non-workflow graphs render exactly as before.
   */
  private drawWorkflowLanes(zoomScale: number) {
    const ctx = this.edgeCtx;
    if (!ctx) return;
    // Group on-screen workflow edges by their workflow key.
    const groups = new Map<string, { edges: EdgeView[]; xs: number[]; ys: number[] }>();
    for (const e of this.edges) {
      if (!e.workflow) continue;
      if (!e.a.onScreen || !e.b.onScreen) continue;
      let g = groups.get(e.workflow);
      if (!g) { g = { edges: [], xs: [], ys: [] }; groups.set(e.workflow, g); }
      g.edges.push(e);
      g.xs.push(e.a.sx, e.b.sx); g.ys.push(e.a.sy, e.b.sy);
    }
    if (groups.size === 0) return;

    ctx.save();
    for (const [key, g] of groups) {
      const color = intToHex(paletteColorInt(key, WORKFLOW_LANE_PALETTE));
      // Lane backdrop: a translucent rounded band around the whole group (parent apex +
      // its workflow subagents), so the tree reads as one visually-grouped lane.
      const pad = Math.max(10, 14 * zoomScale);
      const minX = Math.min(...g.xs) - pad, maxX = Math.max(...g.xs) + pad;
      const minY = Math.min(...g.ys) - pad, maxY = Math.max(...g.ys) + pad;
      const bw = maxX - minX, bh = maxY - minY, r = Math.min(22, bw / 2, bh / 2);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(minX, minY, bw, bh, r); else ctx.rect(minX, minY, bw, bh);
      ctx.globalAlpha = 0.08; ctx.fillStyle = color; ctx.fill();
      ctx.globalAlpha = 0.28; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.strokeStyle = color; ctx.stroke();

      // Soft glow underlay along each connection (round caps → a continuous lane).
      ctx.lineCap = "round"; ctx.strokeStyle = color;
      ctx.globalAlpha = 0.16; ctx.setLineDash([]);
      ctx.lineWidth = Math.max(3, 6 * zoomScale);
      ctx.beginPath();
      for (const e of g.edges) { ctx.moveTo(e.a.sx, e.a.sy); ctx.lineTo(e.b.sx, e.b.sy); }
      ctx.stroke();
      // Crisp dashed accent line on top — the distinct workflow connection.
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = Math.max(1.1, 1.6 * zoomScale);
      ctx.setLineDash([Math.max(3, 5 * zoomScale), Math.max(2, 4 * zoomScale)]);
      ctx.beginPath();
      for (const e of g.edges) { ctx.moveTo(e.a.sx, e.a.sy); ctx.lineTo(e.b.sx, e.b.sy); }
      ctx.stroke();
    }
    ctx.restore();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /**
   * The zoom-driven label ladder. Two tiers that CROSSFADE rather than switch, both keyed off the
   * same `t` the node colour above uses (see `zoomT`), with the curve math owned by labelSelection.ts:
   *
   *   1. CLUSTER NAMES, per hierarchy LEVEL. Below `FILE_LABEL_REVEAL_T` the graph names
   *      communities, not files — walking `communityPath` coarsest → finest as the camera zooms in,
   *      one crossfade per level boundary (`clusterLevelAlphas`), landing on the finest level right
   *      at the reveal point. Each level's name sits at the on-screen centroid of that community's
   *      visible members, in the same colour those members are currently painted, so a name always
   *      matches the mass it names.
   *   2. FILE NAMES — the LAST rung, not a tier of its own. They fade in past the reveal point
   *      (`fileLabelAlpha`) and then every name that fits is drawn; there is no zoom-driven budget
   *      ramp in between (see the `budget` comment below for why that was removed). Forced labels
   *      (self / active / hovered + its neighbours / search / highlight) ignore the fade entirely:
   *      they draw at any zoom, exactly as before.
   *
   * Overlap: labels are placed greedily in rank order and one whose box hits an already-placed box
   * is dropped (forced labels place unconditionally). Bounded by MAX_FILE_LABELS, so the O(k²) test
   * stays a few thousand comparisons.
   */
  private drawLabels(ctx: CanvasRenderingContext2D, t: number) {
    ctx.globalAlpha = 1; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineWidth = 1;
    this.labelBoxes.length = 0;
    if (this.cfg.showGraphLabels === false) return;

    const cAlpha = clusterLabelAlpha(t, CANVAS_REVEAL_T);
    const fAlpha = fileLabelAlpha(t, CANVAS_REVEAL_T);

    // ---- tier 1: cluster names, one pass per active hierarchy level -------------------------
    if (cAlpha > 0.01 && this.levelCount > 0) {
      const levelAlphas = clusterLevelAlphas(t, this.levelCount, CANVAS_REVEAL_T);
      for (let L = 0; L < levelAlphas.length; L++) {
        const a = levelAlphas[L] * cAlpha;
        if (a > 0.01) this.drawClusterNames(ctx, L, a);
      }
    }

    // ---- tier 2: file names ------------------------------------------------------------------
    // Candidates are the nodes actually IN FRAME (see inViewport): ranking over everything merely in
    // front of the camera spends the budget on off-screen hubs, so zooming in surfaced no new names.
    const ordered = this.labelScratch;
    ordered.length = 0;
    for (const nv of this.nodes) if (this.inViewport(nv)) ordered.push(nv);
    // Density is bounded by the overlap rejection below plus MAX_FILE_LABELS — NOT by a zoom-driven
    // budget ramp. labelSelection's `fileLabelBudget` (which opens from ~1 candidate at the reveal
    // point toward "all of them" near max zoom) is deliberately unused here: on a hierarchy this deep
    // it produced exactly
    // the tier the user called out as contradicting the ladder — a few arbitrary node names appearing,
    // then the rest — which reads as a leftover of the old curated-hub labelling rather than as a rung.
    // The ladder's rungs are the hierarchy LEVELS; past the last one, every name that fits is drawn.
    const budget = MAX_FILE_LABELS;
    const forced = (nv: NodeView): boolean => {
      const id = nv.node.id;
      return nv.node.kind === "self" || id === this.hoveredId || id === this.activeFile ||
        this.searchMatches.has(id) || (this.highlightSet?.has(id) ?? false) ||
        (this.hoveredId != null && (this.adjacency.get(this.hoveredId)?.has(id) ?? false));
    };
    // Ranked by degree so that when names DO contend for the same space the more connected note wins.
    // `alwaysOn` (the old curated top-degree hub set) is deliberately NOT consulted: it is a
    // zoom-independent "these ten always have labels" rule from before the hierarchy existed, and it
    // is the other half of what made the labelling read as two contradictory systems.
    const rank = (nv: NodeView) => (forced(nv) ? 1e9 : nv.deg + nv.dr);
    ordered.sort((a, b) => rank(b) - rank(a));

    let drawn = 0;
    for (const nv of ordered) {
      const force = forced(nv);
      if (!force && (drawn >= budget || fAlpha <= 0.01)) break; // forced labels sort to the front
      const self = nv.node.kind === "self";
      ctx.font = self ? this.FONT_SELF : this.FONT_NODE;
      const text = self ? "You" : nv.node.label;
      const ds = this.nodeDiameter(nv);
      if (nv.labelW < 0) nv.labelW = ctx.measureText(text).width;
      const tw = nv.labelW;
      const fh = self ? 14 : 11, padX = 6, padY = 2;
      const bx = nv.sx - tw / 2 - padX, by = nv.sy + ds / 2 + 4, bw = tw + padX * 2, bh = fh + padY * 2;
      if (!force && this.boxTaken(bx, by, bx + bw, by + bh)) continue;
      this.labelBoxes.push(bx, by, bx + bw, by + bh);
      ctx.globalAlpha = force ? 1 : fAlpha;
      ctx.fillStyle = this.cfg.labelBgColor;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 5); else ctx.rect(bx, by, bw, bh);
      ctx.fill();
      ctx.fillStyle = this.cfg.labelTextColor;
      ctx.fillText(text, nv.sx, by + padY);
      if (!force) drawn++;
    }
    ctx.globalAlpha = 1;
  }

  /** One cluster-name pass for hierarchy `level` (0 = coarsest): a single label per community at
   *  that level, coloured with the SAME per-level key the nodes hash — so the name reads as the
   *  mass's own label — and sized by the community's share of the graph, so a super-cluster's name
   *  reads bigger than a leaf cluster's and the ladder is legible AS a hierarchy.
   *
   *  Anchored on the community's HUB (its highest-degree visible member), not on the mean of its
   *  members. A vault's communities are hub-and-spoke and sprawling, so the centroid of a 400-node
   *  community routinely lands in empty space — the names then read as free-floating text captioning
   *  nothing. The hub is both where the mass visibly converges AND the node the exemplar name was
   *  taken from, so the label lands on the thing it names. Ties break on id, matching the backend's
   *  exemplar rule, so the anchor doesn't flicker between two equal-degree members frame to frame.
   *
   *  Allocation-free per frame apart from the reused `clusterAgg` map. */
  private drawClusterNames(ctx: CanvasRenderingContext2D, level: number, alpha: number) {
    const agg = this.clusterAgg;
    agg.clear();
    let visible = 0;
    for (const nv of this.nodes) {
      if (!this.inViewport(nv)) continue;
      visible++;
      const path = nv.node.communityPath?.length ? nv.node.communityPath
        : nv.node.community != null ? [nv.node.community] : null;
      if (!path) continue;
      const li = Math.min(level, path.length - 1);
      const cid = path[li];
      let e = agg.get(cid);
      if (!e) {
        const names = nv.node.communityPathLabels?.length ? nv.node.communityPathLabels
          : nv.node.communityLabel ? [nv.node.communityLabel] : null;
        const raw = names?.[Math.min(li, names.length - 1)] ?? `cluster ${cid}`;
        // The hub comes from the PRECOMPUTED per-level table, not from a running max over the visible
        // members — so a group's name and the group-level lines meeting at it share one anchor, and the
        // anchor doesn't jump as members pan in and out of frame.
        const hub = this.levelHubs[Math.min(level, this.levelHubs.length - 1)]?.get(cid);
        if (!hub) continue;
        e = {
          n: 0, label: trimDanglingWord(clusterLabelText(raw)), hub, rad: 0,
          color: nv.colorByLevel[Math.min(li, nv.colorByLevel.length - 1)],
        };
        agg.set(cid, e);
      }
      e.n++;
      // On-screen extent of the group around its anchor, so the name can clear the whole mass rather
      // than a fixed number of px (a big group is far wider than any constant lift).
      const dy = Math.abs(nv.sy - e.hub.sy), dx = Math.abs(nv.sx - e.hub.sx);
      const r = Math.max(dy, dx * 0.5); // vertical extent matters most — the name is lifted upward
      if (r > e.rad) e.rad = r;
    }
    if (!agg.size) return;
    // Largest first, so a small cluster's name is what gets dropped when two anchors collide.
    const entries = [...agg.values()].sort((a, b) => b.n - a.n);
    // Both the size ramp and the naming threshold are relative to what is IN FRAME, not to the whole
    // graph. That is what makes zoom feel alive: as the camera closes on a region, the communities
    // inside it grow as a share of the visible field, so smaller ones cross the bar and name
    // themselves — instead of the same handful of global masses being the only things ever labelled.
    const total = visible || 1;
    const minMembers = Math.max(CLUSTER_LABEL_MIN_MEMBERS, Math.round(total * CLUSTER_LABEL_MIN_SHARE));
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let named = 0;
    for (const e of entries) {
      if (named >= MAX_CLUSTER_LABELS_BASE + level * MAX_CLUSTER_LABELS_PER_LEVEL) break; // sorted by size → drops the smallest
      if (e.n < minMembers) break;                 // ...and so does this: the long tail of scraps
      // Lifted OFF the hub, not centred on it: the hub is the densest point of the group, so a name
      // drawn at its position sits directly on top of the dots it is naming and neither reads.
      const x = e.hub.sx, y = e.hub.sy - CLUSTER_LABEL_LIFT_PX - Math.min(CLUSTER_LABEL_MAX_LIFT_PX, e.rad);
      const px = CLUSTER_LABEL_MIN_PX + (CLUSTER_LABEL_MAX_PX - CLUSTER_LABEL_MIN_PX) * Math.min(1, Math.sqrt(e.n / total) * 2.2);
      ctx.font = `700 ${px.toFixed(1)}px ${MONO_STACK}`;
      const tw = ctx.measureText(e.label).width + px * 0.6; // + the tracking added below
      const bx = x - tw / 2, by = y - px * 0.7, bx1 = x + tw / 2, by1 = y + px * 0.7;
      if (this.boxTaken(bx, by, bx1, by1)) continue;
      this.labelBoxes.push(bx, by, bx1, by1);
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = this.hexOf(e.color);
      this.fillTracked(ctx, e.label, x, y, px * 0.12);
      named++;
    }
    ctx.globalAlpha = 1; ctx.textBaseline = "top";
  }

  /** Draw `text` centred at (x, y) with `track` px of extra letter-spacing — the eyebrow register
   *  the design gives cluster names. Canvas2D has no letterSpacing in every engine we ship to, so
   *  the characters are placed by hand; cluster names are ≤ CLUSTER_LABEL_MAX_CHARS, so this is a
   *  couple of dozen fillText calls per frame at most. */
  private fillTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, track: number) {
    const prev = ctx.textAlign;
    ctx.textAlign = "left";
    let total = 0;
    for (const ch of text) total += ctx.measureText(ch).width + track;
    total -= track;
    let cx = x - total / 2;
    for (const ch of text) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + track;
    }
    ctx.textAlign = prev;
  }

  /** Has any label already claimed a box overlapping this one? Linear over `labelBoxes` (flat
   *  x0,y0,x1,y1 quads — no per-box object), bounded by MAX_FILE_LABELS + the cluster names. */
  private boxTaken(x0: number, y0: number, x1: number, y1: number): boolean {
    const b = this.labelBoxes;
    for (let i = 0; i < b.length; i += 4) {
      if (x0 < b[i + 2] && x1 > b[i] && y0 < b[i + 3] && y1 > b[i + 1]) return true;
    }
    return false;
  }

  /** Emit the per-frame node-density field for the phosphor bloom (densityField.ts). Reuses the
   *  screen positions projectPositions() already computed this frame (nv.sx/nv.sy — the same
   *  (cx+panX+x)/(cy+panY+viewOffsetY*H+y) space the old glow lobes read off `project()`, just as
   *  0..1 fractions instead of CSS percent) rather than re-projecting: there is only ever one
   *  projection pass per frame. */
  private emitBloom() {
    if (!this.onBloom) return;
    const pts: { x: number; y: number; weight: number }[] = [];
    for (const nv of this.nodes) {
      if (!nv.onScreen) continue;
      const x = nv.sx / this.W, y = nv.sy / this.H;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      // Weight by projected scale so near/large nodes contribute more light than far/small ones.
      pts.push({ x, y, weight: Math.max(0.2, nv.pscale) });
    }
    this.onBloom(buildBloom(pts));
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
