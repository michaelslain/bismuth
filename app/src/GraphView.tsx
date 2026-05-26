// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect, createSignal } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import type { GraphRenderer } from "./graph/GraphRenderer";
import { Canvas2DRenderer } from "./graph/Canvas2DRenderer";
import { WebGLRenderer } from "./graph/WebGLRenderer";

type GraphMode = "brain" | "agents" | "both";
type ViewMode = "2d" | "3d";

export function GraphView(props: {
  graph: GraphData;
  onOpen: (id: string) => void;
  mode: GraphMode;
  setMode: (m: GraphMode) => void;
}) {
  let host!: HTMLDivElement;

  const [view, setView] = createSignal<ViewMode>("2d");
  let renderer: GraphRenderer = new Canvas2DRenderer();
  let mounted = false;
  let lastGraph: GraphData | null = null;

  onMount(() => {
    renderer.mount(host, (id) => { if (id !== "self") props.onOpen(id); });
    mounted = true;
    if (lastGraph) renderer.render(lastGraph);
  });

  createEffect(() => {
    const g = props.graph;
    lastGraph = g;
    if (mounted) renderer.render(g);
  });

  // Switch renderer when view mode changes. createEffect tracks `view()` reactively.
  createEffect(() => {
    const v = view();
    if (!mounted) return; // not yet mounted — onMount handles initial setup
    // Destroy current renderer
    renderer.destroy();
    // Create new renderer
    renderer = v === "3d" ? new WebGLRenderer() : new Canvas2DRenderer();
    // Clear host (destroy() removes the canvas but just in case)
    while (host.firstChild) host.removeChild(host.firstChild);
    renderer.mount(host, (id) => { if (id !== "self") props.onOpen(id); });
    if (lastGraph) renderer.render(lastGraph);
  });

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

  const viewBtnStyle = (v: ViewMode) => ({
    background: view() === v ? "rgba(100,150,255,0.25)" : "transparent",
    border: view() === v ? "1px solid rgba(100,150,255,0.5)" : "1px solid transparent",
    color: view() === v ? "#8ab4f8" : "rgba(200,200,200,0.45)",
    cursor: "pointer",
    "font-size": "10px",
    "font-family": "inherit",
    padding: "2px 7px",
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
        <span style={{ flex: 1 }} />
        <button style={viewBtnStyle("2d")} onClick={() => setView("2d")}>2D</button>
        <button style={viewBtnStyle("3d")} onClick={() => setView("3d")}>3D</button>
      </div>
      <div ref={host} style={{ flex: "1", "min-height": "0" }} />
    </div>
  );
}
