// app/src/export/htmlToPdf.ts
// Renders an HTML *document* string to PDF or PNG bytes.
//
// Fidelity strategy: the output must look like the in-app preview, which is just the browser
// rendering the HTML. jsPDF's own pdf.html() reflows text through a separate engine and
// looks nothing like the browser. Instead we render the HTML in an isolated off-screen
// iframe (its own document — body/<style> can't leak into the app), snapshot that real
// browser rendering with html2canvas, then (for PDF) slice the image across Letter pages.
// The iframe document is fully self-contained, so embedded KaTeX CSS+fonts (data: URIs, via
// exporters.ts) are what make exported math render — the iframe can't see the app's fonts.
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { sanitizeDocColorsForRaster, normalizeCssColor } from './cssColor'
import { RULE_PX } from './htmlTemplate'
import {
    PAGE_W_PX,
    CONTENT_W_PX,
    PAGE_W_PT,
    PAGE_H_PT,
    MARGIN_PT,
    CONTENT_W_PT,
    pdfSliceMetrics,
    pageSlices,
    legalCutStops,
} from './pageGeometry'

// US Letter portrait with a 1in margin on every side — geometry lives in pageGeometry.ts
// (jsPDF "letter" page = 612 x 792 pt; source rasterized at 8.5in @ 96dpi = 816px wide).

// Let the off-screen iframe lay out before measuring/snapshotting. Uses setTimeout, NOT
// requestAnimationFrame: rAF is throttled to zero in a hidden/backgrounded tab, so an
// export started (or left running) while the window isn't foreground would hang forever
// waiting for a frame that never comes. A fixed delay always fires.
const settle = (ms = 50): Promise<void> => new Promise(r => setTimeout(r, ms))

// The 22px baseline grid (RULE_PX, htmlTemplate.ts) that pdfSliceMetrics() relies on only
// holds if every block is a whole multiple of RULE_PX tall — but a `<p>`/`<li>` containing
// inline KaTeX math can render TALLER than its own line-height: a stacked fraction or
// superscript expands the line box to fit it, exactly like the pre/.callout gap this same
// grid work already fixed once. Rather than clamp math to the grid (which would clip tall
// expressions), measure each math-bearing block's REAL rendered height post-layout and pad
// its bottom edge out to the next grid line, so nothing is clipped and every block after it
// lands back on the grid pdfSliceMetrics() assumes. Must run after `doc.fonts.ready` (KaTeX's
// embedded glyph fonts change its measured height) and before anything reads scrollHeight/
// offsetTop for slicing.
function snapMathBlocksToGrid(doc: Document): void {
    // The nearest block-level ancestor is what actually owns the line box a `.katex` sits in —
    // padding the inline math span itself wouldn't change the surrounding block's height.
    const BLOCK_SELECTOR =
        'p, li, h1, h2, h3, h4, h5, h6, td, th, .callout-content, .fmatter'
    const seen = new Set<Element>()
    for (const math of doc.querySelectorAll<HTMLElement>('.katex')) {
        const block = math.closest<HTMLElement>(BLOCK_SELECTOR)
        if (!block || seen.has(block)) continue
        seen.add(block)
        const height = block.getBoundingClientRect().height
        const remainder = height % RULE_PX
        // Sub-pixel remainders (rounding noise) aren't worth padding for; anything past ~0.5px
        // is a real overflow into the next grid line.
        if (remainder <= 0.5) continue
        const pad = RULE_PX - remainder
        const cs = getComputedStyle(block)
        const currentMargin = parseFloat(cs.marginBottom) || 0
        block.style.marginBottom = `${currentMargin + pad}px`
    }
}

// Where a page boundary may legally land, measured from the laid-out document.
//
// The 22px baseline grid (RULE_PX) is a TYPOGRAPHIC rule, and pagination used to lean on it:
// pdfSliceMetrics snaps the page height to a whole multiple of the grid and trusts every block to
// be a whole number of rules tall. A `<table>` row (a 22px line + 2x0.4rem padding + borders =
// ~36.9px) and an `<hr>` (2px + 2x8px default margin) are not, so ONE table shifted every block
// below it off the grid and every following page cut sliced a text line in half — measured at
// 10.5px into an 18px glyph rect, on all four cuts after the table in a six-page probe note. Three
// earlier rounds each conformed one more block type (pre, callouts, math); that work is unbounded,
// because any CSS edit can re-open it and no test that does not RENDER can catch it.
//
// So the geometry is measured instead of assumed. An "atom" is anything that must not be sliced:
// every rendered line box, and every replaced or indivisible element. A cut is legal at the BOTTOM
// of an atom that no other atom straddles — that nested filter is what stops a line inside a table
// cell offering a cut that would saw through the row around it.
//
// Returns ascending canvas-px offsets (the same space pageSlices' `breaks` are in).
function measureCutStops(doc: Document, scale: number): number[] {
    // A table ROW, not the whole table: a table taller than a page must still paginate. `.katex`
    // is an atom too — KaTeX renders a formula as nested spans with no atom of its own, so every
    // internal fragment (numerator, denominator, exponent) was offering its own text-node stop,
    // almost all of them illegal (interior to the formula) but "legal" by this function's own
    // enclosure test, since only the `.katex` span enclosed them and it wasn't in the atom list.
    const ATOM_SELECTOR = 'tr, img, svg, canvas, hr, video, .katex'
    const scrollY = doc.defaultView?.scrollY ?? 0
    const atoms: { top: number; bottom: number }[] = []
    const push = (top: number, bottom: number): void => {
        if (bottom - top > 0.5)
            atoms.push({ top: top + scrollY, bottom: bottom + scrollY })
    }
    for (const el of Array.from(
        doc.querySelectorAll<HTMLElement>(ATOM_SELECTOR),
    )) {
        const r = el.getBoundingClientRect()
        push(r.top, r.bottom)
    }
    // getClientRects() on a text node's range yields ONE rect per rendered line — the real line
    // boxes, wrapping included, which is the whole point. An element-level walk could not see them.
    // Text inside `.katex` is skipped: it is already covered by the formula atom above, and it is
    // the bulk of the walk (thousands of interior fragments on a math-heavy note).
    const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walk.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue
        if ((node.parentElement as HTMLElement | null)?.closest('.katex'))
            continue
        const range = doc.createRange()
        range.selectNodeContents(node)
        for (const r of Array.from(range.getClientRects()))
            push(r.top, r.bottom)
    }
    // The enclosure test that turns atoms into legal stops is pure (no DOM), and lives in
    // pageGeometry.ts as `legalCutStops` so it is unit-tested without a browser — see
    // pageGeometry.test.ts. Collecting the atoms themselves stays here because it needs the DOM
    // (getBoundingClientRect / getClientRects).
    return legalCutStops(atoms, scale)
}

/**
 * Render an HTML document string to a single full-content canvas via an off-screen iframe.
 * Shared by the PDF (sliced into pages) and PNG (single image) exporters. The caller's
 * document MUST be self-contained — the iframe inherits nothing from the app, and
 * `doc.fonts.ready` here is what gates the snapshot on embedded @font-face fonts (incl.
 * the inlined KaTeX glyph fonts) so math is measured/drawn correctly.
 */
async function htmlToCanvas(
    html: string,
    bodyOverrideCss = '',
    contentWidthPx = PAGE_W_PX,
): Promise<{
    canvas: HTMLCanvasElement
    bg: string
    breaks: number[]
    stops: number[]
}> {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${contentWidthPx}px;height:200px;border:0;`
    document.body.appendChild(iframe)
    try {
        const doc = iframe.contentDocument!
        doc.open()
        doc.write(html)
        doc.close()
        // For the paged PDF path: neutralize the shared template's reading-column gutter (its
        // max-width + body padding) so the content fills the raster width and maps edge-to-edge
        // into the printable box — the 1in whitespace then comes solely from the PDF page margin,
        // making it exactly 1in on every side rather than 1in plus the on-screen gutter. Injected
        // last so it wins the cascade. No-op ("") for the PNG path, which keeps the reading column.
        if (bodyOverrideCss) {
            const style = doc.createElement('style')
            style.textContent = bodyOverrideCss
            doc.head.appendChild(style)
        }
        // Let the iframe document lay out, then grow the frame to the full content height so
        // html2canvas captures everything (not just the initial viewport).
        await settle()
        iframe.style.height = `${doc.body.scrollHeight}px`
        // Ensure fonts are loaded so html2canvas measures text with the right metrics. With
        // inlined KaTeX fonts (data: URIs) this resolves once the math glyph fonts are ready.
        // Race a cap so a never-resolving fonts.ready (some embedded-font edge cases) can't hang.
        try {
            await Promise.race([doc.fonts?.ready, settle(4000)])
        } catch {
            /* proceed */
        }
        await settle()

        // Math is measured/laid out now that KaTeX's embedded fonts are ready — pad any
        // math-bearing block back onto the grid before anything below reads layout for slicing.
        snapMathBlocksToGrid(doc)
        iframe.style.height = `${doc.body.scrollHeight}px`

        // Defense-in-depth against html2canvas's color parser: it throws on any CSS Color 4
        // function ("Attempting to parse an unsupported color function 'color'"). The palette is
        // normalized at read time (resolvePalette), but KaTeX/view/extra CSS could still compute
        // to color(srgb …) — inline a normalized rgb() over every unsafe computed color before
        // snapshotting. No-op (0 rewrites) for a clean document.
        sanitizeDocColorsForRaster(doc)

        // The body background feeds html2canvas + the PDF page fill directly, so normalize it too.
        const bg = normalizeCssColor(
            getComputedStyle(doc.body).backgroundColor || '#ffffff',
            '#ffffff',
        )
        // Browsers cap a canvas at ~32767px per side. At the default 2x scale that's ~16k source
        // px (~17 Letter pages); a taller doc makes html2canvas silently return a blank/clamped
        // canvas. Drop the scale so the scaled height stays under the cap (lower-res but valid)
        // — matters most for PNG, which is one image with no page slicing.
        const MAX_CANVAS_PX = 32000
        const ratio = MAX_CANVAS_PX / Math.max(1, doc.body.scrollHeight)
        const scale = ratio >= 1 ? Math.min(2, Math.floor(ratio)) : ratio
        // Explicit page-break markers (bases/markdown.ts `<div class="bismuth-page-break">`): their
        // post-layout Y offset, scaled into canvas pixels. The PDF slicer cuts a new page at each.
        // Measured here (after layout has settled) while the iframe doc is still live. A marker before
        // the first content (offsetTop ≈ body padding-top) or after the last (≈ content bottom) would
        // slice off an empty page, so ignore markers outside the real content band.
        const padCs = getComputedStyle(doc.body)
        const padTop = parseFloat(padCs.paddingTop) || 0
        const contentBottom =
            doc.body.scrollHeight - (parseFloat(padCs.paddingBottom) || 0)
        const breaks = Array.from(
            doc.querySelectorAll<HTMLElement>('.bismuth-page-break'),
        )
            .map(el => el.offsetTop)
            .filter(y => y > padTop + 1 && y < contentBottom - 1)
            .map(y => Math.round(y * scale))
            .sort((a, b) => a - b)
        // Measured on the LIVE iframe document, before html2canvas replaces it with its own clone:
        // the y offsets where a page boundary can land without cutting through a line or an
        // indivisible element. Same canvas-px space as `breaks` above.
        const stops = measureCutStops(doc, scale)
        const canvas = await html2canvas(doc.body, {
            scale,
            backgroundColor: bg,
            width: contentWidthPx,
            windowWidth: contentWidthPx,
            useCORS: true,
        })
        if (canvas.height === 0)
            throw new Error('htmlToCanvas: nothing to render')
        return { canvas, bg, breaks, stops }
    } finally {
        iframe.remove()
    }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

/** Rasterize a self-contained HTML document to a single PNG (bytes + a data: URL preview). */
export async function htmlToPng(
    html: string,
): Promise<{ bytes: Uint8Array; dataUrl: string }> {
    const { canvas } = await htmlToCanvas(html)
    const dataUrl = canvas.toDataURL('image/png')
    return { bytes: dataUrlToBytes(dataUrl), dataUrl }
}

// Fill the raster edge-to-edge into the printable box: drop the shared template's reading
// column (max-width + body padding) so the ONLY margin is the 1in page margin below.
const PDF_BODY_OVERRIDE =
    `html,body{margin:0!important;padding:0!important;max-width:none!important;width:100%!important;}` +
    // The first block's intrinsic top margin (e.g. an <h1>'s margin-top) would otherwise stack on
    // top of the 1in page margin; zero it so content begins exactly at the 1in boundary.
    `body>:first-child{margin-top:0!important;}`

// JPEG (opaque — pages are bg-filled) keeps a multi-page doc to a few hundred KB; a full-page 2x
// PNG raster runs to ~10MB/page. 0.92 is visually lossless at document zoom.
const JPEG_QUALITY = 0.92

/**
 * Render a self-contained HTML document to a list of full US-Letter **page canvases**. This is
 * the single pagination pipeline shared by `htmlToPdf` (packs the pages into a PDF) and
 * `htmlToPdfPages` (data: URLs for the export PREVIEW) — so what the preview shows is exactly
 * what the PDF contains, page for page.
 *
 * The content is rasterized once (full height), then `pageSlices` cuts it into page-sized bands
 * — content taller than one page **auto-flows onto page 2, 3, …** with or without explicit
 * `<!-- pagebreak -->` markers (markers just end a page early). Each band is drawn onto a
 * bg-filled Letter canvas inside the 1in margin on every side, so every page is 8.5x11in with a
 * 1in margin regardless of content length.
 */
async function renderLetterPages(
    html: string,
): Promise<{ pages: HTMLCanvasElement[]; bg: string }> {
    // Lay the body out at the 6.5in printable width (CONTENT_W_PX), not the full 8.5in page: the
    // raster then maps 1:1 into the printable box (96px == 72pt == 1in) with no horizontal squeeze,
    // so a chosen font size renders at its true point size and every margin is exactly 1in.
    const { canvas, bg, breaks, stops } = await htmlToCanvas(
        html,
        PDF_BODY_OVERRIDE,
        CONTENT_W_PX,
    )
    // Source px per printable page (inside the margins), and the px<->pt density of the raster.
    const { pageHpx } = pdfSliceMetrics(canvas.width)
    const density = canvas.width / CONTENT_W_PT // source px per PDF point
    const pageWpxFull = Math.round(PAGE_W_PT * density) // full Letter width in source px
    const pageHpxFull = Math.round(PAGE_H_PT * density) // full Letter height in source px
    const marginPx = Math.round(MARGIN_PT * density) // 1in margin in source px

    const makePage = (start: number, height: number): HTMLCanvasElement => {
        const page = document.createElement('canvas')
        page.width = pageWpxFull
        page.height = pageHpxFull
        const ctx = page.getContext('2d')!
        // Paint the whole page (including the 1in margin band) with the document background so the
        // margin stays on-theme (a dark page is fully dark, not white around the content).
        ctx.fillStyle = bg
        ctx.fillRect(0, 0, page.width, page.height)
        if (height > 0) {
            // Place the content band inside the 1in margins at 1:1 source scale (the whole page is
            // later scaled to 612x792pt, which reproduces the printable-box mapping exactly).
            ctx.drawImage(
                canvas,
                0,
                start,
                canvas.width,
                height,
                marginPx,
                marginPx,
                canvas.width,
                height,
            )
        }
        return page
    }

    const slices = pageSlices(canvas.height, pageHpx, breaks, stops)
    const pages = slices.map(s => makePage(s.start, s.height))
    // A blank/empty document still yields one valid blank Letter page.
    if (pages.length === 0) pages.push(makePage(0, 0))
    return { pages, bg }
}

/** Render a self-contained HTML document to a paginated US-Letter PDF (bytes). */
export async function htmlToPdf(html: string): Promise<Uint8Array> {
    const { pages } = await renderLetterPages(html)
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    pages.forEach((page, i) => {
        if (i > 0) pdf.addPage('letter')
        pdf.addImage(
            page.toDataURL('image/jpeg', JPEG_QUALITY),
            'JPEG',
            0,
            0,
            PAGE_W_PT,
            PAGE_H_PT,
        )
    })
    return new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer)
}

/**
 * The same paginated US-Letter pages `htmlToPdf` writes, as JPEG data: URLs — one per page —
 * for the export PREVIEW. Rendering the real pages (not the raw source HTML) is what makes the
 * preview show the exact multi-page 8.5x11in / 1in-margin layout the downloaded PDF has.
 */
export async function htmlToPdfPages(html: string): Promise<string[]> {
    const { pages } = await renderLetterPages(html)
    return pages.map(page => page.toDataURL('image/jpeg', JPEG_QUALITY))
}
