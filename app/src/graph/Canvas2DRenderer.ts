// app/src/graph/Canvas2DRenderer.ts
import { forceSimulation, forceManyBody, forceLink, forceCenter, type Simulation } from "d3-force";
import type { GraphData } from "../../../core/src/graph";
import type { GraphRenderer } from "./GraphRenderer";

type N = { id: string; label: string; kind: string; x?: number; y?: number };
const COLOR: Record<string, string> = { self: "#ebaa5a", note: "#6496ff", memory: "#50c878", agent: "#50c878" };

export class Canvas2DRenderer implements GraphRenderer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private sim?: Simulation<N, undefined>;
  private nodes: N[] = [];
  private onClick: (id: string) => void = () => {};

  mount(el: HTMLElement, onNodeClick: (id: string) => void) {
    this.onClick = onNodeClick;
    this.canvas = document.createElement("canvas");
    this.canvas.width = el.clientWidth || 320;
    this.canvas.height = 240;
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.canvas.addEventListener("click", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const hit = this.nodes.find((n) => Math.hypot((n.x ?? 0) - mx, (n.y ?? 0) - my) < 8);
      if (hit) this.onClick(hit.id);
    });
  }

  render(g: GraphData) {
    this.nodes = g.nodes.map((n) => ({ ...n }));
    const links = g.edges.map((e) => ({ source: e.from, target: e.to }));
    this.sim?.stop();
    this.sim = forceSimulation(this.nodes)
      .force("charge", forceManyBody().strength(-80))
      .force("link", forceLink(links as any).id((d: any) => d.id).distance(40))
      .force("center", forceCenter(this.canvas.width / 2, this.canvas.height / 2))
      .on("tick", () => this.draw(links));
  }

  private draw(links: { source: any; target: any }[]) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#3a3a3a";
    for (const l of links) {
      ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); ctx.stroke();
    }
    for (const n of this.nodes) {
      ctx.fillStyle = COLOR[n.kind] ?? "#888";
      ctx.beginPath(); ctx.arc(n.x ?? 0, n.y ?? 0, 5, 0, Math.PI * 2); ctx.fill();
    }
  }

  destroy() { this.sim?.stop(); this.canvas?.remove(); }
}
