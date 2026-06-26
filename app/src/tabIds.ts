// app/src/tabIds.ts
// Sentinel content ids that aren't real note paths. No real path begins with "::".
export const SEARCH_TAB = "::search";
export const EMPTY_PANE = "::empty";
// The Knowledge Graph as a first-class tab (the "Open graph view" / "New tab" commands open this).
export const GRAPH_TAB = "::graph";
// Embedded terminal session: TERMINAL_PREFIX + "<uuid>".
export const TERMINAL_PREFIX = "::term:";
// Export options screen for a file: EXPORT_PREFIX + "<file path>".
export const EXPORT_PREFIX = "::export:";
// Chat session with Claude Code: CHAT_PREFIX + "<chat id>".
export const CHAT_PREFIX = "::chat:";

// The app's "settings page" is .settings/settings.yaml opened as an ordinary file tab
// (there is no ::settings sentinel). We treat it as a first-class app: shown as "settings"
// with a gear icon rather than a raw filename.
export const SETTINGS_FILE = ".settings/settings.yaml";
export function isSettingsFile(content: string): boolean {
  return content === SETTINGS_FILE || content.endsWith("/" + SETTINGS_FILE);
}

export function isSentinel(content: string): boolean {
  return content.startsWith("::");
}

// Bare note name from a vault path ("a/b/c.md" -> "c"). Config buffers (.yaml/.yml) and
// app docs (.draw/.sheet) drop their extension too, so a tab reads as a name, not a file.
function noteName(path: string): string {
  return path.split("/").pop()!.replace(/\.(md|draw|sheet|ya?ml)$/, "");
}

// Human label for a pane/tab content id — used by both the tab bar and pane headers.
// `terminalIndex` lets the caller pass the 1-based position among open terminal tabs
// (terminals don't have intrinsic names), so the label can be "Terminal N".
export function contentLabel(content: string, terminalIndex?: number): string {
  if (content === SEARCH_TAB) return "Search";
  if (content === GRAPH_TAB) return "New tab"; // the graph IS the home/new tab; label reads as such (icon stays Share2)
  if (content === EMPTY_PANE) return ""; // blank header — an empty pane reads as truly empty
  if (content.startsWith(EXPORT_PREFIX)) return `Export: ${noteName(content.slice(EXPORT_PREFIX.length))}`;
  if (content.startsWith(CHAT_PREFIX)) return "Chat";
  if (content.startsWith(TERMINAL_PREFIX)) return `Terminal ${terminalIndex ?? "?"}`;
  if (isSettingsFile(content)) return "settings";
  return noteName(content);
}

// Lucide icon NAME for a pane/tab content id, or undefined for plain notes / empty panes.
// Rendered before the label by the tab bar and pane headers.
export function contentIcon(content: string): string | undefined {
  if (content === SEARCH_TAB) return "Search";
  if (content === GRAPH_TAB) return "Share2";
  if (content.startsWith(EXPORT_PREFIX)) return "Download";
  if (content.startsWith(CHAT_PREFIX)) return "MessageSquare";
  if (content.startsWith(TERMINAL_PREFIX)) return "SquareTerminal";
  if (isSettingsFile(content)) return "Settings";
  if (content.endsWith(".sheet")) return "Table";
  if (content.endsWith(".draw")) return "PenTool";
  return undefined;
}
