// app/src/editor/wikilink.ts
// Pure, DOM-free helpers for wikilink autocomplete. NO CodeMirror imports here, so
// these run under `bun test` without a browser environment.

export type NoteCandidate = { label: string; folder?: string };

// The cursor (end of `textBefore`) sits inside an open `[[…` with no closing `]]` yet.
// `[^\]\n]*` after `[[` ensures we only match while the link is still open, and the
// `$` anchor makes `.match` pick the rightmost such `[[` on the line.
const OPEN = /\[\[([^\]\n]*)$/;

export function matchWikilinkPrefix(
  textBefore: string,
): { from: number; query: string } | null {
  const m = textBefore.match(OPEN);
  if (!m) return null;
  // m.index points at the `[[`; the query starts two characters later.
  return { from: (m.index ?? 0) + 2, query: m[1] };
}

// Text to insert when a note is chosen. Append the closing `]]` only when it isn't
// already immediately ahead (avoids `]]]]`); the cursor always lands just past `]]`.
export function buildInsert(
  label: string,
  hasClosingAhead: boolean,
): { insert: string; cursorOffset: number } {
  return {
    insert: hasClosingAhead ? label : label + "]]",
    // Cursor lands just past the closing `]]`, whether we inserted it (label + "]]")
    // or it was already ahead — hence `+ 2` in both branches.
    cursorOffset: label.length + 2,
  };
}
