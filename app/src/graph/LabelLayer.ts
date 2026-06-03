// app/src/graph/LabelLayer.ts
// DOM-overlay labels for the graph view. Each visible label is a native <div> in the app's UI
// font (crisp, theme-matched via CSS vars) positioned absolutely over the WebGL canvas — NOT a
// Three.js sprite. This keeps full 3D (nodes/edges stay in WebGL) while the labels render with the
// browser's own font hinting/AA, so they look identical to the rest of the UI. The previous sprite
// approach drew 6px canvas textures that read as low-res and could bake a fallback font (load race).
//
// Pipeline (unchanged selection math):
//   - updateVisibility() runs on the renderer's throttle (~6/sec): it SELECTS which labels show
//     (top-N hubs + nearest-camera discovery + hover/active/search, greedy occlusion, depth + zoom
//     fade in 3D; a rendered-dot-size gate + grid declutter in 2D) and applies text/opacity to a
//     POOL of reused divs (only the accepted set is in the DOM-updated path — never one div/node).
//   - reposition() runs EVERY frame (cheap): it re-projects each visible label's node from 3D to
//     screen pixels and sets a translate transform, so labels track the idle spin / orbit smoothly.
//     (Sprites tracked the spin for free as children of the rotating group; DOM must re-project.)
import * as THREE from "three";
import { renderedPixelRadius, selectVisibleLabels, type LabelCandidate } from "./labelSelection";

// px gap below the node dot so the label hangs cleanly under it (matches the old sprite anchor).
const LABEL_OFFSET_BELOW = 14;
// Hide all labels once the user has zoomed FURTHER OUT than this fraction of the resting framing.
const ZOOMOUT_FADE_START = 1.4;
const ZOOMOUT_FADE_END = 2.0;
// Discovery: zoomed in below this fraction of the resting wpp, even MORE leaf labels appear.
const DISCOVERY_ZOOM_IN = 0.7;
// At rest, always include this many nearest-to-camera nodes so orbiting changes which labels show.
const NEAREST_AT_REST = 6;
// --- 2D label gate: a node's filename shows when its on-screen dot radius clears this many px.
const LABEL_2D_THRESHOLD_PX = 6;
// Screen-space declutter grid: at most one label per cell, highest-degree (largest rendered) wins.
const LABEL_2D_GRID_CELL = 64;
// Hysteresis: a label already shown clears at a lower threshold so it doesn't flicker at the edge.
const LABEL_2D_HYSTERESIS = 0.75;

export type LabelNode = {
  id: string;
  label: string;
  x?: number;
  y?: number;
  z?: number;
};

type LabelVisibilityArgs = {
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  viewMode: "2d" | "3d";
  screenW: number;
  screenH: number;
  focalDistance: number;                       // camera.position.distanceTo(controls.target)
  cloudCenter: THREE.Vector3;
  cloudRadius: number;
  worldPerPixel: number;
  wppDefault: number;
  // 2D rendered-size gate inputs (ignored by the 3D path):
  nodeSize: number;                            // cfg.nodeSize (base point size)
  fovDeg: number;                              // camera.fov
  scaleById: Map<string, number>;              // per-node degree size multiplier (baseScales)
  activeFileId: string | null;                 // open file → always labeled
  searchMatches?: Set<string>;                 // search hits → always labeled (escape hatch)
};

// Per-frame reprojection only needs the camera/group + screen size; selection state is reused.
type RepositionArgs = {
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  screenW: number;
  screenH: number;
};

export class LabelLayer {
  private overlay: HTMLElement | null = null;
  private ruler: HTMLDivElement | null = null;   // hidden element used to measure label box sizes
  private nodes: LabelNode[] = [];
  private nodeById = new Map<string, LabelNode>();
  private alwaysOn = new Set<string>();
  private hoveredId: string | null = null;
  private enabled = true;
  private shown2d = new Set<string>();           // last frame's accepted 2D set (reveal hysteresis)

  // Div pool. `elById` holds the div currently rendering each visible label; `free` is the reserve
  // of hidden divs available for reuse. `accepted` mirrors elById's ids (for reposition iteration).
  private elById = new Map<string, HTMLDivElement>();
  private free: HTMLDivElement[] = [];
  private accepted = new Set<string>();
  private sizeCache = new Map<string, { w: number; h: number }>();
  private scratch = new THREE.Vector3();

  /** Attach to the DOM overlay container (a div layered over the canvas). Called at mount(). */
  mount(overlay: HTMLElement): void {
    this.overlay = overlay;
    // A measuring ruler: same styling as a label, kept out of view, used to size label boxes for
    // the occlusion/declutter passes without disturbing layout.
    const ruler = document.createElement("div");
    ruler.className = "graph-label";
    ruler.style.position = "absolute";
    ruler.style.left = "-9999px";
    ruler.style.top = "0";
    ruler.style.visibility = "hidden";
    ruler.style.display = "block";
    overlay.appendChild(ruler);
    this.ruler = ruler;
  }

  setAlwaysOnSet(set: Set<string>): void {
    this.alwaysOn = set;
  }

  setHoveredId(id: string | null): void {
    this.hoveredId = id;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.hideAll();
  }

  /** Transiently hide every label (used during the 2D↔3D tween while positions are mid-morph). */
  hideAll(): void {
    for (const el of this.elById.values()) {
      el.style.display = "none";
      this.free.push(el);
    }
    this.elById.clear();
    this.accepted.clear();
    this.shown2d.clear();
  }

  /** Swap to a new graph: re-index nodes and release all current labels (size cache persists). */
  setGraph(nodes: LabelNode[]): void {
    this.nodes = nodes;
    this.nodeById = new Map();
    for (const n of nodes) this.nodeById.set(n.id, n);
    this.hideAll();
  }

  /** A free div (reused or freshly created) appended to the overlay. */
  private acquireEl(): HTMLDivElement {
    const reused = this.free.pop();
    if (reused) return reused;
    const el = document.createElement("div");
    el.className = "graph-label";
    el.style.display = "none";
    this.overlay!.appendChild(el);
    return el;
  }

  /** Measured {w,h} of a label's box (cached by text), for occlusion/declutter math. */
  private measure(label: string): { w: number; h: number } {
    const cached = this.sizeCache.get(label);
    if (cached) return cached;
    if (!this.ruler) return { w: label.length * 7 + 12, h: 18 }; // pre-mount estimate
    this.ruler.textContent = label;
    const size = { w: this.ruler.offsetWidth, h: this.ruler.offsetHeight };
    this.sizeCache.set(label, size);
    return size;
  }

  /** Assign pooled divs to the accepted ids, set text/opacity, release the rest. */
  private applyAccepted(sel: { id: string; opacity: number }[]): void {
    const acceptedIds = new Set(sel.map((s) => s.id));
    // Release divs whose id is no longer shown.
    for (const [id, el] of this.elById) {
      if (!acceptedIds.has(id)) {
        el.style.display = "none";
        this.free.push(el);
        this.elById.delete(id);
      }
    }
    this.accepted = acceptedIds;
    for (const { id, opacity } of sel) {
      const node = this.nodeById.get(id);
      if (!node) continue;
      let el = this.elById.get(id);
      if (!el) {
        el = this.acquireEl();
        el.textContent = node.label;
        el.dataset.label = node.label;
        this.elById.set(id, el);
      } else if (el.dataset.label !== node.label) {
        el.textContent = node.label;
        el.dataset.label = node.label;
      }
      el.style.display = "block";
      el.style.opacity = String(opacity);
    }
  }

  /** Assign label priority: lower number renders first and can occlude higher numbers. */
  private priorityOf(id: string, inAlwaysOn: boolean): number {
    if (id === this.hoveredId) return 0; // hovered node always shows
    if (inAlwaysOn) return 2;            // top hubs / active file
    return 4;                             // near-camera discovery nodes
  }

  /**
   * Decide which labels are visible this frame and their opacity. Called on the renderer's throttle
   * (NOT every frame). Position is applied by reposition() so labels track the spin between
   * selection passes. 2D uses the rendered-size gate; 3D shows always-on candidates + a near-band
   * discovery set with depth + zoom-out fade.
   */
  updateVisibility(args: LabelVisibilityArgs): void {
    if (!this.enabled || !this.overlay || this.nodes.length === 0) {
      this.hideAll();
      return;
    }
    const sel = args.viewMode === "2d" ? this.select2D(args) : this.select3D(args);
    this.applyAccepted(sel);
    this.reposition(args);
  }

  /**
   * 2D selection: gate on each node's rendered on-screen size (degree-scaled dot radius ÷
   * worldPerPixel), then a screen-space grid keeps the worthiest per cell. Hover / active-file /
   * search hits are forced through; an already-shown label clears at a lower threshold (hysteresis).
   */
  private select2D(args: LabelVisibilityArgs): { id: string; opacity: number }[] {
    args.group.updateMatrixWorld();
    const m = args.group.matrixWorld;
    const v = new THREE.Vector3();
    const proj = new THREE.Vector3();
    const forcedOf = (id: string) =>
      id === this.hoveredId || id === args.activeFileId || (args.searchMatches?.has(id) ?? false);

    const cands: LabelCandidate[] = [];
    for (const n of this.nodes) {
      v.set(n.x ?? 0, n.y ?? 0, n.z ?? 0).applyMatrix4(m);
      proj.copy(v).project(args.camera);
      if (proj.x < -1 || proj.x > 1 || proj.y < -1 || proj.y > 1 || proj.z > 1) continue;
      const px = (proj.x * 0.5 + 0.5) * args.screenW;
      const py = (-proj.y * 0.5 + 0.5) * args.screenH;
      const scale = args.scaleById.get(n.id) ?? 1;
      const renderedPx = renderedPixelRadius(args.nodeSize, scale, args.fovDeg, args.worldPerPixel);
      const forced = forcedOf(n.id);
      const eff = this.shown2d.has(n.id) ? LABEL_2D_THRESHOLD_PX * LABEL_2D_HYSTERESIS : LABEL_2D_THRESHOLD_PX;
      if (!forced && renderedPx < eff) continue;
      const size = this.measure(n.label);
      cands.push({ id: n.id, px, py, w: size.w, h: size.h, renderedPx, forced });
    }

    // Size gate already applied → thresholdPx 0 so selectVisibleLabels only runs grid declutter + cap.
    const accepted = selectVisibleLabels(cands, { thresholdPx: 0, gridCell: LABEL_2D_GRID_CELL, perCell: 1 });
    this.shown2d = accepted;
    return [...accepted].map((id) => ({ id, opacity: 1 }));
  }

  /** 3D selection: always-on hubs + nearest-camera discovery, greedy occlusion, depth/zoom fade. */
  private select3D(args: LabelVisibilityArgs): { id: string; opacity: number }[] {
    args.group.updateMatrixWorld();
    const m = args.group.matrixWorld;
    const v = new THREE.Vector3();
    const cam = args.camera.position;
    const zoomRatio = args.wppDefault > 0 ? args.worldPerPixel / args.wppDefault : 1;

    // Discovery candidates: score nodes by camera distance and take the N nearest.
    const discovery = new Set<string>();
    if (zoomRatio < ZOOMOUT_FADE_END) {
      const scored: { id: string; d: number }[] = [];
      for (const n of this.nodes) {
        const wx = m.elements[0] * (n.x ?? 0) + m.elements[4] * (n.y ?? 0) + m.elements[8] * (n.z ?? 0) + m.elements[12];
        const wy = m.elements[1] * (n.x ?? 0) + m.elements[5] * (n.y ?? 0) + m.elements[9] * (n.z ?? 0) + m.elements[13];
        const wz = m.elements[2] * (n.x ?? 0) + m.elements[6] * (n.y ?? 0) + m.elements[10] * (n.z ?? 0) + m.elements[14];
        const d = Math.hypot(wx - cam.x, wy - cam.y, wz - cam.z);
        scored.push({ id: n.id, d });
      }
      scored.sort((a, b) => a.d - b.d);
      const zoomBonus = zoomRatio < DISCOVERY_ZOOM_IN
        ? Math.round(((DISCOVERY_ZOOM_IN - zoomRatio) / DISCOVERY_ZOOM_IN) * this.nodes.length * 0.6)
        : 0;
      const take = Math.min(this.nodes.length, NEAREST_AT_REST + zoomBonus);
      for (let i = 0; i < take && i < scored.length; i++) discovery.add(scored[i].id);
    }

    const candidates = new Set<string>(this.alwaysOn);
    for (const id of discovery) candidates.add(id);
    if (this.hoveredId) candidates.add(this.hoveredId);
    if (args.searchMatches) for (const id of args.searchMatches) candidates.add(id);

    const camToCenter = cam.distanceTo(args.cloudCenter);

    // Zoom-out fade: as the user zooms past the resting framing, labels fade so the overview isn't
    // dominated by constant-size text.
    let zoomFade: number;
    if (zoomRatio <= ZOOMOUT_FADE_START) zoomFade = 1;
    else if (zoomRatio >= ZOOMOUT_FADE_END) zoomFade = 0;
    else zoomFade = 1 - (zoomRatio - ZOOMOUT_FADE_START) / (ZOOMOUT_FADE_END - ZOOMOUT_FADE_START);
    if (zoomFade <= 0.01) return []; // fully zoomed out → hide everything

    type Cand = { id: string; px: number; py: number; w: number; h: number; priority: number; opacity: number };
    const cands: Cand[] = [];
    const proj = new THREE.Vector3();
    for (const id of candidates) {
      const n = this.nodeById.get(id);
      if (!n) continue;
      v.set(n.x ?? 0, n.y ?? 0, n.z ?? 0).applyMatrix4(m);
      proj.copy(v).project(args.camera);
      if (proj.x < -1 || proj.x > 1 || proj.y < -1 || proj.y > 1 || proj.z > 1) continue;
      const px = (proj.x * 0.5 + 0.5) * args.screenW;
      const py = (-proj.y * 0.5 + 0.5) * args.screenH;
      const size = this.measure(n.label);
      // Depth fade for 3D, multiplied by the zoom-out fade.
      let opacity = 1;
      if (args.cloudRadius > 0) {
        const dFromCenter = v.distanceTo(args.cloudCenter);
        const depthFromCam = camToCenter + dFromCenter;
        const fadeStart = args.cloudRadius * 0.3;
        const fadeEnd = args.cloudRadius * 1.0;
        const t = (depthFromCam - (camToCenter + fadeStart)) / (fadeEnd - fadeStart);
        opacity = Math.max(0.15, Math.min(1, 1 - t));
      }
      opacity *= zoomFade;
      const inAlwaysOn = this.alwaysOn.has(id);
      const priority = args.searchMatches?.has(id) ? 1 : this.priorityOf(id, inAlwaysOn);
      cands.push({ id, px, py, w: size.w, h: size.h, priority, opacity });
    }

    // Greedy occlusion: sort by priority asc, accept if the label rect (centered on px, offset
    // below py) does not overlap an already-accepted rect.
    cands.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const acceptedRects: { px: number; py: number; w: number; h: number }[] = [];
    const out: { id: string; opacity: number }[] = [];
    for (const c of cands) {
      const x = c.px - c.w / 2;
      const y = c.py + LABEL_OFFSET_BELOW;
      let blocked = false;
      for (const r of acceptedRects) {
        if (x < r.px + r.w && x + c.w > r.px && y < r.py + r.h && y + c.h > r.py) { blocked = true; break; }
      }
      if (blocked) continue;
      acceptedRects.push({ px: x, py: y, w: c.w, h: c.h });
      out.push({ id: c.id, opacity: c.opacity });
    }
    return out;
  }

  /**
   * Re-project every visible label from its node's 3D position to screen pixels and place it.
   * Runs EVERY frame (cheap — only the accepted set) so labels stay glued to nodes during the idle
   * spin / orbit, even though the heavier selection in updateVisibility is throttled.
   */
  reposition(args: RepositionArgs): void {
    if (this.elById.size === 0) return;
    args.group.updateMatrixWorld();
    const m = args.group.matrixWorld;
    for (const [id, el] of this.elById) {
      const n = this.nodeById.get(id);
      if (!n) { el.style.visibility = "hidden"; continue; }
      this.scratch.set(n.x ?? 0, n.y ?? 0, n.z ?? 0).applyMatrix4(m).project(args.camera);
      if (this.scratch.x < -1 || this.scratch.x > 1 || this.scratch.y < -1 || this.scratch.y > 1 || this.scratch.z > 1) {
        el.style.visibility = "hidden";
        continue;
      }
      const px = (this.scratch.x * 0.5 + 0.5) * args.screenW;
      const py = (-this.scratch.y * 0.5 + 0.5) * args.screenH + LABEL_OFFSET_BELOW;
      el.style.visibility = "visible";
      // translate to the node, then center horizontally and hang below it.
      el.style.transform = `translate(${px}px, ${py}px) translate(-50%, 0)`;
    }
  }

  /** Free DOM resources. Called at WebGLRenderer.destroy(). */
  dispose(): void {
    if (this.overlay) this.overlay.replaceChildren();
    this.elById.clear();
    this.free = [];
    this.accepted.clear();
    this.sizeCache.clear();
    this.nodes = [];
    this.nodeById.clear();
    this.ruler = null;
    this.overlay = null;
  }
}
