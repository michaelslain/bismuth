// app/src/App.tsx
import { createSignal, onMount, onCleanup } from "solid-js";
import { api } from "./api";
import { FileTree } from "./FileTree";
import { Editor } from "./Editor";
import { GraphView } from "./GraphView";
import type { GraphData } from "../../core/src/graph";
import "./App.css";

export default function App() {
  const [graph, setGraph] = createSignal<GraphData>({ nodes: [], edges: [] });
  const [openPath, setOpenPath] = createSignal<string | null>(null);

  const refreshGraph = async () => setGraph(await api.graph());
  onMount(() => {
    refreshGraph();
    // poll so external/agent writes to the vault or memory show up live (Stone-1 stand-in for fs-watch)
    const t = setInterval(refreshGraph, 3000);
    onCleanup(() => clearInterval(t));
  });

  onMount(() => {
    const handler = (e: Event) => setOpenPath((e as CustomEvent).detail);
    window.addEventListener("oa-open", handler);
    onCleanup(() => window.removeEventListener("oa-open", handler));
  });

  return (
    <div class="layout">
      <aside class="sidebar"><FileTree onOpen={setOpenPath} /></aside>
      <main class="editor"><Editor path={openPath()} onSaved={refreshGraph} /></main>
      <aside class="right">
        <GraphView graph={graph()} onOpen={(id) => setOpenPath(id + ".md")} />
      </aside>
    </div>
  );
}
