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
import type { GraphData } from "../../../core/src/graph";
import type { GraphRenderer } from "./GraphRenderer";

const EDGE_COLOR = 0x9aa6e6;
// Graph node palette (pink → purples → lavender → blue)
const PALETTE = [0xf277de, 0x9177f2, 0x8b88f2, 0xbdcaf2, 0x77a0f2];
const EDGE_BASE = 0.5; // normal edge brightness (0..1)
const NODE_DIM = 0.1;  // dimmed non-neighbor node brightness on hover
const EDGE_DIM = 0.05; // dimmed edge brightness on hover
const HL_SPEED = 0.16; // highlight ease per frame (smooth fade in/out)

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
  return h;
}
function paletteColor(key: string): THREE.Color {
  return new THREE.Color(PALETTE[hashInt(key) % PALETTE.length]);
}

function colorFor(n: N3): THREE.Color {
  switch (n.kind) {
    case "note": return paletteColor("folder:" + (n.folder ?? "(root)"));
    case "tag": return paletteColor("tag:" + n.label);
    case "memory": return paletteColor("mem:" + n.label);
    case "agent": return paletteColor("agent:" + n.label);
    case "self": return new THREE.Color(0xffffff); // the single "you" node — distinct white anchor
    default: return new THREE.Color(0xbdcaf2);
  }
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

type N3 = SimNode & { id: string; label: string; kind: string; folder?: string };
type L3 = SimLink<N3>;

function graphSig(nodes: { id: string }[], edgeCount: number): string {
  return nodes.map((n) => n.id).sort().join(",") + "|" + edgeCount;
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
  private onClick: (id: string) => void = () => {};
  private lastSig = "";

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
    // Idle "storm" spin — paused while the pointer is over the graph so hover/inspect stays stable
    if (!this.pointerInside) this.group.rotation.y += 0.0015;
    this.stepHighlight(); // ease hover highlight toward its target
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private handleClick(e: MouseEvent) {
    if (!this.pointsMesh || this.nodes.length === 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse2D.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.mouse2D, this.camera);
    this.raycaster.params.Points = { threshold: 3 };
    const intersects = this.raycaster.intersectObject(this.pointsMesh);
    if (intersects.length > 0) {
      const idx = intersects[0].index!;
      const node = this.nodes[idx];
      if (node) this.onClick(node.id);
    }
  }

  private handleMove(e: MouseEvent) {
    this.pointerInside = true; // pause idle spin while interacting
    if (!this.pointsMesh || this.nodes.length === 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse2D.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.mouse2D, this.camera);
    this.raycaster.params.Points = { threshold: 4 };
    const hits = this.raycaster.intersectObject(this.pointsMesh);
    const id = hits.length > 0 ? this.nodes[hits[0].index!]?.id ?? null : null;
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.renderer.domElement.style.cursor = id ? "pointer" : "default";
    this.setHighlightTargets();
  }

  private neighborsOf(id: string): Set<string> {
    const set = new Set<string>();
    for (const l of this.links) {
      const s = typeof l.source === "object" ? (l.source as N3).id : (l.source as string);
      const t = typeof l.target === "object" ? (l.target as N3).id : (l.target as string);
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
      return;
    }
    const nbrs = this.neighborsOf(id);
    for (let i = 0; i < this.nodes.length; i++) {
      this.tgtI[i] = this.nodes[i].id === id || nbrs.has(this.nodes[i].id) ? 1 : NODE_DIM;
    }
    const resolved = this.resolveLinks();
    for (let i = 0; i < resolved.length && i < this.tgtE.length; i++) {
      this.tgtE[i] = resolved[i].s.id === id || resolved[i].t.id === id ? 1 : EDGE_DIM;
    }
  }

  /** Ease current intensities toward targets each frame; rewrite color buffers only while moving. */
  private stepHighlight() {
    if (!this.pointsMesh || !this.linesMesh || this.curI.length === 0) return;

    const nodeAttr = this.pointsMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const nArr = nodeAttr.array as Float32Array;
    let movingN = false;
    for (let i = 0; i < this.curI.length; i++) {
      const d = this.tgtI[i] - this.curI[i];
      if (Math.abs(d) > 0.002) {
        this.curI[i] += d * HL_SPEED;
        const v = this.curI[i];
        nArr[i * 3] = this.baseColors[i * 3] * v;
        nArr[i * 3 + 1] = this.baseColors[i * 3 + 1] * v;
        nArr[i * 3 + 2] = this.baseColors[i * 3 + 2] * v;
        movingN = true;
      }
    }
    if (movingN) nodeAttr.needsUpdate = true;

    const edgeAttr = this.linesMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const eArr = edgeAttr.array as Float32Array;
    const ec = new THREE.Color(EDGE_COLOR);
    let movingE = false;
    for (let i = 0; i < this.curE.length; i++) {
      const d = this.tgtE[i] - this.curE[i];
      if (Math.abs(d) > 0.002) {
        this.curE[i] += d * HL_SPEED;
        const v = this.curE[i];
        eArr[i * 6] = ec.r * v; eArr[i * 6 + 1] = ec.g * v; eArr[i * 6 + 2] = ec.b * v;
        eArr[i * 6 + 3] = ec.r * v; eArr[i * 6 + 4] = ec.g * v; eArr[i * 6 + 5] = ec.b * v;
        movingE = true;
      }
    }
    if (movingE) edgeAttr.needsUpdate = true;
  }

  render(g: GraphData) {
    const sig = graphSig(g.nodes, g.edges.length);
    if (sig === this.lastSig) return;
    this.lastSig = sig;

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

    this.buildGeometry(); // initial geometry with starting positions
    this.fitCamera();

    // Run 3D force simulation (d3 stops itself at alphaMin)
    this.sim = forceSimulation<N3>(this.nodes, 3)
      .force("charge", forceManyBody<N3>().strength(-7))
      .force(
        "link",
        forceLink<N3, L3>(this.links)
          .id((d: N3) => d.id)
          .distance(5)
      )
      .force("center", forceCenter<N3>(0, 0, 0))
      // Strong pull toward origin so separate tag clusters condense together into one
      // dense ball rather than drifting apart. Higher = denser / clusters closer.
      .force("x", forceX<N3>(0).strength(0.13))
      .force("y", forceY<N3>(0).strength(0.13))
      .force("z", forceZ<N3>(0).strength(0.13))
      .alphaMin(0.001)
      .on("tick", () => {
        this.updateGeometryPositions();
        this.fitCamera(); // keep the whole cloud framed as it condenses — also re-fits on every mode switch
      })
      .on("end", () => this.fitCamera()); // final frame once it settles
  }

  private buildGeometry() {
    // Remove old meshes
    if (this.pointsMesh) {
      this.group.remove(this.pointsMesh);
      this.pointsMesh.geometry.dispose();
      (this.pointsMesh.material as THREE.Material).dispose();
      this.pointsMesh = null;
    }
    if (this.linesMesh) {
      this.group.remove(this.linesMesh);
      this.linesMesh.geometry.dispose();
      (this.linesMesh.material as THREE.Material).dispose();
      this.linesMesh = null;
    }

    const nodeCount = this.nodes.length;

    // --- Points (nodes) ---
    const positions = new Float32Array(nodeCount * 3);
    const colors = new Float32Array(nodeCount * 3);

    for (let i = 0; i < nodeCount; i++) {
      const n = this.nodes[i];
      positions[i * 3] = n.x ?? 0;
      positions[i * 3 + 1] = n.y ?? 0;
      positions[i * 3 + 2] = n.z ?? 0;

      const c = colorFor(n);
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
      size: 6,
      sizeAttenuation: true,
      vertexColors: true,
      map: this.circleTex ?? undefined,
      alphaTest: 0.5,
      transparent: true,
      depthWrite: false,
    });

    this.pointsMesh = new THREE.Points(pointsGeo, pointsMat);
    this.group.add(this.pointsMesh);

    // --- LineSegments (edges) ---
    // Resolve links to node references if they are strings
    const resolvedLinks = this.resolveLinks();
    const lineCount = resolvedLinks.length;
    const linePos = new Float32Array(lineCount * 6); // 2 vertices * 3 components

    for (let i = 0; i < lineCount; i++) {
      const { s, t } = resolvedLinks[i];
      linePos[i * 6] = s.x ?? 0;
      linePos[i * 6 + 1] = s.y ?? 0;
      linePos[i * 6 + 2] = s.z ?? 0;
      linePos[i * 6 + 3] = t.x ?? 0;
      linePos[i * 6 + 4] = t.y ?? 0;
      linePos[i * 6 + 5] = t.z ?? 0;
    }

    const linesGeo = new THREE.BufferGeometry();
    linesGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    // per-vertex edge colors (so hover can brighten connected edges / dim the rest)
    const lineColors = new Float32Array(lineCount * 6);
    const ec = new THREE.Color(EDGE_COLOR);
    for (let i = 0; i < lineCount * 2; i++) { lineColors[i * 3] = ec.r * EDGE_BASE; lineColors[i * 3 + 1] = ec.g * EDGE_BASE; lineColors[i * 3 + 2] = ec.b * EDGE_BASE; }
    linesGeo.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
    this.curE = new Float32Array(lineCount).fill(EDGE_BASE);
    this.tgtE = new Float32Array(lineCount).fill(EDGE_BASE);

    const linesMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
    });

    this.linesMesh = new THREE.LineSegments(linesGeo, linesMat);
    this.group.add(this.linesMesh);
  }

  private resolveLinks(): { s: N3; t: N3 }[] {
    const nodeById = new Map<string, N3>();
    for (const n of this.nodes) nodeById.set(n.id, n);
    const result: { s: N3; t: N3 }[] = [];
    for (const l of this.links) {
      const srcId = typeof l.source === "object" ? (l.source as N3).id : l.source as string;
      const tgtId = typeof l.target === "object" ? (l.target as N3).id : l.target as string;
      const s = nodeById.get(srcId);
      const t = nodeById.get(tgtId);
      if (s && t) result.push({ s, t });
    }
    return result;
  }

  private updateGeometryPositions() {
    if (!this.pointsMesh || !this.linesMesh) return;

    const nodeCount = this.nodes.length;
    const posAttr = this.pointsMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;

    for (let i = 0; i < nodeCount; i++) {
      const n = this.nodes[i];
      posArray[i * 3] = n.x ?? 0;
      posArray[i * 3 + 1] = n.y ?? 0;
      posArray[i * 3 + 2] = n.z ?? 0;
    }
    posAttr.needsUpdate = true;
    this.pointsMesh.geometry.computeBoundingSphere();

    // Update edge positions
    const resolvedLinks = this.resolveLinks();
    const lineCount = resolvedLinks.length;
    const linePosAttr = this.linesMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const linePosArray = linePosAttr.array as Float32Array;

    for (let i = 0; i < lineCount; i++) {
      const { s, t } = resolvedLinks[i];
      linePosArray[i * 6] = s.x ?? 0;
      linePosArray[i * 6 + 1] = s.y ?? 0;
      linePosArray[i * 6 + 2] = s.z ?? 0;
      linePosArray[i * 6 + 3] = t.x ?? 0;
      linePosArray[i * 6 + 4] = t.y ?? 0;
      linePosArray[i * 6 + 5] = t.z ?? 0;
    }
    linePosAttr.needsUpdate = true;
    this.linesMesh.geometry.computeBoundingSphere();
  }

  /** Frame the camera to the node cloud's bounding sphere (centroid + max radius). */
  private fitCamera() {
    if (this.nodes.length === 0) return;
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
    this.controls.minDistance = dist * 0.1;
    this.controls.maxDistance = dist * 4;
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
    this.circleTex?.dispose();
    this.circleTex = null;

    // Dispose meshes
    if (this.pointsMesh) {
      this.pointsMesh.geometry.dispose();
      (this.pointsMesh.material as THREE.Material).dispose();
      this.pointsMesh = null;
    }
    if (this.linesMesh) {
      this.linesMesh.geometry.dispose();
      (this.linesMesh.material as THREE.Material).dispose();
      this.linesMesh = null;
    }

    // Dispose controls
    this.controls?.dispose();

    // Dispose renderer and remove canvas
    this.renderer?.dispose();
    this.renderer?.domElement.remove();

    // Disconnect resize observer
    this.ro?.disconnect();
  }
}
