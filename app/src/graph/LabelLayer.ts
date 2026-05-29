// app/src/graph/LabelLayer.ts
// In-scene label sprites for the graph view. Owns one THREE.Sprite per node, lazily creates
// canvas textures (cached by label string), and exposes a per-frame updateVisibility() hook.
// All sprites use sizeAttenuation:false so they hold a constant on-screen size at any distance.
import * as THREE from "three";

const FONT_PX = 14;        // CSS px before DPR scaling — matches existing UI chrome
const PAD_X = 6;
const PAD_Y = 3;
const TEXT_COLOR = "#e8e8ee";
const BG_COLOR = "rgba(14,14,17,0.7)";
const BORDER_RADIUS = 6;
const RENDER_ORDER = 999;  // labels render after points/edges

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

/** Draw a pill-shaped label onto a canvas at DPR, return { texture, cssWidth, cssHeight }. */
function makeLabelTexture(text: string, fontFamily: string, dpr: number): { texture: THREE.CanvasTexture; cssW: number; cssH: number } {
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `${FONT_PX}px ${fontFamily}`;
  const textW = Math.ceil(measure.measureText(text).width);
  const cssW = textW + PAD_X * 2;
  const cssH = FONT_PX + PAD_Y * 2;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(cssW * dpr));
  cv.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = cv.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = BG_COLOR;
  roundRect(ctx, 0, 0, cssW, cssH, BORDER_RADIUS);
  ctx.fill();
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `${FONT_PX}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, PAD_X, cssH / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  tex.anisotropy = 1;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const made = makeLabelTexture(label, family, dpr);
    this.textureCache.set(label, made);
    return made;
  }

  private fontFamily(): string {
    if (typeof document === "undefined") return "ui-sans-serif, system-ui, sans-serif";
    const editorFont = getComputedStyle(document.documentElement).getPropertyValue("--editor-font").trim();
    return editorFont || "ui-sans-serif, system-ui, sans-serif";
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

    // Discovery-band candidates: 3D uses distance threshold; 2D uses zoom-gated viewport clip.
    const discovery = new Set<string>();
    if (args.viewMode === "3d") {
      const thresh = args.focalDistance * 0.5;
      for (const n of this.nodes) {
        const wx = m.elements[0] * (n.x ?? 0) + m.elements[4] * (n.y ?? 0) + m.elements[8] * (n.z ?? 0) + m.elements[12];
        const wy = m.elements[1] * (n.x ?? 0) + m.elements[5] * (n.y ?? 0) + m.elements[9] * (n.z ?? 0) + m.elements[13];
        const wz = m.elements[2] * (n.x ?? 0) + m.elements[6] * (n.y ?? 0) + m.elements[10] * (n.z ?? 0) + m.elements[14];
        const d = Math.hypot(wx - cam.x, wy - cam.y, wz - cam.z);
        if (d < thresh) discovery.add(n.id);
      }
    } else {
      // 2D: zoom-gated, viewport-clipped.
      const zoomedIn = args.wppDefault > 0 && args.worldPerPixel < args.wppDefault * 0.5;
      if (zoomedIn) {
        const proj = new THREE.Vector3();
        for (const n of this.nodes) {
          proj.set(n.x ?? 0, n.y ?? 0, n.z ?? 0).applyMatrix4(m).project(args.camera);
          // NDC inside viewport
          if (proj.x >= -1 && proj.x <= 1 && proj.y >= -1 && proj.y <= 1 && proj.z <= 1) {
            discovery.add(n.id);
          }
        }
      }
    }

    const candidates = new Set<string>(this.alwaysOn);
    for (const id of discovery) candidates.add(id);
    if (this.hoveredId) candidates.add(this.hoveredId);

    // For 3D opacity fade: distance-to-cloud-center → 0..1 fade band.
    // Front of cloud fully opaque; past (cloudCenter + cloudRadius) fades to 0.
    const fadeStart = args.cloudRadius * 0.3;
    const fadeEnd = args.cloudRadius * 1.0;
    const camToCenter = cam.distanceTo(args.cloudCenter);

    for (const [id, sprite] of this.sprites) {
      if (!candidates.has(id)) { sprite.visible = false; continue; }
      const n = nodeById.get(id);
      if (!n) { sprite.visible = false; continue; }
      v.set(n.x ?? 0, n.y ?? 0, n.z ?? 0).applyMatrix4(m);
      sprite.position.copy(v);
      const entry = this.textureCache.get(n.label);
      if (entry) {
        const sx = entry.cssW / args.screenH * 2;
        const sy = entry.cssH / args.screenH * 2;
        sprite.scale.set(sx, sy, 1);
      }
      // 3D opacity fade: closer-to-camera is brighter.
      if (args.viewMode === "3d" && fadeEnd > fadeStart) {
        const dFromCenter = v.distanceTo(args.cloudCenter);
        const depthFromCam = camToCenter + dFromCenter;
        const t = (depthFromCam - (camToCenter + fadeStart)) / (fadeEnd - fadeStart);
        sprite.material.opacity = Math.max(0.15, Math.min(1, 1 - t));
      } else {
        sprite.material.opacity = 1;
      }
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
