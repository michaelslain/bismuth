// app/src/graph/Canvas2DRenderer.ts
import { forceSimulation, forceManyBody, forceLink, forceCenter, type Simulation } from "d3-force";
import type { GraphData } from "../../../core/src/graph";
import type { GraphRenderer } from "./GraphRenderer";

type N = { id: string; label: string; kind: string; x?: number; y?: number; vx?: number; vy?: number };
type L = { source: any; target: any };
const COLOR: Record<string, string> = { self: "#ebaa5a", note: "#6496ff", memory: "#50c878", agent: "#50c878" };

const PAD = 24;
const MAX_FIT = 1.5;   // don't blow tiny graphs up absurdly when auto-fitting
const NODE_R = 3.5;    // node radius in CSS px

function graphSig(nodes: N[], links: { source: string; target: string }[]): string {
  return nodes.map((n) => n.id).sort().join(",") + "|" + links.map((l) => `${l.source}>${l.target}`).sort().join(",");
}

export class Canvas2DRenderer implements GraphRenderer {
  private el!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private sim?: Simulation<N, undefined>;
  private nodes: N[] = [];
  private links: L[] = [];
  private onClick: (id: string) => void = () => {};
  private lastSig = "";
  private ro?: ResizeObserver;
  private w = 0; private h = 0; private dpr = 1;

  // camera: screen = world * k + t  (CSS px)
  private cam = { k: 1, tx: 0, ty: 0 };
  private manual = false; // becomes true once the user zooms/pans; suspends auto-fit
  private hover: N | null = null;
  private focus: string | null = null;
  private neighbors = new Set<string>();
  private drag: { x: number; y: number } | null = null;

  mount(el: HTMLElement, onNodeClick: (id: string) => void) {
    this.el = el;
    this.onClick = onNodeClick;
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.cursor = "grab";
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.bindEvents();
  }

  private mouse(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private hit(mx: number, my: number): N | null {
    const { k, tx, ty } = this.cam;
    return this.nodes.find((n) => Math.hypot((n.x ?? 0) * k + tx - mx, (n.y ?? 0) * k + ty - my) < NODE_R + 4) ?? null;
  }

  private bindEvents() {
    const c = this.canvas;
    c.addEventListener("mousemove", (e) => {
      const { x, y } = this.mouse(e);
      if (this.drag) {
        this.manual = true;
        this.cam.tx += x - this.drag.x;
        this.cam.ty += y - this.drag.y;
        this.drag = { x, y };
        this.draw();
        return;
      }
      const h = this.hit(x, y);
      if (h !== this.hover) { this.hover = h; c.style.cursor = h ? "pointer" : "grab"; this.draw(); }
    });
    c.addEventListener("mousedown", (e) => { this.drag = this.mouse(e); c.style.cursor = "grabbing"; });
    window.addEventListener("mouseup", () => { if (this.drag) { this.drag = null; this.canvas.style.cursor = "grab"; } });
    c.addEventListener("mouseleave", () => { if (this.hover) { this.hover = null; this.draw(); } });
    c.addEventListener("click", (e) => {
      const { x, y } = this.mouse(e);
      const n = this.hit(x, y);
      if (n) { this.setFocus(n.id); this.onClick(n.id); }
      else { this.setFocus(null); }
    });
    c.addEventListener("dblclick", () => { this.manual = false; this.draw(); }); // reset to auto-fit
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.manual = true;
      const { x, y } = this.mouse(e);
      const { k, tx, ty } = this.cam;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const wx = (x - tx) / k, wy = (y - ty) / k;
      const nk = Math.max(0.05, Math.min(20, k * factor));
      this.cam = { k: nk, tx: x - wx * nk, ty: y - wy * nk };
      this.draw();
    }, { passive: false });
  }

  private setFocus(id: string | null) {
    this.focus = id;
    this.neighbors = new Set();
    if (id) {
      for (const l of this.links) {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        if (s === id) this.neighbors.add(t);
        if (t === id) this.neighbors.add(s);
      }
    }
    this.draw();
  }

  private resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.w = this.el.clientWidth || 320;
    this.h = this.el.clientHeight || 400;
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.draw();
  }

  render(g: GraphData) {
    this.links = g.edges.map((e) => ({ source: e.from, target: e.to }));
    const sig = graphSig(g.nodes.map((n) => ({ ...n })), this.links as any);
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    const prev = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    for (const n of this.nodes) prev.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, vx: n.vx ?? 0, vy: n.vy ?? 0 });
    this.nodes = g.nodes.map((n) => {
      const p = prev.get(n.id);
      return p ? { ...n, ...p } : { ...n };
    });

    this.sim?.stop();
    this.sim = forceSimulation(this.nodes)
      .force("charge", forceManyBody().strength(-80))
      .force("link", forceLink(this.links as any).id((d: any) => d.id).distance(40))
      .force("center", forceCenter(0, 0))
      .on("tick", () => this.draw());
  }

  /** Auto-fit camera to node bounds (only while the user hasn't taken manual control). */
  private fit() {
    if (this.manual || this.nodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      const x = n.x ?? 0, y = n.y ?? 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const bw = maxX - minX || 1, bh = maxY - minY || 1;
    const k = Math.min((this.w - 2 * PAD) / bw, (this.h - 2 * PAD) / bh, MAX_FIT);
    this.cam = { k, tx: (this.w - bw * k) / 2 - minX * k, ty: (this.h - bh * k) / 2 - minY * k };
  }

  private draw() {
    const { ctx } = this;
    if (!ctx || this.w === 0) return;
    this.fit();
    const { k, tx, ty } = this.cam;
    const SX = (x: number) => x * k + tx;
    const SY = (y: number) => y * k + ty;
    const dim = (id: string) => this.focus !== null && id !== this.focus && !this.neighbors.has(id);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    // edges
    for (const l of this.links) {
      const s = l.source, t = l.target;
      if (typeof s !== "object" || typeof t !== "object") continue;
      const touchesFocus = this.focus !== null && (s.id === this.focus || t.id === this.focus);
      ctx.strokeStyle = touchesFocus ? "rgba(120,170,255,0.8)"
        : this.focus !== null ? "rgba(150,165,210,0.08)"
          : "rgba(150,165,210,0.40)";
      ctx.lineWidth = touchesFocus ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(SX(s.x), SY(s.y));
      ctx.lineTo(SX(t.x), SY(t.y));
      ctx.stroke();
    }

    // nodes
    for (const n of this.nodes) {
      ctx.globalAlpha = dim(n.id) ? 0.18 : 1;
      ctx.fillStyle = COLOR[n.kind] ?? "#888";
      ctx.beginPath();
      ctx.arc(SX(n.x ?? 0), SY(n.y ?? 0), n.id === this.focus ? NODE_R + 2 : NODE_R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // hover label
    if (this.hover) {
      const x = SX(this.hover.x ?? 0), y = SY(this.hover.y ?? 0);
      const label = this.hover.label;
      ctx.font = "12px system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      let lx = x + 8, ly = y - 8;
      if (lx + tw + 8 > this.w) lx = x - tw - 12;
      if (ly < 12) ly = y + 16;
      ctx.fillStyle = "rgba(20,20,24,0.92)";
      ctx.fillRect(lx - 4, ly - 12, tw + 8, 18);
      ctx.fillStyle = "#e8e8e8";
      ctx.fillText(label, lx, ly + 2);
    }
  }

  destroy() { this.sim?.stop(); this.ro?.disconnect(); this.canvas?.remove(); }
}
