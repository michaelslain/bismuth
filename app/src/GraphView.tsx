// app/src/GraphView.tsx
import { onCleanup, onMount, createEffect, createSignal, Show } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import { CanvasGraphRenderer, type HoverNode } from "./graph/CanvasGraphRenderer";
import { GraphAtmosphere } from "./graph/GraphAtmosphere";
import { AgentsGraph } from "./graph/AgentsGraph";
import { layoutAgentGraph } from "./graph/agentLayout";
import type { Org } from "./graph/agentOrg";
import { settings, DEFAULT_ACCENT_PALETTE } from "./settings";
import { paletteToInts, hexToInt as hexToIntT } from "./themeColors";
import { resolveAppearance } from "./themes";
import { ClusterLegend, type ClusterRow } from "./ClusterLegend";
import { DaemonList } from "./DaemonList";
import { GraphSearch, type SearchItem } from "./GraphSearch";
import { SegmentedToggle } from "./ui/SegmentedToggle";
import { IconButton } from "./ui/IconButton";
import { ViewBar, Crumb, ViewBarSpacer } from "./ui/ViewBar";
import { IconTextButton } from "./ui/IconTextButton";
import { Icon } from "./icons/Icon";
import type { GraphMode } from "./commands";

/** Lerp two 0xRRGGBB colors per-channel (t=0 → a, t=1 → b). */
function mixHex(a: number, b: number, t: number): number {
  const ch = (shift: number) => {
    const av = (a >> shift) & 0xff;
    const bv = (b >> shift) & 0xff;
    return Math.round(av + (bv - av) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Text shown in the bottom hover readout — note id is its vault-relative path (minus ".md"). */
function hoverLabel(node: HoverNode): string {
  return node.kind === "note" ? `${node.id}.md` : node.label;
}

// FPS readout color is a fixed traffic-light scale (green/yellow/red), NOT derived
// from the theme's palette CSS vars — it should mean the same thing in every theme.
function fpsColor(fps: number): string {
  if (fps >= 50) return "#3fb950"; // green: smooth
  if (fps >= 30) return "#d29922"; // yellow: usable
  return "#f85149";                // red: janky
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

// One icon per control, SHARED by the two toolbars: the cramped sidebar mini-graph
// shows the icon alone, the full-pane graph pairs it with the same text label it has
// today (the `.graph-seg-label` span, hidden by container query when narrow). Same
// glyph in both so the little and big toolbars read as one control at two sizes.
const MODE_ICON: Record<GraphMode, string> = {
  "2nd": "Brain",         // your vault — the 2nd brain
  "3rd": "BrainCircuit",  // claude-bot memory — the 3rd brain
  both: "Blend",          // the two brains blended into one graph
  agents: "Network",      // terminal-tab sessions + their subagents
  daemon: "Bot",          // the background daemon's crons + processes
};
// Current segment text — unchanged; only paired with an icon now.
const MODE_SHORT: Record<GraphMode, string> = { "2nd": "2nd", "3rd": "3rd", both: "Both", agents: "Agents", daemon: "Daemon" };
// 2D birdseye (flat) vs 3D orbit (volumetric).
const DIM_ICON: Record<"2d" | "3d", string> = { "2d": "Square", "3d": "Box" };

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
  // Daemon mode: re-poll /daemon/graph after a supervision action (enable/disable/run)
  // so the services card reflects it immediately instead of waiting for the 4s poll.
  onDaemonChanged?: () => void;
}) {
  let host!: HTMLDivElement;
  let labelsEl: HTMLDivElement | undefined; // DOM overlay the renderer fills with native text labels
  const renderer = new CanvasGraphRenderer();
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

  // The daemon graph mode only exists while the daemon integration is enabled (the
  // settings master switch). If it's turned off while daemon mode is showing, fall back
  // to "both" so the mode toggle never points at a now-hidden option.
  createEffect(() => {
    if (props.mode === "daemon" && !settings.daemon.enabled) props.setMode("both");
  });

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
    // The atmosphere glow (lobes that ride the 3 biggest clusters) is wired by <GraphAtmosphere>.
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
      // DAEMON-mode color tokens (only cron/process nodes consume these):
      //   accent  = running node's own fill (highlighted) + the ::daemon hub anchor
      //   neutral = base daemon-node fill (disabled / enabled-idle), the muted grey
      //   fg      = the glow color for enabled + running nodes (theme foreground / --fg)
      daemonAccent: hexToIntT(ap.accent, 0x3f6bf0),
      daemonNeutral: hexToIntT(ap.neutral, 0xaeb4c2),
      daemonFg: hexToIntT(ap.foreground, 0xffffff),
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
  const MODE_LABEL: Record<GraphMode, string> = { "2nd": "2nd brain", "3rd": "3rd brain", both: "both brains", agents: "agents", daemon: "daemon" };
  const modeLabel = () => MODE_LABEL[props.mode] ?? props.mode;
  const nodeCount = () => props.graph?.nodes?.length ?? 0;
  const edgeCount = () => props.graph?.edges?.length ?? 0;

  return (
    <div class="graph-root" style={{ height: props.fill ? "100%" : undefined }}>
      <ViewBar class="graph-viewbar">
        <span class="graph-vb-wide"><Crumb icon="Share2">Knowledge Graph</Crumb></span>
        <SegmentedToggle
          value={props.mode}
          onChange={props.setMode}
          size="sm"
          options={(["2nd", "3rd", "both", "agents", ...(settings.daemon.enabled ? ["daemon"] : [])] as GraphMode[]).map((id) => ({
            id,
            title: MODE_LABEL[id],
            label: (
              <>
                <Icon value={MODE_ICON[id]} size={14} />
                <span class="graph-seg-label btn-label">{MODE_SHORT[id]}</span>
              </>
            ),
          }))}
        />
        <ViewBarSpacer />
        <span class="graph-vb-wide graph-vb-right">
          <SegmentedToggle
            value={graphViewMode()}
            onChange={setViewMode}
            size="sm"
            options={[
              { id: "2d", title: "2D", label: <><Icon value={DIM_ICON["2d"]} size={14} /><span class="btn-label">2D</span></> },
              { id: "3d", title: "3D", label: <><Icon value={DIM_ICON["3d"]} size={14} /><span class="btn-label">3D</span></> },
            ]}
          />
          <Show when={props.fill}>
            <IconTextButton icon="Search" size="sm" variant={menuOpen() ? "selected" : "unselected"} onClick={() => (menuOpen() ? closeMenu() : setMenuOpen(true))}>FIND</IconTextButton>
          </Show>
        </span>
      </ViewBar>
      <div class="graph-area" style={{ ...(props.fill ? { flex: 1, "min-height": 0 } : { "aspect-ratio": "1" }) }}>
        <div class="graph-canvas-host" ref={host} />
        {/* Native-text label overlay: the renderer projects each visible node to screen px and
            places a crisp <div> here (replaces low-res in-canvas sprites). Layered above the glow. */}
        <div class="graph-labels" ref={labelsEl} />
        {/* Iridescent cluster-glow + depth vignette over the canvas (design's BigGraph
            look). Screen-blended glow tints; pure CSS, no renderer cost. Shown in every
            mode, agents included. */}
        <GraphAtmosphere renderer={renderer} mode={props.mode} />
        {/* Agents mode: the WebGL graph renders the nodes (2D pyramid / 3D molecule); this
            overlay adds the status card + organization picker on top. */}
        <Show when={props.mode === "agents"}>
          <AgentsGraph agents={props.graph} org={agentOrg()} setOrg={setAgentOrg} />
        </Show>
        {/* Floating cluster-legend card (non-agents, non-daemon) — hidden in the cramped sidebar via container query. */}
        <Show when={props.mode !== "agents" && props.mode !== "daemon"}>
          <div class="graph-legend-card">
            <div class="graph-card-h">{modeLabel()} · clusters</div>
            <div class="graph-legend-rows">
              <ClusterLegend rows={legendRows()} onFocus={(ids) => { renderer.highlightNodes(ids); renderer.frameSubset(ids); }} />
            </div>
          </div>
        </Show>
        {/* Daemon-mode list: crons and processes with live status. */}
        <Show when={props.mode === "daemon"}>
          <div class="graph-legend-card daemon-legend">
            <div class="graph-card-h">daemon · services</div>
            <div class="graph-legend-rows">
              <DaemonList
                nodes={props.graph.nodes}
                onChanged={() => props.onDaemonChanged?.()}
                onFocus={(ids) => { renderer.highlightNodes(ids); renderer.frameSubset(ids); }}
              />
            </div>
          </div>
        </Show>
        {/* Floating stats footer (non-agents). */}
        <Show when={props.mode !== "agents"}>
          <div class="graph-stats">
            <span>{nodeCount()} nodes · {edgeCount()} edges · {modeLabel()}</span>
            <Show when={settings.graph.showFps && fps() !== null}><span style={{ color: fpsColor(fps()!) }}>{fps()} fps</span></Show>
          </div>
        </Show>
        {/* Find panel: search only. Clusters live in the floating legend card; there's no
            reset-view button here (Escape / toggling Find closes it). */}
        <Show when={props.fill && menuOpen()}>
          <div class="graph-find-panel">
            <GraphSearch
              items={searchItems()}
              onPreview={(id) => renderer.setSearchMatches(new Set([id]))}
              onFly={(id) => { renderer.setSearchMatches(new Set([id])); renderer.focusNode(id); openNode(id); }}
              onClose={closeMenu}
            />
          </div>
        </Show>
        <div class="graph-bottom-bar">
          <div class="graph-bottom-narrow">
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
              <span class="graph-hud-pill" style={{ "min-width": 0, "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis", color: "var(--fg)", "font-size": "11px", padding: "2px 8px" }}>
                {hoverLabel(node())}
              </span>
            )}
          </Show>
          <Show when={settings.graph.showFps && fps() !== null}>
            <span class="graph-hud-pill graph-bottom-fps" style={{ color: fpsColor(fps()!) }}>
              {fps()} fps
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}
