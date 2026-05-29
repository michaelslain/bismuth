// app/src/graph/LabelLayer.ts
// In-scene label sprites for the graph view. Owns one THREE.Sprite per node, lazily creates
// canvas textures (cached by label string), and exposes a per-frame updateVisibility() hook.
// All sprites use sizeAttenuation:false so they hold a constant on-screen size at any distance.
import * as THREE from "three";

const FONT_PX = 13;        // CSS px before DPR scaling — tight, readable, doesn't dominate the dots
const FONT_WEIGHT = 500;   // medium weight reads as label, not heading
const PAD_X = 6;
const PAD_Y = 2;
const TEXT_COLOR = "rgba(232,232,238,0.95)";
const BG_COLOR = "rgba(14,14,17,0.6)";
const BORDER_RADIUS = 5;
// Labels always use a clean sans-serif regardless of the editor font (which can be a heavy serif
// like Lora). Forcing a UI-grade family keeps labels neutral and crisp at small sizes.
const LABEL_FONT_FAMILY = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const RENDER_ORDER = 999;  // labels render after points/edges
// Supersample the canvas texture: draw at 2x the device-pixel-ratio then sample down. Even at
// DPR 2 (Retina), this means ~4x linear oversampling, eliminating the shimmer/aliasing on text
// strokes when the sprite ends up around 16-24px tall on screen.
const TEXTURE_DPR_MULT = 2;
// Hide all labels once the user has zoomed FURTHER OUT than this fraction of the resting framing.
// At rest worldPerPixel ≈ wppDefault; zooming in shrinks wpp (the screen covers less world);
// zooming out grows it. Past 1.5x the resting wpp the graph is small enough that constant-size
// labels begin to dominate the dots — fade them out across a small band so it doesn't pop.
const ZOOMOUT_FADE_START = 1.4;
const ZOOMOUT_FADE_END = 2.0;
// Discovery threshold: zoomed in below this fraction of the resting wpp, non-hub labels begin
// to appear, ramping in proportionally. 0.7 = once you've zoomed in ~30% past the resting view.
const DISCOVERY_ZOOM_IN = 0.7;

export type LabelNode = {
  id: string;
  label: string;
  x?: number;
  y?: number;
  z?: number;
};

/** Round-rect path on a canvas 2D context. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Draw a pill-shaped label onto a canvas at supersampled DPR, return { texture, cssWidth, cssHeight }. */
function makeLabelTexture(text: string, fontFamily: string, dpr: number): { texture: THREE.CanvasTexture; cssW: number; cssH: number } {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `${FONT_WEIGHT} ${FONT_PX}px ${fontFamily}`;
  const textW = Math.ceil(measure.measureText(text).width);
  const cssW = textW + PAD_X * 2;
  const cssH = FONT_PX + PAD_Y * 2;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(cssW * dpr));
  cv.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = cv.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = BG_COLOR;
  roundRect(ctx, 0, 0, cssW, cssH, BORDER_RADIUS);
  ctx.fill();
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `${FONT_WEIGHT} ${FONT_PX}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, PAD_X, cssH / 2);
  const tex = new THREE.CanvasTexture(cv);
  // Skip mipmaps — labels are sampled at near-native size, mipmaps just add blur. Linear
  // mag+min on the supersampled canvas gives crisp text without shimmer.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return { texture: tex, cssW, cssH };
}

export class LabelLayer {
  private scene: THREE.Scene | null = null;
  private sprites = new Map<string, THREE.Sprite>();
  private textureCache = new Map<string, { texture: THREE.CanvasTexture; cssW: number; cssH: number }>();
  private nodes: LabelNode[] = [];
  private alwaysOn = new Set<string>();
  private hoveredId: string | null = null;
  private enabled = true;

  /** Attach to a scene. Called once at WebGLRenderer.mount(). */
  mount(scene: THREE.Scene): void {
    this.scene = scene;
  }

  setAlwaysOnSet(set: Set<string>): void {
    this.alwaysOn = set;
  }

  setHoveredId(id: string | null): void {
    this.hoveredId = id;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) for (const s of this.sprites.values()) s.visible = false;
  }

  /** Lookup or build the texture for a label string. */
  private textureFor(label: string): { texture: THREE.CanvasTexture; cssW: number; cssH: number } {
    const cached = this.textureCache.get(label);
    if (cached) return cached;
    const family = this.fontFamily();
    const dpr = Math.min((window.devicePixelRatio || 1) * TEXTURE_DPR_MULT, 4);
    const made = makeLabelTexture(label, family, dpr);
    this.textureCache.set(label, made);
    return made;
  }

  private fontFamily(): string {
    // Labels use a fixed sans-serif — the editor font (e.g., serif Lora) is for prose, not UI chips.
    return LABEL_FONT_FAMILY;
  }

  /** Build a sprite for one node and add it to the scene (hidden by default). */
  private createSprite(node: LabelNode): THREE.Sprite {
    const { texture } = this.textureFor(node.label);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = RENDER_ORDER;
    sprite.visible = false;
    // Anchor the sprite by its TOP-CENTER edge so labels hang BELOW the node instead of overlapping
    // it. (0.5,0.5) is the default center anchor; (0.5,1.0+margin) shifts the sprite down so the dot
    // sits cleanly above its label. The margin past 1.0 is the visual gap.
    sprite.center.set(0.5, 1.45);
    sprite.position.set(node.x ?? 0, node.y ?? 0, node.z ?? 0);
    return sprite;
  }

  /** Swap to a new graph: dispose sprites for removed nodes, create sprites for new ones. */
  setGraph(nodes: LabelNode[]): void {
    if (!this.scene) return;
    const newIds = new Set(nodes.map((n) => n.id));

    // Remove sprites for nodes no longer in the graph.
    for (const [id, sprite] of this.sprites) {
      if (!newIds.has(id)) {
        this.scene.remove(sprite);
        sprite.material.dispose();
        this.sprites.delete(id);
      }
    }

    // Add sprites for new nodes, or update label texture if label changed.
    for (const n of nodes) {
      const existing = this.sprites.get(n.id);
      if (!existing) {
        const sprite = this.createSprite(n);
        this.scene.add(sprite);
        this.sprites.set(n.id, sprite);
      } else {
        // If label text changed (rare), retarget the material to the new texture.
        const expected = this.textureFor(n.label).texture;
        if (existing.material.map !== expected) {
          existing.material.map = expected;
          existing.material.needsUpdate = true;
        }
      }
    }

    this.nodes = nodes;
  }

  /** Lower number = higher priority. */
  private priorityOf(id: string, inAlwaysOn: boolean, isDiscovery: boolean): number {
    if (id === this.hoveredId) return 0;
    if (inAlwaysOn) {
      // Self < active < hub among always-on. Order is approximate; the set semantics is what matters.
      // We pull this apart with hints from the LabelLayer's view of the alwaysOn set; for finer grain
      // we could split alwaysOn into separate sets, but for v1 they all share priority 1–3.
      return 2;
    }
    if (isDiscovery) return 4;
    return 9; // unreachable in practice — only candidates reach here
  }

  /**
   * Decide which sprites are visible this frame and position them. Called by WebGLRenderer.animate()
   * via the same throttle as crowding. Shows always-on candidates (hover, active, self, top-N hubs)
   * plus 3D near-band discovery nodes, with depth-fade opacity in 3D mode.
   */
  updateVisibility(args: {
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
  }): void {
    if (!this.enabled || this.sprites.size === 0) return;
    const nodeById = new Map<string, LabelNode>();
    for (const n of this.nodes) nodeById.set(n.id, n);

    args.group.updateMatrixWorld();
    const m = args.group.matrixWorld;
    const v = new THREE.Vector3();
    const cam = args.camera.position;

    // Discovery candidates: in BOTH 2D and 3D, gate on screen-space zoom — as the user zooms in
    // (wpp shrinks past wppDefault * DISCOVERY_ZOOM_IN), non-hub labels begin to appear; tighter
    // zoom reveals more. The discovery set is then viewport-clipped per-candidate during the
    // occlusion pass. This is the right mental model: zoom in to read more; zoom out to declutter.
    const discovery = new Set<string>();
    const zoomRatioCheck = args.wppDefault > 0 ? args.worldPerPixel / args.wppDefault : 1;
    if (zoomRatioCheck < DISCOVERY_ZOOM_IN) {
      // Fraction in [0..1]: 0 at the start of the band, 1 when fully zoomed in (or past).
      // Used to take the closest N nodes when very zoomed in, or fewer when just past the threshold.
      const closeness = Math.min(1, (DISCOVERY_ZOOM_IN - zoomRatioCheck) / DISCOVERY_ZOOM_IN);
      // Score each node by camera-distance; smaller = closer = more likely to be labeled.
      const scored: { id: string; d: number }[] = [];
      for (const n of this.nodes) {
        const wx = m.elements[0] * (n.x ?? 0) + m.elements[4] * (n.y ?? 0) + m.elements[8] * (n.z ?? 0) + m.elements[12];
        const wy = m.elements[1] * (n.x ?? 0) + m.elements[5] * (n.y ?? 0) + m.elements[9] * (n.z ?? 0) + m.elements[13];
        const wz = m.elements[2] * (n.x ?? 0) + m.elements[6] * (n.y ?? 0) + m.elements[10] * (n.z ?? 0) + m.elements[14];
        const d = Math.hypot(wx - cam.x, wy - cam.y, wz - cam.z);
        scored.push({ id: n.id, d });
      }
      scored.sort((a, b) => a.d - b.d);
      const take = Math.max(0, Math.round(closeness * this.nodes.length));
      for (let i = 0; i < take && i < scored.length; i++) discovery.add(scored[i].id);
    }

    const candidates = new Set<string>(this.alwaysOn);
    for (const id of discovery) candidates.add(id);
    if (this.hoveredId) candidates.add(this.hoveredId);

    // Project each candidate to pixel coords; drop those outside the viewport.
    const camToCenter = cam.distanceTo(args.cloudCenter);
    // Zoom-out fade: as the user zooms further out (wpp grows past resting), labels fade
    // out so the abstract overview isn't dominated by constant-size text.
    const zoomRatio = args.wppDefault > 0 ? args.worldPerPixel / args.wppDefault : 1;
    const zoomFade = zoomRatio <= ZOOMOUT_FADE_START
      ? 1
      : zoomRatio >= ZOOMOUT_FADE_END
        ? 0
        : 1 - (zoomRatio - ZOOMOUT_FADE_START) / (ZOOMOUT_FADE_END - ZOOMOUT_FADE_START);
    type Cand = { id: string; px: number; py: number; w: number; h: number; priority: number; opacity: number };
    const cands: Cand[] = [];
    // Fully zoomed out → hide everything cheaply.
    if (zoomFade <= 0.01) {
      for (const sprite of this.sprites.values()) sprite.visible = false;
      return;
    }
    const proj = new THREE.Vector3();
    for (const id of candidates) {
      const n = nodeById.get(id);
      if (!n) continue;
      const entry = this.textureCache.get(n.label);
      if (!entry) continue;
      v.set(n.x ?? 0, n.y ?? 0, n.z ?? 0).applyMatrix4(m);
      proj.copy(v).project(args.camera);
      if (proj.x < -1 || proj.x > 1 || proj.y < -1 || proj.y > 1 || proj.z > 1) continue;
      const px = (proj.x * 0.5 + 0.5) * args.screenW;
      const py = (-proj.y * 0.5 + 0.5) * args.screenH;
      const w = entry.cssW;
      const h = entry.cssH;
      // Compute opacity for 3D depth fade, multiplied by the zoom-out fade.
      let opacity = 1;
      if (args.viewMode === "3d" && args.cloudRadius > 0) {
        const dFromCenter = v.distanceTo(args.cloudCenter);
        const depthFromCam = camToCenter + dFromCenter;
        const fadeStart = args.cloudRadius * 0.3;
        const fadeEnd = args.cloudRadius * 1.0;
        const t = (depthFromCam - (camToCenter + fadeStart)) / (fadeEnd - fadeStart);
        opacity = Math.max(0.15, Math.min(1, 1 - t));
      }
      opacity *= zoomFade;
      const inAlwaysOn = this.alwaysOn.has(id);
      const isDiscovery = !inAlwaysOn && discovery.has(id);
      const priority = this.priorityOf(id, inAlwaysOn, isDiscovery);
      cands.push({ id, px, py, w, h, priority, opacity });
    }

    // Greedy occlusion: sort by priority asc, accept if rect (centered on px,py + label offset down)
    // does not overlap an already-accepted rect.
    cands.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const accepted: { px: number; py: number; w: number; h: number }[] = [];
    const LABEL_OFFSET_BELOW = 14;
    const accept = (c: Cand) => {
      const x = c.px - c.w / 2;
      const y = c.py + LABEL_OFFSET_BELOW;
      for (const r of accepted) {
        if (x < r.px + r.w && x + c.w > r.px && y < r.py + r.h && y + c.h > r.py) return false;
      }
      accepted.push({ px: x, py: y, w: c.w, h: c.h });
      return true;
    };

    const acceptedIds = new Set<string>();
    for (const c of cands) if (accept(c)) acceptedIds.add(c.id);

    // Apply visibility + per-sprite state.
    for (const [id, sprite] of this.sprites) {
      if (!acceptedIds.has(id)) { sprite.visible = false; continue; }
      const n = nodeById.get(id)!;
      v.set(n.x ?? 0, n.y ?? 0, n.z ?? 0).applyMatrix4(m);
      sprite.position.copy(v);
      const entry = this.textureCache.get(n.label)!;
      const sx = entry.cssW / args.screenH * 2;
      const sy = entry.cssH / args.screenH * 2;
      sprite.scale.set(sx, sy, 1);
      const opacity = cands.find((c) => c.id === id)?.opacity ?? 1;
      sprite.material.opacity = opacity;
      sprite.visible = true;
    }
  }

  /** Free GPU resources. Called at WebGLRenderer.destroy(). */
  dispose(): void {
    if (this.scene) {
      for (const sprite of this.sprites.values()) {
        this.scene.remove(sprite);
        sprite.material.dispose();
      }
    }
    this.sprites.clear();
    for (const entry of this.textureCache.values()) entry.texture.dispose();
    this.textureCache.clear();
    this.nodes = [];
    this.scene = null;
  }

  /** Test helper / introspection — number of currently-allocated sprites. */
  spriteCount(): number {
    return this.sprites.size;
  }

  /** Get sprite by id (used by visibility pass — see Task 6). */
  getSprite(id: string): THREE.Sprite | undefined {
    return this.sprites.get(id);
  }

  /** Iterate (id, sprite) pairs. */
  entries(): IterableIterator<[string, THREE.Sprite]> {
    return this.sprites.entries();
  }

  /** Current node list (kept in sync via setGraph). */
  getNodes(): LabelNode[] {
    return this.nodes;
  }
}
