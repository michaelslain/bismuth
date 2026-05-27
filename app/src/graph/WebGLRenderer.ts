// app/src/graph/WebGLRenderer.ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceX,
  forceY,
  forceZ,
  type Simulation,
  type SimNode,
  type SimLink,
} from "d3-force-3d";
import type { GraphData, NodeKind } from "../../../core/src/graph";
import type { GraphRenderer } from "./GraphRenderer";

// Default node palette (pink → purples → lavender → blue) — overridable via setConfig.
const DEFAULT_PALETTE = [0xf277de, 0x9177f2, 0x8b88f2, 0xbdcaf2, 0x77a0f2];
const EDGE_BASE = 0.55; // normal edge brightness (0..1)
const NODE_DIM = 0.4;   // dimmed non-neighbor node brightness on hover (gentle — stays visible)
const EDGE_DIM = 0.18;  // dimmed edge brightness on hover
const HL_SPEED = 0.16;  // highlight ease per frame (smooth fade in/out)
const EDGE_COLOR = 0xbdcaf2; // cohesive lavender for links

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
}

const DEFAULT_CONFIG: GraphConfig = {
  spin: true,
  spinSpeed: 0.0015,
  palette: DEFAULT_PALETTE,
  repulsion: -7,
  linkDistance: 5,
  centering: 0.13,
  nodeSize: 6,
  viewMode: "3d",
};

const MODE_TWEEN_MS = 500; // duration of the 2D<->3D flatten/expand glide

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

/** A white disc texture so points render as circles (alphaTest clips the square corners). */
function makeCircleTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

type N3 = SimNode & { id: string; label: string; kind: NodeKind; folder?: string };
type L3 = SimLink<N3>;

function graphSig(nodes: { id: string }[], edgeCount: number): string {
  return nodes.map((n) => n.id).sort().join(",") + "|" + edgeCount;
}

/** d3-force replaces link endpoints with node objects after the first tick; this reads the id either way. */
function endpointId(endpoint: string | N3): string {
  return typeof endpoint === "object" ? endpoint.id : endpoint;
}

export class WebGLRenderer implements GraphRenderer {
  // three.js core
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;

  // scene objects
  private group!: THREE.Group;
  private pointsMesh: THREE.Points | null = null;
  private linesMesh: THREE.LineSegments | null = null;

  // graph data
  private nodes: N3[] = [];
  private links: L3[] = [];
  private resolvedLinks: { s: N3; t: N3 }[] = []; // links with both endpoints resolved to nodes (rebuilt per graph)
  private onClick: (id: string) => void = () => {};
  private lastSig = "";

  // user settings — spin/size read live each frame; palette/physics applied via setConfig
  private cfg: GraphConfig = { ...DEFAULT_CONFIG };
  private palette: number[] = DEFAULT_PALETTE;

  // simulation
  private sim: Simulation<N3> | null = null;

  // animation
  private rafId: number | null = null;
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
  private hoveredId: string | null = null;
  private pointerInside = false;
  private curI: Float32Array = new Float32Array(0); // current node intensities (eased)
  private tgtI: Float32Array = new Float32Array(0); // target node intensities
  private curE: Float32Array = new Float32Array(0); // current edge intensities (eased)
  private tgtE: Float32Array = new Float32Array(0); // target edge intensities
  private baseEdgeColors: Float32Array = new Float32Array(0); // per-vertex edge colors (endpoint gradient)
  private hlActive = false; // true while a highlight transition is in progress; cleared when settled
  private userControlled = false; // once the user zooms/drags, stop auto-fitting the camera
  private interactHandler?: () => void;

  // 2D/3D view mode + the glide between them
  private viewMode: "2d" | "3d" = "3d";
  private modeInitialized = false; // first setConfig applies mode instantly; later changes tween
  private savedZ = new Map<string, number>(); // node depth captured when flattening, restored on expand
  private tween: null | {
    goingFlat: boolean;
    start: number;
    z0: Map<string, number>;       // per-node z at tween start
    zTarget: Map<string, number>;  // per-node z at tween end
    camFrom: { pos: THREE.Vector3; tgt: THREE.Vector3 };
    camTo: { pos: THREE.Vector3; tgt: THREE.Vector3 };
    rotFrom: number;
    rotTo: number;
  } = null;

  mount(el: HTMLElement, onNodeClick: (id: string) => void) {
    this.el = el;
    this.onClick = onNodeClick;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e0e11);

    // Camera
    const w = el.clientWidth || 320;
    const h = el.clientHeight || 400;
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 20000);
    this.camera.position.set(0, 0, 180);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
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
      this.setHighlightTargets();
    };
    this.renderer.domElement.addEventListener("mouseleave", this.leaveHandler);

    // Once the user zooms/drags, stop auto-fitting so we don't fight their camera
    this.interactHandler = () => { this.userControlled = true; };
    this.renderer.domElement.addEventListener("wheel", this.interactHandler, { passive: true });
    this.renderer.domElement.addEventListener("pointerdown", this.interactHandler);

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
    } else if (!this.pointerInside && this.cfg.spin && this.viewMode === "3d") {
      // Idle "storm" spin — paused while hovering (stable inspect) and in 2D (locked birdseye)
      this.group.rotation.y += this.cfg.spinSpeed;
    }
    this.stepHighlight(); // ease hover highlight toward its target
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
    const id = this.pickNodeId(e, 3);
    if (id) this.onClick(id);
  }

  private handleMove(e: MouseEvent) {
    this.pointerInside = true; // pause idle spin while interacting
    if (!this.pointsMesh || this.nodes.length === 0) return;
    const id = this.pickNodeId(e, 4);
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.renderer.domElement.style.cursor = id ? "pointer" : "default";
    this.setHighlightTargets();
  }

  private neighborsOf(id: string): Set<string> {
    const set = new Set<string>();
    for (const l of this.links) {
      const s = endpointId(l.source as string | N3);
      const t = endpointId(l.target as string | N3);
      if (s === id) set.add(t);
      if (t === id) set.add(s);
    }
    return set;
  }

  /** Set per-node / per-edge target intensities from the hovered node (eased in stepHighlight). */
  private setHighlightTargets() {
    if (this.tgtI.length !== this.nodes.length) return;
    const id = this.hoveredId;
    if (!id) {
      this.tgtI.fill(1);
      this.tgtE.fill(EDGE_BASE);
      this.hlActive = true;
      return;
    }
    const nbrs = this.neighborsOf(id);
    for (let i = 0; i < this.nodes.length; i++) {
      this.tgtI[i] = this.nodes[i].id === id || nbrs.has(this.nodes[i].id) ? 1 : NODE_DIM;
    }
    for (let i = 0; i < this.resolvedLinks.length && i < this.tgtE.length; i++) {
      const { s, t } = this.resolvedLinks[i];
      this.tgtE[i] = s.id === id || t.id === id ? 1 : EDGE_DIM;
    }
    this.hlActive = true;
  }

  /** Ease current intensities toward targets each frame; rewrite color buffers only while moving. */
  private stepHighlight() {
    if (!this.hlActive) return;
    if (!this.pointsMesh || !this.linesMesh || this.curI.length === 0) return;
    const movingN = this.easeColors(this.pointsMesh, this.curI, this.tgtI, this.baseColors, 3);
    const movingE = this.easeColors(this.linesMesh, this.curE, this.tgtE, this.baseEdgeColors, 6);
    if (!movingN && !movingE) this.hlActive = false; // transition settled — stop looping until next hover change
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

  private colorFor(n: N3): THREE.Color {
    switch (n.kind) {
      case "note": return this.paletteColor("folder:" + (n.folder ?? "(root)"));
      case "tag": return this.paletteColor("tag:" + n.label);
      case "memory": return this.paletteColor("mem:" + n.label);
      case "agent": return this.paletteColor("agent:" + n.label);
      case "self": return new THREE.Color(0xffffff); // the single "you" node — distinct white anchor
      default: return new THREE.Color(0xbdcaf2);
    }
  }

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

    if (cfg.palette !== prev.palette && this.pointsMesh) this.recolorNodes();

    if (this.sim && (cfg.repulsion !== prev.repulsion || cfg.linkDistance !== prev.linkDistance || cfg.centering !== prev.centering)) {
      (this.sim.force("charge") as any)?.strength(cfg.repulsion);
      (this.sim.force("link") as any)?.distance(cfg.linkDistance);
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
    }
    if (this.controls) this.modeInitialized = true;
  }

  /** Lock the camera for 2D (top-down, pan+zoom only) or free it for 3D orbit. */
  private applyControlsForMode(mode: "2d" | "3d") {
    if (!this.controls) return;
    if (mode === "2d") {
      this.controls.enableRotate = false;
      this.controls.screenSpacePanning = true;
      this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN; // left-drag pans the plane
    } else {
      this.controls.enableRotate = true;
      this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    }
  }

  /** Pin every node to the z=0 plane (called on sim ticks in 2D so x/y re-spreads flat). */
  private flattenZ() {
    for (const n of this.nodes) { n.z = 0; n.vz = 0; }
  }

  /**
   * Begin the smooth 2D<->3D glide: eases each node's depth (z) toward 0 (flatten) or back to
   * its saved depth (expand), glides the camera to a top-down fit, and untilts the spin. The
   * simulation is paused during the glide and reheated after so the layout re-settles in the
   * new dimensionality.
   */
  private startModeTween(next: "2d" | "3d") {
    if (!this.pointsMesh || this.nodes.length === 0) {
      this.viewMode = next;
      this.applyControlsForMode(next);
      return;
    }
    const goingFlat = next === "2d";
    this.viewMode = next; // logical switch is immediate; visuals catch up over the tween

    const z0 = new Map<string, number>();
    for (const n of this.nodes) z0.set(n.id, n.z ?? 0);
    if (goingFlat) this.savedZ = new Map(z0); // remember depth so 3D restores it
    const zTarget = new Map<string, number>();
    for (const n of this.nodes) {
      zTarget.set(n.id, goingFlat ? 0 : (this.savedZ.get(n.id) ?? (Math.random() - 0.5) * 60));
    }

    this.sim?.stop(); // the tween owns positions until it finishes
    for (const n of this.nodes) n.vz = 0;

    const framing = (zOf: (n: N3) => number) => {
      let cx = 0, cy = 0, cz = 0;
      for (const n of this.nodes) { cx += n.x ?? 0; cy += n.y ?? 0; cz += zOf(n); }
      const k = this.nodes.length || 1; cx /= k; cy /= k; cz /= k;
      let r = 1;
      for (const n of this.nodes) {
        const dx = (n.x ?? 0) - cx, dy = (n.y ?? 0) - cy, dz = zOf(n) - cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > r) r = d;
      }
      const fov = (this.camera.fov * Math.PI) / 180;
      const dist = (r / Math.sin(fov / 2)) * 1.25;
      return { pos: new THREE.Vector3(cx, cy, cz + dist), tgt: new THREE.Vector3(cx, cy, cz) };
    };

    this.controls.enableRotate = false;  // lock orbit during the move
    this.controls.enableDamping = false; // we hard-set the camera each frame
    this.tween = {
      goingFlat,
      start: performance.now(),
      z0,
      zTarget,
      camFrom: { pos: this.camera.position.clone(), tgt: this.controls.target.clone() },
      camTo: framing((n) => zTarget.get(n.id) ?? 0),
      rotFrom: this.group.rotation.y,
      rotTo: goingFlat ? 0 : this.group.rotation.y, // untilt spin when flattening
    };
  }

  /** Advance the active 2D<->3D tween one frame (driven from animate()). */
  private stepTween() {
    const tw = this.tween!;
    const raw = (performance.now() - tw.start) / MODE_TWEEN_MS;
    const t = raw >= 1 ? 1 : raw;
    const e = easeInOutCubic(t);
    for (const n of this.nodes) {
      const a = tw.z0.get(n.id) ?? 0;
      const b = tw.zTarget.get(n.id) ?? 0;
      n.z = a + (b - a) * e;
    }
    this.group.rotation.y = tw.rotFrom + (tw.rotTo - tw.rotFrom) * e;
    this.camera.position.lerpVectors(tw.camFrom.pos, tw.camTo.pos, e);
    this.controls.target.lerpVectors(tw.camFrom.tgt, tw.camTo.tgt, e);
    this.updateGeometryPositions();
    if (t >= 1) this.finishTween();
  }

  /** Land the tween: snap to exact targets, restore controls for the mode, reheat the layout. */
  private finishTween() {
    const tw = this.tween;
    this.tween = null;
    if (!tw) return;
    for (const n of this.nodes) { n.z = tw.zTarget.get(n.id) ?? 0; n.vz = 0; }
    this.controls.enableDamping = true;
    this.applyControlsForMode(this.viewMode);
    this.userControlled = false;       // re-frame as the layout re-settles
    this.updateGeometryPositions();
    this.sim?.alpha(0.5).restart();    // re-spread in the new dimensionality (2D pins z each tick)
  }

  /** Rewrite node colors (live + hover-base buffers) from the current palette. */
  private recolorNodes() {
    if (!this.pointsMesh) return;
    const attr = this.pointsMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.nodes.length; i++) {
      const c = this.colorFor(this.nodes[i]);
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
      this.baseColors[i * 3] = c.r; this.baseColors[i * 3 + 1] = c.g; this.baseColors[i * 3 + 2] = c.b;
    }
    attr.needsUpdate = true;
    this.curI.fill(1); this.tgtI.fill(1); // clear any in-progress hover dim
  }

  render(g: GraphData) {
    const sig = graphSig(g.nodes, g.edges.length);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.userControlled = false; // new graph/mode → re-enable auto-fit

    // Stop old simulation
    if (this.sim) {
      this.sim.stop();
      this.sim = null;
    }

    // Preserve positions for nodes that still exist
    const prevPos = new Map<string, { x: number; y: number; z: number }>();
    for (const n of this.nodes) {
      prevPos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 });
    }

    // Build new node/link arrays
    this.nodes = g.nodes.map((n) => {
      const p = prevPos.get(n.id);
      if (p) {
        return { ...n, x: p.x, y: p.y, z: p.z };
      }
      // Random initial position within a sphere
      const r = 80;
      return {
        ...n,
        x: (Math.random() - 0.5) * r,
        y: (Math.random() - 0.5) * r,
        z: (Math.random() - 0.5) * r,
      };
    });

    this.links = g.edges.map((e) => ({ source: e.from, target: e.to }));
    this.rebuildResolvedLinks(); // resolve endpoints once; endpoint objects mutate in place during ticks

    this.buildGeometry(); // initial geometry with starting positions
    this.fitCamera();

    // Run 3D force simulation (d3 stops itself at alphaMin)
    this.sim = forceSimulation<N3>(this.nodes, 3)
      .force("charge", forceManyBody<N3>().strength(this.cfg.repulsion))
      .force(
        "link",
        forceLink<N3, L3>(this.links)
          .id((d: N3) => d.id)
          .distance(this.cfg.linkDistance)
      )
      .force("center", forceCenter<N3>(0, 0, 0))
      // Strong pull toward origin so separate tag clusters condense together into one
      // dense ball rather than drifting apart. Higher = denser / clusters closer.
      .force("x", forceX<N3>(0).strength(this.cfg.centering))
      .force("y", forceY<N3>(0).strength(this.cfg.centering))
      .force("z", forceZ<N3>(0).strength(this.cfg.centering))
      .alphaMin(0.001)
      .on("tick", () => {
        if (this.viewMode === "2d") this.flattenZ(); // keep the layout planar while x/y re-spreads
        this.updateGeometryPositions();
        this.fitCamera(); // keep the whole cloud framed as it condenses — also re-fits on every mode switch
      })
      .on("end", () => this.fitCamera()); // final frame once it settles
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

    this.baseColors = colors.slice(); // remember for hover restore
    this.hoveredId = null;
    this.curI = new Float32Array(nodeCount).fill(1);
    this.tgtI = new Float32Array(nodeCount).fill(1);

    const pointsMat = new THREE.PointsMaterial({
      size: this.cfg.nodeSize,
      sizeAttenuation: true,
      vertexColors: true,
      map: this.circleTex ?? undefined,
      alphaTest: 0.5,
      transparent: true,
      depthWrite: false,
    });

    this.pointsMesh = new THREE.Points(pointsGeo, pointsMat);
    this.group.add(this.pointsMesh);

    // --- LineSegments (edges) — clean cohesive lavender, brighten on hover ---
    const lineCount = this.resolvedLinks.length;
    const linePos = new Float32Array(lineCount * 6); // 2 vertices * 3 components
    const lineColors = new Float32Array(lineCount * 6);
    this.baseEdgeColors = new Float32Array(lineCount * 6);
    const ec = new THREE.Color(EDGE_COLOR);
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

    const linesMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    this.linesMesh = new THREE.LineSegments(linesGeo, linesMat);
    this.group.add(this.linesMesh);
  }

  /** Resolve each link's endpoints to live node objects, dropping links with a missing end. Cached per graph. */
  private rebuildResolvedLinks() {
    const nodeById = new Map<string, N3>();
    for (const n of this.nodes) nodeById.set(n.id, n);
    this.resolvedLinks = [];
    for (const l of this.links) {
      const s = nodeById.get(endpointId(l.source as string | N3));
      const t = nodeById.get(endpointId(l.target as string | N3));
      if (s && t) this.resolvedLinks.push({ s, t });
    }
  }

  /** Write current endpoint positions (2 vertices * 3 components) into an edge position buffer. */
  private writeEdgePositions(buf: Float32Array) {
    for (let i = 0; i < this.resolvedLinks.length; i++) {
      const { s, t } = this.resolvedLinks[i];
      buf[i * 6] = s.x ?? 0;
      buf[i * 6 + 1] = s.y ?? 0;
      buf[i * 6 + 2] = s.z ?? 0;
      buf[i * 6 + 3] = t.x ?? 0;
      buf[i * 6 + 4] = t.y ?? 0;
      buf[i * 6 + 5] = t.z ?? 0;
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
  }

  /** Frame the camera to the node cloud's bounding sphere (centroid + max radius). */
  private fitCamera() {
    if (this.nodes.length === 0 || this.userControlled || this.tween) return;
    let cx = 0, cy = 0, cz = 0;
    for (const n of this.nodes) { cx += n.x ?? 0; cy += n.y ?? 0; cz += n.z ?? 0; }
    const k = this.nodes.length;
    cx /= k; cy /= k; cz /= k;
    // The centering forces keep the cloud bounded, so fit to the farthest node
    // (with margin) — every node is visible, comfortably framed.
    let r = 1;
    for (const n of this.nodes) {
      const dx = (n.x ?? 0) - cx, dy = (n.y ?? 0) - cy, dz = (n.z ?? 0) - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > r) r = d;
    }
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (r / Math.sin(fov / 2)) * 1.25;
    this.controls.target.set(cx, cy, cz);
    this.camera.position.set(cx, cy, cz + dist);
    this.camera.near = Math.max(0.1, dist / 1000);
    this.camera.far = dist * 12 + 100;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(0.5, dist * 0.02); // allow zooming in close
    this.controls.maxDistance = dist * 12;
    this.controls.update();
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
      this.renderer.domElement.removeEventListener("wheel", this.interactHandler);
      this.renderer.domElement.removeEventListener("pointerdown", this.interactHandler);
      this.interactHandler = undefined;
    }
    this.circleTex?.dispose();
    this.circleTex = null;

    this.disposeMeshes();

    // Dispose controls
    this.controls?.dispose();

    // Dispose renderer and remove canvas
    this.renderer?.dispose();
    this.renderer?.domElement.remove();

    // Disconnect resize observer
    this.ro?.disconnect();
  }
}
