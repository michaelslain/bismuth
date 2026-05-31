// app/src/editor/harperBody.ts
// Pure, DOM-free. Returns the document char range of the markdown *body*, skipping
// a leading YAML frontmatter block so Harper never spell-checks property values.
//
// Mirrors livePreview.ts's frontmatter detection: a frontmatter block exists only
// when the doc opens with a "---" fence line that is later closed by another "---".
// An unterminated opener is treated as plain body. (Interim helper — Fan-out B's
// extractFrontmatterBoundary supersedes this once it lands.)

// Matches a leading frontmatter block: opening --- fence, any content, closing ---
// fence, and the trailing newline. Tolerant of CRLF.
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function harperBodyRange(doc: string): { from: number; to: number } {
  const m = FRONTMATTER.exec(doc);
  const from = m ? m[0].length : 0;
  return { from, to: doc.length };
}
