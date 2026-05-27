// app/src/App.tsx
import { createSignal, onMount, onCleanup, For, createMemo, createEffect, Show } from "solid-js";
import { api } from "./api";
import { FileTree } from "./FileTree";
import { Editor } from "./Editor";
import { GraphView } from "./GraphView";
import { SettingsPage } from "./SettingsPage";
import { CommandPalette } from "./palette/CommandPalette";
import { QuickSwitcher } from "./palette/QuickSwitcher";
import { settings, FONT_STACKS } from "./settings";
import type { GraphData, ViewLayout } from "../../core/src/graph";
import type { NoteCandidate } from "./editor/wikilink";
import "./App.css";

// Sentinel tab id for the settings page — not a real file path.
const SETTINGS_TAB = "::settings";

// 2nd = vault notes, 3rd = claude-bot memory, both = 2nd+3rd (the full brain),
// agents = the agent network. Agents is exclusive — never shown with the brains.
type GraphMode = "2nd" | "3rd" | "both" | "agents";

function filterByKinds(g: GraphData, kinds: Set<string>): GraphData {
  const nodes = g.nodes.filter((n) => kinds.has(n.kind));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: g.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

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
      case "2nd": return applyView(filterByKinds(graph(), new Set(["self", "note", "tag"])), graph().views?.second);
      case "3rd": return applyView(filterByKinds(graph(), new Set(["self", "memory"])), graph().views?.third);
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
  const closeTab = (path: string, e: Event) => {
    e.stopPropagation();
    setTabs((t) => {
      const i = t.indexOf(path);
      const next = t.filter((p) => p !== path);
      if (active() === path) setActive(next[Math.min(i, next.length - 1)] ?? null);
      return next;
    });
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
    const handler = (e: Event) => openFile((e as CustomEvent).detail);
    window.addEventListener("oa-open", handler);
    onCleanup(() => window.removeEventListener("oa-open", handler));
  });
  // Obsidian-style shortcuts: Cmd/Ctrl+P → command palette, Cmd/Ctrl+O → quick
  // switcher. preventDefault suppresses the browser print/open dialogs. These fire
  // even while the editor is focused (CodeMirror doesn't bind these keys).
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setPalette("command");
      } else if (k === "o") {
        e.preventDefault();
        setPalette("file");
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

  const tabLabel = (p: string) => (p === SETTINGS_TAB ? "⚙ Settings" : p.split("/").pop()!.replace(/\.md$/, ""));

  return (
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-icons">
          <button class="icon-btn" title="Settings" onClick={openSettings}>⚙</button>
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
        <div class="editor-body">
          <Show when={active()} fallback={<div class="graph-slot-main" ref={mainSlot} />}>
            <Show when={active() === SETTINGS_TAB} fallback={<Editor path={active()} onSaved={refreshGraph} noteNames={noteCandidates} tagNames={tagCandidates} />}>
              <SettingsPage />
            </Show>
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
    </div>
  );
}
