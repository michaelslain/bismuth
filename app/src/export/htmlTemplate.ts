// app/src/export/htmlTemplate.ts
import { escapeHtml } from "../htmlEscape";
import { DEFAULT_PALETTE } from "./exportTheme";
import type { ThemePalette } from "./types";
import { CALLOUT_TYPES } from "../editor/callout";

export { escapeHtml };

/** Position of the current document within a page-broken export (design/ascii-extended
 *  PORTING.md §3d's "Page footer: filename left, n / total right"). Callers that don't
 *  know their real position (a single continuous document — html/pdf, or a one-off PNG)
 *  omit this and get "1 / 1"; only the PNG-per-section and multi-page-preview paths
 *  (exporters.ts), which already render one wrapHtmlDocument call per page, know a real
 *  index/total. */
export interface PageInfo {
  index: number;
  total: number;
}

/** Ruled-paper HTML: filename left, "n / total" right, --faint-equivalent 9px. Sits on
 *  the SAME 22px ruling as the rest of the document (one 22px line box). */
function pageFooterHtml(name: string, page?: PageInfo): string {
  const pos = page && page.total > 1 ? `${page.index} / ${page.total}` : "1 / 1";
  return `<div class="pagefoot"><span>${escapeHtml(name)}</span><span>${escapeHtml(pos)}</span></div>`;
}

/** Render frontmatter data as the register's "fmatter" block (design/ascii-extended
 *  PORTING.md §3d): one `key: value` line per top-level entry (arrays join with ", "),
 *  using the 2px accent left border — the one sanctioned left-accent border in the
 *  system. Callers skip this entirely when a note has no frontmatter (or the user
 *  excluded it via the Frontmatter chip) rather than emit an empty block. */
export function frontmatterBlockHtml(data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  if (!keys.length) return "";
  const lines = keys.map((k) => {
    const v = data[k];
    const text = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    return `<span class="fm-k">${escapeHtml(k)}:</span> ${escapeHtml(text)}`;
  });
  return `<div class="fmatter">${lines.join("<br>")}</div>`;
}

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

// The 22px text-baseline grid: every text-bearing block's line-height is RULE_PX or a whole
// multiple of it — a single element off that grid walks the rest of the document off the
// baseline, so this list is deliberately exhaustive rather than just the obvious prose tags.
// This grid is load-bearing beyond typography: the in-app PDF rasterizer (pageGeometry.ts
// pdfSliceMetrics) snaps its page-slice height to a whole multiple of RULE_PX so a page
// boundary can only ever land ON a line, never cut through the middle of one (GitHub issue
// #9). Exported so pageGeometry.ts doesn't duplicate the literal 22 as a second copy that
// could silently drift out of sync with this one.
export const RULE_PX = 22;

function styles(p: ThemePalette, fontSizePt?: number): string {
  // A concrete body font-size (pt) is emitted only when a caller asks for one (the PDF path,
  // via the export UI). Left off, the document keeps its intrinsic browser sizing so the html
  // and png exports are unchanged.
  const fontSizeRule = fontSizePt ? `font-size: ${fontSizePt}pt;` : "";
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
  /* Exports are DELIBERATELY unruled (GitHub issue #9): a visible horizontal rule under every
     line of text used to be painted here via a repeating CSS background gradient, across
     every export format (html/pdf/png). The repo owner asked for it removed outright — don't
     re-add it. The padding below stays a whole multiple of ${RULE_PX}px (the text-baseline
     grid, still very much alive — see RULE_PX's own docs) purely so it doesn't shift every
     existing export's layout; that no longer aligns the first line to a visible rule, since
     there isn't one anymore. */
  body {
    font-family: ${p.font}; ${fontSizeRule}
    max-width: 760px; margin: 0 auto; padding: ${RULE_PX * 2}px 1.5rem ${RULE_PX * 3}px;
    line-height: ${RULE_PX}px; color: ${p.fg};
  }
  h1 { font-size: 1.7em; font-weight: 600; letter-spacing: -0.01em; line-height: ${RULE_PX * 2}px; margin: ${RULE_PX * 2}px 0 0; }
  h2, h3, h4, h5, h6 { font-weight: 600; line-height: ${RULE_PX}px; margin: ${RULE_PX}px 0 0; }
  /* Headings below h1 keep their markdown marker, rendered in the muted tone — h1 is the
     document TITLE (no marker), same distinction the card draws. */
  h2::before { content: "## "; color: ${p.muted}; font-weight: 400; }
  h3::before { content: "### "; color: ${p.muted}; font-weight: 400; }
  h4::before { content: "#### "; color: ${p.muted}; font-weight: 400; }
  h5::before { content: "##### "; color: ${p.muted}; font-weight: 400; }
  h6::before { content: "###### "; color: ${p.muted}; font-weight: 400; }
  p, li { line-height: ${RULE_PX}px; margin: 0; color: ${p.fg}; }
  ul, ol { margin: 0; padding-left: 1.4em; }
  a { color: ${p.accent}; }
  pre { background: ${p.head}; padding: 1rem; border-radius: 6px; overflow: auto;
        white-space: pre-wrap; word-break: break-word; line-height: ${RULE_PX}px; }
  code { background: ${p.head}; padding: 0.1em 0.35em; border-radius: 4px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid ${p.border}; margin: 0; padding-left: 1rem;
               color: ${p.muted}; line-height: ${RULE_PX}px; }
  /* The frontmatter block (htmlTemplate.ts frontmatterBlockHtml) — the one sanctioned
     left-accent border in the system, same token the app's own frontmatter/callout gutter
     uses (ui.css --accent-edge). */
  .fmatter { border-left: 2px solid ${p.accent}; margin: 0 0 ${RULE_PX}px; padding-left: 0.75rem;
             font-size: 0.85em; line-height: ${RULE_PX}px; color: ${p.muted}; }
  .fm-k { color: ${p.muted}; opacity: 0.75; }
  /* Callouts (editor/callout.ts). Neutral translucent fill + a 4px accent left bar; the icon
     inherits the title's accent via currentColor. Concrete per-type accents below so the PDF
     rasterizer (html2canvas) renders them. */
  .callout { margin: ${RULE_PX}px 0; border: 1px solid ${p.border}; border-left-width: 4px; border-radius: 6px;
             background: rgba(127,127,127,0.06); padding: 0.55em 0.85em; }
  .callout-title { display: flex; align-items: center; gap: 0.45em; font-weight: 600; line-height: ${RULE_PX}px; }
  .callout-icon { display: inline-flex; flex: 0 0 auto; }
  .callout-icon svg { width: 1.1em; height: 1.1em; }
  .callout-title-inner { min-width: 0; }
  .callout-content { margin-top: 0.4em; line-height: ${RULE_PX}px; }
  .callout-content > :first-child { margin-top: 0; }
  .callout-content > :last-child { margin-bottom: 0; }
  details.callout > summary { cursor: pointer; list-style: none; }
  details.callout > summary::-webkit-details-marker { display: none; }
  ${calloutTypeCss()}
  /* A page break: invisible on screen (height:0), a forced new page when printed. The in-app PDF
     rasterizer slices pages at this element explicitly (htmlToPdf.ts). */
  .bismuth-page-break { break-after: page; page-break-after: always; height: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid ${p.border}; padding: 0.4rem 0.6rem; text-align: left; line-height: ${RULE_PX}px; }
  th { background: ${p.head}; }
  img { max-width: 100%; }
  /* Page footer: filename left, "n / total" right — the ONE footer per document. */
  .pagefoot { margin-top: ${RULE_PX}px; line-height: ${RULE_PX}px; font-size: 9px;
              color: ${p.muted}; letter-spacing: 0.04em; display: flex; justify-content: space-between; }
`;
}

/**
 * Wrap rendered body HTML in a standalone, styled document (used for .html export, the
 * pdf/png render source, and the preview iframe). `palette` carries the resolved app theme
 * (colors + font) so the doc matches the app; it defaults to the dark default palette for
 * simple/headless callers. `extraHead` is injected after the base stylesheet (KaTeX CSS +
 * view-specific CSS). `fontSizePt`, when given, sets the body font size in points (the PDF
 * export path passes the user's chosen size; other callers leave it off for intrinsic sizing).
 */
export function wrapHtmlDocument(
  body: string,
  title: string,
  palette: ThemePalette = DEFAULT_PALETTE.dark,
  extraHead = "",
  fontSizePt?: number,
  // Opt-in: only the rendered-prose paths (wrapBody, below) pass this, so a raw markdown/
  // csv text dump or a single rasterized drawing image never grows an out-of-place footer.
  page?: PageInfo,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles(palette, fontSizePt)}</style>
${extraHead}</head>
<body>
${body}
${page ? pageFooterHtml(title, page) : ""}
</body>
</html>`;
}
