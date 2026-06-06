// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect, createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import { WebGLRenderer, type HoverNode } from "./graph/WebGLRenderer";
import { AgentsGraph } from "./graph/AgentsGraph";
import { layoutAgentGraph } from "./graph/agentLayout";
import type { Org } from "./graph/agentOrg";
import { settings, DEFAULT_ACCENT_PALETTE } from "./settings";
import { paletteToInts, hexToInt as hexToIntT } from "./themeColors";
import { resolveAppearance } from "./themes";
import { ClusterLegend, type ClusterRow } from "./ClusterLegend";
import { GraphSearch, type SearchItem } from "./GraphSearch";
import { SegmentedToggle } from "./ui/SegmentedToggle";
import { IconButton } from "./ui/IconButton";
import { ViewBar, Crumb, ViewBarSpacer } from "./ui/ViewBar";
import { IconTextButton } from "./ui/IconTextButton";

/** Lerp two 0xRRGGBB colors per-channel (t=0 → a, t=1 → b). */
function mixHex(a: number, b: number, t: number): number {
  const ch = (shift: number) => {
    const av = (a >> shift) & 0xff;
    const bv = (b >> shift) & 0xff;
    return Math.round(av + (bv - av) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

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

// Graph dimension (2D birdseye vs 3D orbit) is a *transient* per-window UI choice,
// NOT a persisted setting. Toggling it must never write settings.yaml (doing so
// rewrote the file canonically, which reloaded an open settings buffer and scrolled
// it to the top). It's a module-level signal so every GraphView instance (the home
// tab + the sidebar mini-graph) shares one value, seeded from localStorage so the
// preference survives reload without touching the vault.
const VIEW_MODE_KEY = "oa:graph:viewMode";
const readStoredViewMode = (): "2d" | "3d" => {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return v === "2d" || v === "3d" ? v : "3d";
  } catch {
    return "3d";
  }
};
const [graphViewMode, setGraphViewMode] = createSignal<"2d" | "3d">(readStoredViewMode());
const setViewModePersisted = (m: "2d" | "3d") => {
  setGraphViewMode(m);
  try { localStorage.setItem(VIEW_MODE_KEY, m); } catch { /* private mode / quota — in-memory only */ }
};

type GraphMode = "2nd" | "3rd" | "both" | "agents";

export function GraphView(props: {
  graph: GraphData;
  onOpen: (id: string) => void;
  mode: GraphMode;
  setMode: (m: GraphMode) => void;
  active: string | null;
  // When true, fill the available height (main pane) instead of a 1:1 square (sidebar).
  fill?: boolean;
  // True when this is the cramped sidebar mini-graph. Suppresses the ☰ tools menu
  // (there's no room for the panel it opens); the full-pane graph keeps its Find tools.
  mini?: boolean;
  // When false, pause the renderer's rAF loop (it idles instead of rendering). Used to
  // stop the hidden sidebar mini-graph from burning frames when the main pane shows the
  // graph. Defaults to visible. Tab/window backgrounding also pauses it (visibilitychange).
  visible?: boolean;
}) {
  let host!: HTMLDivElement;
  let glowEl: HTMLDivElement | undefined; // the CSS atmosphere glow — slid/scaled to follow nodes
  let labelsEl: HTMLDivElement | undefined; // DOM overlay the renderer fills with native text labels
  const renderer = new WebGLRenderer();
  let mounted = false;
  let lastGraph: GraphData | null = null;
  const [hovered, setHovered] = createSignal<HoverNode | null>(null);
  const [fps, setFps] = createSignal<number | null>(null);
  const [legendRows, setLegendRows] = createSignal<ClusterRow[]>([]);
  const [searchItems, setSearchItems] = createSignal<SearchItem[]>([]);

  // Graph search panel, opened by the FIND / ☰ buttons. Only shown when the graph is a full
  // pane (props.fill) — the sidebar mini-graph is too small to be worth it. (Clusters have
  // their own floating legend card; there's no reset-view button.)
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

  // Open a node as a tab — shared by canvas clicks and search-result commits. Only vault
  // notes map to a real file; tags, the "you" hub, agents, and memory nodes (their `mem:`
  // ids aren't vault paths) can't be opened, so they just get framed by the caller.
  const openNode = (id: string) => {
    const node = lastGraph?.nodes.find((n) => n.id === id);
    if (node?.kind !== "note") return;
    props.onOpen(id);
  };

  onMount(() => {
    renderer.mount(
      host,
      openNode,
      (node) => setHovered(node),
      labelsEl, // DOM overlay for native text labels (replaces in-canvas sprite labels)
    );
    renderer.setFpsCallback(setFps);
    // Sit the 3 CSS atmosphere-glow lobes on the 3 biggest clusters each frame so the gradient
    // follows the nodes (it was a static background before). Each lobe center is a screen %.
    renderer.setGlowCallback((g) => {
      if (!glowEl) return;
      g.lobes.forEach((p, i) => {
        glowEl!.style.setProperty(`--glow-x${i + 1}`, `${p.x}%`);
        glowEl!.style.setProperty(`--glow-y${i + 1}`, `${p.y}%`);
      });
    });
    mounted = true;
    if (lastGraph) { renderer.render(rendererGraph()); refreshUiData(); }
  });

  // Agents mode renders through the SAME WebGL graph as the knowledge graph, for BOTH 2D
  // and 3D: layoutAgentGraph gives the nodes a pyramid position2d (used in 2D) and leaves
  // 3D to the force layout (the "molecule"), plus the org's communication channels. The
  // AgentsGraph overlay (cards + org picker) sits on top. Reacts to the org signal.
  const [agentOrg, setAgentOrg] = createSignal<Org>("republic");
  const rendererGraph = (): GraphData =>
    props.mode === "agents" ? layoutAgentGraph(props.graph, agentOrg()) : props.graph;

  createEffect(() => {
    lastGraph = props.graph;
    const g = rendererGraph();
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
      spin: props.mode === "agents" ? false : gs.spin, // agents = a tidy pyramid; no idle storm-spin

      spinSpeed: gs.spinSpeed,
      palette: paletteToInts(palette),
      repulsion: gs.repulsion,
      linkDistance: gs.linkDistance,
      centering: gs.centering,
      nodeSize: gs.nodeSize,
      viewMode: graphViewMode(),
      showGraphLabels: gs.showGraphLabels,
      graphLabelHubCount: gs.graphLabelHubCount,
      nodeSizeMinMult: gs.nodeSizeMinMult,
      nodeSizeDegreeGain: gs.nodeSizeDegreeGain,
      nodeSizeMaxMult: gs.nodeSizeMaxMult,
      // On light themes the neutral grey, alpha-blended over the pale canvas, reads as harsh dark
      // lines. Lift the edge color toward the background and drop its opacity so links stay faint.
      edgeColor: ap.isLight
        ? mixHex(hexToIntT(ap.neutral, 0xaeb4c2), hexToIntT(ap.background, 0xffffff), 0.45)
        : hexToIntT(ap.neutral, 0xaeb4c2),
      edgeOpacity: ap.isLight ? 0.2 : 0.32,
      backgroundColor: hexToIntT(ap.background, 0x14151b),
      // Hub-label pill: dark text on a translucent-white halo for light themes (so labels
      // don't render as dark boxes on the pale canvas); the dark-theme default otherwise.
      labelTextColor: ap.isLight ? ap.foreground : "rgba(232,232,238,0.95)",
      labelBgColor: ap.isLight ? "rgba(255,255,255,0.82)" : "rgba(14,14,17,0.6)",
      selfColor: hexToIntT(ap.foreground, 0xffffff),
    });
    // The cluster legend's swatch colors are derived from the renderer's palette (via
    // getCommunityCentroids → colorFor). This effect can run AFTER the initial render+refresh
    // (Solid runs effects in creation order, and this one trails the graph-render effect), so
    // the first legend would otherwise be built from the renderer's DEFAULT_PALETTE and stay
    // stuck there — visibly snapping to the theme colors only on the next graph re-render (a
    // view/mode switch). Refresh here too so the legend always tracks the live palette.
    if (mounted) refreshUiData();
  });

  createEffect(() => {
    const a = props.active;
    // Node ids in vault.ts:32 are the file path WITHOUT the .md extension.
    renderer.setActiveFile(a ? a.replace(/\.md$/, "") : null);
  });

  // Pause/resume the renderer's rAF loop. The mini-graph is paused whenever the prop
  // says it's hidden (main pane already shows the graph) OR the tab/window is backgrounded
  // (document.visibilityState === "hidden"). When the document is visible again we restore
  // based on the prop. `docHidden` is a signal so the prop effect and the listener compose.
  const [docHidden, setDocHidden] = createSignal(
    typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  createEffect(() => {
    renderer.setVisible(props.visible !== false && !docHidden());
  });
  const onVisibilityChange = () => setDocHidden(document.visibilityState === "hidden");
  onMount(() => document.addEventListener("visibilitychange", onVisibilityChange));
  onCleanup(() => document.removeEventListener("visibilitychange", onVisibilityChange));

  onCleanup(() => renderer.destroy());

  const setViewMode = (m: "2d" | "3d") => setViewModePersisted(m);
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
          <SegmentedToggle value={graphViewMode()} onChange={setViewMode} size="sm" options={[{ id: "2d", label: "2D" }, { id: "3d", label: "3D" }]} />
          <Show when={props.fill}>
            <IconTextButton icon="Search" size="sm" variant={menuOpen() ? "selected" : "unselected"} onClick={() => (menuOpen() ? closeMenu() : setMenuOpen(true))}>FIND</IconTextButton>
          </Show>
        </span>
      </ViewBar>
      <div class="graph-area" style={{ position: "relative", width: "100%", ...(props.fill ? { flex: 1, "min-height": 0 } : { "aspect-ratio": "1" }) }}>
        <div ref={host} style={{ width: "100%", height: "100%" }} />
        {/* Native-text label overlay: the renderer projects each visible node to screen px and
            places a crisp <div> here (replaces low-res in-canvas sprites). Layered above the glow. */}
        <div class="graph-labels" ref={labelsEl} />
        {/* Iridescent cluster-glow + depth vignette over the canvas (design's BigGraph
            look). Screen-blended glow tints; pure CSS, no renderer cost. Shown in every
            mode, agents included. */}
        <div class="graph-glow" data-mode={props.mode} ref={glowEl} />
        <div class="graph-vignette" />
        {/* Agents mode: the WebGL graph renders the nodes (2D pyramid / 3D molecule); this
            overlay adds the status card + organization picker on top. */}
        <Show when={props.mode === "agents"}>
          <AgentsGraph agents={props.graph} org={agentOrg()} setOrg={setAgentOrg} />
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
        {/* Find panel: search only. Clusters live in the floating legend card; there's no
            reset-view button here (Escape / toggling Find closes it). */}
        <Show when={props.fill && menuOpen()}>
          <div class="graph-find-panel" style={{ position: "absolute", top: "8px", right: "8px", width: "260px", "max-height": "calc(100% - 16px)", display: "flex", "flex-direction": "column", "pointer-events": "auto" }}>
            <GraphSearch
              items={searchItems()}
              onPreview={(id) => renderer.setSearchMatches(new Set([id]))}
              onFly={(id) => { renderer.setSearchMatches(new Set([id])); renderer.focusNode(id); openNode(id); }}
              onClose={closeMenu}
            />
          </div>
        </Show>
        <div style={{ position: "absolute", left: "6px", right: "6px", bottom: "6px", "z-index": 4, display: "flex", "align-items": "center", gap: "8px", "pointer-events": "none" }}>
          <div class="graph-bottom-narrow" style={{ gap: "2px", "align-items": "stretch", "background": "var(--pop-bg)", "border-radius": "4px", padding: "1px", "pointer-events": "auto", "flex-shrink": 0 }}>
            <SegmentedToggle
              value={graphViewMode()}
              onChange={setViewMode}
              size="sm"
              options={[
                { id: "2d", label: "2D" },
                { id: "3d", label: "3D" },
              ]}
            />
            <Show when={props.fill && !props.mini}>
              <IconButton
                icon="Search"
                label="Search graph"
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
