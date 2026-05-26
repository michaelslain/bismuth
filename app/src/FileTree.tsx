// app/src/FileTree.tsx
import { createResource, For } from "solid-js";
import { api } from "./api";

export function FileTree(props: { onOpen: (path: string) => void }) {
  const [files] = createResource(() => api.tree());
  return (
    <div>
      <div style={{ "font-size": "11px", "text-transform": "uppercase", opacity: 0.6 }}>Vault</div>
      <For each={files() ?? []}>
        {(rel) => (
          <div style={{ padding: "2px 4px", cursor: "pointer" }} onClick={() => props.onOpen(rel)}>
            {rel.replace(/\.md$/, "")}
          </div>
        )}
      </For>
    </div>
  );
}
