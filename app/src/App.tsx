// app/src/App.tsx
import { createSignal, onMount, onCleanup, For } from "solid-js";
import { api } from "./api";
import { FileTree } from "./FileTree";
import { Editor } from "./Editor";
import { GraphView } from "./GraphView";
import type { GraphData } from "../../core/src/graph";
import "./App.css";

export default function App() {
  const [graph, setGraph] = createSignal<GraphData>({ nodes: [], edges: [] });
  const [tabs, setTabs] = createSignal<string[]>([]);
  const [active, setActive] = createSignal<string | null>(null);

  const refreshGraph = async () => setGraph(await api.graph());

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
    const handler = (e: Event) => openFile((e as CustomEvent).detail);
    window.addEventListener("oa-open", handler);
    onCleanup(() => window.removeEventListener("oa-open", handler));
  });

  const tabLabel = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");

  return (
    <div class="layout">
      <aside class="sidebar"><FileTree onOpen={openFile} /></aside>
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
      <aside class="right">
        <GraphView graph={graph()} onOpen={(id) => openFile(id + ".md")} />
      </aside>
    </div>
  );
}
