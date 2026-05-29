// app/src/App.tsx
import { createSignal, onMount, onCleanup, For, createMemo, createEffect, Show, Switch, Match } from "solid-js";
import { api } from "./api";
import { FileTree } from "./FileTree";
import { Editor } from "./Editor";
import { GraphView } from "./GraphView";
import { SettingsPage } from "./SettingsPage";
import { CalendarPage } from "./calendar/CalendarPage";
import { TasksPage } from "./TasksPage";
import { Flashcards } from "./Flashcards";
import { BaseView } from "./bases/BaseView";
import { CommandPalette } from "./palette/CommandPalette";
import { QuickSwitcher } from "./palette/QuickSwitcher";
import { settings, FONT_STACKS } from "./settings";
import { ToastHost, pushToast } from "./Toast";
import { TerminalTab } from "./Terminal";
import { subgraphByKinds, SECOND_BRAIN_KINDS, THIRD_BRAIN_KINDS } from "../../core/src/graph";
import type { GraphData, NodeKind, ViewLayout } from "../../core/src/graph";
import type { NoteCandidate } from "./editor/wikilink";
import "./App.css";

// Sentinel tab id for the settings page — not a real file path.
const SETTINGS_TAB = "::settings";
const CALENDAR_TAB = "::calendar";
// Sentinel tab id for the tasks page — not a real file path.
const TASKS_TAB = "::tasks";
// Tab id prefix for a per-note flashcard review screen: FLASHCARDS_PREFIX + "<note path>".
// Each reviewed note gets its own tab; no real note path begins with "::".
const FLASHCARDS_PREFIX = "::flashcards:";
// Tab id prefix for embedded terminal sessions: TERMINAL_PREFIX + "<uuid>".
const TERMINAL_PREFIX = "::term:";

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
  const [tabs, setTabs] = createSignal<string[]>([]);
  const [active, setActive] = createSignal<string | null>(null);
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

  const openFile = (path: string) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActive(path);
  };
  const openSettings = () => openFile(SETTINGS_TAB);
  const openCalendar = () => openFile(CALENDAR_TAB);
  const openTasks = () => openFile(TASKS_TAB);
  const openTerminal = () => openFile(TERMINAL_PREFIX + crypto.randomUUID());
  // Review the flashcards in whichever note is currently active (its own tab).
  const reviewCurrentNote = () => {
    const a = active();
    if (a && !a.startsWith("::")) openFile(FLASHCARDS_PREFIX + a);
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
  const closePath = (path: string) => {
    setTabs((t) => {
      const i = t.indexOf(path);
      if (i === -1) return t;
      const next = t.filter((p) => p !== path);
      if (active() === path) setActive(next[Math.min(i, next.length - 1)] ?? null);
      return next;
    });
  };
  const closeTab = (path: string, e: Event) => {
    e.stopPropagation();
    closePath(path);
  };

  // Reconcile open tabs when files change in the tree.
  // Delete: close the tab (and any open file beneath a deleted folder).
  const closeDeleted = (path: string) => {
    for (const p of [...tabs()]) if (p === path || p.startsWith(path + "/")) closePath(p);
  };
  // Rename/move: rewrite the open tab's path (handles files moved inside a renamed folder too).
  const renamePath = (from: string, to: string) => {
    const remap = (p: string) =>
      p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : p;
    setTabs((t) => t.map(remap));
    setActive((a) => (a ? remap(a) : a));
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
      if (e.repeat) return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setPalette((p) => (p === "command" ? null : "command"));
      } else if (k === "o") {
        e.preventDefault();
        setPalette((p) => (p === "file" ? null : "file"));
      } else if (k === "`" || k === "j") {
        e.preventDefault();
        openTerminal();
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  // Snap the floating graph onto whichever slot is active (sidebar square when a
  // tab is open, full main pane on an empty tab).
  const placeFloater = () => {
    const slot = active() ? sidebarSlot : mainSlot;
    if (!slot || !floater) return;
    const r = slot.getBoundingClientRect();
    floater.style.top = `${r.top}px`;
    floater.style.left = `${r.left}px`;
    floater.style.width = `${r.width}px`;
    floater.style.height = `${r.height}px`;
  };
  createEffect(() => {
    active(); // re-place whenever the active tab changes
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
    if (p.startsWith(TERMINAL_PREFIX)) {
      const termTabs = tabs().filter((t) => t.startsWith(TERMINAL_PREFIX));
      const idx = termTabs.indexOf(p);
      return `>_ Terminal ${idx + 1}`;
    }
    return noteNameOf(p);
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
        <div class="sidebar-graph" classList={{ collapsed: !active() }} ref={sidebarSlot} />
      </aside>
      <main class="editor-pane">
        <div class="tabbar">
          <For each={tabs()}>
            {(p) => (
              <div class={`tab${active() === p ? " active" : ""}`} onClick={() => setActive(p)}>
                <span>{tabLabel(p)}</span>
                <span class="tab-x" onClick={(e) => closeTab(p, e)}>×</span>
              </div>
            )}
          </For>
        </div>
        <div class="editor-body" style={{ position: "relative" }}>
          <Show when={active()} fallback={<div class="graph-slot-main" ref={mainSlot} />}>
            {(a) => (
              <Switch fallback={<Editor path={a()} onSaved={refreshGraph} noteNames={noteCandidates} tagNames={tagCandidates} />}>
                <Match when={a().startsWith(FLASHCARDS_PREFIX)}>
                  <Flashcards note={a().slice(FLASHCARDS_PREFIX.length)} />
                </Match>
                <Match when={a() === CALENDAR_TAB}>
                  <CalendarPage />
                </Match>
                <Match when={a() === SETTINGS_TAB}>
                  <SettingsPage />
                </Match>
                <Match when={a() === TASKS_TAB}>
                  <TasksPage onOpen={openFile} />
                </Match>
                <Match when={a().endsWith(".base")}>
                  <BaseView path={a()} onOpen={openFile} />
                </Match>
                <Match when={a().startsWith(TERMINAL_PREFIX)}>
                  {/* Empty placeholder. Actual terminal rendering lives in the always-mounted
                      overlay below so WebSockets and scrollback survive tab switches. */}
                  <></>
                </Match>
              </Switch>
            )}
          </Show>
          {/* Always-mounted terminal overlay — preserves PTY and scrollback across tab switches. */}
          <For each={tabs().filter((t) => t.startsWith(TERMINAL_PREFIX))}>
            {(id) => (
              <div style={{
                position: "absolute",
                inset: 0,
                display: active() === id ? "block" : "none",
              }}>
                <TerminalTab id={id} active={() => active() === id} />
              </div>
            )}
          </For>
        </div>
      </main>
      <div class="graph-floater" ref={floater}>
        <GraphView fill graph={displayGraph()} onOpen={(id) => openFile(id + ".md")} mode={mode()} setMode={setMode} />
      </div>
      <Show when={palette() === "command"}>
        <CommandPalette onClose={() => setPalette(null)} openSettings={openSettings} openTerminal={openTerminal} setMode={(m) => setMode(m)} />
      </Show>
      <Show when={palette() === "file"}>
        <QuickSwitcher onClose={() => setPalette(null)} openFile={openFile} />
      </Show>
      <ToastHost />
    </div>
  );
}
