// app/src/chatHistory.ts
//
// Pure shell-style prompt-history cursor for the visual chat composer (Row 84): ArrowUp/ArrowDown
// cycle through THIS chat's own previously-sent user messages, the same way a shell's up-arrow or
// Claude Code's own composer recalls prior input. Kept separate from ChatView/ChatComposer (which own
// the DOM/CodeMirror caret-boundary detection deciding WHEN an arrow key should be hijacked at all) so
// the index/state-machine logic is a small, plain module that's thoroughly unit-testable without a
// browser or CodeMirror instance.

export interface HistoryCursor {
  /** -1 = "bottom": the composer shows the user's in-progress draft, not a recalled history entry.
   *  0 = the most recently sent message, 1 = the one before that, and so on counting back from the
   *  newest entry in `entries`. */
  index: number;
  /** The in-progress draft, stashed the moment the user first arrows up away from the bottom —
   *  restored verbatim when they arrow back down past the newest entry. Meaningless while `index` is
   *  -1 (always "" there). */
  draft: string;
}

/** The resting cursor state: composer shows the live draft, nothing recalled. */
export const HISTORY_BOTTOM: HistoryCursor = { index: -1, draft: "" };

export interface HistoryMove {
  /** The cursor state to store for the next Up/Down press. */
  cursor: HistoryCursor;
  /** The text that should replace the composer's contents. */
  text: string;
}

/** Build the recall list from a chat's sent user turns, oldest → newest. Collapses consecutive
 *  duplicates (resending the same message twice in a row recalls it once) — the caller is responsible
 *  for filtering out still-queued (not-yet-dispatched) turns before calling this. */
export function buildHistoryEntries(sentTexts: readonly string[]): string[] {
  const out: string[] = [];
  for (const text of sentTexts) {
    if (out.length > 0 && out[out.length - 1] === text) continue;
    out.push(text);
  }
  return out;
}

/** ArrowUp: recall an older message. `liveDraft` is the composer's CURRENT text at the moment of the
 *  press — stashed as the eventual "bottom" only the FIRST time the user arrows up (while already
 *  browsing, the original stash is preserved, not overwritten by whatever the recalled text happens to
 *  be). Returns null when there's nothing older to recall (no entries at all, or already showing the
 *  oldest one) — the caller should leave the caret/doc alone in that case. */
export function historyUp(cursor: HistoryCursor, entries: readonly string[], liveDraft: string): HistoryMove | null {
  if (entries.length === 0) return null;
  if (cursor.index >= entries.length - 1) return null; // already at the oldest entry
  const index = cursor.index + 1;
  const draft = cursor.index === -1 ? liveDraft : cursor.draft;
  return { cursor: { index, draft }, text: entries[entries.length - 1 - index] };
}

/** ArrowDown: move forward toward the most recently sent entry, and past it back to the stashed
 *  draft. Returns null when already at the bottom — nothing to move down from. */
export function historyDown(cursor: HistoryCursor, entries: readonly string[]): HistoryMove | null {
  if (cursor.index === -1) return null; // already at the bottom
  if (cursor.index === 0) return { cursor: HISTORY_BOTTOM, text: cursor.draft }; // back to the draft
  const index = cursor.index - 1;
  return { cursor: { index, draft: cursor.draft }, text: entries[entries.length - 1 - index] };
}
