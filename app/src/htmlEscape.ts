// Canonical HTML-escaping helpers shared across markdown/export/editor renderers.

/** Escape a string for use as HTML text content (escapes &, <, >). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape a string for use inside a double-quoted HTML attribute (escapes &, <, "). */
export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
