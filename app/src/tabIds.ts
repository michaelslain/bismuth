// app/src/tabIds.ts
// Sentinel content ids that aren't real note paths. No real path begins with "::".
export const CALENDAR_TAB = "::calendar";
export const EMPTY_PANE = "::empty";
// Per-note flashcard review screen: FLASHCARDS_PREFIX + "<note path>".
export const FLASHCARDS_PREFIX = "::flashcards:";
// Embedded terminal session: TERMINAL_PREFIX + "<uuid>".
export const TERMINAL_PREFIX = "::term:";

export function isSentinel(content: string): boolean {
  return content.startsWith("::");
}

// Bare note name from a vault path ("a/b/c.md" -> "c").
function noteName(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/, "");
}

// Human label for a pane/tab content id — used by both the tab bar and pane headers.
// `terminalIndex` lets the caller pass the 1-based position among open terminal tabs
// (terminals don't have intrinsic names), so the label can be "Terminal N".
export function contentLabel(content: string, terminalIndex?: number): string {
  if (content === CALENDAR_TAB) return "📅 Calendar";
  if (content === EMPTY_PANE) return "(empty)";
  if (content.startsWith(FLASHCARDS_PREFIX)) return "🃏 " + noteName(content.slice(FLASHCARDS_PREFIX.length));
  if (content.startsWith(TERMINAL_PREFIX)) return `>_ Terminal ${terminalIndex ?? "?"}`;
  return noteName(content);
}
