// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect, createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import { WebGLRenderer, type HoverNode } from "./graph/WebGLRenderer";
import { settings, setSettings, PALETTES } from "./settings";
import { SegmentedToggle } from "./ui/SegmentedToggle";

/** Shared dark-pill recipe for the hover/fps HUD readouts (S26). */
const hudPill: JSX.CSSProperties = {
  background: "rgba(20,20,24,0.65)",
  "font-family": "inherit",
  "border-radius": "4px",
};

/** Text shown in the bottom hover readout — note id is its vault-relative path (minus ".md"). */
function hoverLabel(node: HoverNode): string {
  return node.kind === "note" ? `${node.id}.md` : node.label;
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
    });
  });

  createEffect(() => {
    const a = props.active;
    // Node ids in vault.ts:32 are the file path WITHOUT the .md extension.
    renderer.setActiveFile(a ? a.replace(/\.md$/, "") : null);
  });

  onCleanup(() => renderer.destroy());

  const setViewMode = (m: "2d" | "3d") => setSettings("graph", "viewMode", m);

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: props.fill ? "100%" : undefined }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "center", padding: "5px 6px" }}>
        <SegmentedToggle
          value={props.mode}
          onChange={props.setMode}
          variant="ghost"
          size="sm"
          segmentClass="graph-seg"
          options={[
            { id: "2nd", label: "2nd" },
            { id: "3rd", label: "3rd" },
            { id: "both", label: "Both" },
            { id: "agents", label: "Agents" },
          ]}
        />
      </div>
      <div style={{ position: "relative", width: "100%", ...(props.fill ? { flex: 1, "min-height": 0 } : { "aspect-ratio": "1" }) }}>
        <div ref={host} style={{ width: "100%", height: "100%" }} />
        <div style={{ position: "absolute", left: "6px", right: "6px", bottom: "6px", display: "flex", "align-items": "center", gap: "8px", "pointer-events": "none" }}>
          <div style={{ "background": "rgba(20,20,24,0.55)", "border-radius": "4px", padding: "1px", "pointer-events": "auto", "flex-shrink": 0 }}>
            <SegmentedToggle
              value={settings.graph.viewMode}
              onChange={setViewMode}
              variant="ghost"
              size="sm"
              segmentClass="graph-seg"
              options={[
                { id: "2d", label: "2D" },
                { id: "3d", label: "3D" },
              ]}
            />
          </div>
          <Show when={hovered()}>
            {(node) => (
              <span style={{ ...hudPill, "min-width": 0, "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis", color: "rgba(232,232,232,0.92)", "font-size": "11px", padding: "2px 8px" }}>
                {hoverLabel(node())}
              </span>
            )}
          </Show>
          <Show when={fps() !== null}>
            <span style={{ ...hudPill, "margin-left": "auto", "white-space": "nowrap", "font-variant-numeric": "tabular-nums", background: "rgba(20,20,24,0.55)", color: "rgba(200,200,200,0.7)", "font-size": "10px", padding: "2px 7px" }}>
              {fps()} fps
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}
