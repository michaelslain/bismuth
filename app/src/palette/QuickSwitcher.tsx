// app/src/palette/QuickSwitcher.tsx
// Cmd+O — fuzzy-search vault files and open one. Thin wrapper over PaletteModal that
// loads the file list from /tree on open and opens the chosen file (then closes).
import { createSignal, onMount } from "solid-js";
import { PaletteModal, type PaletteItem } from "./PaletteModal";
import { api } from "../api";
import { contentLabel, contentIcon } from "../tabIds";
import type { TreeEntry } from "../../../core/src/graph";

type Props = {
  onClose: () => void;
  openFile: (path: string) => void;
};

// Every openable vault file — notes plus the "app" docs (settings.yaml, spreadsheets,
// drawings). Folders (`kind === "dir"`) are excluded. settings.yaml lives here so cmd+O
// can reach the settings page; .sheet/.draw so the switcher finds them too.
const OPENABLE_EXTS = [".md", ".yaml", ".yml", ".sheet", ".draw"];
function isFile(e: TreeEntry & { kind?: string }): boolean {
  return e.kind !== "dir" && OPENABLE_EXTS.some((ext) => e.path.endsWith(ext));
}

// Reuse the tab seam so the switcher row matches the tab/pane label + icon exactly:
// settings.yaml → "settings" with a gear, apps get their type icon, notes their own icon.
function toItem(e: TreeEntry): PaletteItem {
  const parts = e.path.split("/");
  parts.pop();
  return {
    id: e.path,
    label: contentLabel(e.path),
    sublabel: parts.join("/") || undefined,
    icon: contentIcon(e.path) ?? e.icon,
  };
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
      placeholder="Find a file..."
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
