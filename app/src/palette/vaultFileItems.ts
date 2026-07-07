// app/src/palette/vaultFileItems.ts
// The vault → openable-file list that backs the Cmd+O switcher. Maps a tree-entry list
// (the pre-warmed, SSE-synced `vaultTree` cache, passed in by SwitcherBar) into PaletteItems,
// reusing the tab seam (contentLabel/contentIcon) so each row matches its tab/pane label +
// icon exactly. Pure (entries in → items out, no store/DOM import) so it's unit-testable.
import { contentLabel, contentIcon, isSettingsFile } from "../tabIds";
import type { PaletteItem } from "./rankItems";
import type { TreeEntry } from "../../../core/src/graph";

// Every openable vault file — notes plus the "app" docs (settings, spreadsheets, drawings).
// Folders (`kind === "dir"`) are excluded. `.yaml`/`.yml`/`.sheet`/`.draw` so the switcher
// finds config buffers + spreadsheets + drawings too.
const OPENABLE_EXTS = [".md", ".yaml", ".yml", ".sheet", ".draw"];
function isFile(e: TreeEntry & { kind?: string }): boolean {
  if (e.kind === "dir") return false;
  // The REAL app-settings file is the hidden, extensionless `.settings` at the vault root
  // (SETTINGS_FILE) — the one with schema autocomplete + lint. It has no extension, so the
  // OPENABLE_EXTS check misses it. Include it explicitly so Cmd+O can reach THE settings file,
  // not merely a `settings.yaml` note that happens to be named "settings". (Without this the
  // real settings file was unreachable via the switcher — sidebar-only.)
  if (isSettingsFile(e.path)) return true;
  return OPENABLE_EXTS.some((ext) => e.path.endsWith(ext));
}

// The vault's daemon "brain" (`.daemon/`, holding the 3rd-brain memory notes) is part of
// the vault tree and legitimately shows in the sidebar, but its files are internal state
// — not user notes — so Cmd+O must not surface them. Exclude any path inside a `.daemon`
// directory (top-level `.daemon/…` or nested `…/.daemon/…`).
function isDaemonPath(path: string): boolean {
  return path.startsWith(".daemon/") || path.includes("/.daemon/");
}

// Reuse the tab seam so the switcher row matches the tab/pane label + icon exactly:
// apps get their type icon, notes their own icon.
function toItem(e: TreeEntry): PaletteItem {
  // The real `.settings` file: label it "Settings" (capitalized, with the gear icon) and mark
  // it "App configuration" so it's UNMISTAKABLE next to a random `settings.yaml` note — which,
  // stripped of its extension, also renders as "settings". This is THE file with schema
  // autocomplete; opening it routes through FileView → the CodeMirror source Editor.
  if (isSettingsFile(e.path)) {
    return { id: e.path, label: "Settings", sublabel: "App configuration", icon: "Settings" };
  }
  const parts = e.path.split("/");
  parts.pop();
  return {
    id: e.path,
    label: contentLabel(e.path),
    sublabel: parts.join("/") || undefined,
    icon: contentIcon(e.path) ?? e.icon,
  };
}

/** Derive the openable-file PaletteItems from a vault tree-entry list. Pure. */
export function vaultFileItems(entries: TreeEntry[]): PaletteItem[] {
  return entries.filter((e) => isFile(e) && !isDaemonPath(e.path)).map(toItem);
}
