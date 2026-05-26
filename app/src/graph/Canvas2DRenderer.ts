// app/src/graph/Canvas2DRenderer.ts
import { forceSimulation, forceManyBody, forceLink, forceCenter, type Simulation } from "d3-force";
import type { GraphData } from "../../../core/src/graph";
import type { GraphRenderer } from "./GraphRenderer";

type N = { id: string; label: string; kind: string; x?: number; y?: number; vx?: number; vy?: number };
const COLOR: Record<string, string> = { self: "#ebaa5a", note: "#6496ff", memory: "#50c878", agent: "#50c878" };

const PAD = 24;        // screen-px padding around the fitted graph
const MAX_SCALE = 1.5; // don't blow tiny graphs up absurdly
const NODE_R = 3.5;    // node radius in CSS px (constant regardless of zoom)

/** Stable signature for detecting graph topology changes. */
function graphSig(nodes: N[], links: { source: string; target: string }[]): string {
  const ns = [...nodes].map((n) => n.id).sort().join(",");
  const es = [...links].map((l) => `${l.source}>${l.target}`).sort().join(",");
  return `${ns}|${es}`;
}

export class Canvas2DRenderer implements GraphRenderer {
  private el!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private sim?: Simulation<N, undefined>;
  private nodes: N[] = [];
  private links: { source: any; target: any }[] = [];
  private onClick: (id: string) => void = () => {};
  private lastSig = "";
  private ro?: ResizeObserver;
  private w = 0;   // CSS px width
  private h = 0;   // CSS px height
  private dpr = 1;
  // current fit-to-bounds camera (in CSS px): screen = (world - min) * scale + offset
  private cam = { minX: 0, minY: 0, scale: 1, ox: 0, oy: 0 };

  mount(el: HTMLElement, onNodeClick: (id: string) => void) {
    this.el = el;
    this.onClick = onNodeClick;
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.resize();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);

    this.canvas.addEventListener("click", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top; // CSS px, matches our draw space
      const { minX, minY, scale, ox, oy } = this.cam;
      const hit = this.nodes.find((n) => {
        const sx = ((n.x ?? 0) - minX) * scale + ox;
        const sy = ((n.y ?? 0) - minY) * scale + oy;
        return Math.hypot(sx - mx, sy - my) < NODE_R + 4;
      });
      if (hit) this.onClick(hit.id);
    });
  }

  /** Size the backing store for the device pixel ratio so dots/lines render crisp on Retina. */
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
    if (sig === this.lastSig) return; // topology unchanged — don't re-layout each poll
    this.lastSig = sig;

    // Warm-start: carry over positions for ids that survived the topology change.
    const prevPos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    for (const n of this.nodes) {
      prevPos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, vx: n.vx ?? 0, vy: n.vy ?? 0 });
    }
    this.nodes = g.nodes.map((n) => {
      const prev = prevPos.get(n.id);
      return prev ? { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy } : { ...n };
    });

    this.sim?.stop();
    this.sim = forceSimulation(this.nodes)
      .force("charge", forceManyBody().strength(-80))
      .force("link", forceLink(this.links as any).id((d: any) => d.id).distance(40))
      .force("center", forceCenter(0, 0)) // camera handles framing, not the sim
      .on("tick", () => this.draw());
  }

  /** Recompute the fit-to-bounds camera from current node positions (CSS px). */
  private fit() {
    if (this.nodes.length === 0) { this.cam = { minX: 0, minY: 0, scale: 1, ox: this.w / 2, oy: this.h / 2 }; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      const x = n.x ?? 0, y = n.y ?? 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const scale = Math.min((this.w - 2 * PAD) / w, (this.h - 2 * PAD) / h, MAX_SCALE);
    this.cam = { minX, minY, scale, ox: (this.w - w * scale) / 2, oy: (this.h - h * scale) / 2 };
  }

  private draw() {
    const { ctx } = this;
    if (!ctx || this.w === 0) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); // draw in CSS px; backing store is dpr-scaled
    ctx.clearRect(0, 0, this.w, this.h);
    this.fit();
    const { minX, minY, scale, ox, oy } = this.cam;
    const sx = (x: number) => (x - minX) * scale + ox;
    const sy = (y: number) => (y - minY) * scale + oy;

    // edges — brighter so they read against the dark background
    ctx.strokeStyle = "rgba(150,165,210,0.40)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const l of this.links) {
      ctx.moveTo(sx(l.source.x), sy(l.source.y));
      ctx.lineTo(sx(l.target.x), sy(l.target.y));
    }
    ctx.stroke();

    // nodes
    for (const n of this.nodes) {
      ctx.fillStyle = COLOR[n.kind] ?? "#888";
      ctx.beginPath();
      ctx.arc(sx(n.x ?? 0), sy(n.y ?? 0), NODE_R, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  destroy() {
    this.sim?.stop();
    this.ro?.disconnect();
    this.canvas?.remove();
  }
}
