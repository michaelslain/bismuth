// Markdown thematic-break (horizontal-rule) detection. Kept in its own dependency-free
// module so it's unit-testable without pulling in livePreview's browser-only imports.

/** A markdown thematic break (horizontal rule): a whole line of the same marker char
 *  (`-`, `*`, or `_`) repeated 3+ times, optional spaces between/around. Frontmatter
 *  `---` fences also match this shape — callers must exclude them by position first. */
export function isThematicBreak(text: string): boolean {
  return /^\s*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(text);
}
