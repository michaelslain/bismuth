// app/src/editor/tag.ts
// Pure, DOM-free helper for `#tag` autocomplete. NO CodeMirror imports here, so it
// runs under `bun test` without a browser environment.

// A tag is `#` at start-of-line or after whitespace, followed by tag chars (word
// chars, `/` for nested tags, `-`). Requiring start-of-line/whitespace before the `#`
// excludes markdown headings (`# ` / `## ` have a space), `##` markers, and mid-word
// `#` such as `C#`.
const TAG = /(?:^|\s)#([\w/-]*)$/;

export function matchTagPrefix(
  textBefore: string,
): { from: number; query: string } | null {
  const m = textBefore.match(TAG);
  if (!m) return null;
  // The chars before the query are the optional leading whitespace plus the `#`, so the
  // query (and our insertion point) starts that many chars into the match.
  return { from: (m.index ?? 0) + (m[0].length - m[1].length), query: m[1] };
}
