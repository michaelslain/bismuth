// app/src/App.tsx
import { createSignal, onMount, onCleanup, For, createMemo, createEffect, Show } from "solid-js";
import { api } from "./api";
import { FileTree } from "./FileTree";
import { GraphView } from "./GraphView";
import { CommandPalette } from "./palette/CommandPalette";
import { QuickSwitcher } from "./palette/QuickSwitcher";
import { settings, FONT_STACKS } from "./settings";
import { lastChange } from "./serverVersion";
import { debounce } from "./debounce";
import { ToastHost, pushToast } from "./Toast";
import { TerminalTab } from "./Terminal";
import { subgraphByKinds, SECOND_BRAIN_KINDS, THIRD_BRAIN_KINDS } from "../../core/src/graph";
import type { GraphData, NodeKind, ViewLayout } from "../../core/src/graph";
import type { NoteCandidate } from "./editor/wikilink";
import { SETTINGS_TAB, CALENDAR_TAB, TASKS_TAB, FLASHCARDS_PREFIX, TERMINAL_PREFIX, EMPTY_PANE, isSentinel, contentLabel } from "./tabIds";
import {
  type Tab, type PaneNode, type Dir, type Rect, makeTab,
  splitLeaf, closeLeaf, equalize, focusNeighbor,
  setContent, setRatio, findLeafByContent, leaves, pruneMissing, movePane,
  serializeTabs, deserializeTabs,
} from "./panes";
import { PaneTree } from "./PaneTree";
import { ContextMenu } from "./ContextMenu";
import "./App.css";

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

export default function App() {
  const [graph, setGraph] = createSignal<GraphData>({ nodes: [], edges: [] });
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
  const [tabs, setTabs] = createSignal<Tab[]>(restored.tabs);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(restored.activeTabId);

  const activeTab = createMemo(() => tabs().find((t) => t.id === activeTabId()) ?? null);
  // True when any tab is open — drives the graph floater's sidebar-vs-main docking.
  const anyTabOpen = createMemo(() => tabs().length > 0);

  // Content id of the currently-focused leaf in the active tab, or null.
  // Drives the terminal overlay's visibility.
  const focusedContent = createMemo<string | null>(() => {
    const t = activeTab();
    if (!t) return null;
    return leaves(t.root).find((l) => l.id === t.focusId)?.content ?? null;
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
  // Which palette overlay is open (Cmd+P / Cmd+O), or null. Only one at a time.
  const [palette, setPalette] = createSignal<"command" | "file" | null>(null);
  // Right-click pane menu: which leaf and where to anchor the menu, or null.
  const [paneMenu, setPaneMenu] = createSignal<{ leafId: string; x: number; y: number } | null>(null);

  // The graph is a single persistent element that morphs between two slots: the
  // sidebar square (when a file/settings tab is active) and the full main pane
  // (when on an empty/new tab). One WebGL context stays alive; we just animate
  // its bounding box between the two slot rectangles.
  let sidebarSlot: HTMLDivElement | undefined;
  let mainSlot: HTMLDivElement | undefined;
  let floater: HTMLDivElement | undefined;

  const refreshGraph = async () => setGraph(await api.graph());
  const refreshAgents = async () => setAgents(await api.agentGraph());

  // The graph is a visualization, not the source of truth — it can update a beat
  // after edits settle. Even with server-side `dirty` gating, a burst of real
  // structural changes can fire several graph-dirty events in quick succession;
  // debouncing collapses them into one rebuild (~100-150ms each) instead of a
  // flicker.
  const scheduleGraphRefresh = debounce(() => { refreshGraph(); }, 300);

  const displayGraph = createMemo<GraphData>(() => {
    const currentMode = mode();
    switch (currentMode) {
      case "2nd":
        return applyView(subgraphByKinds(graph(), SECOND_BRAIN_KINDS), graph().views?.second);
      case "3rd":
        return applyView(subgraphByKinds(graph(), THIRD_BRAIN_KINDS), graph().views?.third);
      case "agents":
        return agents();
      case "both":
        return graph(); // full brain (self + notes + memory + cross-brain edges)
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
  const openSettings = () => openFile(SETTINGS_TAB);
  const openCalendar = () => openFile(CALENDAR_TAB);
  const openTasks = () => openFile(TASKS_TAB);
  const openTerminal = () => openFile(TERMINAL_PREFIX + crypto.randomUUID());
  // Review the flashcards in whichever note is focused in the active tab.
  const reviewCurrentNote = () => {
    const at = activeTab();
    const cur = at ? leaves(at.root).find((l) => l.id === at.focusId)?.content : null;
    if (cur && !isSentinel(cur)) openFile(FLASHCARDS_PREFIX + cur);
    else pushToast("Open a note to review its flashcards");
  };

  // Apply Appearance settings to the document: theme + accent + editor font/size,
  // surfaced as CSS variables that App.css and the editor theme read.
  createEffect(() => {
    const a = settings.appearance;
    const root = document.documentElement;
    root.setAttribute("data-theme", a.theme);
    root.style.setProperty("--accent", a.accent);
    root.style.setProperty("--editor-font", FONT_STACKS[a.editorFont] ?? a.editorFont);
    root.style.setProperty("--editor-font-size", a.editorFontSize + "px");
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
    const ls = leaves(nextRoot);
    const focusId = ls.some((l) => l.id === at.focusId) ? at.focusId : ls[0].id;
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

  // Drag a pane by its header onto another pane to rearrange the layout. If the target
  // is an empty placeholder, fill it with the dragged pane's content (no split) and
  // collapse the source's slot.
  const handleMovePane = (targetId: string, draggedId: string, dir: Dir) => {
    const at = activeTab();
    if (!at) return;
    if (draggedId === targetId) return;
    const target = leaves(at.root).find((l) => l.id === targetId);
    if (target?.content === EMPTY_PANE) {
      const dragged = leaves(at.root).find((l) => l.id === draggedId);
      if (!dragged) return;
      const afterClose = closeLeaf(at.root, draggedId);
      if (!afterClose) return;
      const filled = setContent(afterClose, targetId, dragged.content);
      updateActiveTab((t) => ({ ...t, root: filled, focusId: targetId }));
      return;
    }
    const result = movePane(at.root, draggedId, targetId, dir);
    if (!result) return;
    updateActiveTab((t) => ({ ...t, root: result.root, focusId: result.focusId }));
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
        const ls = leaves(root);
        const focusId = ls.some((l) => l.id === t.focusId) ? t.focusId : ls[0].id;
        next.push({ ...t, root, focusId });
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
  // Obsidian-style shortcuts: Cmd/Ctrl+P → command palette, Cmd/Ctrl+O → quick
  // switcher. preventDefault suppresses the browser print/open dialogs. These fire
  // even while the editor is focused (CodeMirror doesn't bind these keys).
  const handleGlobalKeydown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const hasMod = e.metaKey || e.ctrlKey;
    if (!hasMod) return;
    const k = e.key.toLowerCase();
    const hasAlt = e.altKey;
    const hasShift = e.shiftKey;

    // Palette toggle: Cmd+P for command palette
    if (!hasAlt && !hasShift && k === "p") {
      e.preventDefault();
      setPalette((p) => (p === "command" ? null : "command"));
      return;
    }
    // File switcher: Cmd+O for quick switcher
    if (!hasAlt && !hasShift && k === "o") {
      e.preventDefault();
      setPalette((p) => (p === "file" ? null : "file"));
      return;
    }
    // Terminal: Cmd+` or Cmd+J
    if (!hasAlt && !hasShift && (k === "`" || k === "j")) {
      e.preventDefault();
      openTerminal();
      return;
    }

    const at = activeTab();
    if (!at) return;

    // Split: Cmd+D (right) or Cmd+Shift+D (down). New pane starts empty.
    if (!hasAlt && k === "d") {
      e.preventDefault();
      const dir = hasShift ? "col" : "row";
      updateActiveTab((t) => {
        const { root, newLeafId } = splitLeaf(t.root, t.focusId, dir, EMPTY_PANE);
        return { ...t, root, focusId: newLeafId };
      });
      return;
    }
    // Equalize: Cmd+Alt+=
    if (hasAlt && (k === "=" || k === "+")) {
      e.preventDefault();
      updateActiveTab((t) => ({ ...t, root: equalize(t.root) }));
      return;
    }
    // Close pane: Cmd+W
    if (!hasAlt && !hasShift && k === "w") {
      e.preventDefault();
      closeFocusedPane();
      return;
    }
    // Focus neighbor: Cmd+Alt+Arrow keys
    if (hasAlt) {
      const dirMap: Record<string, Dir> = {
        arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down",
      };
      const dir = dirMap[k];
      if (dir) {
        e.preventDefault();
        const next = focusNeighbor(at.root, at.focusId, dir);
        if (next) updateActiveTab((t) => ({ ...t, focusId: next }));
      }
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
    if (ls.length > 1) return `⊞ ${ls.length} panes`;
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

  return (
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-icons">
          <button class="icon-btn" title="New note" onClick={() => window.dispatchEvent(new CustomEvent("oa-new", { detail: { kind: "file" } }))}>📄</button>
          <button class="icon-btn" title="New folder" onClick={() => window.dispatchEvent(new CustomEvent("oa-new", { detail: { kind: "dir" } }))}>🗂️</button>
          <button class="icon-btn" title="Review this note's flashcards" onClick={reviewCurrentNote}>🃏</button>
          <button class="icon-btn" title="Settings" onClick={openSettings}>⚙</button>
          <button class="icon-btn" title="Calendar" onClick={openCalendar}>📅</button>
          <button class="icon-btn" title="Tasks" onClick={openTasks}>✓</button>
          <button class="icon-btn" title="Open terminal" onClick={openTerminal}>{">_"}</button>
        </div>
        <div class="sidebar-files"><FileTree onOpen={openFile} /></div>
        <div class="sidebar-graph" classList={{ collapsed: !anyTabOpen() }} ref={sidebarSlot} />
      </aside>
      <main class="editor-pane">
        <div class="tabbar">
          <For each={tabs()}>
            {(t) => (
              <div
                class={`tab${activeTabId() === t.id ? " active" : ""}`}
                onClick={() => setActiveTabId(t.id)}
              >
                <span>{tabBarLabel(t)}</span>
                <span class="tab-x" onClick={(e) => closeTab(t.id, e)}>×</span>
              </div>
            )}
          </For>
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
                onMenu={(leafId, x, y) => setPaneMenu({ leafId, x, y })}
                onClose={closePane}
                onDropFile={dropFileOnPane}
                onMovePane={handleMovePane}
                // Graph refresh is driven entirely by the server's SSE `dirty`
                // signal now (it knows whether a save changed any connection), so
                // a save itself needs no client-side graph poke.
                onSaved={() => {}}
                onOpen={openFile}
                onOpenQuickSwitcher={() => setPalette("file")}
                onNewTerminal={openTerminal}
                noteNames={noteCandidates}
                tagNames={tagCandidates}
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
                <div style={{
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
      <div class="graph-floater" ref={floater}>
        <GraphView fill graph={displayGraph()} onOpen={(id) => openFile(id + ".md")} mode={mode()} setMode={setMode} active={focusedContent()} />
      </div>
      <Show when={palette() === "command"}>
        <CommandPalette onClose={() => setPalette(null)} openSettings={openSettings} openTerminal={openTerminal} setMode={(m) => setMode(m)} />
      </Show>
      <Show when={palette() === "file"}>
        <QuickSwitcher onClose={() => setPalette(null)} openFile={openFile} />
      </Show>
      <Show when={paneMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            onClose={() => setPaneMenu(null)}
            items={[
              { label: "Split right", onSelect: () => splitPane(m().leafId, "row") },
              { label: "Split down", onSelect: () => splitPane(m().leafId, "col") },
              { label: "Close pane", danger: true, onSelect: () => closePane(m().leafId) },
            ]}
          />
        )}
      </Show>
      <ToastHost />
    </div>
  );
}
