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
