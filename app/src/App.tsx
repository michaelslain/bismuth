// app/src/App.tsx
import { createSignal, onMount, onCleanup, For, createMemo } from "solid-js";
import { api } from "./api";
import { FileTree } from "./FileTree";
import { Editor } from "./Editor";
import { GraphView } from "./GraphView";
import type { GraphData } from "../../core/src/graph";
import "./App.css";

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

  const openFile = (path: string) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActive(path);
  };
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
    const t = setInterval(refreshGraph, 3000); // pick up external/agent writes live
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

  const tabLabel = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");

  return (
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-files"><FileTree onOpen={openFile} /></div>
        <div class="sidebar-graph">
          <GraphView graph={displayGraph()} onOpen={(id) => openFile(id + ".md")} mode={mode()} setMode={setMode} />
        </div>
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
        <div class="editor-body"><Editor path={active()} onSaved={refreshGraph} /></div>
      </main>
    </div>
  );
}
