// app/src/export/printCss.ts
// CSS + head markup the PDF printers inject into an export document. Pure strings, shared by the
// WebKit printer (pdfPrint.ts) and the html2canvas fallback (htmlToPdf.ts) so both engines lay
// the body out at the same printable width and a page's geometry never depends on the engine.

/** Fill the raster/page edge-to-edge into the printable box: drop the shared template's reading
 *  column (max-width + body padding) so the ONLY margin is the 1in page margin; zero the first
 *  block's intrinsic top margin so content begins exactly at the 1in boundary. */
export const PDF_BODY_OVERRIDE =
    'html,body{margin:0!important;padding:0!important;max-width:none!important;width:100%!important;}' +
    'body>:first-child{margin-top:0!important;}'

/** Marker the export document sets on `document.title` once its embedded fonts are ready; the
 *  native printer polls for it before printing (WKWebView.title is readable without a delegate).
 *  The PDF's own Title metadata is set by print_pdf.rs's CoreGraphics compose step (kCGPDFContextTitle), never from this. */
export const PRINT_READY_TITLE = '__bismuth_print_ready__'

/** Measured in the WebKit print spike: `break-inside: avoid` on `tr` alone is ignored by WebKit
 *  (a row split with its empty top half on one page), on `table` it holds (a table taller than a
 *  page still breaks — avoid is only a preference); the display-formula padding keeps the integral
 *  glyph's overflow inside its box, which otherwise left a 1-2px sliver on the previous page. No
 *  `@page` override: the document's own `@page{margin:1in}` is what WebKit honours. The heading
 *  rules keep a heading on the same page as the block it introduces, so it never gets stranded
 *  alone at the foot of a page with its body pushed to the next. */
const WEBKIT_PRINT_BREAKS =
    'tr,table,img,svg,.katex-display{break-inside:avoid;page-break-inside:avoid}' +
    '.katex-display{padding:0.3em 0}' +
    'h1,h2,h3,h4,h5,h6{break-after:avoid;page-break-after:avoid}' +
    'h2+blockquote,h3+blockquote{break-before:avoid;page-break-before:avoid}'

/** Head markup for the WebKit print path: the body override, print colour adjust so backgrounds
 *  print, the break rules above, and the fonts-ready marker script. */
export const WEBKIT_PRINT_HEAD =
    `<style>${PDF_BODY_OVERRIDE}html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}${WEBKIT_PRINT_BREAKS}</style>` +
    `<script>document.fonts.ready.then(function(){document.title=${JSON.stringify(PRINT_READY_TITLE)}})</script>`

/** Insert `markup` immediately before `</head>` (case-insensitive, first occurrence); a document
 *  with no `</head>` gets it prepended to the string. Pure. */
export function injectHead(html: string, markup: string): string {
    const i = html.search(/<\/head>/i)
    return i === -1 ? markup + html : html.slice(0, i) + markup + html.slice(i)
}
