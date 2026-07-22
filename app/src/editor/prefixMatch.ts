// app/src/editor/prefixMatch.ts
// Pure, DOM-free helper shared by the `[[wikilink` and `#tag` autocomplete matchers. NO
// CodeMirror imports here, so it runs under `bun test` without a browser environment.

// Match `textBefore` (the text on the line up to the caret) against a `$`-anchored trigger
// regex whose LAST piece is a single capture group holding the typed query. Returns that
// query plus `from` — the offset where the query (the insertion/replace point) begins, i.e.
// just past the trigger characters (`m[0].length - m[1].length` = the trigger's length).
// `.match` (no `g`) finds the rightmost trigger the anchor allows. Null when nothing matches.
export function matchTriggerPrefix(
  textBefore: string,
  trigger: RegExp,
): { from: number; query: string } | null {
  const m = textBefore.match(trigger);
  if (!m) return null;
  return { from: (m.index ?? 0) + (m[0].length - m[1].length), query: m[1] };
}
