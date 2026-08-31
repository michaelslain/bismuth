// app/src/export/htmlTemplate.ts
import { escapeHtml } from '../htmlEscape'
import { DEFAULT_PALETTE } from './exportTheme'
import type { ThemePalette } from './types'
import { CALLOUT_TYPES } from '../editor/callout'

export { escapeHtml }

/** Position of the current document within a page-broken export (bismuth-design/ascii-extended
 *  PORTING.md §3d's "Page footer: filename left, n / total right"). Callers that don't
 *  know their real position (a single continuous document — html/pdf, or a one-off PNG)
 *  omit this and get "1 / 1"; only the PNG-per-section and multi-page-preview paths
 *  (exporters.ts), which already render one wrapHtmlDocument call per page, know a real
 *  index/total. */
export interface PageInfo {
    index: number
    total: number
}

/** Ruled-paper HTML: filename left, "n / total" right, --faint-equivalent 9px. Sits on
 *  the SAME 22px ruling as the rest of the document (one 22px line box). */
function pageFooterHtml(name: string, page?: PageInfo): string {
    const pos =
        page && page.total > 1 ? `${page.index} / ${page.total}` : '1 / 1'
    return `<div class="pagefoot"><span>${escapeHtml(name)}</span><span>${escapeHtml(pos)}</span></div>`
}

/** Render frontmatter data as the register's "fmatter" block (bismuth-design/ascii-extended
 *  PORTING.md §3d): one `key: value` line per top-level entry (arrays join with ", "),
 *  using the 2px accent left border — the one sanctioned left-accent border in the
 *  system. Callers skip this entirely when a note has no frontmatter (or the user
 *  excluded it via the Frontmatter chip) rather than emit an empty block. */
export function frontmatterBlockHtml(data: Record<string, unknown>): string {
    const keys = Object.keys(data)
    if (!keys.length) return ''
    const lines = keys.map(k => {
        const v = data[k]
        const text = Array.isArray(v) ? v.join(', ') : String(v ?? '')
        return `<span class="fm-k">${escapeHtml(k)}:</span> ${escapeHtml(text)}`
    })
    return `<div class="fmatter">${lines.join('<br>')}</div>`
}

/** Per-type callout accent rules, generated from the shared palette (editor/callout.ts) so the
 *  exported PDF/HTML uses the SAME colors as the in-app surfaces. */
function calloutTypeCss(): string {
    return Object.entries(CALLOUT_TYPES)
        .map(
            ([type, meta]) =>
                `.callout-${type}{border-left-color:${meta.color}}.callout-${type}>.callout-title{color:${meta.color}}`,
        )
        .join('\n  ')
}

// The 22px text-baseline grid: every text-bearing block's line-height is RULE_PX or a whole
// multiple of it — a single element off that grid walks the rest of the document off the
// baseline, so this list is deliberately exhaustive rather than just the obvious prose tags.
// This grid is load-bearing beyond typography: the in-app PDF rasterizer (pageGeometry.ts
// pdfSliceMetrics) snaps its page-slice height to a whole multiple of RULE_PX so a page
// boundary can only ever land ON a line, never cut through the middle of one (GitHub issue
// #9). Exported so pageGeometry.ts doesn't duplicate the literal 22 as a second copy that
// could silently drift out of sync with this one.
export const RULE_PX = 22

// .callout's vertical footprint (border-top + padding-top + padding-bottom + border-bottom +
// .callout-content's margin-top) must sum to a whole multiple of RULE_PX (see the ".callout"
// comment in styles() below) — GitHub issue #9 follow-up. CALLOUT_PAD_V is the one free design
// choice (padding-top/-bottom, in px so it holds at every PDF_FONT_SIZES entry); CALLOUT_GAP_PX
// (.callout-content's margin-top) is DERIVED from it so the total is RULE_PX by construction —
// correct by construction beats correct by arithmetic: change CALLOUT_PAD_V later and the sum
// still lands on the grid automatically.
const CALLOUT_BORDER_V = 1 // border-top/border-bottom width (border: 1px solid, unchanged design)
const CALLOUT_PAD_V = 8 // padding-top/padding-bottom, px
const CALLOUT_GAP_PX = RULE_PX - 2 * CALLOUT_BORDER_V - 2 * CALLOUT_PAD_V // 22-2-16 = 4

function styles(
    p: ThemePalette,
    fontSizePt?: number,
    showMarkdownSyntax = false,
): string {
    // A concrete body font-size (pt) is emitted only when a caller asks for one (the PDF path,
    // via the export UI). Left off, the document keeps its intrinsic browser sizing so the html
    // and png exports are unchanged.
    const fontSizeRule = fontSizePt ? `font-size: ${fontSizePt}pt;` : ''
    // Opt-in (ExportOptions.showMarkdownSyntax, default false): the "## "/"### "/… markers before
    // h2-h6, mirroring the app's own editor aesthetic. Off by default — the repo owner's export
    // literally rendered "## Problem 1" as visible text, so clean/"nice formatting" is now the
    // default and this becomes opt-in rather than deleted.
    const markdownSyntaxRule = showMarkdownSyntax
        ? `
  /* Headings below h1 keep their markdown marker, rendered in the muted tone — h1 is the
     document TITLE (no marker), same distinction the card draws. */
  h2::before { content: "## "; color: ${p.muted}; font-weight: 400; }
  h3::before { content: "### "; color: ${p.muted}; font-weight: 400; }
  h4::before { content: "#### "; color: ${p.muted}; font-weight: 400; }
  h5::before { content: "##### "; color: ${p.muted}; font-weight: 400; }
  h6::before { content: "###### "; color: ${p.muted}; font-weight: 400; }`
        : ''
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
  ${markdownSyntaxRule}
  p, li { line-height: ${RULE_PX}px; margin: 0; color: ${p.fg}; }
  ul, ol { margin: 0; padding-left: 1.4em; }
  a { color: ${p.accent}; }
  /* Vertical rhythm here is LOAD-BEARING for PDF pagination (GitHub issue #9): the in-app PDF
     rasterizer snaps page-slice height to a whole multiple of RULE_PX (pageGeometry.ts
     pdfSliceMetrics), which only holds if every block occupies a whole number of RULE_PX units.
     margin (${RULE_PX}px top+bottom = 2x RULE_PX) and padding (${RULE_PX / 2}px top+bottom = 1x
     RULE_PX) are each independently a whole multiple, in PX (not em — em depends on the PDF
     path's chosen body font size, so it would only be grid-aligned by coincidence at one size).
     Horizontal padding stays 1rem, unchanged from before this fix. Don't "tidy" this back to em. */
  pre { background: ${p.head}; margin: ${RULE_PX}px 0; padding: ${RULE_PX / 2}px 1rem; border-radius: 6px; overflow: auto;
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
     rasterizer (html2canvas) renders them.
     Vertical rhythm is LOAD-BEARING for PDF pagination (GitHub issue #9), same reasoning as
     pre (above): border-top + padding-top + padding-bottom + border-bottom + .callout-content's
     margin-top must sum to a whole multiple of RULE_PX (22px) so a callout never pushes the
     text below it off the baseline grid pageGeometry.ts's pdfSliceMetrics snaps page breaks to.
     Values are px (not em) — CALLOUT_PAD_V/CALLOUT_GAP_PX above, defined once so the sum is
     RULE_PX by construction — so this holds at every PDF_FONT_SIZES entry, not just the
     default. border-radius, border-left-width, background and horizontal padding are unchanged
     design; don't "tidy" the vertical px values back to em. */
  .callout { margin: ${RULE_PX}px 0; border: ${CALLOUT_BORDER_V}px solid ${p.border}; border-left-width: 4px; border-radius: 6px;
             background: rgba(127,127,127,0.06); padding: ${CALLOUT_PAD_V}px 0.85em; }
  .callout-title { display: flex; align-items: center; gap: 0.45em; font-weight: 600; line-height: ${RULE_PX}px; }
  .callout-icon { display: inline-flex; flex: 0 0 auto; }
  .callout-icon svg { width: 1.1em; height: 1.1em; }
  .callout-title-inner { min-width: 0; }
  .callout-content { margin-top: ${CALLOUT_GAP_PX}px; line-height: ${RULE_PX}px; }
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
`
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
    extraHead = '',
    fontSizePt?: number,
    // Opt-in: only the rendered-prose paths (wrapBody, below) pass this, so a raw markdown/
    // csv text dump or a single rasterized drawing image never grows an out-of-place footer.
    page?: PageInfo,
    // Opt-in: renders the raw markdown marker ("## ", "### ", …) before h2-h6 headings, mirroring
    // the app's own editor aesthetic. Default false (clean formatting) — threaded from
    // ExportOptions.showMarkdownSyntax via exporters.ts's wrapBody; the raw-markdown-dump and
    // drawing-image call sites there never pass it, so they stay at this default.
    showMarkdownSyntax = false,
): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles(palette, fontSizePt, showMarkdownSyntax)}</style>
${extraHead}</head>
<body>
${body}
${page ? pageFooterHtml(title, page) : ''}
</body>
</html>`
}
