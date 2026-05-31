// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect, createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import { WebGLRenderer, type HoverNode } from "./graph/WebGLRenderer";
import { settings, setSettings, PALETTES } from "./settings";
import { ClusterLegend, type ClusterRow } from "./ClusterLegend";
import { GraphSearch, type SearchItem } from "./GraphSearch";
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
  const [legendRows, setLegendRows] = createSignal<ClusterRow[]>([]);
  const [searchItems, setSearchItems] = createSignal<SearchItem[]>([]);
  // Shared base for the small graph-overlay buttons (Reset / Close in the tools panel).
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

  // Single tools panel (search + clusters + reset), opened by the ☰ button. Only shown when the
  // graph is a full pane (props.fill) — the sidebar mini-graph is too small to be worth it.
  const [menuOpen, setMenuOpen] = createSignal(false);
  const closeMenu = () => { setMenuOpen(false); renderer.setSearchMatches(new Set()); renderer.clearHighlight(); };

  // Rebuild legend rows + search items from the renderer's current node set. Called after each
  // render() so the cluster directory tracks the live graph.
  const refreshUiData = () => {
    const centroids = renderer.getCommunityCentroids();
    const rows: ClusterRow[] = [...centroids.entries()].map(([community, c]) => ({
      community, label: c.label, count: c.count, color: c.color, ids: c.ids,
    }));
    setLegendRows(rows);
    setSearchItems(
      renderer.getNodesForUI().map((n) => ({ id: n.id, label: n.label, sub: n.communityLabel ?? n.folder })),
    );
  };

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
    if (lastGraph) { renderer.render(lastGraph); refreshUiData(); }
  });

  createEffect(() => {
    const g = props.graph;
    lastGraph = g;
    if (mounted) { renderer.render(g); refreshUiData(); }
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
        <Show when={props.fill && menuOpen()}>
          <div style={{ position: "absolute", top: "8px", right: "8px", bottom: "8px", width: "244px", display: "flex", "flex-direction": "column", gap: "10px", "pointer-events": "auto" }}>
            {/* Section 1 — view actions: a clearly-bordered Reset button + close. */}
            <div style={{ display: "flex", "align-items": "stretch", gap: "6px", "flex-shrink": 0 }}>
              <button
                title="Reset view to whole graph"
                onClick={() => renderer.resetView()}
                style={{ ...baseButtonStyle, flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(232,232,235,0.9)", padding: "6px 8px" }}
              >
                Reset view
              </button>
              <button
                title="Close menu"
                onClick={closeMenu}
                style={{ ...baseButtonStyle, background: "rgba(20,20,24,0.6)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(220,220,225,0.8)", "font-size": "12px", padding: "6px 9px" }}
              >
                ✕
              </button>
            </div>
            {/* Section 2 — search. */}
            <GraphSearch
              items={searchItems()}
              onPreview={(id) => renderer.setSearchMatches(new Set([id]))}
              onFly={(id) => { renderer.setSearchMatches(new Set([id])); renderer.focusNode(id); }}
              onClose={closeMenu}
            />
            {/* Section 3 — clusters, captioned + scrollable. */}
            <div style={{ display: "flex", "flex-direction": "column", gap: "4px", flex: 1, "min-height": 0 }}>
              <div style={{ "font-size": "9px", "letter-spacing": "0.09em", "text-transform": "uppercase", color: "rgba(200,200,200,0.4)", padding: "0 3px", "flex-shrink": 0 }}>
                Clusters
              </div>
              <div style={{ flex: 1, "min-height": 0 }}>
                <ClusterLegend rows={legendRows()} onFocus={(ids) => { renderer.highlightNodes(ids); renderer.frameSubset(ids); }} />
              </div>
            </div>
          </div>
        </Show>
        <div style={{ position: "absolute", left: "6px", right: "6px", bottom: "6px", display: "flex", "align-items": "center", gap: "8px", "pointer-events": "none" }}>
          <div style={{ display: "flex", gap: "2px", "align-items": "stretch", "background": "rgba(20,20,24,0.55)", "border-radius": "4px", padding: "1px", "pointer-events": "auto", "flex-shrink": 0 }}>
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
            <Show when={props.fill}>
              <button
                style={{
                  background: menuOpen() ? "rgba(255,255,255,0.15)" : "transparent",
                  color: menuOpen() ? "#e8e8e8" : "rgba(200,200,200,0.55)",
                  border: "none",
                  cursor: "pointer",
                  "border-radius": "3px",
                  "font-size": "16px",
                  "line-height": 1,
                  padding: "2px 9px",
                }}
                title="Graph tools — search, clusters, reset"
                onClick={() => (menuOpen() ? closeMenu() : setMenuOpen(true))}
              >
                ☰
              </button>
            </Show>
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
