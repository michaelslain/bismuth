import DOMPurify from "dompurify";

// Single shared sanitizer for every surface that renders raw HTML out of vault
// markdown as innerHTML: the editor live-preview (htmlPreview.ts), card faces +
// calendar descriptions + `.md` transclusion + md export (all via
// bases/markdown.ts `renderMarkdown`). Obsidian-style raw-HTML passthrough means
// arbitrary user/note HTML reaches the DOM, so it MUST flow through here first —
// DOMPurify strips <script>, inline event handlers (onclick=…), javascript:
// URLs, and other XSS vectors while keeping benign formatting (b/i/u/span/mark/
// sub/sup/div/details/img/a/table/…) and the `style`/`align`/`class` attributes
// people actually use in notes.
const CONFIG = {
  // Standard HTML profile (no SVG/MathML islands — math is handled by KaTeX).
  USE_PROFILES: { html: true },
  // Allow `<a target="_blank">` (DOMPurify drops unknown attrs otherwise).
  ADD_ATTR: ["target"],
};

/** Sanitize an HTML fragment for safe innerHTML injection. */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty ?? "", CONFIG) as unknown as string;
}
