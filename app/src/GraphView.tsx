// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import { WebGLRenderer } from "./graph/WebGLRenderer";
import { settings, setSettings, PALETTES } from "./settings";

type GraphMode = "2nd" | "3rd" | "both" | "agents";

export function GraphView(props: {
  graph: GraphData;
  onOpen: (id: string) => void;
  mode: GraphMode;
  setMode: (m: GraphMode) => void;
}) {
  let host!: HTMLDivElement;
  const renderer = new WebGLRenderer();
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

  // Push graph settings (spin/palette/physics/size) to the renderer whenever they change.
  createEffect(() => {
    const gs = settings.graph;
    renderer.setConfig({
      spin: gs.spin,
      spinSpeed: gs.spinSpeed,
      palette: PALETTES[gs.palette] ?? PALETTES.aurora,
      repulsion: gs.repulsion,
      linkDistance: gs.linkDistance,
      centering: gs.centering,
      nodeSize: gs.nodeSize,
      viewMode: gs.viewMode,
    });
  });

  onCleanup(() => renderer.destroy());

  const btnStyle = (active: boolean) => ({
    background: active ? "rgba(255,255,255,0.15)" : "transparent",
    border: "none",
    color: active ? "#e8e8e8" : "rgba(200,200,200,0.55)",
    cursor: "pointer",
    "font-size": "10px",
    "font-family": "inherit",
    padding: "2px 8px",
    "border-radius": "3px",
    "text-transform": "uppercase",
    "letter-spacing": "0.04em",
  } as const);

  const setViewMode = (m: "2d" | "3d") => setSettings("graph", "viewMode", m);

  return (
    <div style={{ display: "flex", "flex-direction": "column" }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "center", padding: "5px 6px", gap: "2px" }}>
        <button style={btnStyle(props.mode === "2nd")} onClick={() => props.setMode("2nd")}>2nd</button>
        <button style={btnStyle(props.mode === "3rd")} onClick={() => props.setMode("3rd")}>3rd</button>
        <button style={btnStyle(props.mode === "both")} onClick={() => props.setMode("both")}>Both</button>
        <button style={btnStyle(props.mode === "agents")} onClick={() => props.setMode("agents")}>Agents</button>
      </div>
      <div style={{ position: "relative", width: "100%", "aspect-ratio": "1" }}>
        <div ref={host} style={{ width: "100%", height: "100%" }} />
        <div style={{ position: "absolute", left: "6px", bottom: "6px", display: "flex", gap: "2px", "background": "rgba(20,20,24,0.55)", "border-radius": "4px", padding: "1px" }}>
          <button style={btnStyle(settings.graph.viewMode === "2d")} onClick={() => setViewMode("2d")}>2D</button>
          <button style={btnStyle(settings.graph.viewMode === "3d")} onClick={() => setViewMode("3d")}>3D</button>
        </div>
      </div>
    </div>
  );
}
