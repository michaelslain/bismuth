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
 *  `@page` override: the document's own `@page{margin:1in}` is what WebKit honours. WebKit also
 *  ignores `break-after`/`break-before: avoid` on headings, so keep-with-next is done by
 *  `keepHeadingsWithNext` (below), whose `.bismuth-keep` wrap is what this rule protects. */
const WEBKIT_PRINT_BREAKS =
    'tr,table,img,svg,.katex-display{break-inside:avoid;page-break-inside:avoid}' +
    '.katex-display{padding:0.3em 0}' +
    '.bismuth-keep{break-inside:avoid;page-break-inside:avoid}'

/** Keep-with-next for headings, run inside the export document before it prints. Each heading is
 *  wrapped in a `break-inside: avoid` div together with an empty spacer as tall as the first
 *  `KEEP_PX` of whatever follows it; the spacer's equal negative bottom margin pulls the following
 *  block back up over it, so the layout does not move. A heading near the foot of a page whose
 *  wrap does not fit moves to the next page, so it is never stranded above its body.
 *
 *  The following block itself stays OUT of the wrap: wrapping a whole list or long paragraph made
 *  the unbreakable unit as tall as that block, and WebKit pushed all of it to the next page,
 *  leaving most of a page blank before every heading whose section did not fit.
 *
 *  Runs in the page, not in the app: it is serialized into WEBKIT_PRINT_HEAD with
 *  `Function.prototype.toString`, so it must reference nothing outside its own body. */
export function keepHeadingsWithNext(doc: Document): void {
    const KEEP_PX = 48
    const top = (el: Element): number => el.getBoundingClientRect().top
    const hs = Array.from(doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    // Last first, so a heading followed by another heading reserves space for that heading's
    // own wrap (heading plus its first lines), not just the bare heading.
    for (let i = hs.length - 1; i >= 0; i--) {
        const h = hs[i] as HTMLElement
        const next = h.nextElementSibling as HTMLElement | null
        if (!next || !h.parentNode) continue
        const reserve = Math.min(KEEP_PX, next.getBoundingClientRect().height)
        const hTop = top(h)
        const nextTop = top(next)
        const wrap = doc.createElement('div')
        wrap.className = 'bismuth-keep'
        const spacer = doc.createElement('div')
        spacer.style.height = reserve + 'px'
        spacer.style.marginBottom = -reserve + 'px'
        h.parentNode.insertBefore(wrap, h)
        wrap.appendChild(h)
        wrap.appendChild(spacer)
        // The wrap changes how the heading's margins collapse with its neighbours; shift both
        // back to where they were laid out before it existed.
        const hShift = top(h) - hTop
        if (hShift)
            h.style.marginTop =
                parseFloat(getComputedStyle(h).marginTop) - hShift + 'px'
        const nextShift = top(next) - nextTop
        if (nextShift)
            spacer.style.marginBottom = -reserve - nextShift + 'px'
    }
}

/** Zeroes the bottom margin of the document's trailing element chain (the body's last child, its
 *  last child, and so on down). Those margins collapse through to the end of the body, and when
 *  the last line sits near the foot of a page they overflow it, so WebKit printed an extra page
 *  holding nothing but that margin. Same in-page constraint as `keepHeadingsWithNext`. */
export function trimTrailingMargin(doc: Document): void {
    let el = doc.body.lastElementChild as HTMLElement | null
    while (el) {
        el.style.marginBottom = '0'
        el = el.lastElementChild as HTMLElement | null
    }
}

/** Head markup for the WebKit print path: the body override, print colour adjust so backgrounds
 *  print, the break rules above, keep-with-next for headings, the trailing-margin trim, and the
 *  fonts-ready marker script.
 *  The wrap runs inside the `document.fonts.ready.then(...)` callback — the body is fully parsed
 *  and laid out with its real fonts by then — and MUST run before `document.title` is set to
 *  PRINT_READY_TITLE, since the native printer polls for that title as its "go" signal. */
export const WEBKIT_PRINT_HEAD =
    `<style>${PDF_BODY_OVERRIDE}html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}${WEBKIT_PRINT_BREAKS}</style>` +
    '<script>document.fonts.ready.then(function(){' +
    `(${keepHeadingsWithNext.toString()})(document);` +
    `(${trimTrailingMargin.toString()})(document);` +
    `document.title=${JSON.stringify(PRINT_READY_TITLE)}` +
    '})</script>'

/** Insert `markup` immediately before `</head>` (case-insensitive, first occurrence); a document
 *  with no `</head>` gets it prepended to the string. Pure. */
export function injectHead(html: string, markup: string): string {
    const i = html.search(/<\/head>/i)
    return i === -1 ? markup + html : html.slice(0, i) + markup + html.slice(i)
}
