// app/src/export/htmlTemplate.ts
import { escapeHtml } from '../htmlEscape'
import { DEFAULT_PALETTE } from './exportTheme'
import { headingSizes } from './types'
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

// The text-baseline grid UNIT: every text-bearing block's line-height is one rule or a whole
// multiple of it, so the document reads on an even rhythm. This list is deliberately exhaustive
// rather than just the obvious prose tags.
//
// It is no longer load-bearing for PAGINATION. It used to be: pdfSliceMetrics snapped the page
// height to a multiple of RULE_PX and trusted every block to be a whole number of rules tall, so
// one `<table>` (a row is ~36.9px) or one `<hr>` walked everything below it off the grid and every
// later page cut sliced a text line in half. htmlToPdf.ts now MEASURES real line positions
// (measureCutStops) and cuts there instead — which is also what frees the rule below to follow the
// user's editor.lineHeight rather than being pinned at 22.
//
// Exported so pageGeometry.ts doesn't duplicate the literal 22 as a second copy that could
// silently drift out of sync with this one.
export const RULE_PX = 22

// .callout's vertical footprint (border-top + padding-top + padding-bottom + border-bottom +
// .callout-content's margin-top) sums to a whole rule, so a callout never pushes the text below it
// off the baseline rhythm. CALLOUT_PAD_V is the one free design choice (padding-top/-bottom, in px
// so it holds at every PDF_FONT_SIZES entry); the gap is DERIVED from it inside styles() so the
// total is one rule by construction at WHATEVER leading the user's editor.lineHeight produces —
// correct by construction beats correct by arithmetic.
const CALLOUT_BORDER_V = 1 // border-top/border-bottom width (border: 1px solid, unchanged design)
const CALLOUT_PAD_V = 8 // padding-top/padding-bottom, px

function styles(
    p: ThemePalette,
    fontSizePt?: number,
    showMarkdownSyntax = false,
    // Opt-in: this document is a rendered NOTE, so it gets the app's prose typography (face,
    // optical scale, and the user's editor.lineHeight) instead of the UI font at a fixed rule. A
    // base's visual export (calendar grid, cards, kanban) leaves this off, because those surfaces
    // use the UI font in the app too.
    prose = false,
): string {
    // Prose is set at proseScale x the body size, so its leading has to come from the TYPE, not
    // from RULE_PX: 22px of leading under a 20.5px serif is a 1.07 ratio, which overlaps adjacent
    // line boxes and reads exactly as cramped as editor.lineHeight's own schema doc warns. The
    // app's ratio (proseLeading) applied to the export's own prose size is what actually
    // transfers. A non-prose document keeps the fixed rule, so every base/calendar/sheet export is
    // byte-identical to before. Rounded to whole px so every line box is an integer height.
    // Nothing about PAGINATION depends on this value any more (see RULE_PX's own docs) — which is
    // what lets it follow a setting at all.
    const bodySizePx = fontSizePt ? (fontSizePt * 96) / 72 : 16
    const rule = prose
        ? Math.max(1, Math.round(bodySizePx * p.proseLeading))
        : RULE_PX
    // Never negative: at a very tight leading the borders + padding can already exceed one rule.
    const calloutGap = Math.max(
        0,
        rule - 2 * CALLOUT_BORDER_V - 2 * CALLOUT_PAD_V,
    )
    // Half a rule of SEPARATION between two stacked formulas, split across the two margins,
    // which do not collapse on an inline-block. Whole px so every line box stays an integer.
    const katexGap = Math.round(rule / 4)
    // The MONO size. Prose renders at --prose-scale (1.28) times the editor size for optical
    // parity with the mono beside it, so anything pulled back to mono divides that out rather
    // than inheriting the scaled size — which is the app's rule, not an approximation.
    const editorPx = prose ? Math.round(bodySizePx / 1.28) : bodySizePx
    const bodyFont = prose ? p.proseFont : p.font
    // A concrete body font-size (pt) is emitted only when a caller asks for one (the PDF path,
    // via the export UI). Left off, the document keeps its intrinsic browser sizing so the html
    // and png exports are unchanged. The chosen size is used LITERALLY for prose too — the app's
    // --prose-scale is not applied here; see ThemePalette.proseLeading for why.
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
    // Headings are DELIBERATELY off the rule grid now, unlike every other block here. The grid
    // stopped being load-bearing for pagination when htmlToPdf started measuring real line boxes
    // (see RULE_PX's own docs), so its remaining job is rhythm — and forcing a heading onto it
    // meant a 19px h2 in a 34px box, a 1.8 ratio where the app uses 1.4. Matching the app's actual
    // leading is worth more than holding the grid for six lines in a document.
    const ts = p.type
    // The ramp is applied to THIS DOCUMENT's body size, not the app's editor font size. Those are
    // independent settings, and carrying resolved sizes across coupled them: at editorFontSize 28
    // with a 9pt export an h3 rendered 28px of glyph in a 5px line box, a 23px overflow.
    const headingPx = headingSizes(ts, bodySizePx)
    const headingRules = ([1, 2, 3, 4, 5, 6] as const)
        .map(n => {
            const i = n - 1
            const size = headingPx[i]
            // EXACTLY what editor/livePreview.ts does: --lh-tight is set on h1 and h2 ONLY. h3..h6
            // have no line-height of their own there and simply inherit the editor's, which here is
            // the prose rule. Applying the tight ratio to all six (tried first) pushed every level
            // to the same box and made an h3 as tall as an h1.
            //
            // Floored at the font size, because the prose rule follows editor.lineHeight and that
            // setting goes down to 0.8 — a ratio below 1 against the type, which would otherwise
            // put a heading's glyphs outside its own line box. Body prose keeps the user's chosen
            // leading whatever it is; a heading is not allowed to overflow.
            const natural = n <= 2 ? Math.round(size * ts.lhTight) : rule
            const lh = Math.max(natural, Math.ceil(size))
            // h1 carries display tracking; h5/h6 earn their smaller size by switching REGISTER —
            // uppercase + label tracking — rather than merely shrinking, and h6 is muted. Drop
            // those and h5 becomes small body text, which is the app's own warning about them.
            const extra =
                n === 1
                    ? ` letter-spacing: ${ts.lsDisplay};`
                    : n >= 5
                      ? ` text-transform: uppercase; letter-spacing: ${ts.lsLabel};${n === 6 ? ' opacity: 0.85;' : ''}`
                      : ''
            return `  h${n} { font-size: ${size}px; font-weight: ${ts.headingWeight[i]}; line-height: ${lh}px; margin: ${rule}px 0 0;${extra} }`
        })
        .join('\n')
    return `
  :root { color-scheme: ${p.scheme}; }
  /* US Letter portrait with a 1in margin on every side. Governs a browser print/"Save as PDF"
     of the exported .html; the in-app PDF rasterizer (htmlToPdf.ts) enforces the same geometry
     explicitly, since html2canvas ignores @page.
     A background ON THE @page RULE is what paints the MARGIN AREA. A printed page's margin
     is not covered by the root background and cannot be reached by anything in the document: an
     element positioned to bleed into it is clipped to the page box. Measured, by sampling the
     rendered PDF rather than reading its content stream: margin rgb(18,18,18) against content
     rgb(21,22,26) — Chrome's own color-scheme: dark canvas showing through, a near-black frame
     around a slightly-lighter column of text.
     A position:fixed bleed layer was tried first and LOOKED right in the content stream (a
     612x792pt rect on every page) while changing nothing on screen, because the fill is clipped.
     Only sampling pixels showed it. A page-rule background paints margin and content alike. */
  @page { size: 8.5in 11in; margin: 1in; background: ${p.bg}; }
  /* The export inlines the app's own font (resolved live) so the document reads as the same
     product. The PDF/PNG path rasterizes via html2canvas, which measures text with canvas
     measureText() — so a concrete named font stack (not a CSS keyword) is required; the
     resolved stack carries its own fallbacks. */
  html, body { margin: 0; background: ${p.bg}; }
  /* Exports are DELIBERATELY unruled (GitHub issue #9): a visible horizontal rule under every
     line of text used to be painted here via a repeating CSS background gradient, across
     every export format (html/pdf/png). The repo owner asked for it removed outright — don't
     re-add it. The padding below stays a whole multiple of ${rule}px (the text-baseline
     grid, still very much alive — see RULE_PX's own docs) purely so it doesn't shift every
     existing export's layout; that no longer aligns the first line to a visible rule, since
     there isn't one anymore. */
  body {
    font-family: ${bodyFont}; ${fontSizeRule}
    max-width: 760px; margin: 0 auto; padding: ${rule * 2}px 1.5rem ${rule * 3}px;
    line-height: ${rule}px; color: ${p.fg};
  }
  /* THE APP'S OWN HEADING SCALE, not the browser's defaults. An exported note used to set no
     heading font-size at all, so every level fell back to the UA stylesheet — a different ramp and
     a different SHAPE from the app's. In the app (editor/livePreview.ts, sizes in
     styles/tokens.css) h3 and h4 sit AT body size and differ only in weight, and h5/h6 change
     REGISTER (uppercase + tracking) rather than merely shrinking. The UA defaults instead step h3
     ABOVE body and shrink h5/h6 into small body text — which is precisely what the app's own
     comment warns turns h5 into "small body text".
     Sizes arrive already resolved on the palette (resolvePalette probes them through real
     properties, since a custom property reads back as its specified text), so nothing here
     re-derives a type scale. Line-height is still snapped to whole rules by headingRules below:
     the SIZES come from the app, the vertical grid stays this document's own. */
${headingRules}
  ${markdownSyntaxRule}
  /* A blank line in the source note ends the paragraph (markdown.ts renders with breaks: true,
     so only a BLANK line — not a single newline — produces a new <p>). Without a bottom margin
     that deliberate spacing collapses to zero, and a blank line reads identically to a plain
     line break. One rule of bottom margin makes a blank line worth exactly one blank line, on
     the same baseline grid as everything else. li keeps margin: 0 — list items are not where
     blank-line spacing is expected, and a margin there would separate list items from each
     other rather than from surrounding prose.
     A "loose" markdown list (blank line between items) wraps each item's text in its own <p>
     (marked's loose-list handling), so that <p> would otherwise carry the same trailing rule as
     prose — a full rule of dead space after every item, including the last, which also pushes
     space after the whole list. The last (or only) paragraph in a list item loses that margin,
     same precedent as .callout-content > :last-child below; an earlier paragraph in a
     multi-paragraph item keeps it, so its own paragraphs still separate from each other.
     :last-of-type, NOT :last-child — when the item's paragraph is followed by a NESTED list
     the <ul> is the last child, so :last-child missed it and the paragraph kept a full rule of
     dead space before the sublist (measured 30px). :last-of-type still means "the final
     paragraph in this item", which is what the rule was always trying to say. */
  p { line-height: ${rule}px; margin: 0 0 ${rule}px; color: ${p.fg}; }
  li { line-height: ${rule}px; margin: 0; color: ${p.fg}; }
  li > p:last-of-type { margin-bottom: 0; }
  ul, ol { margin: 0; padding-left: 1.4em; }
  a { color: ${p.accent}; }
  /* Vertical rhythm: margin (${rule}px top+bottom = 2 rules) and padding (${rule / 2}px
     top+bottom = 1 rule) are each independently a whole multiple of the rule, in PX (not em — em
     depends on the PDF path's chosen body font size, so it would only line up by coincidence at
     one size). This keeps the page reading on an even baseline; it is no longer what keeps a page
     BREAK off a line of text (htmlToPdf.ts measures those directly now). Horizontal padding stays
     1rem. Don't "tidy" the vertical px values back to em. */
  pre { background: ${p.head}; margin: ${rule}px 0; padding: ${rule / 2}px 1rem; border-radius: 6px; overflow: auto;
        white-space: pre-wrap; word-break: break-word; line-height: ${rule}px; }
  /* EVERYTHING PULLED BACK OUT OF PROSE RETURNS TO THE MONO FACE AT THE EDITOR SIZE — the same
     scoping Editor.css applies in the app, not a guess at what looks code-ish. Its list is
     cm-codeblock, cm-inline-code, cm-code-header, cm-code-lang, cm-code-numbered, cm-frontmatter,
     cm-fm-key, cm-math, cm-math-src, cm-inline-math, cm-list-marker, cm-syntax-mark, cm-tag and
     cm-task-field — and BOTH the family and the SIZE reset, because prose is set at --prose-scale
     times the editor size and mono does not want that optical compensation.
     (Those names are written without their leading dots on purpose: a CSS comment ends at the
     first star-slash, and an earlier draft wrote the math classes as one glob, which closed this
     comment early and made the browser silently drop the entire rule below. The emitted file still
     LOOKED right; only reading the CSSOM back showed the rule was never parsed.)
     TABLES AND HEADINGS ARE DELIBERATELY ABSENT, exactly as they are in the app: a table in a note
     is the note's own content rather than chrome, and headings carry their own absolute scale, so
     resetting either would flatten it. The one standing exception the app makes is a #tag inside a
     table cell, which stays mono — kept here too. */
  pre, pre code, code,
  .fmatter, .fmatter-key,
  .bismuth-tag, .bismuth-task-field,
  .bismuth-cell-list .bismuth-tag {
    font-family: ${p.monoFont};
    font-size: ${editorPx}px;
  }
  code { background: ${p.head}; padding: 0.1em 0.35em; border-radius: 4px; }
  pre code { background: none; padding: 0; }
  /* Matches the app's .cm-quote (editor/livePreview.ts): a 2px rule, 8px of padding and a
     softened opacity — not a 3px rule, 1rem of padding and a muted COLOUR, which is what this
     said before and is a visibly heavier quote than the editor shows. */
  blockquote { border-left: 2px solid ${p.border}; margin: 0; padding-left: 8px;
               opacity: 0.85; line-height: ${rule}px; }
  /* The frontmatter block (htmlTemplate.ts frontmatterBlockHtml) — the one sanctioned
     left-accent border in the system, same token the app's own frontmatter/callout gutter
     uses (ui.css --accent-edge). */
  .fmatter { border-left: 2px solid ${p.accent}; margin: 0 0 ${rule}px; padding-left: 0.75rem;
             font-size: 0.85em; line-height: ${rule}px; color: ${p.muted}; }
  .fm-k { color: ${p.muted}; opacity: 0.75; }
  /* Callouts (editor/callout.ts). Neutral translucent fill + a 4px accent left bar; the icon
     inherits the title's accent via currentColor. Concrete per-type accents below so the PDF
     rasterizer (html2canvas) renders them.
     Vertical rhythm, same reasoning as pre (above): border-top + padding-top + padding-bottom +
     border-bottom + .callout-content's margin-top sum to exactly one rule, so a callout never
     pushes the text below it off the baseline rhythm. Values are px (not em) — CALLOUT_PAD_V above
     plus the derived calloutGap — so this holds at every PDF_FONT_SIZES entry AND at every
     editor.lineHeight, not just the default. border-radius, border-left-width, background and
     horizontal padding are unchanged design; don't "tidy" the vertical px values back to em. */
  .callout { margin: ${rule}px 0; border: ${CALLOUT_BORDER_V}px solid ${p.border}; border-left-width: 4px; border-radius: 6px;
             background: rgba(127,127,127,0.06); padding: ${CALLOUT_PAD_V}px 0.85em; }
  .callout-title { display: flex; align-items: center; gap: 0.45em; font-weight: 600; line-height: ${rule}px; }
  .callout-icon { display: inline-flex; flex: 0 0 auto; }
  .callout-icon svg { width: 1.1em; height: 1.1em; }
  .callout-title-inner { min-width: 0; }
  .callout-content { margin-top: ${calloutGap}px; line-height: ${rule}px; }
  .callout-content > :first-child { margin-top: 0; }
  .callout-content > :last-child { margin-bottom: 0; }
  details.callout > summary { cursor: pointer; list-style: none; }
  details.callout > summary::-webkit-details-marker { display: none; }
  ${calloutTypeCss()}
  /* A page break: invisible on screen (height:0), a forced new page when printed. The in-app PDF
     rasterizer slices pages at this element explicitly (htmlToPdf.ts). */
  .bismuth-page-break { break-after: page; page-break-after: always; height: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid ${p.border}; padding: 0.4rem 0.6rem; text-align: left; line-height: ${rule}px; }
  th { background: ${p.head}; }
  img { max-width: 100%; }
  /* Inline KaTeX math must push the line box open instead of painting over the line below it.
     The inlined KaTeX stylesheet (katexCss.ts, injected via extraHead) leaves .katex at its
     library default display: inline for an INLINE formula ($...$), which only contributes its
     line-height (23.232px) to the surrounding line box, never its ink — so a tall fraction/sum
     (measured up to ~47px) overflows straight through the fixed ${rule}px line-height on p/li
     above. inline-block turns that fixed line-height into a MINIMUM instead of a ceiling: the
     line box grows to fit the formula's real height. This selector's specificity ties with the
     KaTeX stylesheet's own bare .katex rule (both one class), but that rule never sets display,
     so this wins regardless of injection order. It does NOT touch display formulas ($$...$$),
     which KaTeX scopes as .katex-display > .katex with display:block — two classes beats one, so
     that rule always wins on its own. The default vertical-align: baseline (inline-block's own
     default) is deliberately left unset — middle would visibly shift every inline formula off
     the text baseline mid-sentence. */
  /* A quarter rule of air above and below, ON TOP of inline-block. A QUARTER, not a half,
     because vertical margins on an inline-block do NOT collapse: the gap between two stacked
     formulas is top + bottom, so a quarter each side is the half rule of separation intended.
     Half each side was tried and measured at a full rule between lines, which took the sample
     note from 8 pages to 12. inline-block alone stops a tall
     formula painting over the line below (that was the bug), but the line box then grows to fit
     the ink EXACTLY, so consecutive formulas TOUCH at a 0px gap and a stack of them reads as one
     dense block. Measured tightestLineLeadingGapPx: 0 at a tight leading.
     The cost, stated so it is a choice: this lands on ANY line carrying inline maths, not only a
     stack of display-style lines, so a lone symbol mid-prose sits in a slightly taller line than
     its neighbours — and documents get longer. On a maths-heavy note, which is where this was
     reported, loosening every such line is the point. */
  .katex { display: inline-block; margin-top: ${katexGap}px; margin-bottom: ${katexGap}px; }
  /* Page footer: filename left, "n / total" right — the ONE footer per document. */
  .pagefoot { margin-top: ${rule}px; line-height: ${rule}px; font-size: 9px;
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
    // Opt-in: this document is rendered NOTE prose, so it takes the app's prose face + the user's
    // editor.lineHeight (see styles()). Threaded from exporters.ts, which is what knows whether a
    // given export is a note or a base's visual view.
    prose = false,
): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles(palette, fontSizePt, showMarkdownSyntax, prose)}</style>
${extraHead}</head>
<body>
${body}
${page ? pageFooterHtml(title, page) : ''}
</body>
</html>`
}
