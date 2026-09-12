// Canonical HTML-escaping helpers shared across markdown/export/editor renderers.
//
// marked (bases/markdown.ts) escapes &, <, >, " and ' on its own, but only in plain markdown
// TEXT — it passes HTML the app hands it (a <span> built by hand, a data attribute) straight
// through untouched, so that escaping never reaches content like taskCardMarkup.ts's field
// chips. These functions are the only guard for that content; sanitizeHtml.ts's DOMPurify
// pass, which runs after marked, is the backstop, stripping dangerous tags/attributes from it.

/** Escape a string for use as HTML text content (escapes &, <, >). */
export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape a string for use inside a double-quoted HTML attribute (escapes &, <, "). */
export function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;')
}
