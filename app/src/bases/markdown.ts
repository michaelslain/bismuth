import { marked } from "marked";
import { sanitizeHtml } from "../sanitizeHtml";

// GFM + single-newline line breaks. marked passes raw HTML in the markdown
// straight through (Obsidian-style passthrough), so the result is sanitized
// before it is injected as innerHTML (card faces, calendar descriptions, `.md`
// transclusion, md export).
marked.use({ gfm: true, breaks: true });

/** Render a markdown string to sanitized HTML (synchronous). */
export function renderMarkdown(src: string): string {
  return sanitizeHtml(marked.parse(src ?? "", { async: false }) as string);
}
