// app/src/export/htmlTemplate.ts
import { escapeHtml } from "../htmlEscape";
import { DEFAULT_PALETTE } from "./exportTheme";
import type { ThemePalette } from "./types";
import { CALLOUT_TYPES } from "../editor/callout";

export { escapeHtml };

/** Per-type callout accent rules, generated from the shared palette (editor/callout.ts) so the
 *  exported PDF/HTML uses the SAME colors as the in-app surfaces. */
function calloutTypeCss(): string {
  return Object.entries(CALLOUT_TYPES)
    .map(
      ([type, meta]) =>
        `.callout-${type}{border-left-color:${meta.color}}.callout-${type}>.callout-title{color:${meta.color}}`,
    )
    .join("\n  ");
}

function styles(p: ThemePalette): string {
  return `
  :root { color-scheme: ${p.scheme}; }
  /* US Letter portrait with a 1in margin on every side. Governs a browser print/"Save as PDF"
     of the exported .html; the in-app PDF rasterizer (htmlToPdf.ts) enforces the same geometry
     explicitly, since html2canvas ignores @page. */
  @page { size: 8.5in 11in; margin: 1in; }
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
  /* Callouts (editor/callout.ts). Neutral translucent fill + a 4px accent left bar; the icon
     inherits the title's accent via currentColor. Concrete per-type accents below so the PDF
     rasterizer (html2canvas) renders them. */
  .callout { margin: 1em 0; border: 1px solid ${p.border}; border-left-width: 4px; border-radius: 6px;
             background: rgba(127,127,127,0.06); padding: 0.55em 0.85em; }
  .callout-title { display: flex; align-items: center; gap: 0.45em; font-weight: 600; }
  .callout-icon { display: inline-flex; flex: 0 0 auto; }
  .callout-icon svg { width: 1.1em; height: 1.1em; }
  .callout-title-inner { min-width: 0; }
  .callout-content { margin-top: 0.4em; }
  .callout-content > :first-child { margin-top: 0; }
  .callout-content > :last-child { margin-bottom: 0; }
  details.callout > summary { cursor: pointer; list-style: none; }
  details.callout > summary::-webkit-details-marker { display: none; }
  ${calloutTypeCss()}
  /* A page break: invisible on screen (height:0), a forced new page when printed. The in-app PDF
     rasterizer slices pages at this element explicitly (htmlToPdf.ts). */
  .bismuth-page-break { break-after: page; page-break-after: always; height: 0; }
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
