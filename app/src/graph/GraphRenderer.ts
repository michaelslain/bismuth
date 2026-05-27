// app/src/graph/GraphRenderer.ts
import type { GraphData } from "../../../core/src/graph";
import type { HoverNode } from "./WebGLRenderer";

export interface GraphRenderer {
  mount(el: HTMLElement, onNodeClick: (id: string) => void, onHover?: (node: HoverNode | null) => void): void;
  render(g: GraphData): void;
  destroy(): void;
}
