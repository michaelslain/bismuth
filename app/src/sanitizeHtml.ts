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

// DOMPurify's default export is a ready instance in the browser (window present
// at import) but an uninitialized factory under a headless runtime (Bun tests /
// SSR, no `window`). Resolve a working sanitizer once: the live instance if it
// has `.sanitize`, else bind the factory to a real `window` if one exists.
const purify: { sanitize: (s: string, c?: unknown) => unknown } | null =
  typeof (DOMPurify as { sanitize?: unknown }).sanitize === "function"
    ? (DOMPurify as unknown as { sanitize: (s: string, c?: unknown) => unknown })
    : typeof window !== "undefined"
      ? (DOMPurify as unknown as (w: Window) => { sanitize: (s: string, c?: unknown) => unknown })(window)
      : null;

/** Sanitize an HTML fragment for safe innerHTML injection. Sanitization needs a
 *  DOM; with none (headless tests/SSR, where nothing is injected) the input is
 *  passed through unchanged — every real innerHTML surface runs in the browser. */
export function sanitizeHtml(dirty: string): string {
  if (!purify) return dirty ?? "";
  return purify.sanitize(dirty ?? "", CONFIG) as string;
}
