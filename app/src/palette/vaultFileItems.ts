// app/src/palette/vaultFileItems.ts
// The vault → openable-file list that backs the Cmd+O switcher. Derives PaletteItems from
// the pre-warmed, SSE-synced `vaultTree` cache (so the list shows instantly with no empty/
// stale flash), reusing the tab seam (contentLabel/contentIcon) so each row matches its
// tab/pane label + icon exactly. Extracted from the old QuickSwitcher modal so the logic
// survives the switch to the in-window SwitcherBar.
import { contentLabel, contentIcon } from "../tabIds";
import { vaultTree } from "../treeStore";
import type { PaletteItem } from "./rankItems";
import type { TreeEntry } from "../../../core/src/graph";

// Every openable vault file — notes plus the "app" docs (settings, spreadsheets, drawings).
// Folders (`kind === "dir"`) are excluded. settings.yaml lives here so Cmd+O can reach the
// settings page; .sheet/.draw so the switcher finds them too.
const OPENABLE_EXTS = [".md", ".yaml", ".yml", ".sheet", ".draw"];
function isFile(e: TreeEntry & { kind?: string }): boolean {
  return e.kind !== "dir" && OPENABLE_EXTS.some((ext) => e.path.endsWith(ext));
}

// The vault's daemon "brain" (`.daemon/`, holding the 3rd-brain memory notes) is part of
// the vault tree and legitimately shows in the sidebar, but its files are internal state
// — not user notes — so Cmd+O must not surface them. Exclude any path inside a `.daemon`
// directory (top-level `.daemon/…` or nested `…/.daemon/…`).
function isDaemonPath(path: string): boolean {
  return path.startsWith(".daemon/") || path.includes("/.daemon/");
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

/** The current openable-file PaletteItems, derived reactively from the vaultTree cache. */
export function vaultFileItems(): PaletteItem[] {
  return vaultTree()
    .filter((e) => isFile(e) && !isDaemonPath(e.path))
    .map(toItem);
}
