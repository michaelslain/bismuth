// app/src/editor/harperOffsets.ts
// Pure, DOM-free. NO CodeMirror / harper.js imports here so it runs under `bun test`.
//
// Harper reports lint spans as Unicode *scalar* (code-point) indices. CodeMirror
// positions are UTF-16 code-unit offsets. Any astral character (emoji, some CJK,
// math symbols) occupies one scalar but two UTF-16 units, so a lint after such a
// char would land too far left without this remap. We convert a scalar index into
// the corresponding UTF-16 offset by walking the string's code points and summing
// each one's UTF-16 width.

export function scalarToUtf16(text: string, scalarIndex: number): number {
  if (scalarIndex <= 0) return 0;
  let scalar = 0;
  let utf16 = 0;
  // String iteration yields one entry per code point (scalar), so each step is
  // one scalar; `cp.length` is its UTF-16 width (1 for BMP, 2 for astral).
  for (const cp of text) {
    if (scalar === scalarIndex) return utf16;
    utf16 += cp.length;
    scalar += 1;
  }
  // scalarIndex at or past the end -> clamp to the full UTF-16 length.
  return utf16;
}
