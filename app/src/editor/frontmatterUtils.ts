// app/src/editor/frontmatterUtils.ts
// Pure, DOM-free helper for locating the YAML frontmatter body in a document.
// NO CodeMirror imports, so it runs under `bun test` without a browser environment.
// Shared by frontmatter validation/autocomplete (yamlSchema) and Harper's body-skip.

/** Matches a closing `---` frontmatter fence at the start of a line (end-of-doc allowed). */
const CLOSE_FENCE_RE = /^---[ \t]*(?:\r?\n|$)/m;

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
  const after = doc.slice(from);
  const m = CLOSE_FENCE_RE.exec(after);
  if (!m) return null;
  let to = from + m.index; // immediate close (empty body) → to === from
  if (m.index > 0) {
    // trim the single newline before the closing fence
    const nl = /\r?\n$/.exec(doc.slice(from, to));
    if (nl) to -= nl[0].length;
  }
  return { from, to, text: doc.slice(from, to) };
}

/**
 * Char range of the markdown *body* — everything after a leading YAML frontmatter block
 * (past the closing `---` fence + its newline), or the whole doc when there's no
 * frontmatter. Used by Harper's body-skip so property values aren't spell-checked.
 *
 * `extractFrontmatterBoundary` returns the frontmatter CONTENT range (`to` is the end of
 * the body text, before the closing fence). This advances past the closing `---\n` line.
 */
export function frontmatterBodyRange(doc: string): { from: number; to: number } {
  const fm = extractFrontmatterBoundary(doc);
  if (!fm) return { from: 0, to: doc.length };
  // Find the closing fence: the first `---` line at or after the content end. The slice
  // from fm.to begins with the (optional) newline that precedes the closing fence.
  const after = doc.slice(fm.to);
  const m = CLOSE_FENCE_RE.exec(after);
  if (!m) return { from: 0, to: doc.length }; // shouldn't happen (boundary already matched)
  const from = fm.to + m.index + m[0].length; // past the closing fence + its newline
  return { from, to: doc.length };
}
