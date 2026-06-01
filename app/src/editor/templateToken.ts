// app/src/editor/templateToken.ts
// Pure matcher for an OPEN "{{…" template token immediately before the caret.
// Mirrors matchWikilinkPrefix / matchTagPrefix in style. Returns the line-relative
// offset of the "{{" and the partial token text typed after it, or null when the
// caret is not inside an open token.
export function matchTemplateTokenPrefix(textBefore: string): { from: number; query: string } | null {
  const open = textBefore.lastIndexOf("{{");
  if (open === -1) return null;
  const after = textBefore.slice(open + 2);
  if (after.includes("}}")) return null;       // already closed before the caret
  if (!/^[\w+:-]*$/.test(after)) return null;   // only token-ish chars (name, +offset, :format)
  return { from: open, query: after };
}
