// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import { Canvas2DRenderer } from "./graph/Canvas2DRenderer";

type GraphMode = "brain" | "agents" | "both";

export function GraphView(props: {
  graph: GraphData;
  onOpen: (id: string) => void;
  mode: GraphMode;
  setMode: (m: GraphMode) => void;
}) {
  let host!: HTMLDivElement;
  const renderer = new Canvas2DRenderer();
  onMount(() => renderer.mount(host, (id) => { if (id !== "self") props.onOpen(id); }));
  createEffect(() => renderer.render(props.graph));
  onCleanup(() => renderer.destroy());

  const btnStyle = (m: GraphMode) => ({
    background: props.mode === m ? "rgba(255,255,255,0.15)" : "transparent",
    border: "none",
    color: props.mode === m ? "#e8e8e8" : "rgba(200,200,200,0.55)",
    cursor: "pointer",
    "font-size": "10px",
    "font-family": "inherit",
    padding: "2px 8px",
    "border-radius": "3px",
    "text-transform": "uppercase",
    "letter-spacing": "0.04em",
  } as const);

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      <div style={{ display: "flex", "align-items": "center", padding: "6px 8px 2px", gap: "2px" }}>
        <span style={{ "font-size": "11px", "text-transform": "uppercase", opacity: 0.6, "margin-right": "8px", "flex-shrink": 0 }}>
          Living graph
        </span>
        <button style={btnStyle("brain")} onClick={() => props.setMode("brain")}>Brain</button>
        <button style={btnStyle("agents")} onClick={() => props.setMode("agents")}>Agents</button>
        <button style={btnStyle("both")} onClick={() => props.setMode("both")}>Both</button>
      </div>
      <div ref={host} style={{ flex: "1", "min-height": "0" }} />
    </div>
  );
}
