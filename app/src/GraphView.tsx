// app/src/GraphView.tsx
import { For, onCleanup, onMount, createEffect, createMemo, createSignal, Show } from "solid-js";
import type { GraphData } from "../../core/src/graph";
import type { GraphConfig, GraphRenderer, HoverNode } from "./graph/graphRenderer";
import { AsciiGraphRenderer } from "./graph/AsciiGraphRenderer";
import { GraphAtmosphere, type BloomSink } from "./graph/GraphAtmosphere";
import { computeLayout } from "../../core/src/layout";
import { localLayoutInput } from "./graph/localLayoutInput";
import { settings, DEFAULT_ACCENT_PALETTE } from "./settings";
import { paletteToInts, hexToInt as hexToIntT } from "./themeColors";
import { resolveAppearance } from "./themes";
import { readCache, writeCache } from "./viewCache";
import { DaemonList } from "./DaemonList";
import { GraphSearch, type SearchItem } from "./GraphSearch";
import { SegmentedToggle } from "./ui/SegmentedToggle";
import { IconButton } from "./ui/IconButton";
import { TextButton } from "./ui/TextButton";
import { ViewBar, Crumb, ViewBarSpacer } from "./ui/ViewBar";
import { IconTextButton } from "./ui/IconTextButton";
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
const VIEW_MODE_KEY = "bismuth:graph:viewMode";
const readStoredViewMode = (): "2d" | "3d" => {
  const v = readCache<"2d" | "3d">(VIEW_MODE_KEY);
  // Default is 2D — the LOD redesign (aggregate cluster entities, cursor-anchored zoom) ships for
  // the 2D field; 3D keeps its non-LOD orbit behaviour and stays one toggle away.
  return v === "2d" || v === "3d" ? v : "2d";
};
const [graphViewMode, setGraphViewMode] = createSignal<"2d" | "3d">(readStoredViewMode());
const setViewModePersisted = (m: "2d" | "3d") => {
  setGraphViewMode(m);
  writeCache(VIEW_MODE_KEY, m);
};

// Mode-switcher text, SHARED by the two toolbars (the cramped sidebar mini-graph and the
// full-pane graph): text-only, uppercase, no glyph prefix — same string in both so the little
// and big toolbars read as one control at two sizes (the narrow one just wraps to a second row
// if all five segments don't fit one line; see the @container rule in App.css).
/** Refine ticks for the client-side LOCAL layout. A neighbourhood is tens of nodes, not thousands, so
 *  this settles in a few ms on the main thread — the backend budget (400) exists for 2000+ nodes and
 *  would be wasted here. */
const LOCAL_REFINE_TICKS = 120;

const MODE_SHORT: Record<GraphMode, string> = { "2nd": "2ND", "3rd": "3RD", both: "BOTH", daemon: "DAEMON", local: "LOCAL" };
/**
 * The same switcher as ICONS, for the sidebar mini-graph only.
 *
 * This REVERSES an earlier decision, deliberately and at the user's request: the mode switcher was
 * specified as text-only ("2ND/3RD/BOTH/DAEMON, no glyph prefixes, ever" — see the container
 * query in App.css). That still holds for the FULL-PANE graph, where there is room for words and the
 * words are unambiguous. In the sidebar the same text segments wrap onto two rows and eat the
 * little field's height, which is the problem icons solve. Text stays the rule where it fits.
 *
 * Each icon names the mode's SUBJECT rather than an abstract symbol: the vault of notes, the memory
 * brain, the two combined, the background worker.
 */
const MODE_ICON: Record<GraphMode, string> = {
  "2nd": "Notebook",   // the vault: markdown notes
  "3rd": "Brain",      // the daemon's memory graph
  both: "Combine",     // both brains + their cross-edges
  daemon: "Zap",       // the running supervisor (crons/processes)
  local: "Share",      // the open note's neighbourhood
};

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
  // Cmd+O switcher: the graph node ids (note paths WITHOUT ".md") for EVERY current search
  // result, or null/empty. All are highlighted in the backdrop graph so the search and the
  // graph read as one surface — the graph lights up the set of matching notes, not just one.
  // Undefined/null = not driven (the FIND panel owns matches).
  searchMatchIds?: readonly string[] | null;
  // Fired at the end of EVERY frame this renderer draws, with the node count drawn that frame
  // (any count, including zero). General-purpose instrumentation; not currently wired by App —
  // the boot splash gates on the app shell's own first paint (see App.tsx's bootGate wiring),
  // not the graph's, so the graph is free to keep rasterizing after the splash is gone.
  onPaint?: (nodeCount: number) => void;
  // The full (un-mode-filtered) vault+memory graph, used ONLY as a `community`/`communityPath`
  // lookup for LOCAL mode's own layout settle (see localLaidOut below) — never rendered. `props.graph`
  // in local mode is `displayGraph.ts`'s `localSubgraph()` result, which deliberately STRIPS those
  // fields before the renderer ever sees them (a dozen notes coloured by the whole vault's community
  // structure "said nothing" — see localSubgraph's doc comment) — but the underlying ids are still
  // useful to the LAYOUT physics even when there's nothing sensible to draw from them: a neighbour
  // that shares the focused note's community should settle closer than a bridge into an unrelated
  // one. Optional so a caller that doesn't have it degrades to the pre-Task-5 community-less local
  // layout instead of erroring.
  communitySource?: GraphData;
}) {
  let host!: HTMLDivElement;
  // The ASCII field draws its labels ON the character grid (they're cells like everything else), so
  // there is no DOM label overlay.
  const renderer: GraphRenderer = new AsciiGraphRenderer();
  // The bloom's paint target, decoupled from `renderer`'s identity entirely — see
  // GraphAtmosphere.tsx's file-level comment for why a `renderer` prop on <GraphAtmosphere> is a bug
  // magnet (Solid compiles a bare-identifier prop to a static value, so it captures whatever
  // instance existed at JSX-evaluation time). The indirection outlives the renderer swap it was
  // written for: VaultIntro's IntroGraph uses the same shape for its two cross-faded instances, and
  // it keeps <GraphAtmosphere> independent of when, or how often, `renderer` is (re)assigned.
  const bloomSink: BloomSink = {};
  let mounted = false;
  let lastGraph: GraphData | null = null;
  const [hovered, setHovered] = createSignal<HoverNode | null>(null);
  const [fps, setFps] = createSignal<number | null>(null);
  // Zoom is RESOLUTION, not scale: 100% fits the whole graph on the grid (graph-size relative),
  // 0% is a fixed absolute resolution with every note individually distinguishable, independent of
  // graph size (design/ascii .../guidelines/ascii-zoom.card.html; asciiGrid.ts DEEPEST_WORLD_PER_CELL).
  // Moves in 10% steps (wheel notches / +- keys). Starts at 100 so the HUD never flashes "0%" (which
  // would misleadingly read as "already at max detail") before the renderer's first real emitZoom.
  const [zoomPct, setZoomPct] = createSignal(100);
  const [searchItems, setSearchItems] = createSignal<SearchItem[]>([]);

  // Graph search panel, opened by the FIND / ☰ buttons. Only shown when the graph is a full
  // pane (props.fill) — the sidebar mini-graph is too small to be worth it. Cluster names now
  // live IN the field (zoomed-out labels), not a floating legend card; there's no reset-view
  // button here either.
  const [menuOpen, setMenuOpen] = createSignal(false);
  const closeMenu = () => { setMenuOpen(false); renderer.setSearchMatches(new Set()); renderer.clearHighlight(); };

  // LOCAL is a LENS, not a brain view: it shows whatever note is open, so it toggles on and off over
  // the mode you were already in rather than replacing it in the switcher. `beforeLocal` remembers what
  // to go back to.
  let beforeLocal: GraphMode = "2nd";
  const localOn = () => props.mode === "local";
  const toggleLocal = () => {
    if (localOn()) { props.setMode(beforeLocal); return; }
    beforeLocal = props.mode;
    props.setMode("local");
  };
  // LOCAL only exists in the little graph. If the graph is promoted to a full pane while the lens is
  // on, drop back — otherwise the full-pane switcher would show no selected segment (its options don't
  // include "local") and there would be no control anywhere to turn it off.
  createEffect(() => {
    if (!props.mini && props.mode === "local") props.setMode(beforeLocal);
  });

  // The 3rd-brain (memory) + daemon graph modes only exist while the daemon is enabled
  // (the per-vault master switch). When it's off, the 3rd brain carries no nodes and the
  // daemon graph is empty — fall back to "2nd" so the toggle never points at a hidden mode.
  createEffect(() => {
    if (!settings.daemon.enabled && (props.mode === "daemon" || props.mode === "3rd" || props.mode === "both")) {
      props.setMode("2nd");
    }
  });

  // Rebuild search items from the renderer's current node set. Called after each render() so the
  // Cmd+O-style graph search tracks the live graph.
  const refreshUiData = () => {
    setSearchItems(
      renderer.getNodesForUI().map((n) => ({ id: n.id, label: n.label, sub: n.communityLabel ?? n.folder })),
    );
  };

  // Open a node as a tab — shared by canvas clicks and search-result commits. Only vault
  // notes map to a real file; tags, the "you" hub, and memory nodes (their `mem:`
  // ids aren't vault paths) can't be opened, so they just get framed by the caller.
  const openNode = (id: string) => {
    const node = lastGraph?.nodes.find((n) => n.id === id);
    if (node?.kind !== "note") return;
    props.onOpen(id);
  };

  // mountRenderer is defined further below (after rendererGraph/buildConfig, which it calls) but
  // referenced here — safe, since this callback only runs once Solid actually mounts the component
  // (after the whole function body below has already executed and initialized those consts).
  onMount(() => {
    mountRenderer();
    mounted = true;
  });

  // LOCAL mode lays its own graph out, client-side. The positions on the nodes came from a layout of
  // the WHOLE vault — at neighbourhood scale they are meaningless (a dozen notes scattered across a
  // ±2000-unit world), so the subgraph gets its own settle. Same approach EmbeddedGraph.tsx already
  // uses for a ```graph block: the pure `computeLayout`, no backend round-trip and no cache, because a
  // neighbourhood is small enough to settle in a few ms. 3D first, then 2D seeded from it, exactly as
  // the backend pipeline does, so the 2D/3D morph stays aligned.
  //
  // `community`/`communityPath` are looked up from `props.communitySource` (the full, un-stripped
  // graph — see the prop doc) rather than read off `g.nodes` directly: `g` in local mode is already
  // `localSubgraph()`'s stripped result, by design (see its comment), so the fields aren't there to
  // read even though the underlying data exists. This makes `computeLayout`'s community-aware gravity
  // apply (a neighbour sharing the focused note's community settles closer than a cross-community
  // bridge) WITHOUT changing what gets rendered: the returned nodes below never carry these fields, so
  // the renderer stays exactly as flat/uncoloured in local mode as it already was (showLodMasses is
  // separately gated off `props.mode !== "local"` regardless). See localLayoutInput.ts / its test.
  const localLaidOut = createMemo<GraphData>(() => {
    const g = props.graph;
    if (props.mode !== "local" || g.nodes.length === 0) return g;
    const input = localLayoutInput(g, props.communitySource);
    const pos3 = computeLayout(input, { refineTicks: LOCAL_REFINE_TICKS });
    const pos2 = computeLayout(input, { dimensions: 2, refineTicks: LOCAL_REFINE_TICKS, initialPositions: pos3 });
    return {
      nodes: g.nodes.map((n) => ({
        ...n,
        position: pos3[n.id] ?? n.position,
        position2d: pos2[n.id] ? ([pos2[n.id][0], pos2[n.id][1]] as [number, number]) : n.position2d,
      })),
      edges: g.edges,
    };
  });

  const rendererGraph = (): GraphData =>
    props.mode === "local" ? localLaidOut() : props.graph;

  /** Render `g` on the renderer and refresh the search/legend UI data from its new node set.
   *  Shared by the graph-render effect below and mountRenderer. */
  const renderGraphNow = (g: GraphData) => {
    renderer.render(g);
    refreshUiData();
  };

  createEffect(() => {
    lastGraph = props.graph;
    const g = rendererGraph();
    if (mounted) renderGraphNow(g);
  });

  // Derive the live GraphConfig from settings + appearance tokens. Colors derive from the
  // centralized `appearance` theme tokens: nodes/clusters from the Oxide accentPalette
  // (by stable hash, inside the renderer), edges = Steel (neutral) at low alpha, the
  // canvas background = Ink (background). No separate graph palette/colors anymore.
  // Extracted into its own function (rather than inlined in the effect below) so mountRenderer can
  // push a full config the moment it mounts, without duplicating the settings -> GraphConfig mapping.
  const buildConfig = (): GraphConfig => {
    const gs = settings.graph;
    const ap = resolveAppearance(settings.appearance);
    const palette = ap.accentPalette?.length ? ap.accentPalette : DEFAULT_ACCENT_PALETTE;
    const cfg: GraphConfig = {
      spin: gs.spin,
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
      // The faint ASCII noise texture under the field — off by default (settingsSchema.ts).
      backgroundNoise: gs.backgroundNoise,
      // LEVEL OF DETAIL — the ASCII field's aggregate CLUSTER MASSES (lod.ts). Zoomed out, each
      // community of the active hierarchy level draws as ONE compact ASCII mass sized by member
      // count, joined by AGGREGATE edges that each summarize every real link between two
      // communities' member sets; stepping the zoom ladder in replaces a parent mass with its
      // children, and only the deepest stops rasterize individual notes and their real edges.
      //
      // This was built, unit-tested (lod.ts / lod.test.ts / AsciiGraphRenderer.test.ts's LEVEL OF
      // DETAIL block) and then left unreachable — GraphView never set the flag, so the shipped field
      // drew every node at every zoom and the hierarchy read only through colour + labels. That is
      // the version the user found unreadable; the masses are what made it legible.
      // ...but NEVER in "local" mode. A local neighbourhood carries no community hierarchy by design
      // (localSubgraph strips it), and the LOD path suppresses the individual-note raster at coarse
      // zoom on the assumption that aggregate MASSES are covering the field. With no communities there
      // are no masses, so both passes stay off and the field renders completely empty. Local mode wants
      // the real notes at every zoom, which is exactly the non-LOD path.
      showLodMasses: props.mode !== "local",
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
    };
    return cfg;
  };

  createEffect(() => {
    renderer.setConfig(buildConfig());
    // Search items' sub-labels are derived from the renderer's live node set. This effect can run
    // AFTER the initial render+refresh (Solid runs effects in creation order, and this one trails
    // the graph-render effect), so refresh here too rather than relying solely on the render effect.
    if (mounted) refreshUiData();
  });

  // Mount the renderer + send it everything it needs to reflect the live state: config, the
  // current graph, the active file, and any live search-match set. This function IS "what onMount
  // does".
  const mountRenderer = () => {
    renderer.mount(host, openNode, (node) => setHovered(node));
    renderer.setFpsCallback(setFps);
    renderer.setZoomCallback?.(setZoomPct);
    // Forward through the stable sink, not straight to a signal/effect — see bloomSink's own
    // comment and GraphAtmosphere.tsx's file-level one.
    renderer.setBloomCallback?.((field) => bloomSink.current?.(field));
    if (props.onPaint) renderer.setPaintCallback(props.onPaint);
    renderer.setConfig(buildConfig());
    if (lastGraph) renderGraphNow(rendererGraph());
    renderer.setActiveFile(props.active ? props.active.replace(/\.md$/, "") : null);
    if (switcherHadMatch && props.searchMatchIds?.length) renderer.setSearchMatches(new Set(props.searchMatchIds));
    renderer.setVisible(props.visible !== false && !docHidden());
  };

  // The one graph instance moves between a full pane and the cramped backdrop/sidebar slot, but it
  // draws on the SAME cell in both (the app's unified --row-h rhythm, asciiGraph.css --cell-h) —
  // there is no denser cell for the mini slot any more. It just fits fewer glyphs; that's expected.

  createEffect(() => {
    const a = props.active;
    // Node ids in vault.ts:32 are the file path WITHOUT the .md extension.
    renderer.setActiveFile(a ? a.replace(/\.md$/, "") : null);
  });

  // Cmd+O switcher highlight: reflect the WHOLE current result set as search matches in the
  // graph (every matching note lights up, not just the active row). Only ever clears a match
  // WE set (switcherHadMatch) so it never fights the FIND panel, which uses the same
  // setSearchMatches for its own preview.
  let switcherHadMatch = false;
  createEffect(() => {
    const ids = props.searchMatchIds;
    if (ids == null || ids.length === 0) {
      if (switcherHadMatch) { renderer.setSearchMatches(new Set()); switcherHadMatch = false; }
      return;
    }
    renderer.setSearchMatches(new Set(ids));
    switcherHadMatch = true;
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
  // The 3rd-brain/daemon graph modes only exist while the daemon is on (see the effect above that
  // falls back to "2nd" when it's off), so with it off there is only ONE brain-mode option — "2nd".
  // A single-option switcher is a permanently-selected, does-nothing control, so it's hidden
  // entirely rather than rendered disabled (see the outer <Show> around it below).
  const modeOptions = (): GraphMode[] => (settings.daemon.enabled ? ["2nd", "3rd", "both", "daemon"] : ["2nd"]) as GraphMode[];
  const MODE_LABEL: Record<GraphMode, string> = { "2nd": "2nd brain", "3rd": "3rd brain", both: "both brains", daemon: "daemon", local: "the open note's neighbourhood" };
  const modeLabel = () => MODE_LABEL[props.mode] ?? props.mode;
  const nodeCount = () => props.graph?.nodes?.length ?? 0;
  const edgeCount = () => props.graph?.edges?.length ?? 0;

  return (
    <div class="graph-root" style={{ height: props.fill ? "100%" : undefined }}>
      <ViewBar class="graph-viewbar">
        <span class="graph-vb-wide"><Crumb icon="Share2">Knowledge Graph</Crumb></span>
        {/* The mini-graph switcher is a row of BARE ICON BUTTONS, matching the sidebar's own toolbar
            (.sidebar-icons) — same 28x28 box, same radius, same hover, no border. It is deliberately
            NOT a <SegmentedToggle> here: that renders .btn--text segments, which keep their outline and
            turn an icon into a chunky bordered tile — the one control in the sidebar that didn't look
            like the sidebar. The full-pane graph keeps the real segmented control, where the labels are
            words and a joined outline is right. */}
        {/* Hidden outright (not just disabled) when there's only one brain-mode option to pick
            from — the daemon-off default — since a permanently-selected single-option control
            does nothing. See modeOptions() above. */}
        <Show when={modeOptions().length > 1}>
          <Show
            when={props.mini}
            fallback={
              <SegmentedToggle
                value={props.mode}
                onChange={props.setMode}
                size="sm"
                // "local" is deliberately NOT here — it is not a sibling of the brain views. It is a lens
                // on whatever note is open, so it gets its own on/off toggle in the mini-graph's bottom bar.
                options={modeOptions().map((id) => ({
                  id,
                  title: MODE_LABEL[id],
                  label: MODE_SHORT[id],
                }))}
              />
            }
          >
            <div class="graph-mode-icons">
              <For each={modeOptions()}>
                {(id) => (
                  <IconButton
                    icon={MODE_ICON[id]}
                    label={MODE_LABEL[id]}
                    variant={props.mode === id ? "selected" : "unselected"}
                    onClick={() => props.setMode(id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
        <ViewBarSpacer />
        <span class="graph-vb-wide graph-vb-right">
          <SegmentedToggle
            value={graphViewMode()}
            onChange={setViewMode}
            size="sm"
            options={[
              { id: "2d", title: "2D", label: "2D" },
              { id: "3d", title: "3D", label: "3D" },
            ]}
          />
          <Show when={props.fill}>
            <IconTextButton icon="Search" size="sm" variant={menuOpen() ? "selected" : "unselected"} onClick={() => (menuOpen() ? closeMenu() : setMenuOpen(true))}>FIND</IconTextButton>
          </Show>
        </span>
      </ViewBar>
      <div
        class="graph-area"
        style={{ ...(props.fill ? { flex: 1, "min-height": 0 } : { "aspect-ratio": "1" }) }}
      >
        <div class="graph-canvas-host" ref={host} />
        {/* Atmosphere (phosphor bloom emitted by the node field + depth vignette). Mounts
            unconditionally, ONCE, for the component's whole lifetime. The old rule ("the ASCII
            field's ground is deliberately flat, no glow or vignette") is deliberately reversed: the
            redesign's phosphor bloom IS the atmosphere.
            No `renderer` prop, on purpose — see GraphAtmosphere.tsx's file-level comment and
            bloomSink above. No DOM label overlay: the renderer draws its labels on its own
            canvas. */}
        <GraphAtmosphere sink={bloomSink} mode={props.mode} />
        {/* No floating cluster-legend card — cluster names are drawn IN the field itself
            (zoomed-out labels; see AsciiGraphRenderer's layoutClusterNames), crossfading to file
            names as the camera zooms in. */}
        {/* Daemon-mode list: crons and processes with live status. */}
        <Show when={props.mode === "daemon"}>
          <div class="graph-legend-card daemon-legend asc-popover">
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
        {/* Floating stats footer. */}
        <div class="graph-stats">
          <span>{nodeCount()} nodes · {edgeCount()} edges · {modeLabel()}</span>
          {/* Resolution, not scale — see the zoom law in AsciiGraphRenderer. */}
          <span class="graph-zoom-pct">{zoomPct()}%</span>
          <Show when={settings.graph.showFps && fps() !== null}><span style={{ color: fpsColor(fps()!) }}>{fps()} fps</span></Show>
        </div>
        {/* Find panel: search only. Clusters live in the floating legend card; there's no
            reset-view button here (Escape / toggling Find closes it). */}
        <Show when={props.fill && menuOpen()}>
          <div class="graph-find-panel asc-popover">
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
          {/* LOCAL — the little graph only, bottom-RIGHT, on/off. Separate from the brain-mode
              switcher because it is a different kind of choice: those pick WHICH graph, this picks
              whether to narrow the current one to the open note. */}
          <Show when={props.mini}>
            <div class="graph-bottom-local">
              <TextButton
                size="sm"
                variant={localOn() ? "selected" : "unselected"}
                title={localOn() ? "Showing the open note's neighbourhood — click to show the whole graph" : "Show only the open note and what it connects to"}
                onClick={toggleLocal}
              >
                LOCAL
              </TextButton>
            </div>
          </Show>
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
