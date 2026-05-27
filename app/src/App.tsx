// app/src/App.tsx
import { createSignal, onMount, onCleanup, For, createMemo, createEffect, Show } from "solid-js";
import { api } from "./api";
import { FileTree } from "./FileTree";
import { Editor } from "./Editor";
import { GraphView } from "./GraphView";
import { SettingsPage } from "./SettingsPage";
import { settings, FONT_STACKS } from "./settings";
import { ToastHost } from "./Toast";
import type { GraphData } from "../../core/src/graph";
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

export default function App() {
  const [graph, setGraph] = createSignal<GraphData>({ nodes: [], edges: [] });
  const [agents, setAgents] = createSignal<GraphData>({ nodes: [], edges: [] });
  const [mode, setMode] = createSignal<GraphMode>("both");
  const [tabs, setTabs] = createSignal<string[]>([]);
  const [active, setActive] = createSignal<string | null>(null);

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
      case "2nd": return filterByKinds(graph(), new Set(["self", "note", "tag"]));
      case "3rd": return filterByKinds(graph(), new Set(["self", "memory"]));
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
          <button class="icon-btn" title="New note" onClick={() => window.dispatchEvent(new CustomEvent("oa-new", { detail: { kind: "file" } }))}>📄</button>
          <button class="icon-btn" title="New folder" onClick={() => window.dispatchEvent(new CustomEvent("oa-new", { detail: { kind: "dir" } }))}>🗂️</button>
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
      <ToastHost />
    </div>
  );
}
