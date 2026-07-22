// app/src/tabIds.ts
// Sentinel content ids that aren't real note paths. No real path begins with "::".
import { previewKind } from "./preview/previewKind";

// NOTE: there is no ::search sentinel anymore — search is the Cmd+O switcher takeover (#8:
// "the search tab and the cmd+o should be the same thing"). Persisted "::search" tabs from
// older builds are migrated to ::graph on restore (see LEGACY_CONTENT_IDS in panes.ts).
export const EMPTY_PANE = "::empty";
// The Knowledge Graph as a first-class tab (the "Open graph view" / "New tab" commands open this).
export const GRAPH_TAB = "::graph";
// Embedded terminal session: TERMINAL_PREFIX + "<uuid>".
export const TERMINAL_PREFIX = "::term:";
// Export options screen for a file: EXPORT_PREFIX + "<file path>".
export const EXPORT_PREFIX = "::export:";
// Chat session with Claude Code: CHAT_PREFIX + "<chat id>".
export const CHAT_PREFIX = "::chat:";
// The daemon inbox — pages awaiting approval/dismissal (core/src/daemonPages.ts). One tab, like
// GRAPH_TAB (not per-instance, unlike CHAT_PREFIX/TERMINAL_PREFIX).
export const INBOX_TAB = "::inbox";
// Annotate (mark up) an image/PDF on the `.draw` sidecar surface: ANNOTATE_PREFIX + "<file path>".
// This is the SECONDARY action reached from a preview's "Annotate" button — a plain image/PDF
// path opens the lighter read-only PreviewView by default (see PaneContent).
export const ANNOTATE_PREFIX = "::annotate:";
/** Content id that opens `path`'s markup (annotate) surface. */
export const annotatePath = (path: string): string => ANNOTATE_PREFIX + path;

// The app's "settings page" is the single hidden `.settings` file (YAML) opened as an ordinary
// file tab (there is no ::settings sentinel). We treat it as a first-class app: shown as "settings"
// with a gear icon rather than a raw filename.
export const SETTINGS_FILE = ".settings";
export function isSettingsFile(content: string): boolean {
  return content === SETTINGS_FILE || content.endsWith("/" + SETTINGS_FILE);
}

export function isSentinel(content: string): boolean {
  return content.startsWith("::");
}

// Chat tabs are labeled by an injected provider (tabIds stays framework-free): App wires it to
// the per-session conversation title (chatTitles) with the daemon's identity name as fallback,
// so precedence is title > daemon persona > "Chat". Because the provider reads signals, any
// JSX/memo calling contentLabel stays reactive to both. Receives the full content id
// ("::chat:<id>") so it can key the title lookup.
let chatLabelProvider: ((content: string) => string | null) | null = null;
export function setChatLabelProvider(fn: (content: string) => string | null): void {
  chatLabelProvider = fn;
}

// Chat tabs also get an injected ICON provider (same seam/reasoning as the label provider above):
// App wires it to the tab's resolved daemon-vs-user origin (app/src/chatOrigin.ts), so the tab bar +
// pane header show a distinct glyph for a chat bound to a DAEMON session (a cron chat opened from
// History's daemon scope) vs one the user started. Falls back to the plain chat icon when unset/null
// (a brand-new tab, or before App has wired it).
let chatIconProvider: ((content: string) => string | null) | null = null;
export function setChatIconProvider(fn: (content: string) => string | null): void {
  chatIconProvider = fn;
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
  if (content === GRAPH_TAB) return "New tab"; // the graph IS the home/new tab; label reads as such (icon stays Share2)
  if (content === INBOX_TAB) return "Inbox";
  if (content === EMPTY_PANE) return ""; // blank header — an empty pane reads as truly empty
  if (content.startsWith(EXPORT_PREFIX)) return `Export: ${noteName(content.slice(EXPORT_PREFIX.length))}`;
  if (content.startsWith(CHAT_PREFIX)) return chatLabelProvider?.(content) ?? "Chat";
  if (content.startsWith(TERMINAL_PREFIX)) return `Terminal ${terminalIndex ?? "?"}`;
  // Annotate tab: label as the bare filename (keeps its extension, like a preview tab).
  if (content.startsWith(ANNOTATE_PREFIX)) return content.slice(ANNOTATE_PREFIX.length).split("/").pop() ?? content;
  if (isSettingsFile(content)) return "settings";
  return noteName(content);
}

// Lucide icon NAME for a pane/tab content id, or undefined for plain notes / empty panes.
// Rendered before the label by the tab bar and pane headers.
export function contentIcon(content: string): string | undefined {
  if (content === GRAPH_TAB) return "Share2";
  if (content === INBOX_TAB) return "Inbox";
  if (content.startsWith(EXPORT_PREFIX)) return "Download";
  if (content.startsWith(CHAT_PREFIX)) return chatIconProvider?.(content) ?? "MessageSquare";
  if (content.startsWith(TERMINAL_PREFIX)) return "SquareTerminal";
  if (content.startsWith(ANNOTATE_PREFIX)) return "PenTool"; // markup surface
  if (isSettingsFile(content)) return "Settings";
  if (content.endsWith(".sheet")) return "Table";
  if (content.endsWith(".draw")) return "PenTool";
  // Preview tabs (images/PDFs/code/binary) get a kind-specific glyph.
  switch (previewKind(content)) {
    case "image": return "Image";
    case "pdf": return "FileText";
    case "code": return "Code";
    case "external": return "File";
  }
  return undefined;
}
