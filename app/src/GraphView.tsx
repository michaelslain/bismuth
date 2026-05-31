// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect, createSignal, Show } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import { WebGLRenderer, type HoverNode } from "./graph/WebGLRenderer";
import { settings, setSettings, PALETTES } from "./settings";

/** Text shown in the bottom hover readout — note id is its vault-relative path (minus ".md"). */
function hoverLabel(node: HoverNode): string {
  return node.kind === "note" ? `${node.id}.md` : node.label;
}

/** Parse a "#rrggbb" hex color to the 0xRRGGBB int the renderer wants; fall back on garbage. */
function hexToInt(hex: string, fallback: number): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  return m ? parseInt(m[1], 16) : fallback;
}

type GraphMode = "2nd" | "3rd" | "both" | "agents";

export function GraphView(props: {
  graph: GraphData;
  onOpen: (id: string) => void;
  mode: GraphMode;
  setMode: (m: GraphMode) => void;
  active: string | null;
  // When true, fill the available height (main pane) instead of a 1:1 square (sidebar).
  fill?: boolean;
}) {
  let host!: HTMLDivElement;
  const renderer = new WebGLRenderer();
  let mounted = false;
  let lastGraph: GraphData | null = null;
  const [hovered, setHovered] = createSignal<HoverNode | null>(null);
  const [fps, setFps] = createSignal<number | null>(null);

  onMount(() => {
    renderer.mount(
      host,
      (id) => {
        const node = lastGraph?.nodes.find((n) => n.id === id);
        if (node?.kind === "tag") return;
        props.onOpen(id);
      },
      (node) => setHovered(node),
    );
    renderer.setFpsCallback(setFps);
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
      showGraphLabels: gs.showGraphLabels,
      graphLabelHubCount: gs.graphLabelHubCount,
      nodeSizeMinMult: gs.nodeSizeMinMult,
      nodeSizeDegreeGain: gs.nodeSizeDegreeGain,
      nodeSizeMaxMult: gs.nodeSizeMaxMult,
      edgeColor: hexToInt(gs.edgeColor, 0xbdcaf2),
      backgroundColor: hexToInt(gs.backgroundColor, 0x0e0e11),
    });
  });

  createEffect(() => {
    const a = props.active;
    // Node ids in vault.ts:32 are the file path WITHOUT the .md extension.
    renderer.setActiveFile(a ? a.replace(/\.md$/, "") : null);
  });

  onCleanup(() => renderer.destroy());

  const baseButtonStyle = {
    border: "none",
    cursor: "pointer",
    "font-size": "10px",
    "font-family": "inherit",
    padding: "2px 8px",
    "border-radius": "3px",
    "text-transform": "uppercase",
    "letter-spacing": "0.04em",
  } as const;

  const getBtnStyle = (active: boolean) => ({
    ...baseButtonStyle,
    background: active ? "rgba(255,255,255,0.15)" : "transparent",
    color: active ? "#e8e8e8" : "rgba(200,200,200,0.55)",
  } as const);

  const setViewMode = (m: "2d" | "3d") => setSettings("graph", "viewMode", m);

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: props.fill ? "100%" : undefined }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "center", padding: "5px 6px", gap: "2px" }}>
        <button style={getBtnStyle(props.mode === "2nd")} onClick={() => props.setMode("2nd")}>2nd</button>
        <button style={getBtnStyle(props.mode === "3rd")} onClick={() => props.setMode("3rd")}>3rd</button>
        <button style={getBtnStyle(props.mode === "both")} onClick={() => props.setMode("both")}>Both</button>
        <button style={getBtnStyle(props.mode === "agents")} onClick={() => props.setMode("agents")}>Agents</button>
      </div>
      <div style={{ position: "relative", width: "100%", ...(props.fill ? { flex: 1, "min-height": 0 } : { "aspect-ratio": "1" }) }}>
        <div ref={host} style={{ width: "100%", height: "100%" }} />
        <div style={{ position: "absolute", left: "6px", right: "6px", bottom: "6px", display: "flex", "align-items": "center", gap: "8px", "pointer-events": "none" }}>
          <div style={{ display: "flex", gap: "2px", "background": "rgba(20,20,24,0.55)", "border-radius": "4px", padding: "1px", "pointer-events": "auto", "flex-shrink": 0 }}>
            <button style={getBtnStyle(settings.graph.viewMode === "2d")} onClick={() => setViewMode("2d")}>2D</button>
            <button style={getBtnStyle(settings.graph.viewMode === "3d")} onClick={() => setViewMode("3d")}>3D</button>
          </div>
          <Show when={hovered()}>
            {(node) => (
              <span style={{ "min-width": 0, "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis", background: "rgba(20,20,24,0.65)", color: "rgba(232,232,232,0.92)", "font-size": "11px", "font-family": "inherit", padding: "2px 8px", "border-radius": "4px" }}>
                {hoverLabel(node())}
              </span>
            )}
          </Show>
          <Show when={fps() !== null}>
            <span style={{ "margin-left": "auto", "white-space": "nowrap", "font-variant-numeric": "tabular-nums", background: "rgba(20,20,24,0.55)", color: "rgba(200,200,200,0.7)", "font-size": "10px", "font-family": "inherit", padding: "2px 7px", "border-radius": "4px" }}>
              {fps()} fps
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}
