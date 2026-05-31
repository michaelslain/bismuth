// app/src/editor/frontmatterUtils.ts
// Pure, DOM-free helper for locating the YAML frontmatter body in a document.
// NO CodeMirror imports, so it runs under `bun test` without a browser environment.
// Shared by frontmatter validation/autocomplete (yamlSchema) and Harper's body-skip.

export interface FrontmatterRange {
  /** Document char offset where the YAML body starts (just after the opening fence). */
  from: number;
  /** Document char offset where the YAML body ends (just before the closing fence). */
  to: number;
  /** The YAML body text, i.e. doc.slice(from, to). */
  text: string;
}

/**
 * Return the char-offset range of the YAML frontmatter body, or null if the document
 * has no well-formed frontmatter (no opening fence on line 1, or never closed).
 *
 * The returned range is the CONTENT between the fences — `to` is the end of the body
 * text, before the closing `---` fence (or === `from` for an empty body).
 */
export function extractFrontmatterBoundary(doc: string): FrontmatterRange | null {
  const open = /^---\r?\n/.exec(doc);
  if (!open) return null;
  const from = open[0].length; // first char after the opening fence + newline
  const closeRe = /^---[ \t]*(?:\r?\n|$)/m;
  const after = doc.slice(from);
  const m = closeRe.exec(after);
  if (!m) return null;
  let to = from + m.index; // immediate close (empty body) → to === from
  if (m.index > 0) {
    // trim the single newline before the closing fence
    const nl = /\r?\n$/.exec(doc.slice(from, to));
    if (nl) to -= nl[0].length;
  }
  return { from, to, text: doc.slice(from, to) };
}
