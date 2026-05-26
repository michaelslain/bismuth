// app/src/graph/Canvas2DRenderer.ts
import { forceSimulation, forceManyBody, forceLink, forceCenter, type Simulation } from "d3-force";
import type { GraphData } from "../../../core/src/graph";
import type { GraphRenderer } from "./GraphRenderer";

type N = { id: string; label: string; kind: string; x?: number; y?: number; vx?: number; vy?: number };
const COLOR: Record<string, string> = { self: "#ebaa5a", note: "#6496ff", memory: "#50c878", agent: "#50c878" };

/** Stable signature for detecting graph topology changes. */
function graphSig(nodes: N[], links: { source: string; target: string }[]): string {
  const ns = [...nodes].map((n) => n.id).sort().join(",");
  const es = [...links].map((l) => `${l.source}>${l.target}`).sort().join(",");
  return `${ns}|${es}`;
}

export class Canvas2DRenderer implements GraphRenderer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private sim?: Simulation<N, undefined>;
  private nodes: N[] = [];
  private onClick: (id: string) => void = () => {};
  private lastSig = "";

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
    const links = g.edges.map((e) => ({ source: e.from, target: e.to }));
    const sig = graphSig(g.nodes.map((n) => ({ ...n })), links);

    // If topology hasn't changed, do nothing — avoids re-layout every poll cycle.
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    // Build a position map from the previous simulation so we can warm-start.
    const prevPos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    for (const n of this.nodes) {
      prevPos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, vx: n.vx ?? 0, vy: n.vy ?? 0 });
    }

    // Copy over existing positions for ids that survived the topology change.
    this.nodes = g.nodes.map((n) => {
      const prev = prevPos.get(n.id);
      return prev
        ? { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy }
        : { ...n };
    });

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
