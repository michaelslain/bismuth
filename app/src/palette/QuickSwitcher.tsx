// app/src/palette/QuickSwitcher.tsx
// Cmd+O — fuzzy-search vault files and open one. Thin wrapper over PaletteModal that
// renders the file list off the pre-warmed, SSE-synced `vaultTree` cache (so the list
// shows instantly with no empty/stale flash on open) and opens the chosen file (then closes).
import { createMemo } from "solid-js";
import { PaletteModal, type PaletteItem } from "./PaletteModal";
import { contentLabel, contentIcon } from "../tabIds";
import { vaultTree, refreshVaultTree } from "../treeStore";
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
  // Derive items reactively from the pre-warmed cache: the list paints immediately
  // off the last-known tree (no per-open fetch), and re-renders if a refresh lands.
  const items = createMemo<PaletteItem[]>(() => vaultTree().filter(isFile).map(toItem));

  // Still kick a refresh on open so a missed SSE corrects fast — but we render the
  // cache right now rather than waiting on it (the await would re-introduce the flash).
  void refreshVaultTree();

  return (
    <PaletteModal
      placeholder="Find a file..."
      items={items()}
      // Empty almost always means the cache hasn't warmed yet (cold boot) rather than a
      // truly empty vault, so frame it as loading; the kicked refresh fills it in.
      emptyText="Loading files…"
      onClose={props.onClose}
      onSelect={(item) => {
        props.openFile(item.id);
        props.onClose();
      }}
    />
  );
}
