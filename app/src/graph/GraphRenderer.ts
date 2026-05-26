// app/src/graph/GraphRenderer.ts
import type { GraphData } from "../../../core/src/graph";

export interface GraphRenderer {
  mount(el: HTMLElement, onNodeClick: (id: string) => void): void;
  render(g: GraphData): void;
  destroy(): void;
}
