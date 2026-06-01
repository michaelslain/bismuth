// app/src/graph/WebGLRenderer.ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  forceZ,
  type Simulation,
  type SimNode,
  type SimLink,
} from "d3-force-3d";
import type { GraphData, NodeKind } from "../../../core/src/graph";
import { nodeCollideRadius } from "./collide";
import { LabelLayer } from "./LabelLayer";
import { computeAlwaysOnSet } from "./labelSelection";

// Default node palette = the 6 Oxide accent colors — overridden via setConfig from
// settings.appearance.accentPalette (the centralized theme tokens).
const DEFAULT_PALETTE = [0xf0509b, 0x9b53e8, 0x3f6bf0, 0x27c7d9, 0x43d49a, 0xf2c53d];
const EDGE_BASE = 0.32; // normal edge brightness (0..1) — faint so dense hub fans don't read as clumps
const NODE_DIM = 0.4;   // dimmed non-neighbor node brightness on hover (gentle — stays visible)
const EDGE_DIM = 0.18;  // dimmed edge brightness on hover
const HL_SPEED = 0.16;  // highlight ease per frame (smooth fade in/out)
const EDGE_COLOR = 0xaeb4c2; // Steel (neutral token) for links — overridden via setConfig

// Edge crowding — measured in SCREEN space from the current camera, so it works for both 2D
// and 3D and re-forms as you orbit/zoom. Each edge is sampled along its projected length and
// binned into screen-pixel cells; an edge's "peak" is the most edges sharing any cell it
// crosses. Crowded edges are DIMMED in the overview (the look you liked). While a node is
// highlighted, crowded NON-focused edges are additionally CULLED (collapsed to zero length so
// they don't draw) — the focused node's edges always stay — so the web doesn't reappear.
const EDGE_CROWD_CELL = 0.7;   // crowding cell as a fraction of link distance (graph scale, projected to px)
const EDGE_CROWD_FULL = 3;     // up to this many overlaps keep full brightness (no dimming)
const EDGE_CROWD_MIN = 0.16;   // brightness floor for the densest clusters (× EDGE_BASE)
const EDGE_CULL_KEEP = 5;      // while highlighting, keep ~this many non-focused edges per crowded cell

// Collision force gives every node a minimum personal space, so dense clusters can't pack
// tighter than this floor while sparse regions are untouched — evening out density across
// the graph. Radius is a fraction of link distance; min spacing between any two nodes is
// 2*radius. Multiple solver iterations per tick make the floor hold even inside densely
// linked cliques, where a single pass lets the link/centering pull overpower it.
const COLLIDE_RATIO = 0.9;
const COLLIDE_ITERATIONS = 3;
// Big nodes collide as their drawn circle (not a point); this pads that circle so neighbouring hubs
// keep a small visible gap instead of merely touching. Only affects nodes whose padded radius beats
// the spacing floor (the largest hubs) — leaves are untouched.
const COLLIDE_SIZE_PADDING = 1.25;

// Link strength is fixed low instead of d3's default (1/min(degree), which yanks a hub's
// degree-1 leaves tight against it into dense fans). A weak, uniform pull lets collision and
// charge set the spacing — leaves spread into an even field instead of clumping around hubs.
const LINK_STRENGTH = 0.18;

// 2D packs the same nodes into a plane instead of a volume, so it needs more spread than 3D
// to feel equally airy. In 2D, link distance (and the collide radius that scales off it) is
// multiplied by this — nodes settle farther apart and the auto-fit zooms out, shrinking them.
const MODE_2D_SPACING = 1.8;

// Settle behaviour. d3 decays alpha slowly (~300 ticks to alphaMin) and renders every step, which
// is what makes the initial layout visibly scatter and then drift for seconds at low FPS. Instead
// we run the initial settle HEADLESSLY (tick the physics in a tight loop with no per-step render,
// then paint once — the graph appears already in place) and stop on actual motion rather than the
// slow global timer:
//   SETTLE_SPEED_FRAC — once the fastest node moves slower than this fraction of link distance
//     (world units/tick), the layout is visually at rest: zero velocities and stop. Lower = let it
//     relax more before freezing; higher = snap sooner. Used by both the headless and animated paths.
//   PRESETTLE_MAX_TICKS / PRESETTLE_BUDGET_MS — caps on the synchronous headless loop so a large
//     graph can't hang the load; if it can't settle within them we paint the partial layout and
//     hand the remainder to the (brief, velocity-capped) animated timer.
const SETTLE_SPEED_FRAC = 0.03;
const SETTLE_REST_TICKS = 3; // require this many consecutive sub-threshold ticks so a momentary mid-scatter lull can't freeze a half-formed layout
const PRESETTLE_MAX_TICKS = 400;
const PRESETTLE_BUDGET_MS = 120;

// A single force tick is expensive at scale (the n-body charge alone is tens of ms for a few
// thousand nodes), so re-settling on every load is what tanks FPS. When at least this fraction of
// nodes already have a cached (previously-settled) position, we SKIP the simulation entirely and
// render the cached layout — the costly settle then only runs on a true first load. The few new
// nodes (a live vault/memory graph adds a handful between loads) are placed next to their neighbours.
const SETTLE_SKIP_FRAC = 0.9;

// Barnes-Hut approximation for the n-body charge force. d3's default (0.9) does little pruning in 3D;
// 1.5 roughly halves the charge cost with negligible visual change (only the cold first settle runs it).
const MANYBODY_THETA = 1.5;

// Cap the render resolution. On a Retina display devicePixelRatio is 2 (some 3). Rendering at the
// full device ratio keeps nodes, edges, AND label sprites crisp — a 1.5x cap visibly softens them
// (the graininess). 2x is the full Retina resolution; we clamp 3x displays to 2x as a GPU-cost
// ceiling. Lower toward 1.5 if a weak GPU needs more headroom.
const MAX_PIXEL_RATIO = 2;

// Recompute screen-space edge crowding at most once every N frames while the view is moving (idle
// spin, orbit, zoom). The recompute is an O(edges x samples) Map-building pass; at 60fps every other
// frame it dominates the frame budget during the perpetual 3D spin. ~6Hz is plenty for a subtle
// dim effect (and the brightness changes are eased, so stepped recomputes still look smooth).
const CROWD_RECOMPUTE_FRAMES = 10;

// Node size scales with connection count (degree), Obsidian-style. The MIN/GAIN/MAX
// multipliers now live in settings (graph.nodeSize*), read via this.cfg at the use site:
// multiplier = clamp(MIN + GAIN*sqrt(degree), MIN, MAX). sqrt keeps mid-range growth smooth.

// 3D depth cue: linear fog toward the background color, so nodes/edges deeper in the cloud
// fade out and read as "further away". near/far track the live camera→centroid distance and
// the cloud radius — the front edge stays crisp, the rearmost nodes fade to a faint ghost.
// In flat 2D the fog is pushed out of range (every node sits at one depth, nothing to convey).
const FOG_FRONT = 1.0; // fog.near = camDist - cloudRadius*FOG_FRONT (front edge of cloud → crisp)
const FOG_BACK = 1.7;  // fog.far  = camDist + cloudRadius*FOG_BACK  (past the back → it ghosts out)

/** User-tunable graph appearance/physics, fed in from the settings store. */
export interface GraphConfig {
  spin: boolean;
  spinSpeed: number;
  palette: number[];
  repulsion: number;    // d3 forceManyBody strength (negative = push apart)
  linkDistance: number;
  centering: number;    // forceX/Y/Z strength toward origin
  nodeSize: number;
  viewMode: "2d" | "3d"; // 3d = volumetric orbit; 2d = flat birdseye, locked rotation
  showGraphLabels: boolean;
  graphLabelHubCount: number;
  nodeSizeMinMult: number;    // multiplier for a 0/1-degree leaf
  nodeSizeDegreeGain: number; // size added per sqrt(degree)
  nodeSizeMaxMult: number;    // ceiling multiplier (biggest hub)
  edgeColor: number;          // link color (0xRRGGBB)
  backgroundColor: number;    // canvas background (0xRRGGBB)
}

const DEFAULT_CONFIG: GraphConfig = {
  spin: true,
  spinSpeed: 0.0015,
  palette: DEFAULT_PALETTE,
  repulsion: -10,
  linkDistance: 5,
  centering: 0.13,
  nodeSize: 6,
  viewMode: "3d",
  showGraphLabels: true,
  graphLabelHubCount: 10,
  nodeSizeMinMult: 0.4,
  nodeSizeDegreeGain: 0.45,
  nodeSizeMaxMult: 6,
  edgeColor: EDGE_COLOR,
  backgroundColor: 0x14151b, // Ink (background token)
};

const MODE_TWEEN_MS = 500; // duration of the 2D<->3D flatten/expand glide
const FRAME_TWEEN_MS = 450; // duration of the "z" zoom-to-fit-node-and-neighbors glide
// 3D near-camera node cull: a node fades out as it approaches the camera, fully gone once it's
// closer than NEAR_CULL_HIDE × (camera→target distance) and fully shown past NEAR_CULL_SHOW ×.
// Expressed as a fraction of the focal distance so it's dormant at the resting whole-graph framing
// (nearest node sits past SHOW) and only bites as you zoom in — e.g. after a "z" frame — dissolving
// foreground nodes that would otherwise occlude whatever you're looking at. 3D only.
const NEAR_CULL_SHOW = 0.55;
const NEAR_CULL_HIDE = 0.32;

/** Ease-in-out cubic interpolation (0→1). Used for camera and node position tweens. */
function easeInOutCubic(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  const s = -2 * t + 2;
  return 1 - (s * s * s) / 2;
}

const TWO_PI = Math.PI * 2;
/**
 * Reduce an angle to its shortest signed equivalent in (-π, π]. The visual
 * orientation is unchanged (angles differing by a multiple of 2π look identical),
 * but tweening *from* this value lands on the nearest revolution — so the graph
 * untilts the short way instead of unwinding every accumulated full turn.
 */
function shortestAngle(a: number): number {
  const m = ((a % TWO_PI) + TWO_PI) % TWO_PI; // [0, 2π)
  return m > Math.PI ? m - TWO_PI : m;
}

/**
 * Eigen-decomposition of a symmetric 3x3 matrix via cyclic Jacobi rotations. Returns the three
 * eigenvalues with their (unit) eigenvectors, ascending by eigenvalue. Used to find the best-fit
 * plane of a point cluster: the smallest-eigenvalue eigenvector is the plane normal (the thinnest
 * axis), so looking down it shows the cluster spread out face-on. n=3 converges in a few sweeps.
 */
function eigenSym3(m: number[][]): { value: number; vector: THREE.Vector3 }[] {
  const a = m.map((row) => row.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 24; iter++) {
    // Rotate to annihilate the largest off-diagonal element.
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) { max = Math.abs(a[0][2]); p = 0; q = 2; }
    if (Math.abs(a[1][2]) > max) { max = Math.abs(a[1][2]); p = 1; q = 2; }
    if (max < 1e-10) break;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = (theta === 0 ? 1 : Math.sign(theta)) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let i = 0; i < 3; i++) {
      const aip = a[i][p], aiq = a[i][q];
      a[i][p] = c * aip - s * aiq;
      a[i][q] = s * aip + c * aiq;
    }
    for (let i = 0; i < 3; i++) {
      const api = a[p][i], aqi = a[q][i];
      a[p][i] = c * api - s * aqi;
      a[q][i] = s * api + c * aqi;
    }
    for (let i = 0; i < 3; i++) {
      const vip = v[i][p], viq = v[i][q];
      v[i][p] = c * vip - s * viq;
      v[i][q] = s * vip + c * viq;
    }
  }
  return [0, 1, 2]
    .map((i) => ({ value: a[i][i], vector: new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize() }))
    .sort((x, y) => x.value - y.value);
}

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

/** A white disc texture so points render as circles (alphaTest clips the square corners). */
function makeCircleTexture(): THREE.Texture {
  // 256px (was 64) so big hubs — drawn many screen-px wide — don't upscale a tiny disc into a
  // soft, grainy blob. The arc is anti-aliased at this resolution and downsamples cleanly.
  const s = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearMipmapLinearFilter; // smooth mipmapped downscale when shrunk
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

type N3 = SimNode & {
  id: string;
  label: string;
  kind: NodeKind;
  folder?: string;
  community?: number;          // Louvain community id (color + cluster grouping), from the backend
  communityLabel?: string;     // exemplar name for the community (highest-degree member's label)
  // Backend-precomputed target layouts for each mode — the 2D↔3D tween morphs straight to these
  // (no re-settle). Populated from the graph's position/position2d in render().
  pos3d?: [number, number, number];
  pos2d?: [number, number];
};
type L3 = SimLink<N3>;

/** The node currently under the pointer, reported to the host for the hover readout (null = none). */
export interface HoverNode {
  id: string;
  label: string;
  kind: NodeKind;
  folder?: string;
}

function graphSig(nodes: { id: string }[], edgeCount: number): string {
  return nodes.map((n) => n.id).sort().join(",") + "|" + edgeCount;
}

/** d3-force replaces link endpoints with node objects after the first tick; this reads the id either way. */
function endpointId(endpoint: string | N3): string {
  return typeof endpoint === "object" ? endpoint.id : endpoint;
}

export class WebGLRenderer {
  // three.js core
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;

  // scene objects
  private group!: THREE.Group;
  private pointsMesh: THREE.Points | null = null;
  private linesMesh: THREE.LineSegments | null = null;
  private labels = new LabelLayer();
  private activeFileId: string | null = null;
  private wppDefaultForLabels = 0;

  // graph data
  private nodes: N3[] = [];
  private links: L3[] = [];
  private resolvedLinks: { s: N3; t: N3 }[] = []; // links with both endpoints resolved to nodes (rebuilt per graph)
  private onClick: (id: string) => void = () => {};
  private onHover: (node: HoverNode | null) => void = () => {};
  private lastSig = "";
  // A graph update (new vault data) that arrived while a 2D<->3D tween was mid-flight. Applying it
  // then would rebuild nodes + reheat the sim and scatter the in-flight morph, so we stash it here
  // and replay it from finishTween once the glide has landed.
  private pendingGraph: GraphData | null = null;

  // user settings — spin/size read live each frame; palette/physics applied via setConfig
  private cfg: GraphConfig = { ...DEFAULT_CONFIG };
  private palette: number[] = DEFAULT_PALETTE;

  // simulation
  private sim: Simulation<N3> | null = null;
  private simSettling = false; // true while the layout is actively settling (sim ticking) — see refreshCrowdingIfMoved

  // animation
  private rafId: number | null = null;
  // FPS sampling — count frames over a window and report the rate to the host once per window.
  private onFps: (fps: number) => void = () => {};
  private fpsWindowStart = 0; // performance.now() at the start of the current sample window
  private fpsFrames = 0;      // frames rendered since the window started
  private el!: HTMLElement;
  private ro?: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private mouse2D = new THREE.Vector2();
  // click handler reference for removal
  private clickHandler?: (e: MouseEvent) => void;
  private moveHandler?: (e: MouseEvent) => void;
  private leaveHandler?: () => void;
  private circleTex: THREE.Texture | null = null;
  private baseColors: Float32Array = new Float32Array(0); // node colors, for hover restore
  private baseScales: Float32Array = new Float32Array(0); // per-node degree size multiplier, before near-cull
  private nearCullActive = false; // true while any node is currently near-camera culled (3D only)
  private hoveredId: string | null = null;
  private pointerInside = false;
  private curI: Float32Array = new Float32Array(0); // current node highlight scalar, eased (0 rest, +1 white, -1 dim)
  private tgtI: Float32Array = new Float32Array(0); // target node highlight scalar
  private curE: Float32Array = new Float32Array(0); // current edge intensities (eased)
  private tgtE: Float32Array = new Float32Array(0); // target edge intensities
  private crowdE: Float32Array = new Float32Array(0); // per-edge dim factor (1 = uncrowded, → EDGE_CROWD_MIN)
  private keepE: Uint8Array = new Uint8Array(0);      // per-edge render flag used while hovering (0 = cull)
  private camKey = "";                                 // camera pose the crowding was last computed for
  private frame = 0;                                   // frame counter (throttles crowding recompute)
  private wppDefault = 0;                              // world-per-pixel at the auto-fit framing (zoom reference)
  private crowdZoom = 1;                               // current zoom ratio vs default framing (brightens edges as you zoom in)
  private baseEdgeColors: Float32Array = new Float32Array(0); // per-vertex edge colors (endpoint gradient)
  private hlActive = false; // true while a highlight transition is in progress; cleared when settled
  private highlightedSet: Set<string> | null = null; // persistent cluster highlight (survives mouse-out)
  private userControlled = false; // once the user zooms/drags, stop auto-fitting the camera
  private interactHandler?: () => void;
  private keyHandler?: (e: KeyboardEvent) => void;
  private wheelHandler?: (e: WheelEvent) => void;
  // "z" zoom-to-fit: a camera-only glide that frames the hovered node + its neighbors. Kept
  // separate from the mode tween (which also moves node depths); the mode tween takes priority.
  private camTween: null | {
    start: number;
    posFrom: THREE.Vector3;
    posTo: THREE.Vector3;
    tgtFrom: THREE.Vector3;
    tgtTo: THREE.Vector3;
  } = null;
  // While "focused" on a "z"-framed cluster the orbit target sits on the cluster (so it stays
  // centered) and the idle spin is paused (the spin rotates the whole graph about the world origin,
  // which would fling an off-center cluster across the view). Scrolling out returns to homePose —
  // the whole-graph pose captured before the first frame — restoring the original pivot and axes.
  private framed = false;
  private homePose: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private history: { pos: THREE.Vector3; target: THREE.Vector3 }[] = []; // camera-pose back-stack (cluster tours / node hops)
  private searchMatches = new Set<string>();                            // graph-search hits → forced labels

  // 3D depth fog — centroid + radius of the node cloud, refreshed in fitCamera; the fog near/far
  // are derived from the live camera distance to this centroid so they track orbit/zoom.
  private cloudCenter = new THREE.Vector3();
  private cloudRadius = 1;

  // Rotation velocity tracking — prevents clicks during fast graph rotation
  private prevCameraQuat = new THREE.Quaternion();
  private rotationVelocity = 0; // radians per frame
  private readonly ROTATION_VELOCITY_THRESHOLD = 0.02; // clicks only allowed when below this

  // 2D/3D view mode + the glide between them
  private viewMode: "2d" | "3d" = "3d";
  private modeInitialized = false; // first setConfig applies mode instantly; later changes tween
  private savedZ = new Map<string, number>(); // node depth captured when flattening, restored on expand
  private tween: null | {
    start: number;
    fromPos: Map<string, [number, number, number]>; // per-node xyz at tween start
    toPos: Map<string, [number, number, number]>;    // per-node xyz at tween end
    morph: boolean; // true = landing on a precomputed target layout (no re-settle); false = legacy z-ease + re-settle
    camFrom: { pos: THREE.Vector3; tgt: THREE.Vector3 };
    camTo: { pos: THREE.Vector3; tgt: THREE.Vector3 };
    rotFrom: number;
    rotTo: number;
  } = null;

  mount(el: HTMLElement, onNodeClick: (id: string) => void, onHover?: (node: HoverNode | null) => void) {
    this.el = el;
    this.onClick = onNodeClick;
    if (onHover) this.onHover = onHover;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.cfg.backgroundColor);
    // Linear depth fog toward the background → nodes deeper in the cloud fade out (3D depth cue).
    // near/far are recomputed each frame in updateFog (and pushed out of range in flat 2D).
    this.scene.fog = new THREE.Fog(this.cfg.backgroundColor, 1, 1000);

    // Camera
    const w = el.clientWidth || 320;
    const h = el.clientHeight || 400;
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 20000);
    this.camera.position.set(0, 0, 180);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h);
    this.renderer.domElement.style.display = "block";
    el.appendChild(this.renderer.domElement);

    // Group to hold nodes/edges (auto-rotation applied here)
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 600;
    this.applyControlsForMode(this.viewMode); // honor a 2D mode chosen before mount
    this.modeInitialized = true;

    // Resize observer
    this.ro = new ResizeObserver(() => this.handleResize());
    this.ro.observe(el);

    // Circle sprite for round nodes
    this.circleTex = makeCircleTexture();

    // Click handler for node picking
    this.clickHandler = (e: MouseEvent) => this.handleClick(e);
    this.renderer.domElement.addEventListener("click", this.clickHandler);

    // Hover handler — highlight a node + its neighbors (Obsidian-style); pauses spin while inside
    this.moveHandler = (e: MouseEvent) => this.handleMove(e);
    this.renderer.domElement.addEventListener("mousemove", this.moveHandler);
    this.leaveHandler = () => {
      this.pointerInside = false;
      this.hoveredId = null;
      this.labels.setHoveredId(null);
      this.setHighlightTargets();
      this.notifyHover();
    };
    this.renderer.domElement.addEventListener("mouseleave", this.leaveHandler);

    // Once the user zooms/drags, stop auto-fitting so we don't fight their camera
    this.interactHandler = () => { this.userControlled = true; };
    this.renderer.domElement.addEventListener("pointerdown", this.interactHandler);
    // Scrolling OUT while focused on a framed cluster glides back to the pre-frame whole-graph view
    // (the "undo" of a frame); otherwise the wheel just disables auto-fit like a drag.
    this.wheelHandler = (e: WheelEvent) => {
      this.userControlled = true;
      if (this.framed && e.deltaY > 0) this.returnHome();
    };
    this.renderer.domElement.addEventListener("wheel", this.wheelHandler, { passive: true });

    // "z" over a node → frame that node + its neighbors; "z" over empty graph → fit the whole graph
    // (the un-focus / overview gesture). Window-level so the canvas needn't be focused; bails on
    // modifiers (Cmd/Ctrl+Z is undo) and while typing in an input/editor. The empty-space case is
    // gated on pointerInside so a stray "z" elsewhere doesn't jump the camera.
    this.keyHandler = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const typing = !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
      // Escape steps back through the camera history (cluster tour / node hops). Gated on
      // pointerInside so it doesn't hijack Escape from modals or the editor elsewhere.
      if (e.key === "Escape") {
        if (typing || !this.pointerInside) return;
        if (this.framed || this.history.length > 0) this.back();
        return;
      }
      if (e.key !== "z" && e.key !== "Z") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing) return;
      if (this.hoveredId) this.frameNode(this.hoveredId);
      else if (this.pointerInside) this.frameAll();
    };
    window.addEventListener("keydown", this.keyHandler);

    this.labels.mount(this.group); // parent to the node group so labels track the idle spin
    this.labels.setEnabled(this.cfg.showGraphLabels);

    // Start render loop
    this.animate();
  }

  private handleResize() {
    const w = this.el.clientWidth || 320;
    const h = this.el.clientHeight || 400;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate() {
    this.rafId = requestAnimationFrame(() => this.animate());
    if (this.tween) {
      this.stepTween();
    } else if (this.camTween) {
      this.stepCamTween();
    } else if (!this.pointerInside && !this.framed && this.cfg.spin && this.viewMode === "3d") {
      // Idle "storm" spin — paused while hovering (stable inspect), while focused on a framed
      // cluster (the world-origin spin would fling it off-center), and in 2D (locked birdseye)
      this.group.rotation.y += this.cfg.spinSpeed;
    }
    // Crowding is camera-relative (screen space), so it recomputes when the view changes — orbit,
    // zoom, pan, or idle spin. In 3D the idle spin moves the view every frame, so without throttling
    // this O(edges) pass would run continuously. Throttled (CROWD_RECOMPUTE_FRAMES); no-op when still.
    if (this.frame++ % CROWD_RECOMPUTE_FRAMES === 0) this.refreshCrowdingIfMoved();
    this.stepHighlight(); // ease hover highlight toward its target
    this.updateNearCull(); // dissolve nodes that have come too close to the camera (3D)
    // Always runs — including during a 2D<->3D tween, where it keeps the camera aimed at the
    // (lerping) target. The tween disables controls + flushes inertia so this no longer jolts.
    this.controls.update();
    this.updateRotationVelocity(); // track camera rotation speed for click gating
    this.updateFog(); // depth fade tracks the (now-current) camera distance
    this.updateLabelsIfMoved();
    this.renderer.render(this.scene, this.camera);
    this.sampleFps();
  }

  /** Count rendered frames and report the rate to the host roughly twice a second. */
  private sampleFps() {
    const now = performance.now();
    if (this.fpsWindowStart === 0) { this.fpsWindowStart = now; return; }
    this.fpsFrames++;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 500) {
      this.onFps(Math.round((this.fpsFrames * 1000) / elapsed));
      this.fpsWindowStart = now;
      this.fpsFrames = 0;
    }
  }

  /** Register a callback that receives the measured frames-per-second (~2x/sec). */
  setFpsCallback(cb: (fps: number) => void) {
    this.onFps = cb;
  }

  /** Compute rotation velocity by measuring the quaternion change each frame. */
  private updateRotationVelocity() {
    const curQuat = this.camera.quaternion.clone();
    const deltaQuat = curQuat.clone().multiply(this.prevCameraQuat.clone().invert());
    // Extract angle from quaternion: angle = 2 * acos(w), where w is the scalar part.
    // Clamp w to [-1, 1] to avoid NaN from floating point errors.
    const w = Math.max(-1, Math.min(1, deltaQuat.w));
    this.rotationVelocity = Math.abs(2 * Math.acos(w));
    this.prevCameraQuat.copy(curQuat);
  }

  /** Raycast the pointer against the node points, returning the nearest node id (or null). */
  private pickNodeId(e: MouseEvent, threshold: number): string | null {
    if (!this.pointsMesh || this.nodes.length === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse2D.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.mouse2D, this.camera);
    this.raycaster.params.Points = { threshold };
    const hits = this.raycaster.intersectObject(this.pointsMesh);
    return hits.length > 0 ? this.nodes[hits[0].index!]?.id ?? null : null;
  }

  private handleClick(e: MouseEvent) {
    // Prevent file opens during fast graph rotation
    if (this.rotationVelocity > this.ROTATION_VELOCITY_THRESHOLD) return;
    const id = this.pickNodeId(e, 3);
    if (id) this.onClick(id);
  }

  private handleMove(e: MouseEvent) {
    this.pointerInside = true; // pause idle spin while interacting
    if (!this.pointsMesh || this.nodes.length === 0) return;
    const id = this.pickNodeId(e, 4);
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.labels.setHoveredId(this.hoveredId);
    this.renderer.domElement.style.cursor = id ? "pointer" : "default";
    this.setHighlightTargets();
    this.notifyHover();
  }

  /** Report the node under the pointer (resolved from hoveredId) to the host, or null when none. */
  private notifyHover() {
    const id = this.hoveredId;
    const n = id ? this.nodes.find((nd) => nd.id === id) : undefined;
    this.onHover(n ? { id: n.id, label: n.label, kind: n.kind, folder: n.folder } : null);
  }

  /** Return the set of node ids directly connected to the given node (one-hop neighbors). */
  private neighborsOf(id: string): Set<string> {
    const neighbors = new Set<string>();
    for (const link of this.links) {
      const sourceId = endpointId(link.source as string | N3);
      const targetId = endpointId(link.target as string | N3);
      if (sourceId === id) neighbors.add(targetId);
      if (targetId === id) neighbors.add(sourceId);
    }
    return neighbors;
  }

  /**
   * Glide the camera so the given node and its direct neighbors fill the view, centered, viewed
   * from the angle that shows the cluster most spread out. The viewing direction is the normal of
   * the cluster's best-fit plane (PCA: the thinnest principal axis), so neighbors fan across the
   * screen instead of stacking edge-on. Distance fits the in-plane (perpendicular-to-view) radius
   * to the FOV. A lone node (or a near-degenerate cluster) keeps the current angle and just dollies
   * in, since there's no meaningful plane to square up to.
   */
  private frameNode(id: string) {
    if (!this.nodes.some((n) => n.id === id)) return;
    const ids = this.neighborsOf(id);
    ids.add(id);
    this.frameIds(ids, 1.4); // 1.4 = a touch of breathing room around the cluster
  }

  /**
   * Glide so an arbitrary subset of nodes fills the view, centered, viewed down the normal of the
   * subset's best-fit plane (PCA: thinnest principal axis) so members fan across the screen instead
   * of stacking edge-on. Distance fits the in-plane (perpendicular-to-view) radius to the FOV. The
   * shared primitive behind frameNode (one node + neighbors) and frameSubset (a whole cluster).
   */
  private frameIds(ids: Set<string>, margin: number) {
    const subset = this.nodes.filter((n) => ids.has(n.id));
    if (subset.length === 0) return;

    const center = new THREE.Vector3();
    for (const n of subset) center.add(new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0));
    center.divideScalar(subset.length);

    // 2D stays top-down: pan + zoom to the subset, never tilt to a PCA plane (that would break the
    // flat map). View direction is fixed straight down (+Z) and the fit radius is the in-plane spread.
    if (this.viewMode === "2d") {
      center.z = 0;
      let r2 = this.cfg.nodeSize * 1.5;
      for (const n of subset) {
        const d = Math.hypot((n.x ?? 0) - center.x, (n.y ?? 0) - center.y);
        if (d > r2) r2 = d;
      }
      if (!this.framed) this.homePose = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
      this.framed = true;
      this.userControlled = true;
      this.glideToFraming(center, new THREE.Vector3(0, 0, 1), r2, margin);
      return;
    }

    // View direction: normal of the cluster's best-fit plane (smallest principal axis), oriented to
    // stay on the camera's current side so we square up rather than flip around. Falls back to the
    // current direction when the cluster is too small/flat for a plane to be meaningful.
    const curDir = this.camera.position.clone().sub(this.controls.target);
    if (curDir.lengthSq() < 1e-6) curDir.set(0, 0, 1);
    curDir.normalize();
    let viewDir = curDir.clone();
    if (subset.length >= 2) {
      let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
      for (const n of subset) {
        const dx = (n.x ?? 0) - center.x, dy = (n.y ?? 0) - center.y, dz = (n.z ?? 0) - center.z;
        cxx += dx * dx; cyy += dy * dy; czz += dz * dz; cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
      }
      const eig = eigenSym3([[cxx, cxy, cxz], [cxy, cyy, cyz], [cxz, cyz, czz]]);
      // Only reorient if the spread is genuinely 3D (a real plane exists, not a line/point).
      if (eig[2].value > 1e-6 && eig[1].value > eig[2].value * 1e-3) {
        viewDir = eig[0].vector;
        if (viewDir.dot(curDir) < 0) viewDir.negate(); // keep the camera on its current side
      }
    }

    // Distance fits the radius measured perpendicular to the view direction (the on-screen spread),
    // so the flat dimension we're looking down doesn't inflate the framing. Floor keeps a lone node
    // from zooming to a degenerate close-up.
    let r = this.cfg.nodeSize * 1.5;
    for (const n of subset) {
      const off = new THREE.Vector3((n.x ?? 0) - center.x, (n.y ?? 0) - center.y, (n.z ?? 0) - center.z);
      const along = off.dot(viewDir);
      const perp = Math.sqrt(Math.max(0, off.lengthSq() - along * along));
      if (perp > r) r = perp;
    }
    // Remember the pre-frame pose the first time we focus, so scrolling out returns to the original
    // whole-graph view (re-framing a different cluster while focused keeps the original home).
    if (!this.framed) this.homePose = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    this.framed = true;
    this.userControlled = true; // deliberate framing — don't let auto-fit pull it back
    this.glideToFraming(center, viewDir, r, margin);
  }

  // --- Public navigation API. Wraps the (private) glide engine; every jump pushes the prior pose
  // onto a history stack so back()/Escape can retrace a cluster tour or node walk. ---

  /** Fly to a node and its 1-hop neighborhood, framed and clarified. */
  focusNode(id: string): void {
    if (!this.nodes.some((n) => n.id === id)) return;
    this.pushHistory();
    this.frameNode(id);
  }

  /** Fly to an arbitrary set of nodes (e.g. a whole cluster) and frame them together. */
  frameSubset(ids: string[]): void {
    const set = new Set(ids.filter((id) => this.nodes.some((n) => n.id === id)));
    if (set.size === 0) return;
    this.pushHistory();
    this.frameIds(set, 1.25);
  }

  /** Highlight a set of nodes (e.g. a clicked cluster): brighten them, dim the rest, until cleared.
   *  Persists through mouse-out (hover temporarily overrides, then this returns). */
  highlightNodes(ids: string[]): void {
    this.highlightedSet = ids.length ? new Set(ids) : null;
    this.setHighlightTargets();
  }

  /** Drop any cluster highlight, back to the resting palette. */
  clearHighlight(): void {
    if (!this.highlightedSet) return;
    this.highlightedSet = null;
    this.setHighlightTargets();
  }

  /** Fly back to the whole-graph overview (public Home/reset). */
  resetView(): void {
    this.clearHighlight();
    this.pushHistory();
    this.frameAll();
  }

  /** Step back to the previous camera pose; falls back to the overview when history is empty. */
  back(): void {
    const pose = this.history.pop();
    if (pose) {
      this.clearFrame();
      this.userControlled = false;
      this.glideToPose(pose);
    } else {
      this.frameAll();
    }
  }

  private pushHistory() {
    // Coalesce rapid jumps: if a glide is already in flight the camera is mid-interpolation, so its
    // position isn't a meaningful "previous pose" — skip the push (the in-flight glide's origin was
    // already captured by the push that started it). Keeps back()/Escape stepping through settled poses.
    if (this.camTween) return;
    this.history.push({ pos: this.camera.position.clone(), target: this.controls.target.clone() });
    if (this.history.length > 20) this.history.shift();
  }

  /** Glide to an explicit camera pose (history back-step). */
  private glideToPose(pose: { pos: THREE.Vector3; target: THREE.Vector3 }) {
    this.controls.enableDamping = false;
    this.camTween = {
      start: performance.now(),
      posFrom: this.camera.position.clone(),
      posTo: pose.pos.clone(),
      tgtFrom: this.controls.target.clone(),
      tgtTo: pose.target.clone(),
    };
  }

  /** Node list for the graph search box: id/label/folder/community. */
  getNodesForUI(): { id: string; label: string; folder?: string; community?: number; communityLabel?: string }[] {
    return this.nodes.map((n) => ({
      id: n.id, label: n.label, folder: n.folder, community: n.community, communityLabel: n.communityLabel,
    }));
  }

  /** Per-community centroid + members + color, for the cluster legend's fly-to. */
  getCommunityCentroids(): Map<number, { label: string; ids: string[]; color: string; centroid: [number, number, number]; count: number }> {
    const groups = new Map<number, N3[]>();
    for (const n of this.nodes) {
      if (n.community == null) continue;
      let arr = groups.get(n.community);
      if (!arr) { arr = []; groups.set(n.community, arr); }
      arr.push(n);
    }
    const out = new Map<number, { label: string; ids: string[]; color: string; centroid: [number, number, number]; count: number }>();
    for (const [community, members] of groups) {
      if (members.length < 2) continue; // a lone note isn't a cluster — keep it out of the legend
      let cx = 0, cy = 0, cz = 0;
      for (const n of members) { cx += n.x ?? 0; cy += n.y ?? 0; cz += n.z ?? 0; }
      const k = members.length || 1;
      out.set(community, {
        label: members[0].communityLabel ?? `Cluster ${community}`,
        ids: members.map((n) => n.id),
        color: "#" + this.colorFor(members[0]).getHexString(),
        centroid: [cx / k, cy / k, cz / k],
        count: members.length,
      });
    }
    return out;
  }

  /**
   * Glide the whole graph back into view from the current angle — the "z over empty space" gesture.
   * Recenters on the graph centroid and fits every node, like the initial auto-fit but as a glide.
   * Drops any "z" focus so the idle spin resumes and scroll-out behaves normally again.
   */
  private frameAll() {
    if (this.nodes.length === 0) return;
    const center = new THREE.Vector3();
    for (const n of this.nodes) center.add(new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0));
    center.divideScalar(this.nodes.length);
    let r = this.cfg.nodeSize * 1.5;
    for (const n of this.nodes) {
      const d = center.distanceTo(new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0));
      if (d > r) r = d;
    }
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    this.clearFrame();           // overview — not focused on any cluster
    this.userControlled = false; // this IS the resting home framing
    this.glideToFraming(center, dir, r, 1.25); // 1.25 = fitCamera's whole-graph margin
  }

  /**
   * Shared camera glide for both framings: ease position + target toward looking at `center` from
   * `viewDir`, at the distance that fits `radius` to the FOV (× `margin`). Widens the clip planes
   * and orbit-distance limits first so neither the projection nor controls.update() clamps the glide
   * as it passes through distances outside the resting framing.
   */
  private glideToFraming(center: THREE.Vector3, viewDir: THREE.Vector3, radius: number, margin: number) {
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * margin;
    const startDist = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = 0.1;
    this.camera.far = Math.max(this.camera.far, Math.max(startDist, dist) * 4 + 100);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = Math.max(this.controls.maxDistance, dist * 4 + 100);
    this.controls.enableDamping = false; // we hard-set the camera each frame during the glide
    this.camTween = {
      start: performance.now(),
      posFrom: this.camera.position.clone(),
      posTo: center.clone().add(viewDir.clone().multiplyScalar(dist)),
      tgtFrom: this.controls.target.clone(),
      tgtTo: center.clone(),
    };
  }

  /** Clear frame state: a mode switch, graph reload, or return-home supersedes any "z" focus. */
  private clearFrame() {
    this.framed = false;
    this.homePose = null;
  }

  /**
   * Glide back to the whole-graph pose captured before the first "z" frame, restoring the original
   * orbit pivot and axes (and re-enabling the idle spin). Triggered by scrolling out while focused.
   */
  private returnHome() {
    if (!this.homePose) return;
    const pose = this.homePose;
    this.clearFrame();
    this.userControlled = false;         // back to the auto-fit home framing
    this.controls.enableDamping = false; // hard-set the camera during the glide
    this.camTween = {
      start: performance.now(),
      posFrom: this.camera.position.clone(),
      posTo: pose.pos.clone(),
      tgtFrom: this.controls.target.clone(),
      tgtTo: pose.target.clone(),
    };
  }

  /** Advance the active "z" framing glide one frame (driven from animate()). */
  private stepCamTween() {
    const tw = this.camTween!;
    const raw = (performance.now() - tw.start) / FRAME_TWEEN_MS;
    const t = raw >= 1 ? 1 : raw;
    const e = easeInOutCubic(t);
    this.camera.position.lerpVectors(tw.posFrom, tw.posTo, e);
    this.controls.target.lerpVectors(tw.tgtFrom, tw.tgtTo, e);
    if (t >= 1) {
      this.camTween = null;
      this.controls.enableDamping = true; // restore inertial feel for manual orbit/zoom
    }
  }

  /**
   * Dissolve nodes too close to the camera (3D only) by zeroing their point size, so foreground
   * nodes stop occluding whatever you've zoomed toward. The fade band is a fraction of the
   * camera→target distance, so it's dormant at the resting framing and bites as you move in. Writes
   * aScale = baseScale × fade each frame; the threshold uses world positions (group rotation/spin
   * applies). Outside 3D (or mid mode-tween) it restores full sizes once and bails.
   */
  private updateNearCull() {
    if (!this.pointsMesh || this.baseScales.length !== this.nodes.length) return;
    const attr = this.pointsMesh.geometry.getAttribute("aScale") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    if (this.viewMode !== "3d" || this.tween) {
      if (this.nearCullActive) { arr.set(this.baseScales); attr.needsUpdate = true; this.nearCullActive = false; }
      return;
    }
    this.group.updateMatrixWorld(); // node coords are group-local; fold in rotation/spin for world distance
    const cam = this.camera.position;
    const D = cam.distanceTo(this.controls.target) || 1;
    const hide = D * NEAR_CULL_HIDE;
    const show = D * NEAR_CULL_SHOW;
    const span = Math.max(1e-3, show - hide);
    const m = this.group.matrixWorld.elements;
    let anyCulled = false, changed = false;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const x = n.x ?? 0, y = n.y ?? 0, z = n.z ?? 0;
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const dist = Math.hypot(wx - cam.x, wy - cam.y, wz - cam.z);
      const fade = dist <= hide ? 0 : dist >= show ? 1 : (dist - hide) / span;
      if (fade < 1) anyCulled = true;
      const v = this.baseScales[i] * fade;
      if (arr[i] !== v) { arr[i] = v; changed = true; }
    }
    if (changed) attr.needsUpdate = true;
    this.nearCullActive = anyCulled;
  }

  /**
   * Edge target intensity = a base level scaled by the graph-scale crowding dim AND the zoom
   * ratio, capped at fully opaque. At the default framing (crowdZoom ≈ 1) this is just
   * base × crowd (the dimmed look); zooming in (crowdZoom > 1) brightens edges toward 1.0.
   */
  private edgeIntensity(i: number, base: number): number {
    return Math.min(1, Math.max(EDGE_BASE * EDGE_CROWD_MIN, base * (this.crowdE[i] ?? 1) * this.crowdZoom));
  }

  /** Set per-node / per-edge target intensities from the hovered node (eased in stepHighlight). */
  private setHighlightTargets() {
    if (this.tgtI.length !== this.nodes.length) return;
    const id = this.hoveredId;
    if (!id) {
      // No hover: if a cluster is highlighted, brighten its members and dim the rest; else rest.
      if (this.highlightedSet) {
        const set = this.highlightedSet;
        for (let i = 0; i < this.nodes.length; i++) this.tgtI[i] = set.has(this.nodes[i].id) ? 1 : -1;
        for (let i = 0; i < this.resolvedLinks.length && i < this.tgtE.length; i++) {
          const { s, t } = this.resolvedLinks[i];
          this.tgtE[i] = set.has(s.id) && set.has(t.id) ? 1 : this.edgeIntensity(i, EDGE_DIM);
        }
        this.hlActive = true;
        this.rewriteEdgePositions();
        return;
      }
      this.tgtI.fill(0); // 0 = resting palette color (no hover)
      for (let i = 0; i < this.tgtE.length; i++) this.tgtE[i] = this.edgeIntensity(i, EDGE_BASE);
      this.hlActive = true;
      this.rewriteEdgePositions(); // un-cull (no hover → every edge drawn)
      return;
    }
    const nbrs = this.neighborsOf(id);
    for (let i = 0; i < this.nodes.length; i++) {
      // +1 = highlighted → eased to white (matching the lit edges); -1 = dimmed non-neighbor.
      this.tgtI[i] = this.nodes[i].id === id || nbrs.has(this.nodes[i].id) ? 1 : -1;
    }
    for (let i = 0; i < this.resolvedLinks.length && i < this.tgtE.length; i++) {
      const { s, t } = this.resolvedLinks[i];
      // Focused edges pop to full; others dim by crowding (the crowded ones are also culled
      // from the geometry in rewriteEdgePositions, so the dense web doesn't reappear).
      this.tgtE[i] = s.id === id || t.id === id ? 1 : this.edgeIntensity(i, EDGE_DIM);
    }
    this.hlActive = true;
    this.rewriteEdgePositions(); // cull crowded non-focused edges for this hover
  }

  /** World units spanned by one screen pixel at the camera's focus distance (both 2D and 3D). */
  private worldPerPixel(): number {
    const dist = this.camera.position.distanceTo(this.controls.target) || 1;
    const hpx = this.renderer.domElement.clientHeight || 1;
    return (2 * dist * Math.tan(((this.camera.fov * Math.PI) / 180) / 2)) / hpx;
  }

  /**
   * Recompute crowding when the camera pose (or idle-spin rotation) has changed since the last
   * computation. Crowding is screen-space, so any view change can alter it. Cheap no-op when still.
   */
  private refreshCrowdingIfMoved() {
    if (this.resolvedLinks.length === 0) return;
    // While the layout is in motion (sim settling on first load, or a 2D/3D tween) the node
    // positions change every frame, so any crowding we measure is stale next frame — and
    // updateGeometryPositions resets camKey each tick, which would otherwise force this expensive
    // screen-space pass ~30x/sec. Skip it during motion; render() / finishTween recompute once on
    // settle. Crowding on a still-moving graph has no visual value anyway. Exception: once the USER
    // takes the camera (zoom/orbit/pan), recompute even mid-settle so zoom brightening responds —
    // a 3D layout can take a long time to settle, and we don't want zoom dead until then.
    if ((this.simSettling || this.tween) && !this.userControlled) return;
    const c = this.camera.position, t = this.controls.target;
    const key = `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)},${t.x.toFixed(1)},${t.y.toFixed(1)},${t.z.toFixed(1)},${this.group.rotation.y.toFixed(3)}`;
    if (key === this.camKey) return;
    this.camKey = key;
    this.recomputeEdgeCrowding();
    // Re-apply targets from the fresh crowding: hover re-dims + re-culls, otherwise resting dim.
    if (this.hoveredId) this.setHighlightTargets();
    else this.refreshRestingEdges();
  }

  /**
   * Per-edge screen-space crowding (both 2D and 3D), from the current camera. Projects each
   * edge's endpoints to pixels, walks the projected segment binning into screen cells, then sets
   * a brightness factor (crowdE) and a render flag (keepE) from the peak crowding along the edge.
   */
  private recomputeEdgeCrowding() {
    const n = this.resolvedLinks.length;
    if (this.crowdE.length !== n) { this.crowdE = new Float32Array(n).fill(1); this.keepE = new Uint8Array(n).fill(1); }
    if (n === 0) return;
    const w = this.renderer.domElement.clientWidth || 1;
    const h = this.renderer.domElement.clientHeight || 1;
    this.group.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    const project = (node: N3): [number, number] => {
      v.set(node.x ?? 0, node.y ?? 0, node.z ?? 0).applyMatrix4(this.group.matrixWorld).project(this.camera);
      return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h];
    };
    // project each edge's endpoints once
    const ex = new Float32Array(n * 4); // [sx, sy, tx, ty] per edge
    for (let i = 0; i < n; i++) {
      const { s, t } = this.resolvedLinks[i];
      const [sx, sy] = project(s);
      const [tx, ty] = project(t);
      ex[i * 4] = sx; ex[i * 4 + 1] = sy; ex[i * 4 + 2] = tx; ex[i * 4 + 3] = ty;
    }
    // Cell size = a fraction of the link distance, projected to screen px at the current zoom.
    // This keeps the crowding COUNT at graph scale (so sparse regions read sparse and the
    // default look is stable), while still being a screen-space test that re-forms as you orbit.
    const wpp = this.worldPerPixel();
    const C = Math.max(2, (this.linkDist() * EDGE_CROWD_CELL) / wpp);
    // Zoom factor: how much closer than the default (auto-fit) framing we are. Zooming in spreads
    // edges apart on screen, so crowding should ease and edges brighten — this scales that in.
    if (!this.userControlled || this.wppDefault === 0) this.wppDefault = wpp;
    const zoom = Math.min(8, Math.max(0.25, this.wppDefault / wpp));
    this.crowdZoom = zoom; // applied to edge brightness in restingEdgeIntensity / setHighlightTargets
    const key = (px: number, py: number) => (Math.floor(px / C) + 4096) * 16384 + (Math.floor(py / C) + 4096);
    const walk = (i: number, fn: (k: number) => void) => {
      const sx = ex[i * 4], sy = ex[i * 4 + 1], tx = ex[i * 4 + 2], ty = ex[i * 4 + 3];
      const steps = Math.max(1, Math.min(64, Math.ceil(Math.hypot(tx - sx, ty - sy) / C)));
      for (let j = 0; j <= steps; j++) { const f = j / steps; fn(key(sx + (tx - sx) * f, sy + (ty - sy) * f)); }
    };
    const count = new Map<number, number>();
    for (let i = 0; i < n; i++) walk(i, (k) => count.set(k, (count.get(k) ?? 0) + 1));
    for (let i = 0; i < n; i++) {
      let peak = 1;
      walk(i, (k) => { const c = count.get(k) ?? 1; if (c > peak) peak = c; });
      // crowdE: graph-scale dim factor (zoom-independent → stable default look). The zoom-relative
      // brightening is applied separately via crowdZoom when building edge targets.
      this.crowdE[i] = Math.max(EDGE_CROWD_MIN, Math.min(1, EDGE_CROWD_FULL / peak));
      // culling DOES ease with zoom: keep more non-focused edges as you zoom in (effPeak = peak/zoom)
      const effPeak = peak / zoom;
      const keepFrac = effPeak <= EDGE_CROWD_FULL ? 1 : EDGE_CULL_KEEP / effPeak;
      this.keepE[i] = (hashInt("" + i) % 1024) / 1024 < keepFrac ? 1 : 0;
    }
  }

  private updateLabelsIfMoved() {
    if (!this.cfg.showGraphLabels) return;
    // During a 2D↔3D mode tween the node positions are mid-morph, so hide labels entirely for the
    // duration; the next recompute (once the tween lands) brings the correct set back. This is the
    // requested "names go invisible while switching modes" behavior.
    if (this.tween) { this.labels.hideAll(); return; }
    // Skip while the layout is still settling (positions changing every frame) unless the user has
    // taken the camera — labels freeze on their last set, mirroring the crowding recompute.
    if (this.simSettling && !this.userControlled) return;
    if (this.frame % CROWD_RECOMPUTE_FRAMES !== 0) return;

    const wpp = this.worldPerPixel();
    if (this.wppDefaultForLabels === 0 || !this.userControlled) this.wppDefaultForLabels = wpp;
    const focalDistance = this.camera.position.distanceTo(this.controls.target);
    // Per-node degree size multiplier (baseScales is aligned to this.nodes) → the 2D rendered-size
    // label gate. Defaults to 1 when scales aren't built yet (pre-first-settle).
    const scaleById = new Map<string, number>();
    for (let i = 0; i < this.nodes.length; i++) scaleById.set(this.nodes[i].id, this.baseScales[i] ?? 1);
    this.labels.updateVisibility({
      camera: this.camera,
      group: this.group,
      viewMode: this.viewMode,
      screenW: this.renderer.domElement.clientWidth || 1,
      screenH: this.renderer.domElement.clientHeight || 1,
      focalDistance,
      cloudCenter: this.cloudCenter,
      cloudRadius: this.cloudRadius,
      worldPerPixel: wpp,
      wppDefault: this.wppDefaultForLabels,
      nodeSize: this.cfg.nodeSize,
      fovDeg: this.camera.fov,
      scaleById,
      activeFileId: this.activeFileId,
      searchMatches: this.searchMatches,
    });
  }

  /** Re-apply resting edge brightness from the latest crowding + zoom, unless a hover is active. */
  private refreshRestingEdges() {
    if (this.hoveredId) return;
    for (let i = 0; i < this.tgtE.length; i++) this.tgtE[i] = this.edgeIntensity(i, EDGE_BASE);
    this.hlActive = true;
  }

  /** Rewrite the edge position buffer (applies hover culling) and flag it for upload. */
  private rewriteEdgePositions() {
    if (!this.linesMesh) return;
    const attr = this.linesMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    this.writeEdgePositions(attr.array as Float32Array);
    attr.needsUpdate = true;
  }

  /** Ease current intensities toward targets each frame; rewrite color buffers only while moving. */
  private stepHighlight() {
    if (!this.hlActive) return;
    if (!this.pointsMesh || !this.linesMesh || this.curI.length === 0) return;
    const movingN = this.easeNodeColors();
    const movingE = this.easeColors(this.linesMesh, this.curE, this.tgtE, this.baseEdgeColors, 6);
    if (!movingN && !movingE) this.hlActive = false; // transition settled — stop looping until next hover change
  }

  /**
   * Ease each node's highlight scalar (curI) toward its target and recolor from it. The scalar is
   * signed: s ≥ 0 lerps the palette color toward white (highlighted, matching the lit edges), s < 0
   * darkens toward the dim level (non-neighbor under hover), s = 0 is the resting palette color.
   * Only flags the attribute dirty when something moved, so a settled graph does no GPU uploads.
   */
  private easeNodeColors(): boolean {
    if (!this.pointsMesh) return false;
    const attr = this.pointsMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    let moved = false;
    for (let i = 0; i < this.curI.length; i++) {
      const delta = this.tgtI[i] - this.curI[i];
      if (Math.abs(delta) <= 0.002) continue;
      this.curI[i] += delta * HL_SPEED;
      const s = this.curI[i];
      for (let k = 0; k < 3; k++) {
        const b = this.baseColors[i * 3 + k];
        arr[i * 3 + k] = s >= 0 ? b + (1 - b) * s : b * (1 + s * (1 - NODE_DIM));
      }
      moved = true;
    }
    if (moved) attr.needsUpdate = true;
    return moved;
  }

  /**
   * Ease each per-element intensity toward its target and scale that element's color
   * components (`stride` per element) from the base colors. Only flags the attribute
   * dirty when something actually moved, so a settled graph does no GPU uploads.
   */
  private easeColors(mesh: THREE.Object3D & { geometry: THREE.BufferGeometry }, cur: Float32Array, tgt: Float32Array, base: Float32Array, stride: number): boolean {
    const attr = mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    let moved = false;
    for (let i = 0; i < cur.length; i++) {
      const delta = tgt[i] - cur[i];
      if (Math.abs(delta) <= 0.002) continue;
      cur[i] += delta * HL_SPEED;
      const v = cur[i];
      for (let k = 0; k < stride; k++) arr[i * stride + k] = base[i * stride + k] * v;
      moved = true;
    }
    if (moved) attr.needsUpdate = true;
    return moved;
  }

  private paletteColor(key: string): THREE.Color {
    return new THREE.Color(this.palette[hashInt(key) % this.palette.length]);
  }

  /** Determine node color from kind (notes by folder, tags/memory/agents by label, self is lavender). */
  private colorFor(n: N3): THREE.Color {
    // Color by Louvain community when the backend stamped one (the chosen cluster driver). Falls back
    // to the per-kind scheme for sub-views/agents where community is absent.
    switch (n.kind) {
      case "note":
        if (n.community != null) return this.paletteColor("community:" + n.community);
        return this.paletteColor("folder:" + (n.folder ?? "(root)"));
      case "tag":
        return this.paletteColor("tag:" + n.label);
      case "memory":
        if (n.community != null) return this.paletteColor("community:" + n.community);
        return this.paletteColor("mem:" + n.label);
      case "agent":
        if (n.community != null) return this.paletteColor("community:" + n.community);
        return this.paletteColor("agent:" + n.label);
      default:
        return new THREE.Color(this.palette[2] ?? this.palette[0] ?? 0x3f6bf0); // self node (accent Blue)
    }
  }

  /** Link distance for the current view mode (2D spreads wider than 3D). */
  private linkDist(): number {
    return this.cfg.linkDistance * (this.viewMode === "2d" ? MODE_2D_SPACING : 1);
  }

  /** Collide radius derived from the (mode-adjusted) link distance — the uniform spacing floor. */
  private collideRadius(): number {
    return this.linkDist() * COLLIDE_RATIO;
  }

  /**
   * Per-node collide radius passed to forceCollide. Leaves get the uniform floor; hubs get their
   * actual drawn radius (degree-scaled point size, converted to world units) so big nodes repel as
   * the circles they're drawn as instead of as points — which is what made hubs overlap. `i` indexes
   * `this.nodes`, the same order as `baseScales` (its degree multipliers) and the sim's node array.
   */
  private collideRadiusFor = (_n: N3, i: number): number =>
    nodeCollideRadius(this.collideRadius(), this.cfg.nodeSize, this.baseScales[i] ?? 1, this.camera?.fov ?? 60, COLLIDE_SIZE_PADDING);

  /**
   * Apply user settings. Spin and node size are read live (cheap); a palette change
   * recolors the existing geometry in place; a physics change updates the forces and
   * gently reheats the simulation so the layout re-settles — none of these reload.
   */
  setConfig(cfg: GraphConfig) {
    const prev = this.cfg;
    this.cfg = cfg;
    this.palette = cfg.palette;

    if (this.pointsMesh) (this.pointsMesh.material as THREE.PointsMaterial).size = cfg.nodeSize;

    // Compare palette by content (GraphView builds a fresh array each effect run from
    // the accentPalette tokens, so reference identity would recolor on every config push).
    const paletteChanged =
      cfg.palette.length !== prev.palette.length ||
      cfg.palette.some((c, i) => c !== prev.palette[i]);
    if (paletteChanged && this.pointsMesh) this.recolorNodes();

    // Background color applies instantly; edge color + node-size multipliers apply on the
    // next graph render (re-settle below covers a size change).
    if (cfg.backgroundColor !== prev.backgroundColor) {
      this.scene.background = new THREE.Color(cfg.backgroundColor);
      if (this.scene.fog) (this.scene.fog as THREE.Fog).color = new THREE.Color(cfg.backgroundColor);
    }

    // nodeSize feeds the per-node collide radius, so a size change must recompute collide (and re-settle).
    if (this.sim && (cfg.repulsion !== prev.repulsion || cfg.linkDistance !== prev.linkDistance || cfg.centering !== prev.centering || cfg.nodeSize !== prev.nodeSize)) {
      (this.sim.force("charge") as any)?.strength(cfg.repulsion);
      (this.sim.force("link") as any)?.distance(this.linkDist());
      (this.sim.force("collide") as any)?.radius(this.collideRadiusFor); // re-eval per node (picks up new size/linkDist)
      for (const axis of ["x", "y", "z"] as const) (this.sim.force(axis) as any)?.strength(cfg.centering);
      this.userControlled = false; // re-frame as it re-settles
      this.sim.alpha(0.5).restart();
    }

    if (cfg.viewMode !== this.viewMode) {
      const next = cfg.viewMode;
      if (!this.controls) {
        this.viewMode = next; // not mounted yet — mount() will apply the controls
      } else if (!this.modeInitialized || !this.pointsMesh) {
        this.viewMode = next; // first apply / no graph yet — switch instantly, no tween
        this.applyControlsForMode(next);
      } else {
        this.startModeTween(next);
      }
      // Re-spread for the new mode: 2D uses wider link/collide spacing than 3D. The tween
      // reheats on land; the instant paths re-settle on the next render.
      if (this.sim) {
        (this.sim.force("link") as any)?.distance(this.linkDist());
        (this.sim.force("collide") as any)?.radius(this.collideRadiusFor); // re-eval per node for the new mode spacing
      }
    }
    if (cfg.showGraphLabels !== prev.showGraphLabels) {
      this.labels.setEnabled(cfg.showGraphLabels);
    }
    if (cfg.graphLabelHubCount !== prev.graphLabelHubCount) {
      this.refreshAlwaysOnLabels();
    }
    if (this.controls) this.modeInitialized = true;
  }

  private refreshAlwaysOnLabels() {
    const set = computeAlwaysOnSet(
      this.nodes.map((n) => ({ id: n.id, kind: n.kind })),
      this.links.map((l) => ({ source: l.source as string | { id: string }, target: l.target as string | { id: string } })),
      this.activeFileId,
      this.cfg.graphLabelHubCount,
    );
    this.labels.setAlwaysOnSet(set);
  }

  setActiveFile(id: string | null) {
    if (this.activeFileId === id) return;
    this.activeFileId = id;
    this.refreshAlwaysOnLabels();
  }

  /** Graph-search hits whose labels are forced visible (escape hatch for the 2D density gate). */
  setSearchMatches(ids: Set<string>) {
    this.searchMatches = ids;
  }

  /** Configure OrbitControls for 2D (pan-only) or 3D (orbit) mode. */
  private applyControlsForMode(mode: "2d" | "3d") {
    if (!this.controls) return;
    const is2D = mode === "2d";
    this.controls.enableRotate = !is2D;
    this.controls.screenSpacePanning = is2D;
    this.controls.mouseButtons.LEFT = is2D ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  }

  /** Pin every node to the z=0 plane (called on sim ticks in 2D so x/y re-spreads flat). */
  private flattenZ() {
    for (const node of this.nodes) {
      node.z = 0;
      node.vz = 0;
    }
  }

  /**
   * Begin the smooth 2D<->3D glide. When the backend has shipped both layouts (the common case), it
   * morphs every node straight from its current position to the target mode's precomputed position —
   * a controlled 500ms glide with NO re-settle, so it stays at full FPS. The 2D and 3D layouts are
   * aligned (2D is seeded from the flattened 3D), so the morph flattens/expands in place. Falls back
   * to the legacy "ease z, then re-settle" only when target positions aren't available.
   */
  private startModeTween(next: "2d" | "3d") {
    if (!this.pointsMesh || this.nodes.length === 0) {
      this.viewMode = next;
      this.applyControlsForMode(next);
      return;
    }
    const goingFlat = next === "2d";
    this.viewMode = next; // logical switch is immediate; visuals catch up over the tween
    this.clearFrame();
    this.sim?.stop(); // the tween owns positions until it finishes
    for (const node of this.nodes) {
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
    }

    // Get target position for a node in the new mode from backend-precomputed layout (or null).
    const targetOf = (n: N3): [number, number, number] | null => {
      if (next === "2d") {
        return n.pos2d ? [n.pos2d[0], n.pos2d[1], 0] : null;
      }
      return n.pos3d ? [n.pos3d[0], n.pos3d[1], n.pos3d[2]] : null;
    };
    const morph = this.nodes.every((n) => targetOf(n) !== null);

    // Legacy expand needs the depth saved when we flattened (no precomputed 3D layout available).
    if (!morph && goingFlat) {
      this.savedZ = new Map(this.nodes.map((n) => [n.id, n.z ?? 0]));
    }

    const fromPos = new Map<string, [number, number, number]>();
    const toPos = new Map<string, [number, number, number]>();
    for (const n of this.nodes) {
      fromPos.set(n.id, [n.x ?? 0, n.y ?? 0, n.z ?? 0]);
      if (morph) {
        toPos.set(n.id, targetOf(n)!);
      } else {
        // Legacy: x/y stay put, only z eases; post-tween re-settle re-spreads x/y for the mode.
        const zTarget = goingFlat ? 0 : (this.savedZ.get(n.id) ?? (Math.random() - 0.5) * 60);
        toPos.set(n.id, [n.x ?? 0, n.y ?? 0, zTarget]);
      }
    }

    // Frame the camera to the target layout's bounding sphere.
    let cx = 0, cy = 0, cz = 0;
    for (const [x, y, z] of toPos.values()) {
      cx += x;
      cy += y;
      cz += z;
    }
    const k = toPos.size || 1;
    cx /= k;
    cy /= k;
    cz /= k;
    let r = 1;
    for (const [x, y, z] of toPos.values()) {
      const d = Math.hypot(x - cx, y - cy, z - cz);
      if (d > r) r = d;
    }
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (r / Math.sin(fov / 2)) * 1.25;

    // stepTween hard-sets the camera position/target each frame, but controls.update() still
    // runs (in animate) to keep the camera AIMED at the lerping target. We just have to stop
    // that update() from re-applying orbit inertia, which is what jolted the graph sideways:
    //  • enabled=false makes OrbitControls ignore LIVE input, so trackpad/scroll momentum
    //    (which keeps firing for ~1s after a gesture) can't queue new inertia mid-glide.
    //  • the flush below drops inertia ALREADY queued from a fling just before the switch.
    // With no inertia left, update() only re-aims the camera — no sideways snap.
    this.controls.enableRotate = false;
    this.controls.enableDamping = false; // we hard-set the camera each frame
    this.controls.enabled = false;       // ignore live orbit/zoom/pan input during the glide
    // Consume + zero any queued inertia (one update with damping off), without moving the
    // camera (save/restore the pose around it).
    const preFlushPos = this.camera.position.clone();
    const preFlushTgt = this.controls.target.clone();
    this.controls.update();
    this.camera.position.copy(preFlushPos);
    this.controls.target.copy(preFlushTgt);
    this.tween = {
      start: performance.now(),
      fromPos,
      toPos,
      morph,
      camFrom: { pos: this.camera.position.clone(), tgt: this.controls.target.clone() },
      camTo: { pos: new THREE.Vector3(cx, cy, cz + dist), tgt: new THREE.Vector3(cx, cy, cz) },
      // When flattening, the idle 3D spin has piled up rotation.y across many full
      // turns. Tweening that raw value down to 0 would visibly spin the whole graph
      // around several times before it lands flat. Normalize the start angle into
      // (-π, π] (same visual orientation, no jump) so we untilt the short way — at
      // most a half-turn — to reach the locked 2D birdseye (rotation.y = 0).
      rotFrom: goingFlat ? shortestAngle(this.group.rotation.y) : this.group.rotation.y,
      rotTo: goingFlat ? 0 : this.group.rotation.y, // untilt spin when flattening
    };
  }

  /** Advance the active 2D<->3D tween one frame (driven from animate()). */
  private stepTween() {
    const tw = this.tween!;
    const raw = (performance.now() - tw.start) / MODE_TWEEN_MS;
    const t = raw >= 1 ? 1 : raw;
    const eased = easeInOutCubic(t);

    for (const node of this.nodes) {
      const fromPos = tw.fromPos.get(node.id);
      const toPos = tw.toPos.get(node.id);
      if (!fromPos || !toPos) continue;
      node.x = fromPos[0] + (toPos[0] - fromPos[0]) * eased;
      node.y = fromPos[1] + (toPos[1] - fromPos[1]) * eased;
      node.z = fromPos[2] + (toPos[2] - fromPos[2]) * eased;
    }
    this.group.rotation.y = tw.rotFrom + (tw.rotTo - tw.rotFrom) * eased;
    this.camera.position.lerpVectors(tw.camFrom.pos, tw.camTo.pos, eased);
    this.controls.target.lerpVectors(tw.camFrom.tgt, tw.camTo.tgt, eased);
    this.updateGeometryPositions();
    if (t >= 1) this.finishTween();
  }

  /** Land the tween: snap to the target layout, restore controls. Morph path needs no re-settle. */
  private finishTween() {
    const tw = this.tween;
    this.tween = null;
    if (!tw) return;

    for (const node of this.nodes) {
      const toPos = tw.toPos.get(node.id);
      if (toPos) {
        node.x = toPos[0];
        node.y = toPos[1];
        node.z = toPos[2];
      }
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
    }
    // Hand the camera back to OrbitControls: re-enable live input and restore damping. No
    // inertia accumulated during the glide (input was disabled and the start flush cleared
    // what was queued), so the first live update() lands clean — no snap.
    this.controls.enabled = true;
    this.controls.enableDamping = true;
    this.applyControlsForMode(this.viewMode);
    this.userControlled = false;
    this.updateGeometryPositions();

    if (tw.morph) {
      // At rest on precomputed layout → let crowding recompute, no re-settle needed.
      this.simSettling = false;
    } else {
      // Legacy path: re-spread in the new dimensionality (2D pins z each tick).
      this.sim?.alpha(0.5).restart();
    }

    // Apply any graph update that arrived mid-glide (deferred in render() to avoid scattering it).
    if (this.pendingGraph) {
      const g = this.pendingGraph;
      this.pendingGraph = null;
      this.render(g);
    }
  }

  /** Rewrite node colors (live + hover-base buffers) from the current palette. */
  private recolorNodes() {
    if (!this.pointsMesh) return;
    const attr = this.pointsMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.nodes.length; i++) {
      const color = this.colorFor(this.nodes[i]);
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
      this.baseColors[i * 3] = color.r;
      this.baseColors[i * 3 + 1] = color.g;
      this.baseColors[i * 3 + 2] = color.b;
    }
    attr.needsUpdate = true;
    this.curI.fill(0);
    this.tgtI.fill(0); // clear any in-progress hover highlight
    // If the pointer is still over a node, re-derive edge/node highlight targets from the
    // fresh base colors so edges and nodes stay consistent on a mid-hover palette change.
    // Without this the edge buffer remains in its hover state (focused bright, others culled)
    // while the node buffer has snapped back to flat resting colors — a half-hovered view.
    if (this.hoveredId) this.setHighlightTargets();
  }

  /**
   * localStorage key for persisted node positions. Keyed by view mode as well as graph
   * signature: a 2D layout is flat (z=0), so restoring it into 3D would leave the graph
   * stuck on a plane — separate keys keep each mode's settled layout independent.
   */
  private posKey(): string {
    // Key by view mode ONLY (not the graph signature). The vault/memory graph is live — a few nodes
    // are added/removed between loads — so an exact-graph key never matches next load and every load
    // is a cold start. One blob per view mode (2D layouts are flat, so they stay separate from 3D),
    // merged by node id on save, lets a graph that's ~99% the same reuse ~99% of cached positions.
    // Bump the version whenever the layout algorithm changes so stale cached positions are dropped
    // and a fresh settle runs. v5: per-node collision radius (nodes collide as circles, not points).
    return `oa-graphpos:v5:${this.viewMode}`;
  }

  /** Load persisted positions (id → [x,y,z]) for the current view mode, or null if none. */
  private loadCachedPositions(): Map<string, [number, number, number]> | null {
    try {
      const raw = localStorage.getItem(this.posKey());
      if (!raw) return null;
      const obj = JSON.parse(raw) as Record<string, [number, number, number]>;
      const map = new Map<string, [number, number, number]>();
      for (const [id, xyz] of Object.entries(obj)) {
        if (Array.isArray(xyz) && xyz.length === 3) map.set(id, xyz as [number, number, number]);
      }
      return map.size > 0 ? map : null;
    } catch {
      return null;
    }
  }

  /**
   * Persist settled node positions. Merges into the existing blob rather than overwriting, so
   * positions survive the small graph changes that happen between loads (the live graph adds/removes
   * a handful of nodes). The blob is a growing id→position memory; load() matches by id, keeping the
   * overlap near 100% so we warm-start (low alpha) instead of re-settling from scratch (the cold,
   * low-FPS path). Stale ids for deleted nodes linger harmlessly until a quota eviction clears them.
   */
  private saveCachedPositions() {
    const key = this.posKey();
    let obj: Record<string, [number, number, number]> = {};
    try {
      const raw = localStorage.getItem(key);
      if (raw) obj = (JSON.parse(raw) as Record<string, [number, number, number]>) ?? {};
    } catch {
      obj = {};
    }
    for (const n of this.nodes) {
      obj[n.id] = [Math.round(n.x ?? 0), Math.round(n.y ?? 0), Math.round(n.z ?? 0)];
    }
    const data = JSON.stringify(obj);
    try {
      localStorage.setItem(key, data);
    } catch {
      // Quota hit — drop every other cached layout (stale entries, other view mode) and retry once.
      this.evictOtherPositionCaches(key);
      try { localStorage.setItem(key, data); } catch { /* still too large — skip caching */ }
    }
  }

  /** Remove all `oa-graphpos:*` entries except the one we want to keep (frees quota). */
  private evictOtherPositionCaches(keepKey: string) {
    try {
      const staleKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("oa-graphpos:") && key !== keepKey) {
          staleKeys.push(key);
        }
      }
      for (const key of staleKeys) {
        localStorage.removeItem(key);
      }
    } catch {
      // localStorage unavailable — nothing to evict
    }
  }

  render(g: GraphData) {
    const sig = graphSig(g.nodes, g.edges.length);
    if (sig === this.lastSig) return;
    // A 2D<->3D glide owns node positions right now. Rebuilding the node array, refitting the
    // camera, and reheating the force sim here would scatter the in-flight morph for a frame
    // (the "instant scatter"). Defer this update; finishTween replays it once the glide lands.
    if (this.tween) { this.pendingGraph = g; return; }
    this.lastSig = sig;
    this.userControlled = false; // new graph/mode → re-enable auto-fit

    // Stop old simulation
    if (this.sim) {
      this.sim.stop();
      this.sim = null;
    }

    // Preserve positions for nodes that still exist (in-memory warm-start)
    const prevPos = new Map<string, { x: number; y: number; z: number }>();
    for (const n of this.nodes) {
      prevPos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 });
    }

    // Try to restore persisted (settled) positions from localStorage for a cooled start
    const cachedPos = this.loadCachedPositions();
    let cachedCount = 0;

    // Build new node/link arrays, tracking nodes that had no cached position (new since last settle).
    const uncached: N3[] = [];
    this.nodes = g.nodes.map((n) => {
      // Stash both backend-precomputed target layouts on the node so the 2D↔3D tween can morph
      // straight to them (no re-settle). Seed the current mode's starting position from the matching one.
      const base = { ...n, pos3d: n.position, pos2d: n.position2d } as N3;
      const server: [number, number, number] | null =
        this.viewMode === "2d"
          ? (n.position2d ? [n.position2d[0], n.position2d[1], 0] : null)
          : (n.position ?? null);
      // 0th priority: backend-precomputed layout for the current mode → render instantly.
      if (server) { cachedCount++; return { ...base, x: server[0], y: server[1], z: server[2] }; }
      // 1st priority: persisted localStorage positions (settled layout from a previous session)
      if (cachedPos) {
        const c = cachedPos.get(n.id);
        if (c) { cachedCount++; return { ...base, x: c[0], y: c[1], z: c[2] }; }
      }
      // 2nd priority: in-memory positions from previous render (same session, graph changed)
      const p = prevPos.get(n.id);
      const r = 80;
      const node: N3 = p
        ? { ...base, x: p.x, y: p.y, z: p.z }
        : { ...base, x: (Math.random() - 0.5) * r, y: (Math.random() - 0.5) * r, z: (Math.random() - 0.5) * r };
      uncached.push(node); // had no persisted position — new, or first session
      return node;
    });

    const totalNodes = this.nodes.length;
    const cachedFraction = totalNodes > 0 ? cachedCount / totalNodes : 0;
    // Warm load: enough nodes already have a settled position that we skip the (expensive) global
    // simulation and render the cached layout directly. Cold load (first ever / major change) settles.
    const warm = cachedFraction >= SETTLE_SKIP_FRAC;

    this.links = g.edges.map((e) => ({ source: e.from, target: e.to }));
    this.rebuildResolvedLinks(); // resolve endpoints once; endpoint objects mutate in place during ticks

    if (warm && uncached.length > 0) this.placeNearNeighbors(uncached); // nudge the few new nodes next to their neighbours

    this.buildGeometry(); // initial geometry with starting positions
    this.fitCamera();

    // Build the 3D force simulation. On a warm load it stays stopped (the cached layout is already
    // settled); it exists only so a settings-slider reheat or 2D/3D tween can re-run it. On a cold
    // load presettle() runs it to rest. d3 stops itself at alphaMin.
    this.sim = forceSimulation<N3>(this.nodes, 3)
      .alpha(warm ? 0.25 : 1) // cooled start when positions are restored from cache
      .force("charge", forceManyBody<N3>().strength(this.cfg.repulsion).theta(MANYBODY_THETA))
      .force(
        "link",
        forceLink<N3, L3>(this.links)
          .id((d: N3) => d.id)
          .distance(this.linkDist())
          .strength(LINK_STRENGTH)
      )
      .force("center", forceCenter<N3>(0, 0, 0))
      // Min-spacing floor: spreads dense clusters apart so density reads evenly across the graph.
      // Radius is per-node (hubs use their drawn size) so big nodes don't overlap. See collideRadiusFor.
      .force("collide", forceCollide<N3>(this.collideRadiusFor).iterations(COLLIDE_ITERATIONS))
      // Pull toward origin so separate tag clusters stay grouped rather than drifting apart.
      // Higher = denser / clusters closer.
      .force("x", forceX<N3>(0).strength(this.cfg.centering))
      .force("y", forceY<N3>(0).strength(this.cfg.centering))
      .force("z", forceZ<N3>(0).strength(this.cfg.centering))
      .alphaMin(0.001)
      // These handlers drive only the ANIMATED path — a settings-slider reheat or a 2D/3D tween
      // nudging an already-settled layout. The INITIAL layout is run headlessly in presettle()
      // below, so it never animates a scatter. Both paths stop on the same velocity threshold.
      .on("tick", () => {
        this.simSettling = true; // suppresses per-frame crowding recompute while the layout moves
        if (this.viewMode === "2d") this.flattenZ(); // keep the layout planar while x/y re-spreads
        this.updateGeometryPositions();
        this.fitCamera(); // keep the whole cloud framed as it condenses — also re-fits on every mode switch
        if (this.maxNodeSpeedSq() < this.restThresholdSq()) this.onSettled(); // freeze once motion is imperceptible
      })
      .on("end", () => this.onSettled()); // alphaMin backstop if motion never dips below the freeze threshold

    if (warm) {
      // The cached layout is already settled — don't tick the expensive simulation, just show it.
      this.sim.stop();
      this.onSettled();
    } else {
      this.presettle(); // cold: run the initial layout to rest synchronously (no scatter, once per new graph)
    }

    // Refresh label sprites + always-on selection for the new graph.
    this.labels.setGraph(this.nodes);
    this.refreshAlwaysOnLabels();
  }

  /**
   * Place new (uncached) nodes at the average position of their already-positioned neighbours, so on
   * a warm load the handful of nodes the live graph added since last settle sit next to where they
   * belong instead of at a random point — good enough to render without running the global settle.
   */
  private placeNearNeighbors(uncached: N3[]) {
    const isNew = new Set(uncached.map((n) => n.id));
    const neighborSum = new Map<string, { x: number; y: number; z: number; count: number }>();
    for (const node of uncached) {
      neighborSum.set(node.id, { x: 0, y: 0, z: 0, count: 0 });
    }

    // Accumulate position sums from positioned neighbors.
    for (const { s, t } of this.resolvedLinks) {
      if (isNew.has(s.id) && !isNew.has(t.id)) {
        const sum = neighborSum.get(s.id)!;
        sum.x += t.x ?? 0;
        sum.y += t.y ?? 0;
        sum.z += t.z ?? 0;
        sum.count++;
      }
      if (isNew.has(t.id) && !isNew.has(s.id)) {
        const sum = neighborSum.get(t.id)!;
        sum.x += s.x ?? 0;
        sum.y += s.y ?? 0;
        sum.z += s.z ?? 0;
        sum.count++;
      }
    }

    // Apply averaged position, or keep random fallback for isolated nodes.
    for (const node of uncached) {
      const sum = neighborSum.get(node.id)!;
      if (sum.count > 0) {
        node.x = sum.x / sum.count;
        node.y = sum.y / sum.count;
        node.z = sum.z / sum.count;
      }
    }
  }

  /** Squared speed of the fastest-moving node (compared squared to skip a per-node sqrt). */
  private maxNodeSpeedSq(): number {
    let maxSq = 0;
    for (const node of this.nodes) {
      const vx = node.vx ?? 0;
      const vy = node.vy ?? 0;
      const vz = node.vz ?? 0;
      const speedSq = vx * vx + vy * vy + vz * vz;
      if (speedSq > maxSq) maxSq = speedSq;
    }
    return maxSq;
  }

  /** Squared rest threshold: below this per-node speed the layout reads as settled (scales with mode spacing). */
  private restThresholdSq(): number {
    const t = this.linkDist() * SETTLE_SPEED_FRAC;
    return t * t;
  }

  /** Shared at-rest bookkeeping: stop the sim, zero residual motion, frame + persist the settled layout. */
  private onSettled() {
    this.sim?.stop();
    this.simSettling = false;
    // Zero residual velocity and acceleration (no more forces to apply).
    for (const node of this.nodes) {
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
    }
    this.updateGeometryPositions();
    this.fitCamera();
    this.refreshCrowdingIfMoved(); // compute resting crowding once now that the layout is still
    this.saveCachedPositions();    // persist settled positions for instant restore on next load
  }

  /**
   * Run the initial layout to rest synchronously, before the first paint. Advances the physics in a
   * tight loop (each tick() integrates forces → velocity → position; it does NOT dispatch "tick", so
   * nothing renders mid-loop), stopping as soon as the fastest node is barely moving, alphaMin is
   * reached, or the tick/time caps are hit. The graph then appears already in place — no visible
   * scatter and no multi-second low-FPS settle. A graph too large to settle within the caps paints
   * its partial layout and hands the rest to the animated timer (bounded by the same velocity freeze).
   */
  private presettle() {
    if (!this.sim) return;
    this.sim.stop(); // take over from d3's internal rAF timer; we tick manually
    const threshSq = this.restThresholdSq();
    const deadline = performance.now() + PRESETTLE_BUDGET_MS;
    let restRunCount = 0; // consecutive sub-threshold ticks
    for (let i = 0; i < PRESETTLE_MAX_TICKS; i++) {
      this.sim.tick();
      if (this.viewMode === "2d") this.flattenZ(); // keep the headless layout planar in 2D
      if (this.sim.alpha() < this.sim.alphaMin()) {
        this.onSettled();
        return; // fully cooled
      }
      restRunCount = this.maxNodeSpeedSq() < threshSq ? restRunCount + 1 : 0;
      if (restRunCount >= SETTLE_REST_TICKS) {
        this.onSettled();
        return; // settled by motion, not the slow timer
      }
      if (performance.now() >= deadline) break; // budget spent — finish the remainder animated
    }
    // Didn't fully settle within the caps: paint what we have and let the animated timer finish it.
    // Its tick handler applies the same velocity freeze, so the visible tail stays short.
    this.updateGeometryPositions();
    this.fitCamera();
    this.simSettling = true;
    this.sim.restart();
  }

  /** Remove both meshes from the scene group and free their GPU resources. */
  private disposeMeshes() {
    for (const mesh of [this.pointsMesh, this.linesMesh]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.pointsMesh = null;
    this.linesMesh = null;
  }

  /**
   * Per-node size multiplier from connection count (degree). Counts edges touching each
   * node from the resolved links, then maps degree → multiplier with a capped sqrt curve.
   * Returned in node-array order for the geometry's `aScale` attribute.
   */
  private degreeScales(): Float32Array {
    const deg = new Map<string, number>();
    for (const { s, t } of this.resolvedLinks) {
      deg.set(s.id, (deg.get(s.id) ?? 0) + 1);
      deg.set(t.id, (deg.get(t.id) ?? 0) + 1);
    }
    const scales = new Float32Array(this.nodes.length);
    for (let i = 0; i < this.nodes.length; i++) {
      const d = deg.get(this.nodes[i].id) ?? 0;
      scales[i] = Math.min(this.cfg.nodeSizeMaxMult, this.cfg.nodeSizeMinMult + this.cfg.nodeSizeDegreeGain * Math.sqrt(d));
    }
    return scales;
  }

  private buildGeometry() {
    this.disposeMeshes();

    const nodeCount = this.nodes.length;

    // --- Points (nodes) ---
    const positions = new Float32Array(nodeCount * 3);
    const colors = new Float32Array(nodeCount * 3);

    for (let i = 0; i < nodeCount; i++) {
      const n = this.nodes[i];
      positions[i * 3] = n.x ?? 0;
      positions[i * 3 + 1] = n.y ?? 0;
      positions[i * 3 + 2] = n.z ?? 0;

      const c = this.colorFor(n);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.baseScales = this.degreeScales();
    pointsGeo.setAttribute("aScale", new THREE.BufferAttribute(this.baseScales.slice(), 1));

    this.baseColors = colors.slice(); // remember for hover restore
    this.hoveredId = null;
    this.clearFrame();
    this.curI = new Float32Array(nodeCount).fill(0); // node highlight scalar: 0 rest, +1 white, -1 dim
    this.tgtI = new Float32Array(nodeCount).fill(0);

    const pointsMat = new THREE.PointsMaterial({
      size: this.cfg.nodeSize,
      sizeAttenuation: true,
      vertexColors: true,
      map: this.circleTex ?? undefined,
      alphaTest: 0.5,
      transparent: true,
      // Write depth so nodes occlude each other by real camera distance, not buffer order
      // (a back node was painting over a front one). Safe because alphaTest hard-clips the
      // transparent corners, so the kept pixels are opaque and leave no depth halos.
      depthWrite: true,
    });
    // Scale each point's base size by its per-vertex degree multiplier. Injected into the
    // built-in points shader so size attenuation, circle map, and vertex colors stay intact.
    pointsMat.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "attribute float aScale;\n" +
        shader.vertexShader.replace("gl_PointSize = size;", "gl_PointSize = size * aScale;");
    };

    this.pointsMesh = new THREE.Points(pointsGeo, pointsMat);
    this.pointsMesh.renderOrder = 1; // draw nodes after edges so links sit under nodes (matters in 2D, where equal depth ties)
    this.group.add(this.pointsMesh);

    // --- LineSegments (edges) — clean cohesive lavender, brighten on hover ---
    const lineCount = this.resolvedLinks.length;
    const linePos = new Float32Array(lineCount * 6); // 2 vertices * 3 components
    const lineColors = new Float32Array(lineCount * 6);
    this.baseEdgeColors = new Float32Array(lineCount * 6);
    const ec = new THREE.Color(this.cfg.edgeColor);
    const ecc = [ec.r, ec.g, ec.b];
    for (let i = 0; i < lineCount; i++) {
      for (let k = 0; k < 6; k++) {
        this.baseEdgeColors[i * 6 + k] = ecc[k % 3];
        lineColors[i * 6 + k] = ecc[k % 3] * EDGE_BASE;
      }
    }
    this.writeEdgePositions(linePos);

    const linesGeo = new THREE.BufferGeometry();
    linesGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    linesGeo.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
    this.curE = new Float32Array(lineCount).fill(EDGE_BASE);
    this.tgtE = new Float32Array(lineCount).fill(EDGE_BASE);
    this.crowdE = new Float32Array(lineCount).fill(1);
    this.keepE = new Uint8Array(lineCount).fill(1);

    const linesMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });

    this.linesMesh = new THREE.LineSegments(linesGeo, linesMat);
    this.linesMesh.renderOrder = 0; // edges below nodes (see pointsMesh.renderOrder)
    this.group.add(this.linesMesh);
  }

  /** Resolve each link's endpoints to live node objects, dropping links with a missing end. Cached per graph. */
  private rebuildResolvedLinks() {
    const nodeById = new Map<string, N3>();
    for (const node of this.nodes) nodeById.set(node.id, node);
    this.resolvedLinks = [];
    for (const link of this.links) {
      const source = nodeById.get(endpointId(link.source as string | N3));
      const target = nodeById.get(endpointId(link.target as string | N3));
      if (source && target) {
        this.resolvedLinks.push({ s: source, t: target });
      }
    }
  }

  /**
   * Write endpoint positions (2 vertices * 3 components) into an edge position buffer. While a
   * node is hovered, crowded NON-focused edges (keepE === 0) are collapsed to a zero-length
   * segment so they don't render — thinning the dense web behind the highlight. The focused
   * node's own edges are always drawn in full.
   */
  private writeEdgePositions(buf: Float32Array) {
    const hoveredId = this.hoveredId;
    const hovering = hoveredId !== null;
    for (let i = 0; i < this.resolvedLinks.length; i++) {
      const { s: source, t: target } = this.resolvedLinks[i];
      const sx = source.x ?? 0;
      const sy = source.y ?? 0;
      const sz = source.z ?? 0;
      const shouldCull = hovering && this.keepE[i] === 0 && source.id !== hoveredId && target.id !== hoveredId;
      buf[i * 6] = sx;
      buf[i * 6 + 1] = sy;
      buf[i * 6 + 2] = sz;
      // Culled edge: collapse to zero-length (second vertex == first, no pixels); else draw to far endpoint.
      buf[i * 6 + 3] = shouldCull ? sx : (target.x ?? 0);
      buf[i * 6 + 4] = shouldCull ? sy : (target.y ?? 0);
      buf[i * 6 + 5] = shouldCull ? sz : (target.z ?? 0);
    }
  }

  private updateGeometryPositions() {
    if (!this.pointsMesh || !this.linesMesh) return;

    const posAttr = this.pointsMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      posArray[i * 3] = n.x ?? 0;
      posArray[i * 3 + 1] = n.y ?? 0;
      posArray[i * 3 + 2] = n.z ?? 0;
    }
    posAttr.needsUpdate = true;
    this.pointsMesh.geometry.computeBoundingSphere();

    const linePosAttr = this.linesMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    this.writeEdgePositions(linePosAttr.array as Float32Array);
    linePosAttr.needsUpdate = true;
    this.linesMesh.geometry.computeBoundingSphere();

    this.camKey = ""; // layout moved → force a crowding recompute on the next frame
  }

  /** Frame the camera to the node cloud's bounding sphere (centroid + max radius). */
  private fitCamera() {
    if (this.nodes.length === 0 || this.userControlled || this.tween || this.camTween) return;

    // Compute centroid.
    let cx = 0, cy = 0, cz = 0;
    for (const node of this.nodes) {
      cx += node.x ?? 0;
      cy += node.y ?? 0;
      cz += node.z ?? 0;
    }
    const k = this.nodes.length;
    cx /= k;
    cy /= k;
    cz /= k;

    // Compute radius: the farthest node from the centroid.
    // Centering forces keep the cloud bounded, so fitting to the farthest node with margin
    // ensures every node is visible and comfortably framed.
    let radius = 1;
    for (const node of this.nodes) {
      const dx = (node.x ?? 0) - cx;
      const dy = (node.y ?? 0) - cy;
      const dz = (node.z ?? 0) - cz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance > radius) radius = distance;
    }
    this.cloudCenter.set(cx, cy, cz); // remembered for the depth-fog framing
    this.cloudRadius = radius;

    // Compute camera distance from FOV and radius.
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = (radius / Math.sin(fov / 2)) * 1.25;
    this.controls.target.set(cx, cy, cz);
    this.camera.position.set(cx, cy, cz + distance);
    this.camera.near = Math.max(0.1, distance / 1000);
    this.camera.far = distance * 12 + 100;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(0.5, distance * 0.02); // allow zooming in close
    this.controls.maxDistance = distance * 12;
    this.controls.update();
  }

  /**
   * Position the linear depth fog so the front of the node cloud stays crisp and the back
   * fades toward the background — driven each frame off the live camera→centroid distance,
   * so it tracks orbit and zoom. In flat 2D every node sits at one depth (nothing to convey),
   * so the fog is pushed out of range rather than toggled off (toggling recompiles materials).
   */
  private updateFog() {
    const fog = this.scene.fog as THREE.Fog | null;
    if (!fog) return;
    if (this.viewMode !== "3d") {
      fog.near = 1e6;
      fog.far = 1e7;
      return;
    }
    const camDist = this.camera.position.distanceTo(this.cloudCenter);
    const r = this.cloudRadius;
    fog.near = Math.max(0.1, camDist - r * FOG_FRONT);
    fog.far = camDist + r * FOG_BACK;
  }

  destroy() {
    // Cancel animation loop
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Stop simulation
    if (this.sim) {
      this.sim.stop();
      this.sim = null;
    }

    // Remove click handler
    if (this.clickHandler) {
      this.renderer.domElement.removeEventListener("click", this.clickHandler);
      this.clickHandler = undefined;
    }
    if (this.moveHandler) {
      this.renderer.domElement.removeEventListener("mousemove", this.moveHandler);
      this.moveHandler = undefined;
    }
    if (this.leaveHandler) {
      this.renderer.domElement.removeEventListener("mouseleave", this.leaveHandler);
      this.leaveHandler = undefined;
    }
    if (this.interactHandler) {
      this.renderer.domElement.removeEventListener("pointerdown", this.interactHandler);
      this.interactHandler = undefined;
    }
    if (this.wheelHandler) {
      this.renderer.domElement.removeEventListener("wheel", this.wheelHandler);
      this.wheelHandler = undefined;
    }
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = undefined;
    }
    this.circleTex?.dispose();
    this.circleTex = null;

    this.disposeMeshes();
    this.labels.dispose();

    // Dispose controls
    this.controls?.dispose();

    // Dispose renderer and remove canvas
    this.renderer?.dispose();
    this.renderer?.domElement.remove();

    // Disconnect resize observer
    this.ro?.disconnect();
  }
}
