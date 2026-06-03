// app/src/App.tsx
import { createSignal, onMount, onCleanup, For, createMemo, createEffect, Show } from "solid-js";
import { api } from "./api";
import { readCache, writeCache } from "./viewCache";
import { FileTree } from "./FileTree";
import { Icon } from "./icons/Icon";
import { GraphView } from "./GraphView";
import { CommandPalette } from "./palette/CommandPalette";
import { QuickSwitcher } from "./palette/QuickSwitcher";
import { TemplatePalette } from "./palette/TemplatePalette";
import { bindCommands } from "./commands";
import { settings } from "./settings";
import { settingsToCssVars, setCssVars } from "./settingsCssVars";
import { resolveAppearance } from "./themes";
import { matchesKeybinding } from "./keybindings";
import { lastChange } from "./serverVersion";
import { debounce } from "./debounce";
import { ToastHost, pushToast } from "./Toast";
import { TerminalTab } from "./Terminal";
import { subgraphByKinds, SECOND_BRAIN_KINDS, THIRD_BRAIN_KINDS } from "../../core/src/graph";
import { withYouNode } from "./graph/youNode";
import type { GraphData, ViewLayout } from "../../core/src/graph";
import type { NoteCandidate } from "./editor/wikilink";
import { TERMINAL_PREFIX, SEARCH_TAB, GRAPH_TAB, EXPORT_PREFIX, EMPTY_PANE, CALENDAR_TAB, FLASHCARDS_PREFIX, contentLabel, contentIcon, isSentinel } from "./tabIds";
import { isExportable } from "./export/formats";
import {
  type Tab, type PaneNode, type Dir, type Rect, makeTab,
  splitLeaf, closeLeaf, equalize, focusNeighbor,
  setContent, setRatio, findLeafByContent, leaves, leafCount, pruneMissing, movePane,
  reorderTabs, splitLeafWithNode, replaceLeafWithNode, replacePaneWithPane, detachLeafToTab,
  serializeTabs, deserializeTabs, resolveFocus,
} from "./panes";
import { IconButton } from "./ui/IconButton";
import { PaneTree } from "./PaneTree";
import { createViewDrag, type DragDescriptor, type DropTarget } from "./dnd/viewDrag";
import type { Zone as DropZone } from "./dnd/geometry";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { openContextMenu } from "./nativeMenu";
import "./App.css";
import "./ui/popover/popover.css";

/** Graph view mode: 2nd=vault notes, 3rd=memory, both=vault+memory, agents=relay network */
type GraphMode = "2nd" | "3rd" | "both" | "agents";

/**
 * Apply brain-view layout to a subgraph. Overwrites node positions with the view's
 * precomputed layout (for 2nd/3rd brain views) instead of using full-graph positions
 * which would strand cross-brain-linked nodes.
 */
function applyView(graph: GraphData, view: ViewLayout | undefined): GraphData {
  if (!view) return graph;
  return {
    edges: graph.edges,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: view.pos3d[node.id] ?? node.position,
      position2d: view.pos2d[node.id] ?? node.position2d,
    })),
  };
}

const TABS_STORAGE_KEY = "oa-tabs-v1";
const SIDEBAR_STORAGE_KEY = "oa-sidebar-visible-v1";
const GRAPH_CACHE_KEY = "oa-graph-cache-v1";
// Mirrors the key the inline <head> script in index.html reads to apply the theme before
// the bundle loads. Bump both together if the var map shape changes.
const THEME_VARS_KEY = "oa-theme-vars-v1";
// Max width of the floating drag-ghost. A pane header spans the whole pane, which
// looked oversized as a ghost; cap it to a tab-like chip.
const GHOST_MAX_W = 200;

export default function App() {
  // Seed from the last good graph so it paints instantly on boot (the renderer already
  // caches node positions in localStorage; this supplies the structure). Reconciles when
  // /graph returns. Persisted WITHOUT the lazy `views` layouts to keep the blob small.
  const [graph, setGraph] = createSignal<GraphData>(
    readCache<GraphData>(GRAPH_CACHE_KEY) ?? { nodes: [], edges: [] },
  );
  const [agents, setAgents] = createSignal<GraphData>({ nodes: [], edges: [] });
  const [mode, setMode] = createSignal<GraphMode>("both");

  // Restore persisted tab/pane layout at setup (before any persist effect runs, so we
  // never clobber storage with the initial empty state). The graph/vault list isn't
  // loaded yet, so we keep every leaf here; the existing oa-deleted reconciliation prunes
  // any leaf whose file turns out to be gone once edits occur.
  const restored = deserializeTabs(
    typeof localStorage !== "undefined" ? localStorage.getItem(TABS_STORAGE_KEY) : null,
    () => true,
  );
  // The Knowledge Graph is the home tab: there's no separate floating "default view" anymore, so
  // when nothing is restored we open with the graph AS a tab. The no-empty-state effect + the
  // close handlers keep this invariant (a graph tab always exists) at runtime.
  const initialTabs = restored.tabs.length > 0 ? restored.tabs : [makeTab(GRAPH_TAB)];
  const [tabs, setTabs] = createSignal<Tab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(restored.activeTabId ?? initialTabs[0]?.id ?? null);

  const activeTab = createMemo(() => tabs().find((t) => t.id === activeTabId()) ?? null);
  // True when any tab is open — drives the graph floater's sidebar-vs-main docking.
  const anyTabOpen = createMemo(() => tabs().length > 0);
  // True when the active tab is showing the Knowledge Graph in one of its panes. The sidebar
  // mini-graph hides in this case so the graph never renders twice on screen at once.
  const activeTabShowsGraph = createMemo(() => {
    const t = activeTab();
    return !!t && leaves(t.root).some((l) => l.content === GRAPH_TAB);
  });

  // Content id of the currently-focused leaf in the active tab, or null.
  // Drives the terminal overlay's visibility.
  const focusedContent = createMemo<string | null>(() => {
    const t = activeTab();
    if (!t) return null;
    return leaves(t.root).find((l) => l.id === t.focusId)?.content ?? null;
  });

  // Basename (no folder, no .md) of the focused note — used as {{title}} when
  // expanding a template. Empty string when the focused pane isn't a real note
  // (sentinel like ::settings/::graph/terminal, or nothing focused).
  const activeNoteTitle = createMemo<string>(() => {
    const c = focusedContent();
    if (!c || isSentinel(c)) return "";
    return c.split("/").pop()!.replace(/\.md$/, "");
  });

  // Every unique terminal content id open across all tabs/panes — each gets one
  // always-mounted xterm in the overlay. Hidden ones use display:none so their
  // PTY/WebSocket stay alive when the user switches tab or focuses a sibling pane.
  const terminalContents = createMemo<string[]>(() => {
    const ids = new Set<string>();
    for (const t of tabs()) {
      for (const l of leaves(t.root)) {
        if (l.content.startsWith(TERMINAL_PREFIX)) ids.add(l.content);
      }
    }
    return [...ids];
  });

  // Every content id open as a tab or pane, across all tabs — the "you" hub in the knowledge
  // graph links to each of these (whichever resolve to a note in the active brain view). Live:
  // re-derives on any tab/pane open/close/replace, so the hub's edges track the working set.
  const openContents = createMemo<string[]>(() => {
    const ids = new Set<string>();
    for (const t of tabs()) for (const l of leaves(t.root)) ids.add(l.content);
    return [...ids];
  });

  // The editor body element — overlay positioning is relative to its rect.
  let editorBodyEl: HTMLDivElement | undefined;
  // Pixel rects (relative to editor body) of each terminal's host placeholder in the
  // active tab. Absent → terminal not in active tab → hidden. Recomputed whenever the
  // active tab's tree changes or the body resizes (see effect below).
  const [terminalHostRects, setTerminalHostRects] = createSignal<Map<string, Rect>>(new Map());
  const measureTerminalHosts = (): void => {
    if (!editorBodyEl) return;
    const parent = editorBodyEl.getBoundingClientRect();
    const next = new Map<string, Rect>();
    for (const host of editorBodyEl.querySelectorAll<HTMLElement>("[data-terminal-host]")) {
      const id = host.getAttribute("data-terminal-host");
      if (!id) continue;
      const r = host.getBoundingClientRect();
      next.set(id, { x: r.left - parent.left, y: r.top - parent.top, w: r.width, h: r.height });
    }
    setTerminalHostRects(next);
  };
  // Re-measure whenever the active tab's tree changes — Solid runs this effect after the
  // render that placed/removed host elements, so getBoundingClientRect is current.
  createEffect(() => {
    activeTab(); // track
    queueMicrotask(measureTerminalHosts);
  });

  const updateActiveTab = (fn: (t: Tab) => Tab) =>
    setTabs((ts) => ts.map((t) => (t.id === activeTabId() ? fn(t) : t)));
  // Left sidebar visibility (Option+S / "Toggle sidebar" command). Persisted.
  const [sidebarVisible, setSidebarVisible] = createSignal(
    localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "0",
  );
  createEffect(() => localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarVisible() ? "1" : "0"));
  const toggleSidebar = () => setSidebarVisible((v) => !v);
  const equalizePanes = () => updateActiveTab((t) => ({ ...t, root: equalize(t.root) }));
  // Which palette overlay is open (Cmd+P / Cmd+O), or null. Only one at a time.
  const [palette, setPalette] = createSignal<"command" | "file" | "template" | null>(null);
  // Right-click pane menu: which leaf and where to anchor the menu, or null.
  const [paneMenu, setPaneMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const paneMenuItems = (leafId: string): MenuItem[] => [
    { label: "Split right", icon: "PanelRight", onSelect: () => splitPane(leafId, "row") },
    { label: "Split down", icon: "PanelBottom", onSelect: () => splitPane(leafId, "col") },
    // Equalize is only meaningful with ≥2 panes; on a single leaf it's a no-op, so
    // hide it. This menu (a click) is the reliable trigger — the Mod+Alt+= keybind is
    // eaten by the browser's zoom shortcut while a note editor is focused, which is
    // exactly when you want to equalize.
    ...((activeTab() && leafCount(activeTab()!.root) > 1)
      ? [{ label: "Equalize panes", icon: "Columns3", separatorBefore: true, onSelect: () => equalizePanes() } as MenuItem]
      : []),
    { label: "Close pane", icon: "X", danger: true, separatorBefore: true, onSelect: () => closePane(leafId) },
  ];
  // Right-click menu for an editor mark (spelling / grammar / property suggestions),
  // emitted by editor/contextMenu.ts as an 'oa-context-menu' event. Rendered with the
  // SAME <ContextMenu> component as the pane menu — one menu style across the app.
  const [editorMenu, setEditorMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);
  onMount(() => {
    const onCtx = (e: Event) => {
      const d = (e as CustomEvent<{ x: number; y: number; items: MenuItem[] }>).detail;
      openContextMenu(d.x, d.y, d.items, setEditorMenu);
    };
    window.addEventListener("oa-context-menu", onCtx);
    onCleanup(() => window.removeEventListener("oa-context-menu", onCtx));
  });

  // The graph is a single persistent element that morphs between two slots: the
  // sidebar square (when a file/settings tab is active) and the full main pane
  // (when on an empty/new tab). One WebGL context stays alive; we just animate
  // its bounding box between the two slot rectangles.
  let sidebarSlot: HTMLDivElement | undefined;
  let mainSlot: HTMLDivElement | undefined;
  let floater: HTMLDivElement | undefined;

  const refreshGraph = async () => {
    const g = await api.graph();
    setGraph(g);
    writeCache(GRAPH_CACHE_KEY, { nodes: g.nodes, edges: g.edges });
  };

  // The backend computes the dedicated 2nd/3rd-brain layouts lazily (GET /graph/views),
  // since "both" mode doesn't need them. When the user switches to a brain mode whose
  // layout isn't loaded yet, fetch it once and merge it in. Throttled so a not-yet-ready
  // layout can't cause a fetch storm; applyView falls back to full-graph positions until
  // the layout lands.
  let lastViewFetch = -Infinity; // -Infinity (not 0): the first call always clears the throttle
  const ensureViewLayouts = async () => {
    const now = performance.now();
    if (now - lastViewFetch < 2000) return;
    lastViewFetch = now;
    try {
      const views = await api.graphViews();
      setGraph((g) => ({ ...g, views }));
    } catch {
      // leave views absent — the graph renders with full-graph positions
    }
  };

  const refreshAgents = async () => setAgents(await api.agentGraph());

  // The graph is a visualization, not the source of truth — it can update a beat
  // after edits settle. Even with server-side `dirty` gating, a burst of real
  // structural changes can fire several graph-dirty events in quick succession;
  // debouncing collapses them into one rebuild (~100-150ms each) instead of a
  // flicker.
  const scheduleGraphRefresh = debounce(() => { refreshGraph(); }, () => settings.graph.refreshDebounceMs);

  const displayGraph = createMemo<GraphData>(() => {
    const currentMode = mode();
    const open = openContents();
    switch (currentMode) {
      case "2nd":
        return withYouNode(applyView(subgraphByKinds(graph(), SECOND_BRAIN_KINDS), graph().views?.second), open);
      case "3rd":
        return withYouNode(applyView(subgraphByKinds(graph(), THIRD_BRAIN_KINDS), graph().views?.third), open);
      case "agents":
        return agents(); // agents mode has its own SVG "you" hub (AgentsGraph) — no injection
      case "both":
        return withYouNode(graph(), open); // full brain + the you hub linking the open working set
    }
  });

  const noteCandidates = createMemo<NoteCandidate[]>(() =>
    graph().nodes.filter((n) => n.kind === "note").map((n) => ({ label: n.label, path: n.id, folder: n.folder })),
  );

  const tagCandidates = createMemo<string[]>(() =>
    graph().nodes.filter((n) => n.kind === "tag").map((n) => n.label.replace(/^#/, "")),
  );

  // Open a content id. Single-pane active tab → new tab (today's behavior). Multi-pane
  // active tab → load into the focused pane. If already visible in the active tab, focus it.
  const openFile = (path: string) => {
    const at = activeTab();
    const isMultiPane = at && leaves(at.root).length > 1;
    if (isMultiPane) {
      const existing = findLeafByContent(at.root, path);
      if (existing) {
        updateActiveTab((t) => ({ ...t, focusId: existing.id }));
        return;
      }
      updateActiveTab((t) => ({ ...t, root: setContent(t.root, t.focusId, path) }));
      return;
    }
    const sameTab = tabs().find(
      (t) => t.root.kind === "leaf" && t.root.content === path,
    );
    if (sameTab) {
      setActiveTabId(sameTab.id);
      return;
    }
    const tab = makeTab(path);
    setTabs((ts) => [...ts, tab]);
    setActiveTabId(tab.id);
  };
  const openSettings = () => openFile("settings.yaml");
  const openTerminal = () => openFile(TERMINAL_PREFIX + crypto.randomUUID());
  const openSearch = () => openFile(SEARCH_TAB);
  const openExport = (path: string) => openFile(EXPORT_PREFIX + path);
  const newNote = () => window.dispatchEvent(new CustomEvent("oa-new", { detail: { kind: "file" } }));
  const newFolder = () => window.dispatchEvent(new CustomEvent("oa-new", { detail: { kind: "dir" } }));
  // Create a blank document (.draw / .sheet) and open it. Falls back to a unique name on collision.
  const newDoc = async (base: string, ext: string) => {
    let path = `${base}.${ext}`;
    try { await api.create(path, "file"); }
    catch { path = `${base}-${crypto.randomUUID().slice(0, 6)}.${ext}`; await api.create(path, "file"); }
    openFile(path);
  };
  const newSpreadsheet = () => void newDoc("Spreadsheet", "sheet");
  const newDrawing = () => void newDoc("Drawing", "draw");
  const openCalendar = () => openFile(CALENDAR_TAB);
  const openFlashcards = () => openFile(FLASHCARDS_PREFIX);
  // Open the Knowledge Graph as its own tab (focuses the existing graph tab if already open).
  const openGraph = () => openFile(GRAPH_TAB);
  // No empty state: if every tab ever closes (via any path — close, drag-detach, prune), reopen
  // the graph home tab. The close handler already swaps atomically; this is the catch-all.
  createEffect(() => {
    if (tabs().length === 0) openGraph();
  });
  const openDailyNote = async (id: string) => {
    try {
      const { path } = await api.dailyNote(id);
      openFile(path);
    } catch (e) {
      pushToast(`Daily note failed: ${(e as Error).message}`);
    }
  };
  // The catalog->action binding both the toolbar and the command palette consume.
  const commands = () => bindCommands({ openSettings, openTerminal, openSearch, newNote, newFolder, newSpreadsheet, newDrawing, openCalendar, openFlashcards, openGraph, setMode, openDailyNote, equalizePanes, toggleSidebar }, settings.dailyNotes);

  // Apply settings to the document as CSS custom properties (theme, accent, fonts,
  // and all appearance/ui sizing/spacing). The mapping lives in settingsCssVars so
  // adding a CSS-driven setting is one line there + one var() in the stylesheet.
  createEffect(() => {
    const vars = settingsToCssVars(settings);
    setCssVars(vars);
    // Light/dark themes: set color-scheme so native form controls + scrollbars match.
    document.documentElement.style.colorScheme = resolveAppearance(settings.appearance).isLight ? "light" : "dark";
    // Cache the computed vars so index.html's inline script can paint the theme before
    // the bundle even loads next launch (no flash of the default fallback theme).
    writeCache(THEME_VARS_KEY, vars);
  });
  // Per-vault app icon → favicon + window/document title. Live: re-runs whenever
  // settings.appearance.icon changes (SSE re-hydrate → reactive store).
  createEffect(() => {
    const href = `/logos/${settings.appearance.icon}.svg`;
    const link = document.getElementById("app-favicon") as HTMLLinkElement | null;
    if (link) link.href = href;
  });
  // The macOS dock icon is set natively at startup from settings.yaml's
  // appearance.icon (see src-tauri/src/lib.rs) — doing it from the webview after
  // first paint blanks the WKWebView on macOS, so it is intentionally NOT done here.
  createEffect(() => {
    document.title = "Bismuth";
  });
  // Persist tab/pane layout whenever it changes.
  createEffect(() => {
    localStorage.setItem(TABS_STORAGE_KEY, serializeTabs(tabs(), activeTabId()));
  });
  // Close one tab by id (its whole pane tree goes with it).
  const closeTabById = (id: string) => {
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.id === id);
      if (i === -1) return ts;
      const next = ts.filter((t) => t.id !== id);
      // Never fall back to an empty state: closing the last tab reopens the graph home tab in its
      // place (atomic, so there's no flash of the old main-pane default view).
      if (next.length === 0) {
        const home = makeTab(GRAPH_TAB);
        setActiveTabId(home.id);
        return [home];
      }
      if (activeTabId() === id) setActiveTabId(next[Math.min(i, next.length - 1)]?.id ?? null);
      return next;
    });
  };
  const closeTab = (id: string, e: Event) => {
    e.stopPropagation();
    closeTabById(id);
  };

  // Close a given pane of the active tab. Collapses its parent split; if it was the
  // last pane in the tab, the tab itself closes.
  const closePane = (leafId: string) => {
    const at = activeTab();
    if (!at) return;
    const nextRoot = closeLeaf(at.root, leafId);
    if (nextRoot === null) {
      closeTabById(at.id);
      return;
    }
    const focusId = resolveFocus(nextRoot, at.focusId);
    updateActiveTab((t) => ({ ...t, root: nextRoot, focusId }));
  };
  const closeFocusedPane = () => {
    const at = activeTab();
    if (at) closePane(at.focusId);
  };

  // Split a given pane; focus the new pane. The new pane starts empty; the user
  // fills it by dragging a file/pane onto it or opening something while focused.
  const splitPane = (leafId: string, dir: "row" | "col") => {
    updateActiveTab((t) => {
      const { root, newLeafId } = splitLeaf(t.root, leafId, dir, EMPTY_PANE);
      return { ...t, root, focusId: newLeafId };
    });
  };

  // Drop a file from the tree onto a pane: split the pane along the dropped edge and show
  // the file in the half nearest the drop point. left/up put it on the original side; the
  // duplicate (new leaf) holds the prior content. Empty target panes are filled in place
  // (no split) — the whole point of the empty placeholder is to be a drop target.
  const dropFileOnPane = (leafId: string, path: string, dir: Dir) => {
    const at = activeTab();
    if (!at) return;
    const target = leaves(at.root).find((l) => l.id === leafId);
    if (target?.content === EMPTY_PANE) {
      updateActiveTab((t) => ({ ...t, root: setContent(t.root, leafId, path), focusId: leafId }));
      return;
    }
    const splitDir = dir === "left" || dir === "right" ? "row" : "col";
    updateActiveTab((t) => {
      const { root, newLeafId } = splitLeaf(t.root, leafId, splitDir);
      const fileLeaf = dir === "right" || dir === "down" ? newLeafId : leafId;
      return { ...t, root: setContent(root, fileLeaf, path), focusId: fileLeaf };
    });
  };

  // === Unified tab/pane drag (see dnd/viewDrag.ts) ===
  // Tabs and panes are interchangeable draggable "views". The controller resolves
  // a (descriptor, target) on drop; the handlers below map each combination onto a
  // pure model op.

  // Drop a tab onto a pane of the ACTIVE tab. Center (or an empty target) fills the
  // pane in place for a single-pane tab; an edge splits in that direction. Any
  // multi-pane tab grafts its whole subtree (layout preserved). The source tab is
  // consumed. Dragging the active tab onto its own panes is a no-op.
  const dropTabOnPane = (srcTabId: string, targetLeafId: string, zone: DropZone) => {
    if (srcTabId === activeTabId()) return;
    const src = tabs().find((t) => t.id === srcTabId);
    const at = activeTab();
    if (!src || !at) return;
    const srcLeaf = src.root.kind === "leaf" ? src.root : null;
    const target = leaves(at.root).find((l) => l.id === targetLeafId);
    const fillsInPlace = zone === "center" || target?.content === EMPTY_PANE;
    const subtreeFocus = leaves(src.root)[0].id; // first leaf of the moved view
    setTabs((ts) =>
      ts
        .filter((t) => t.id !== srcTabId)
        .map((t) => {
          if (t.id !== activeTabId()) return t;
          if (fillsInPlace) {
            // Replace the target pane in place: a single-pane tab sets the content;
            // a multi-pane tab grafts its whole subtree (so no stray empty/old leaf
            // is left beside it).
            const root = srcLeaf
              ? setContent(t.root, targetLeafId, srcLeaf.content)
              : replaceLeafWithNode(t.root, targetLeafId, src.root);
            return { ...t, root, focusId: srcLeaf ? targetLeafId : subtreeFocus };
          }
          // Edge zone on a non-empty target: split, grafting the source beside it.
          const dir = zone === "up" || zone === "down" ? "col" : "row";
          const nodeFirst = zone === "left" || zone === "up";
          const { root } = splitLeafWithNode(t.root, targetLeafId, dir, src.root, nodeFirst);
          return { ...t, root, focusId: subtreeFocus };
        }),
    );
  };

  // Drop a pane onto another pane within the active tab. Center replaces the target
  // (closing the source); an edge moves/splits. An empty target is filled in place.
  const dropPaneOnPane = (srcLeafId: string, targetLeafId: string, zone: DropZone) => {
    const at = activeTab();
    if (!at || srcLeafId === targetLeafId) return;
    const target = leaves(at.root).find((l) => l.id === targetLeafId);
    if (target?.content === EMPTY_PANE) {
      const dragged = leaves(at.root).find((l) => l.id === srcLeafId);
      const afterClose = dragged ? closeLeaf(at.root, srcLeafId) : null;
      if (!afterClose || !dragged) return;
      updateActiveTab((t) => ({ ...t, root: setContent(afterClose, targetLeafId, dragged.content), focusId: targetLeafId }));
      return;
    }
    const res =
      zone === "center"
        ? replacePaneWithPane(at.root, targetLeafId, srcLeafId)
        : movePane(at.root, srcLeafId, targetLeafId, zone);
    if (res) updateActiveTab((t) => ({ ...t, root: res.root, focusId: res.focusId }));
  };

  // Detach a pane out to a new top-level tab at the strip insertion index, and focus it.
  const detachPaneToTab = (srcTabId: string, leafId: string, index: number) => {
    const res = detachLeafToTab(tabs(), srcTabId, leafId, index);
    if (!res) return;
    setTabs(res.tabs);
    setActiveTabId(res.newTabId);
  };

  const viewDrag = createViewDrag((descriptor: DragDescriptor, target: DropTarget) => {
    if (descriptor.kind === "tab") {
      if (target.kind === "tabstrip") setTabs((ts) => reorderTabs(ts, descriptor.tabId, target.index));
      else dropTabOnPane(descriptor.tabId, target.leafId, target.zone);
    } else {
      if (target.kind === "tabstrip") detachPaneToTab(descriptor.tabId, descriptor.leafId, target.index);
      else dropPaneOnPane(descriptor.leafId, target.leafId, target.zone);
    }
  });
  const drag = viewDrag.state;

  // While dragging a tab, neighbors slide to open a gap at the live drop slot
  // (Chrome-style). Returns the px shift for the chip at `index`; 0 otherwise.
  const draggingTabId = (): string | null => {
    const d = drag();
    return d.active && d.descriptor?.kind === "tab" ? d.descriptor.tabId : null;
  };
  const stripDropIndex = (): number | null => {
    const d = drag();
    return d.active && d.target?.kind === "tabstrip" ? d.target.index : null;
  };
  const tabShift = (index: number): number => {
    const d = drag();
    const dragId = draggingTabId();
    const dropI = stripDropIndex();
    if (!dragId || dropI === null || d.descriptor?.kind !== "tab") return 0;
    const from = tabs().findIndex((t) => t.id === dragId);
    if (from === -1 || index === from) return 0;
    const w = d.descriptor.width;
    if (from < dropI && index > from && index < dropI) return -w;
    if (from > dropI && index >= dropI && index < from) return w;
    return 0;
  };

  // Delete: drop any leaf whose content is the deleted path (or a file beneath a deleted
  // folder), collapsing splits; remove a tab if its tree empties.
  const closeDeleted = (path: string) => {
    const hit = (c: string) => c === path || c.startsWith(path + "/");
    setTabs((ts) => {
      const next: Tab[] = [];
      for (const t of ts) {
        const root = pruneMissing(t.root, (c) => !hit(c));
        if (!root) continue;
        next.push({ ...t, root, focusId: resolveFocus(root, t.focusId) });
      }
      if (!next.some((t) => t.id === activeTabId())) setActiveTabId(next[0]?.id ?? null);
      return next;
    });
  };

  // Rename/move: rewrite matching leaf contents in every tab's tree.
  const renamePath = (from: string, to: string) => {
    const remap = (c: string) =>
      c === from ? to : c.startsWith(from + "/") ? to + c.slice(from.length) : c;
    const walk = (node: PaneNode): PaneNode =>
      node.kind === "leaf"
        ? { ...node, content: remap(node.content) }
        : { ...node, a: walk(node.a), b: walk(node.b) };
    setTabs((ts) => ts.map((t) => ({ ...t, root: walk(t.root) })));
  };


  onMount(() => {
    refreshGraph();
  });

  createEffect(() => {
    const c = lastChange();
    // Skip the initial 0 → don't double-fetch on mount; refreshGraph() above handles startup.
    if (c.version === 0) return;
    // The server tells us when a change actually altered graph connections. A
    // content edit that touched no wikilink/tag (dirty.graph === false) leaves
    // the graph alone — no rebuild, no flicker. Absent `dirty` (poll/reconnect)
    // means "unknown", so we refresh to be safe.
    if (c.dirty?.graph === false) return;
    scheduleGraphRefresh();
  });

  // When entering a brain mode that lacks its dedicated view layout, fetch it on demand.
  // Tracks graph().views too, so it also re-fires when refreshGraph replaces the graph
  // (which drops views) — that self-heals the layout after edits/reconnects.
  createEffect(() => {
    const m = mode();
    const v = graph().views;
    if ((m === "2nd" && !v?.second) || (m === "3rd" && !v?.third)) {
      void ensureViewLayouts();
    }
  });

  onMount(() => {
    refreshAgents();
    const t = setInterval(refreshAgents, 2000); // live agent-network polling
    onCleanup(() => clearInterval(t));
  });
  const registerFileEvents = () => {
    const onOpen = (e: Event) => openFile((e as CustomEvent).detail);
    const onDeleted = (e: Event) => closeDeleted((e as CustomEvent).detail as string);
    const onMoved = (e: Event) => {
      const { from, to } = (e as CustomEvent).detail as { from: string; to: string };
      renamePath(from, to);
    };
    window.addEventListener("oa-open", onOpen);
    window.addEventListener("oa-deleted", onDeleted);
    window.addEventListener("oa-moved", onMoved);
    onCleanup(() => {
      window.removeEventListener("oa-open", onOpen);
      window.removeEventListener("oa-deleted", onDeleted);
      window.removeEventListener("oa-moved", onMoved);
    });
  };

  onMount(registerFileEvents);
  // Global keyboard shortcuts. Every combo is read from settings.keybindings
  // (defaults in core/src/keybindings.ts), matched via matchesKeybinding — none
  // are hardcoded here. These fire even while the editor is focused (CodeMirror
  // doesn't bind these keys); preventDefault suppresses browser print/open/etc.
  const handleGlobalKeydown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const kb = settings.keybindings;

    // Insert template (default Alt+T): don't hijack while typing in a form field
    // (palette search, calendar title, etc.). The note editor is contentEditable,
    // not an INPUT/TEXTAREA, so insertion from a focused note still works.
    if (matchesKeybinding(e, kb["insert-template"])) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        setPalette((p) => (p === "template" ? null : "template"));
      }
      return;
    }
    // Toggle sidebar (default Alt+S): don't hijack while typing in a form field.
    if (matchesKeybinding(e, kb["toggle-sidebar"])) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        toggleSidebar();
      }
      return;
    }
    // Command palette (default Mod+P).
    if (matchesKeybinding(e, kb["command-palette"])) {
      e.preventDefault();
      setPalette((p) => (p === "command" ? null : "command"));
      return;
    }
    // Quick switcher (default Mod+O).
    if (matchesKeybinding(e, kb["quick-switcher"])) {
      e.preventDefault();
      setPalette((p) => (p === "file" ? null : "file"));
      return;
    }
    // Terminal (default Mod+` or Mod+J).
    if (matchesKeybinding(e, kb["terminal"])) {
      e.preventDefault();
      openTerminal();
      return;
    }

    const at = activeTab();
    if (!at) return;

    // Split right (default Mod+D) / split down (default Mod+Shift+D). New pane empty.
    const splitDown = matchesKeybinding(e, kb["split-down"]);
    if (splitDown || matchesKeybinding(e, kb["split-right"])) {
      e.preventDefault();
      const dir = splitDown ? "col" : "row";
      updateActiveTab((t) => {
        const { root, newLeafId } = splitLeaf(t.root, t.focusId, dir, EMPTY_PANE);
        return { ...t, root, focusId: newLeafId };
      });
      return;
    }
    // Equalize panes (default Mod+Alt+=).
    if (matchesKeybinding(e, kb["equalize-panes"])) {
      e.preventDefault();
      updateActiveTab((t) => ({ ...t, root: equalize(t.root) }));
      return;
    }
    // Close pane (default Mod+W).
    if (matchesKeybinding(e, kb["close-pane"])) {
      e.preventDefault();
      closeFocusedPane();
      return;
    }
    // Focus neighboring pane (default Mod+Alt+Arrow).
    const focusDirs: Array<[keyof typeof kb, Dir]> = [
      ["focus-pane-left", "left"],
      ["focus-pane-right", "right"],
      ["focus-pane-up", "up"],
      ["focus-pane-down", "down"],
    ];
    for (const [id, dir] of focusDirs) {
      if (!matchesKeybinding(e, kb[id])) continue;
      e.preventDefault();
      const next = focusNeighbor(at.root, at.focusId, dir);
      if (next) updateActiveTab((t) => ({ ...t, focusId: next }));
      return;
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleGlobalKeydown);
    onCleanup(() => window.removeEventListener("keydown", handleGlobalKeydown));
  });

  // Snap the floating graph onto whichever slot is active (sidebar square when a
  // tab is open, full main pane on an empty tab).
  const placeFloater = () => {
    const slot = anyTabOpen() ? sidebarSlot : mainSlot;
    if (!slot || !floater) return;
    const r = slot.getBoundingClientRect();
    floater.style.top = `${r.top}px`;
    floater.style.left = `${r.left}px`;
    floater.style.width = `${r.width}px`;
    floater.style.height = `${r.height}px`;
  };
  createEffect(() => {
    activeTabId(); // re-place whenever the active tab changes
    tabs().length; // …or when tabs open/close
    sidebarVisible(); // …or when the sidebar is shown/hidden
    activeTabShowsGraph(); // …or when the mini-graph slot un-collapses (graph tab → note tab)
    requestAnimationFrame(placeFloater);
  });
  onMount(() => {
    window.addEventListener("resize", placeFloater);
    onCleanup(() => window.removeEventListener("resize", placeFloater));
  });
  // Keep terminal overlay rects in sync when the body resizes (window resize, divider drag).
  onMount(() => {
    if (!editorBodyEl) return;
    const ro = new ResizeObserver(measureTerminalHosts);
    ro.observe(editorBodyEl);
    onCleanup(() => ro.disconnect());
  });

  // A single-pane tab shows its note name; a split ("omnitab") shows a pane count, since
  // joining every pane name doesn't scale. Terminal tabs get a 1-based index ("Terminal N"),
  // numbered by their position among the open terminal tabs.
  function tabBarLabel(t: Tab): string {
    const ls = leaves(t.root);
    if (ls.length > 1) return `${ls.length} panes`;
    const content = ls[0].content;
    if (content.startsWith(TERMINAL_PREFIX)) {
      const termTabs = tabs().filter((tt) => {
        const tl = leaves(tt.root);
        return tl.length === 1 && tl[0].content.startsWith(TERMINAL_PREFIX);
      });
      return contentLabel(content, termTabs.indexOf(t) + 1);
    }
    return contentLabel(content);
  }

  // Lucide icon name for a tab: a split-pane glyph for "omnitab"s, else the content's icon.
  function tabBarIcon(t: Tab): string | undefined {
    const ls = leaves(t.root);
    if (ls.length > 1) return "Columns2";
    return contentIcon(ls[0].content);
  }

  return (
    <div class="layout" classList={{ "sidebar-hidden": !sidebarVisible() }}>
      <aside class="sidebar" classList={{ hidden: !sidebarVisible() }}>
        <div class="sidebar-icons">
          <For each={settings.toolbar}>
            {(btn) => {
              const cmd = () => commands().get(btn.command);
              return (
                <Show
                  when={cmd()}
                  fallback={
                    <IconButton icon={btn.icon || "CircleHelp"} iconSize={18} disabled label={`Unknown command: ${btn.command}`} />
                  }
                >
                  {(c) => (
                    <IconButton icon={btn.icon} iconSize={18} label={btn.tooltip ?? c().label} onClick={() => c().action()} />
                  )}
                </Show>
              );
            }}
          </For>
        </div>
        <div class="sidebar-files"><FileTree onOpen={openFile} activeFile={focusedContent()} /></div>
        <div class="sidebar-graph" classList={{ collapsed: !anyTabOpen() || activeTabShowsGraph() }} ref={sidebarSlot} />
      </aside>
      <main class="editor-pane">
        <div class="tabbar" data-tabstrip="true">
          <For each={tabs()}>
            {(t, i) => (
              <>
                <Show when={stripDropIndex() === i() && !draggingTabId()}>
                  <div class="tab-caret" />
                </Show>
                <div
                  class={`tab${activeTabId() === t.id ? " active" : ""}`}
                  classList={{ dragging: draggingTabId() === t.id }}
                  data-tab-chip="true"
                  style={{ transform: `translateX(${tabShift(i())}px)` }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).classList.contains("tab-x")) return;
                    viewDrag.startTab(e, t.id, tabBarLabel(t), () => setActiveTabId(t.id));
                  }}
                  onContextMenu={(e) => {
                    const content = t.root.kind === "leaf" ? t.root.content : null;
                    if (!content || !isExportable(content)) return;
                    e.preventDefault();
                    openContextMenu(e.clientX, e.clientY, [
                      { label: "Export…", icon: "Download", onSelect: () => openExport(content) },
                    ], setEditorMenu);
                  }}
                >
                  <Show when={tabBarIcon(t)}>
                    {(icon) => <Icon value={icon()} size={13} />}
                  </Show>
                  <span>{tabBarLabel(t)}</span>
                  <IconButton icon="X" label="Close tab" iconSize={12} onClick={(e) => closeTab(t.id, e)} />
                </div>
              </>
            )}
          </For>
          <Show when={stripDropIndex() === tabs().length && !draggingTabId()}>
            <div class="tab-caret" />
          </Show>
        </div>
        <div class="editor-body" ref={editorBodyEl} style={{ position: "relative" }}>
          <Show when={activeTab()} fallback={<div class="graph-slot-main" ref={mainSlot} />}>
            {(t) => (
              <PaneTree
                node={t().root}
                focusId={t().focusId}
                showHeader={leaves(t().root).length > 1}
                onFocus={(leafId) => updateActiveTab((tab) => ({ ...tab, focusId: leafId }))}
                onResize={(splitId, ratio) =>
                  updateActiveTab((tab) => ({ ...tab, root: setRatio(tab.root, splitId, ratio) }))
                }
                onMenu={(leafId, x, y) => openContextMenu(x, y, paneMenuItems(leafId), setPaneMenu)}
                onClose={closePane}
                onDropFile={dropFileOnPane}
                dragState={drag}
                onStartPaneDrag={(e, leafId, label) => viewDrag.startPane(e, activeTabId()!, leafId, label)}
                // Graph refresh is driven entirely by the server's SSE `dirty`
                // signal now (it knows whether a save changed any connection), so
                // a save itself needs no client-side graph poke.
                onSaved={() => {}}
                onOpen={openFile}
                onOpenQuickSwitcher={() => setPalette("file")}
                onNewTerminal={openTerminal}
                noteNames={noteCandidates}
                tagNames={tagCandidates}
                // A ::graph pane renders the full Knowledge Graph (not the cramped sidebar one).
                renderGraph={() => (
                  <GraphView fill graph={displayGraph()} onOpen={(id) => openFile(id + ".md")} mode={mode()} setMode={setMode} active={focusedContent()} />
                )}
              />
            )}
          </Show>
          {/* Always-mounted terminal overlay — preserves PTY and scrollback across tab/pane switches.
              Each unique terminal content id mounts once. We position it over the matching
              data-terminal-host inside the active tab's pane tree (so terminals in splits live
              within their leaf, not over the whole editor body). When no host exists in the
              active tab the terminal is hidden but stays mounted. */}
          <For each={terminalContents()}>
            {(id) => {
              const rect = () => terminalHostRects().get(id);
              return (
                <div class="terminal-overlay" style={{
                  position: "absolute",
                  left: rect() ? `${rect()!.x}px` : "0",
                  top: rect() ? `${rect()!.y}px` : "0",
                  width: rect() ? `${rect()!.w}px` : "100%",
                  height: rect() ? `${rect()!.h}px` : "100%",
                  display: rect() ? "block" : "none",
                }}>
                  <TerminalTab id={id} active={() => focusedContent() === id} />
                </div>
              );
            }}
          </For>
        </div>
      </main>
      <div class="graph-floater" classList={{ hidden: activeTabShowsGraph() }} ref={floater}>
        <GraphView fill mini={anyTabOpen()} graph={displayGraph()} onOpen={(id) => openFile(id + ".md")} mode={mode()} setMode={setMode} active={focusedContent()} />
      </div>
      <Show when={palette() === "command"}>
        <CommandPalette onClose={() => setPalette(null)} commands={commands()} />
      </Show>
      <Show when={palette() === "file"}>
        <QuickSwitcher onClose={() => setPalette(null)} openFile={openFile} />
      </Show>
      <Show when={palette() === "template"}>
        <TemplatePalette onClose={() => setPalette(null)} title={activeNoteTitle()} />
      </Show>
      <Show when={paneMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            onClose={() => setPaneMenu(null)}
            items={m().items}
          />
        )}
      </Show>
      <Show when={editorMenu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setEditorMenu(null)} />}
      </Show>
      {/* Floating ghost that follows the cursor during a tab/pane drag. pointer-events:none
          so elementFromPoint resolves the drop target beneath it. Width is capped to a
          tab-like size — a pane header spans the whole pane, which looked oversized — and
          the grab offset is clamped to that width so the cursor stays over the ghost. */}
      <Show when={drag().active && drag().descriptor}>
        <div
          class="drag-ghost"
          classList={{ pane: drag().descriptor?.kind === "pane" }}
          style={{
            left: `${drag().x - Math.min(drag().grabDX, Math.min(drag().descriptor?.width ?? 0, GHOST_MAX_W))}px`,
            top: `${drag().y - drag().grabDY}px`,
            width: `${Math.min(drag().descriptor?.width ?? 0, GHOST_MAX_W)}px`,
          }}
        >
          {drag().descriptor?.label}
        </div>
      </Show>
      <ToastHost />
    </div>
  );
}
