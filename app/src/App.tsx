// app/src/App.tsx
import { createSignal, onMount, onCleanup, For, createMemo, createEffect, Show } from "solid-js";
import { api } from "./api";
import { FileTree } from "./FileTree";
import { GraphView } from "./GraphView";
import { CommandPalette } from "./palette/CommandPalette";
import { QuickSwitcher } from "./palette/QuickSwitcher";
import { settings, FONT_STACKS } from "./settings";
import { ToastHost, pushToast } from "./Toast";
import { subgraphByKinds, SECOND_BRAIN_KINDS, THIRD_BRAIN_KINDS } from "../../core/src/graph";
import type { GraphData, NodeKind, ViewLayout } from "../../core/src/graph";
import type { NoteCandidate } from "./editor/wikilink";
import { SETTINGS_TAB, CALENDAR_TAB, TASKS_TAB, FLASHCARDS_PREFIX, isSentinel } from "./tabIds";
import {
  type Tab, type PaneNode, type Dir, makeTab,
  splitLeaf, closeLeaf, equalize, focusNeighbor,
  setContent, setRatio, findLeafByContent, leaves, pruneMissing,
} from "./panes";
import { PaneTree } from "./PaneTree";
import "./App.css";

// 2nd = vault notes, 3rd = claude-bot memory, both = 2nd+3rd (the full brain),
// agents = the agent network. Agents is exclusive — never shown with the brains.
type GraphMode = "2nd" | "3rd" | "both" | "agents";

// Overwrite each node's position with the brain VIEW's self-contained layout (computed by the
// backend over just this subset). Without this, 2nd/3rd would draw nodes at their full-graph
// coordinates — stranding cross-brain-linked nodes far from their cluster.
function applyView(g: GraphData, view: ViewLayout | undefined): GraphData {
  if (!view) return g;
  return {
    edges: g.edges,
    nodes: g.nodes.map((n) => {
      const p3 = view.pos3d[n.id];
      const p2 = view.pos2d[n.id];
      return { ...n, position: p3 ?? n.position, position2d: p2 ?? n.position2d };
    }),
  };
}

export default function App() {
  const [graph, setGraph] = createSignal<GraphData>({ nodes: [], edges: [] });
  const [agents, setAgents] = createSignal<GraphData>({ nodes: [], edges: [] });
  const [mode, setMode] = createSignal<GraphMode>("both");
  const [tabs, setTabs] = createSignal<Tab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null);

  const activeTab = createMemo(() => tabs().find((t) => t.id === activeTabId()) ?? null);
  // True when any tab is open — drives the graph floater's sidebar-vs-main docking.
  const anyTabOpen = createMemo(() => tabs().length > 0);

  const updateActiveTab = (fn: (t: Tab) => Tab) =>
    setTabs((ts) => ts.map((t) => (t.id === activeTabId() ? fn(t) : t)));
  // Which palette overlay is open (Cmd+P / Cmd+O), or null. Only one at a time.
  const [palette, setPalette] = createSignal<"command" | "file" | null>(null);

  // The graph is a single persistent element that morphs between two slots: the
  // sidebar square (when a file/settings tab is active) and the full main pane
  // (when on an empty/new tab). One WebGL context stays alive; we just animate
  // its bounding box between the two slot rectangles.
  let sidebarSlot: HTMLDivElement | undefined;
  let mainSlot: HTMLDivElement | undefined;
  let floater: HTMLDivElement | undefined;

  const refreshGraph = async () => setGraph(await api.graph());
  const refreshAgents = async () => setAgents(await api.agentGraph());

  const displayGraph = createMemo<GraphData>(() => {
    switch (mode()) {
      case "2nd": return applyView(subgraphByKinds(graph(), SECOND_BRAIN_KINDS), graph().views?.second);
      case "3rd": return applyView(subgraphByKinds(graph(), THIRD_BRAIN_KINDS), graph().views?.third);
      case "agents": return agents();
      default: return graph(); // "both" = full brain (self + notes + memory + cross-brain edges)
    }
  });

  const noteCandidates = createMemo<NoteCandidate[]>(() =>
    graph().nodes.filter((n) => n.kind === "note").map((n) => ({ label: n.label, folder: n.folder })),
  );

  const tagCandidates = createMemo<string[]>(() =>
    graph().nodes.filter((n) => n.kind === "tag").map((n) => n.label.replace(/^#/, "")),
  );

  // Open a content id. Single-pane active tab → new tab (today's behavior). Multi-pane
  // active tab → load into the focused pane. If already visible in the active tab, focus it.
  const openFile = (path: string) => {
    const at = activeTab();
    if (at && leaves(at.root).length > 1) {
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

  // Close the focused pane of the active tab. Collapses its parent split; if it was the
  // last pane in the tab, the tab itself closes.
  const closeFocusedPane = () => {
    const at = activeTab();
    if (!at) return;
    const nextRoot = closeLeaf(at.root, at.focusId);
    if (nextRoot === null) {
      closeTabById(at.id);
      return;
    }
    const focusId = leaves(nextRoot)[0].id;
    updateActiveTab((t) => ({ ...t, root: nextRoot, focusId }));
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
    let lastVersion = -1; // sentinel: force fetch on first version check
    const t = setInterval(async () => {
      try {
        const { version } = await api.version();
        if (version !== lastVersion) {
          lastVersion = version;
          await refreshGraph();
        }
      } catch {
        // network hiccup — skip this tick
      }
    }, 3000); // poll version only; fetch graph only when changed
    onCleanup(() => clearInterval(t));
  });
  onMount(() => {
    refreshAgents();
    const t = setInterval(refreshAgents, 2000); // live agent-network polling
    onCleanup(() => clearInterval(t));
  });
  onMount(() => {
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
  });
  // Obsidian-style shortcuts: Cmd/Ctrl+P → command palette, Cmd/Ctrl+O → quick
  // switcher. preventDefault suppresses the browser print/open dialogs. These fire
  // even while the editor is focused (CodeMirror doesn't bind these keys).
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();

      // Palette / quick-switcher (no other modifiers).
      if (!e.altKey && !e.shiftKey && k === "p") {
        e.preventDefault();
        setPalette((p) => (p === "command" ? null : "command"));
        return;
      }
      if (!e.altKey && !e.shiftKey && k === "o") {
        e.preventDefault();
        setPalette((p) => (p === "file" ? null : "file"));
        return;
      }

      const at = activeTab();
      if (!at) return;

      // Cmd+D split right, Cmd+Shift+D split down.
      if (!e.altKey && k === "d") {
        e.preventDefault();
        const dir = e.shiftKey ? "col" : "row";
        updateActiveTab((t) => {
          const { root, newLeafId } = splitLeaf(t.root, t.focusId, dir);
          return { ...t, root, focusId: newLeafId };
        });
        return;
      }
      // Cmd+Alt+= equalize.
      if (e.altKey && (k === "=" || k === "+")) {
        e.preventDefault();
        updateActiveTab((t) => ({ ...t, root: equalize(t.root) }));
        return;
      }
      // Cmd+W close focused pane (collapse parent; if last pane, close tab).
      if (!e.altKey && !e.shiftKey && k === "w") {
        e.preventDefault();
        closeFocusedPane();
        return;
      }
      // Cmd+Alt+arrows focus neighbor.
      if (e.altKey) {
        const dirMap: Record<string, Dir> = {
          arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down",
        };
        const dir = dirMap[k];
        if (dir) {
          e.preventDefault();
          const next = focusNeighbor(at.root, at.focusId, dir);
          if (next) updateActiveTab((t) => ({ ...t, focusId: next }));
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
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

  const SENTINEL_LABELS: Record<string, string> = {
    [SETTINGS_TAB]: "⚙ Settings",
    [CALENDAR_TAB]: "📅 Calendar",
    [TASKS_TAB]: "✓ Tasks",
  };

  function noteNameOf(path: string): string {
    return path.split("/").pop()!.replace(/\.md$/, "");
  }

  function tabLabel(p: string): string {
    if (SENTINEL_LABELS[p]) return SENTINEL_LABELS[p];
    if (p.startsWith(FLASHCARDS_PREFIX)) return "🃏 " + noteNameOf(p.slice(FLASHCARDS_PREFIX.length));
    return noteNameOf(p);
  }

  // The content shown on a tab's label: its focused leaf's content, falling back to the
  // first leaf. Keeps the tab title meaningful even when the tab is split.
  function primaryContentOf(t: Tab): string {
    const ls = leaves(t.root);
    return ls.find((l) => l.id === t.focusId)?.content ?? ls[0].content;
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
                <span>{tabLabel(primaryContentOf(t))}</span>
                <span class="tab-x" onClick={(e) => closeTab(t.id, e)}>×</span>
              </div>
            )}
          </For>
        </div>
        <div class="editor-body">
          <Show when={activeTab()} fallback={<div class="graph-slot-main" ref={mainSlot} />}>
            {(t) => (
              <PaneTree
                node={t().root}
                focusId={t().focusId}
                onFocus={(leafId) => updateActiveTab((tab) => ({ ...tab, focusId: leafId }))}
                onResize={(splitId, ratio) =>
                  updateActiveTab((tab) => ({ ...tab, root: setRatio(tab.root, splitId, ratio) }))
                }
                onSaved={refreshGraph}
                onOpen={openFile}
                noteNames={noteCandidates}
                tagNames={tagCandidates}
              />
            )}
          </Show>
        </div>
      </main>
      <div class="graph-floater" ref={floater}>
        <GraphView fill graph={displayGraph()} onOpen={(id) => openFile(id + ".md")} mode={mode()} setMode={setMode} />
      </div>
      <Show when={palette() === "command"}>
        <CommandPalette onClose={() => setPalette(null)} openSettings={openSettings} setMode={(m) => setMode(m)} />
      </Show>
      <Show when={palette() === "file"}>
        <QuickSwitcher onClose={() => setPalette(null)} openFile={openFile} />
      </Show>
      <ToastHost />
    </div>
  );
}
