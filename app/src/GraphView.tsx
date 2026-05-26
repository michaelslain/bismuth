// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import { Canvas2DRenderer } from "./graph/Canvas2DRenderer";

export function GraphView(props: { graph: GraphData; onOpen: (id: string) => void }) {
  let host!: HTMLDivElement;
  const renderer = new Canvas2DRenderer();
  onMount(() => renderer.mount(host, (id) => { if (id !== "self") props.onOpen(id); }));
  createEffect(() => renderer.render(props.graph));
  onCleanup(() => renderer.destroy());
  return (
    <div>
      <div style={{ "font-size": "11px", "text-transform": "uppercase", opacity: 0.6, padding: "8px 8px 0" }}>Living graph</div>
      <div ref={host} />
    </div>
  );
}
