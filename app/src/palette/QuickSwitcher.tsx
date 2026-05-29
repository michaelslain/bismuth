// app/src/palette/QuickSwitcher.tsx
// Cmd+O — fuzzy-search vault files and open one. Thin wrapper over PaletteModal that
// loads the file list from /tree on open and opens the chosen file (then closes).
import { createSignal, onMount } from "solid-js";
import { PaletteModal, type PaletteItem } from "./PaletteModal";
import { api } from "../api";
import type { TreeEntry } from "../../../core/src/graph";

type Props = {
  onClose: () => void;
  openFile: (path: string) => void;
};

// Files must end in .md (excludes folders in /tree entries with `kind`).
function isFile(e: TreeEntry & { kind?: string }): boolean {
  return e.kind !== "dir" && e.path.endsWith(".md");
}

function toItem(e: TreeEntry): PaletteItem {
  const parts = e.path.split("/");
  const name = parts.pop()!.replace(/\.md$/, "");
  return { id: e.path, label: name, sublabel: parts.join("/") || undefined, icon: e.icon };
}

export function QuickSwitcher(props: Props) {
  const [items, setItems] = createSignal<PaletteItem[]>([]);
  const [failed, setFailed] = createSignal(false);

  onMount(async (): Promise<void> => {
    try {
      const tree = await api.tree();
      setItems(tree.filter(isFile).map(toItem));
    } catch {
      setFailed(true);
    }
  });

  return (
    <PaletteModal
      placeholder="Find a note..."
      items={items()}
      emptyText={failed() ? "Failed to load files" : "No files"}
      onClose={props.onClose}
      onSelect={(item) => {
        props.openFile(item.id);
        props.onClose();
      }}
    />
  );
}
