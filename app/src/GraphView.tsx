// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect, createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import { WebGLRenderer, type HoverNode } from "./graph/WebGLRenderer";
import { settings, setSettings, DEFAULT_ACCENT_PALETTE } from "./settings";
import { paletteToInts, hexToInt as hexToIntT } from "./themeColors";
import { resolveAppearance } from "./themes";
import { ClusterLegend, type ClusterRow } from "./ClusterLegend";
import { GraphSearch, type SearchItem } from "./GraphSearch";
import { AgentsGraph } from "./graph/AgentsGraph";
import { SegmentedToggle } from "./ui/SegmentedToggle";
import { TextButton } from "./ui/TextButton";
import { IconButton } from "./ui/IconButton";
import { ViewBar, Crumb, ViewBarSpacer } from "./ui/ViewBar";
import { IconTextButton } from "./ui/IconTextButton";

/** Shared pill recipe for the hover/fps HUD readouts (theme-aware for light/dark). */
const hudPill: JSX.CSSProperties = {
  background: "var(--pop-bg)",
  border: "1px solid var(--border-soft)",
  "font-family": "inherit",
  "border-radius": "5px",
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
  const [legendRows, setLegendRows] = createSignal<ClusterRow[]>([]);
  const [searchItems, setSearchItems] = createSignal<SearchItem[]>([]);

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

  // Push graph settings to the renderer whenever they change. Colors derive from the
  // centralized `appearance` theme tokens: nodes/clusters from the Oxide accentPalette
  // (by stable hash, inside the renderer), edges = Steel (neutral) at low alpha, the
  // canvas background = Ink (background). No separate graph palette/colors anymore.
  createEffect(() => {
    const gs = settings.graph;
    const ap = resolveAppearance(settings.appearance);
    const palette = ap.accentPalette?.length ? ap.accentPalette : DEFAULT_ACCENT_PALETTE;
    renderer.setConfig({
      spin: gs.spin,
      spinSpeed: gs.spinSpeed,
      palette: paletteToInts(palette),
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
      edgeColor: hexToIntT(ap.neutral, 0xaeb4c2),
      backgroundColor: hexToIntT(ap.background, 0x14151b),
    });
  });

  createEffect(() => {
    const a = props.active;
    // Node ids in vault.ts:32 are the file path WITHOUT the .md extension.
    renderer.setActiveFile(a ? a.replace(/\.md$/, "") : null);
  });

  onCleanup(() => renderer.destroy());

  const setViewMode = (m: "2d" | "3d") => setSettings("graph", "viewMode", m);
  const MODE_LABEL: Record<GraphMode, string> = { "2nd": "2nd brain", "3rd": "3rd brain", both: "both brains", agents: "agents" };
  const modeLabel = () => MODE_LABEL[props.mode] ?? props.mode;
  const nodeCount = () => props.graph?.nodes?.length ?? 0;
  const edgeCount = () => props.graph?.edges?.length ?? 0;

  return (
    <div class="graph-root" style={{ display: "flex", "flex-direction": "column", height: props.fill ? "100%" : undefined }}>
      <ViewBar class="graph-viewbar">
        <span class="graph-vb-wide"><Crumb icon="Share2">Knowledge Graph</Crumb></span>
        <SegmentedToggle
          value={props.mode}
          onChange={props.setMode}
          size="sm"
          options={[
            { id: "2nd", label: "2nd" },
            { id: "3rd", label: "3rd" },
            { id: "both", label: "Both" },
            { id: "agents", label: "Agents" },
          ]}
        />
        <ViewBarSpacer />
        <span class="graph-vb-wide graph-vb-right">
          <SegmentedToggle value={settings.graph.viewMode} onChange={setViewMode} size="sm" options={[{ id: "2d", label: "2D" }, { id: "3d", label: "3D" }]} />
          <Show when={props.fill}>
            <IconTextButton icon="Search" variant={menuOpen() ? "selected" : "normal"} onClick={() => (menuOpen() ? closeMenu() : setMenuOpen(true))}>FIND</IconTextButton>
          </Show>
        </span>
      </ViewBar>
      <div class="graph-area" style={{ position: "relative", width: "100%", ...(props.fill ? { flex: 1, "min-height": 0 } : { "aspect-ratio": "1" }) }}>
        <div ref={host} style={{ width: "100%", height: "100%" }} />
        {/* Iridescent cluster-glow + depth vignette over the canvas (design's BigGraph
            look). Screen-blended glow tints, gated per mode; pure CSS, no renderer cost. */}
        <Show when={props.mode !== "agents"}>
          <div class="graph-glow" data-mode={props.mode} />
          <div class="graph-vignette" />
        </Show>
        {/* Agents mode: the SVG governance-structure picker overlays the WebGL canvas. */}
        <Show when={props.mode === "agents"}>
          <AgentsGraph />
        </Show>
        {/* Floating cluster-legend card (non-agents) — hidden in the cramped sidebar via container query. */}
        <Show when={props.mode !== "agents"}>
          <div class="graph-legend-card graph-wide">
            <div class="graph-card-h">{modeLabel()} · clusters</div>
            <div class="graph-legend-rows">
              <ClusterLegend rows={legendRows()} onFocus={(ids) => { renderer.highlightNodes(ids); renderer.frameSubset(ids); }} />
            </div>
          </div>
        </Show>
        {/* Floating stats footer (non-agents). */}
        <Show when={props.mode !== "agents"}>
          <div class="graph-stats graph-wide">
            <span>{nodeCount()} nodes · {edgeCount()} edges · {modeLabel()}</span>
            <Show when={fps() !== null}><span style={{ color: "var(--green)" }}>{fps()} fps</span></Show>
          </div>
        </Show>
        <Show when={props.fill && menuOpen()}>
          <div class="graph-find-panel" style={{ position: "absolute", top: "8px", right: "8px", bottom: "8px", width: "244px", display: "flex", "flex-direction": "column", gap: "10px", "pointer-events": "auto", padding: "10px" }}>
            {/* Section 1 — view actions: a bordered Reset button + close. */}
            <div style={{ display: "flex", "align-items": "stretch", gap: "6px", "flex-shrink": 0 }}>
              <TextButton
                size="sm"
                style={{ flex: 1 }}
                title="Reset view to whole graph"
                onClick={() => renderer.resetView()}
              >
                RESET VIEW
              </TextButton>
              <IconButton
                icon="X"
                label="Close menu"
                size="sm"
                onClick={closeMenu}
              />
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
              <div class="graph-card-h" style={{ "flex-shrink": 0 }}>Clusters</div>
              <div style={{ flex: 1, "min-height": 0 }}>
                <ClusterLegend rows={legendRows()} onFocus={(ids) => { renderer.highlightNodes(ids); renderer.frameSubset(ids); }} />
              </div>
            </div>
          </div>
        </Show>
        <div style={{ position: "absolute", left: "6px", right: "6px", bottom: "6px", display: "flex", "align-items": "center", gap: "8px", "pointer-events": "none" }}>
          <div class="graph-bottom-narrow" style={{ gap: "2px", "align-items": "stretch", "background": "var(--pop-bg)", "border-radius": "4px", padding: "1px", "pointer-events": "auto", "flex-shrink": 0 }}>
            <SegmentedToggle
              value={settings.graph.viewMode}
              onChange={setViewMode}
              size="sm"
              options={[
                { id: "2d", label: "2D" },
                { id: "3d", label: "3D" },
              ]}
            />
            <Show when={props.fill}>
              <IconButton
                icon="Menu"
                label="Graph tools — search, clusters, reset"
                variant={menuOpen() ? "selected" : "unselected"}
                onClick={() => (menuOpen() ? closeMenu() : setMenuOpen(true))}
              />
            </Show>
          </div>
          <Show when={hovered()}>
            {(node) => (
              <span style={{ ...hudPill, "min-width": 0, "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis", color: "var(--fg)", "font-size": "11px", padding: "2px 8px" }}>
                {hoverLabel(node())}
              </span>
            )}
          </Show>
          <Show when={fps() !== null}>
            <span class="graph-bottom-fps" style={{ ...hudPill, "margin-left": "auto", "white-space": "nowrap", "font-variant-numeric": "tabular-nums", background: "var(--pop-bg)", color: "var(--text-muted)", "font-size": "10px", padding: "2px 7px" }}>
              {fps()} fps
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}
