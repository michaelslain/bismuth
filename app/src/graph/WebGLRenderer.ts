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

const COLOR: Record<string, number> = {
  self: 0xebaa5a,
  note: 0x6496ff,
  memory: 0x50c878,
  agent: 0xe06c9f,
};
const DEFAULT_COLOR = 0x888888;
const EDGE_COLOR = 0x8aa5d2;

type N3 = SimNode & { id: string; label: string; kind: string };
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

    // Click handler for node picking
    this.clickHandler = (e: MouseEvent) => this.handleClick(e);
    this.renderer.domElement.addEventListener("click", this.clickHandler);

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
    // Auto-rotate the group (nodes+edges), not the camera, so OrbitControls still works
    this.group.rotation.y += 0.0015;
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
      .force("charge", forceManyBody<N3>().strength(-12))
      .force(
        "link",
        forceLink<N3, L3>(this.links)
          .id((d: N3) => d.id)
          .distance(6)
      )
      .force("center", forceCenter<N3>(0, 0, 0))
      // Gentle pull toward origin so weakly-connected nodes condense into a bounded
      // ball instead of flying off — keeps the whole graph compact and frameable.
      .force("x", forceX<N3>(0).strength(0.07))
      .force("y", forceY<N3>(0).strength(0.07))
      .force("z", forceZ<N3>(0).strength(0.07))
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

      const hex = COLOR[n.kind] ?? DEFAULT_COLOR;
      const c = new THREE.Color(hex);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const pointsMat = new THREE.PointsMaterial({
      size: 5,
      sizeAttenuation: true,
      vertexColors: true,
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

    const linesMat = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: 0.25,
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
