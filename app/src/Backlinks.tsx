// app/src/Backlinks.tsx
import { For, createMemo } from "solid-js";
import type { GraphData } from "../../core/src/graph";

export function Backlinks(props: { graph: GraphData; path: string | null; onOpen: (p: string) => void }) {
  const targetId = createMemo(() => (props.path ? props.path.replace(/\.md$/, "") : null));
  const back = createMemo(() => {
    const id = targetId();
    if (!id) return [];
    return props.graph.edges.filter((e) => e.to === id).map((e) => e.from);
  });
  return (
    <div style={{ padding: "8px", "border-top": "1px solid #2a2a2a", flex: "1", overflow: "auto" }}>
      <div style={{ "font-size": "11px", "text-transform": "uppercase", opacity: 0.6 }}>Backlinks</div>
      <For each={back()} fallback={<div style={{ opacity: 0.4 }}>none</div>}>
        {(fromId) => (
          <div style={{ padding: "2px 0", cursor: "pointer" }}
               onClick={() => !fromId.startsWith("mem:") && props.onOpen(fromId + ".md")}>
            {fromId.startsWith("mem:") ? "🧠 " + fromId.slice(4) : fromId}
          </div>
        )}
      </For>
    </div>
  );
}
