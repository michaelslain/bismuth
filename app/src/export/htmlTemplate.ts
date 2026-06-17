// app/src/export/htmlTemplate.ts
import { escapeHtml } from "../htmlEscape";
import { DEFAULT_PALETTE } from "./exportTheme";
import type { ThemePalette } from "./types";

export { escapeHtml };

function styles(p: ThemePalette): string {
  return `
  :root { color-scheme: ${p.scheme}; }
  /* The export inlines the app's own font (resolved live) so the document reads as the same
     product. The PDF/PNG path rasterizes via html2canvas, which measures text with canvas
     measureText() — so a concrete named font stack (not a CSS keyword) is required; the
     resolved stack carries its own fallbacks. */
  html, body { margin: 0; background: ${p.bg}; }
  body { font-family: ${p.font};
         max-width: 760px; margin: 0 auto; padding: 2.5rem 1.5rem 3rem;
         line-height: 1.6; color: ${p.fg}; }
  h1,h2,h3 { line-height: 1.25; margin-top: 1.6em; }
  a { color: ${p.accent}; }
  pre { background: ${p.head}; padding: 1rem; border-radius: 6px; overflow: auto;
        white-space: pre-wrap; word-break: break-word; }
  code { background: ${p.head}; padding: 0.1em 0.35em; border-radius: 4px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid ${p.border}; margin: 0; padding-left: 1rem; color: ${p.muted}; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid ${p.border}; padding: 0.4rem 0.6rem; text-align: left; }
  th { background: ${p.head}; }
  img { max-width: 100%; }
`;
}

/**
 * Wrap rendered body HTML in a standalone, styled document (used for .html export, the
 * pdf/png render source, and the preview iframe). `palette` carries the resolved app theme
 * (colors + font) so the doc matches the app; it defaults to the dark default palette for
 * simple/headless callers. `extraHead` is injected after the base stylesheet (KaTeX CSS +
 * view-specific CSS).
 */
export function wrapHtmlDocument(
  body: string,
  title: string,
  palette: ThemePalette = DEFAULT_PALETTE.dark,
  extraHead = "",
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles(palette)}</style>
${extraHead}</head>
<body>
${body}
</body>
</html>`;
}
