// app/src/tabIds.ts
// Sentinel content ids that aren't real note paths. No real path begins with "::".
export const SETTINGS_TAB = "::settings";
export const CALENDAR_TAB = "::calendar";
export const TASKS_TAB = "::tasks";
// Per-note flashcard review screen: FLASHCARDS_PREFIX + "<note path>".
export const FLASHCARDS_PREFIX = "::flashcards:";

export function isSentinel(content: string): boolean {
  return content.startsWith("::");
}

// Bare note name from a vault path ("a/b/c.md" -> "c").
function noteName(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/, "");
}

// Human label for a pane/tab content id — used by both the tab bar and pane headers.
export function contentLabel(content: string): string {
  if (content === SETTINGS_TAB) return "⚙ Settings";
  if (content === CALENDAR_TAB) return "📅 Calendar";
  if (content === TASKS_TAB) return "✓ Tasks";
  if (content.startsWith(FLASHCARDS_PREFIX)) return "🃏 " + noteName(content.slice(FLASHCARDS_PREFIX.length));
  return noteName(content);
}
