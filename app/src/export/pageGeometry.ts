// app/src/export/pageGeometry.ts
// Pure geometry for the browser PDF exporter (htmlToPdf.ts).
//
// The exported PDF is US Letter portrait (8.5in x 11in) with a 1 inch margin on every side —
// equivalent to the CSS `@page { size: 8.5in 11in; margin: 1in; }` a browser-print path would
// use, but computed explicitly here because htmlToPdf rasterizes the document with html2canvas
// and slices that single canvas across pages itself (html2canvas ignores @page rules).
//
// Units: PDF points at 72pt/in. Letter = 612 x 792 pt; a 1in margin = 72pt; so the printable
// (content) box is 468 x 648 pt. The source HTML is rasterized at 8.5in @ 96dpi (816px wide)
// and the resulting canvas is mapped edge-to-edge into the printable box.
//
// The pure parts (page constants + px->pt slice scale + an rgb() parser used to paint the page
// background into the 1in margin band) are unit-tested in pageGeometry.test.ts.

import { RULE_PX } from './htmlTemplate'

/** US Letter portrait, in PDF points (72pt/in): 8.5in x 11in. */
export const PAGE_W_PT = 612 // 8.5 * 72
export const PAGE_H_PT = 792 // 11 * 72

/** 1 inch margin on every side. */
export const MARGIN_PT = 72 // 1 * 72

/** Printable content box = Letter minus a 1in margin on each edge. */
export const CONTENT_W_PT = PAGE_W_PT - 2 * MARGIN_PT // 468
export const CONTENT_H_PT = PAGE_H_PT - 2 * MARGIN_PT // 648

/** Source raster width: 8.5in @ 96dpi. The iframe body is laid out at this width (PNG path). */
export const PAGE_W_PX = 816 // 8.5 * 96

/**
 * PDF content raster width: the 6.5in PRINTABLE box @ 96dpi. The PDF path lays the body out at
 * this width (not the full 8.5in page) so the raster maps edge-to-edge into the printable box
 * with NO squeeze — 96 source px == 72 PDF pt == 1 inch. That 1:1 inch mapping is what makes a
 * chosen font size (pt) render at its true point size in the PDF, and keeps every margin exactly
 * 1in. (The PNG path still lays out at the full PAGE_W_PX with the reading column.)
 */
export const CONTENT_W_PX = 624 // 6.5 * 96

/**
 * Snap a raw size DOWN to the nearest whole multiple of `unit` (same px space). Falls back to
 * the floored raw value when `unit` doesn't fit within `raw` at all (or is non-positive) —
 * naive snapping would zero the result out in that case, and pageSlices' `while (offset <
 * contentHpx)` loop advances by the slice height each iteration, so a zero-height slice would
 * never advance `offset` and loop forever. `raw` is assumed non-negative (callers here always
 * pass a page-height-shaped value); a negative `raw` just floors through unchanged.
 */
export function snapDownToGrid(raw: number, unit: number): number {
    if (!(unit > 0)) return Math.floor(raw)
    const snapped = Math.floor(raw / unit) * unit
    return snapped > 0 ? snapped : Math.floor(raw)
}

/**
 * Map a rasterized canvas (whose width fills the printable box) onto Letter pages:
 *   - `scale` converts source canvas px -> PDF pt inside the 1in margins.
 *   - `pageHpx` is how many source px of height fill ONE printable page (the vertical slice
 *     height the pager cuts at, before honoring any earlier forced page-break marker).
 *
 * `pageHpx` is snapped DOWN to a whole multiple of the 22px (RULE_PX) text-baseline grid the
 * export document is built on (htmlTemplate.ts) — every line-height is RULE_PX or a whole
 * multiple of it, so a page boundary that isn't grid-aligned is guaranteed to eventually cut
 * straight through the middle of a text line (GitHub issue #9: the raw, unsnapped page height
 * divided by the grid landed on 39.2727... lines at every raster scale — never a whole number
 * — so EVERY page boundary sliced mid-line, deterministically). The grid is defined in CSS px;
 * the raster may be scaled up by a device-pixel factor, so it's converted into canvas px via
 * `canvasWidthPx / CONTENT_W_PX` (the CSS width the PDF path lays the document out at) before
 * snapping. Cost is at most one rule's worth of page height per page — under one line.
 *
 * Pure so the pager's math is unit-tested without a DOM.
 */
export function pdfSliceMetrics(canvasWidthPx: number): {
    scale: number
    pageHpx: number
} {
    const scale = CONTENT_W_PT / canvasWidthPx // canvas px -> pt within the printable box
    const rawPageHpx = CONTENT_H_PT / scale // source px per printable page, before grid-snapping
    const ruleCanvasPx = RULE_PX * (canvasWidthPx / CONTENT_W_PX) // the CSS rule, in canvas px
    const pageHpx = snapDownToGrid(rawPageHpx, ruleCanvasPx)
    return { scale, pageHpx }
}

/** An indivisible rendered thing (a line box, or a replaced/atomic element) in the same
 *  coordinate space — CSS px measured from the laid-out document, before any canvas scale is
 *  applied. */
export interface CutAtom {
    top: number
    bottom: number
}

/**
 * Turn a set of atoms (line boxes + indivisible elements, already collected from the DOM by
 * `measureCutStops` in htmlToPdf.ts) into the list of legal page-cut stops, in CANVAS px.
 *
 * An atom's bottom edge is legal unless some atom ENCLOSES it — starts at or above this one and
 * ends below it. That is the nesting case (a text line inside a table row, or an interior KaTeX
 * fragment inside the `.katex` span around it), and it is the only one that matters: cutting at
 * the interior edge would saw through the atom drawn around it.
 *
 * Deliberately NOT "no atom overlaps this edge". `getClientRects()` returns each line's ink box,
 * not its line box, and at a tight leading consecutive lines' ink boxes overlap. The overlap test
 * disqualified every text edge in the document, leaving a handful of stops instead of hundreds and
 * dropping the pager straight back to raw grid cuts. Sibling atoms that overlap are still the
 * right place to cut — the app renders them overlapping too.
 *
 * Sorted by top, the enclosing candidates for `a` are exactly those with `top <= a.top` — a
 * prefix — so a prefix-max of bottoms answers it in one comparison rather than a nested scan (a
 * long document has one atom per line, and the nested form is quadratic in that).
 *
 * Pure (no DOM) so the enclosure math is unit-tested without a browser — see
 * pageGeometry.test.ts. `scale` converts the atoms' CSS-px coordinates into the canvas-px space
 * `pageSlices`' `stops` argument expects.
 */
export function legalCutStops(atoms: CutAtom[], scale: number): number[] {
    if (!atoms.length) return []
    const sorted = [...atoms].sort((a, b) => a.top - b.top)
    const tops = sorted.map(a => a.top)
    const maxBottom: number[] = []
    let running = -Infinity
    for (const a of sorted) {
        running = Math.max(running, a.bottom)
        maxBottom.push(running)
    }
    const stops: number[] = []
    for (const a of sorted) {
        // Index of the last atom starting at or above this one.
        let lo = 0
        let hi = tops.length - 1
        let k = -1
        while (lo <= hi) {
            const mid = (lo + hi) >> 1
            if (tops[mid] <= a.top + 0.5) {
                k = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        // `a` itself is in that prefix, but `a.bottom > a.bottom + 0.5` is false, so an atom never
        // disqualifies its own edge.
        if (k >= 0 && maxBottom[k] > a.bottom + 0.5) continue
        stops.push(Math.round(a.bottom * scale))
    }
    return [...new Set(stops)].sort((x, y) => x - y)
}

/** One page's slice of the source content raster: a [start, start+height) band of canvas px. */
export interface PageSlice {
    /** Source-canvas Y (px) where this page's content starts. */
    start: number
    /** Source-canvas height (px) of this page's content (< pageHpx for the last / a forced-break page). */
    height: number
}

/**
 * Slice a rasterized content canvas of total height `contentHpx` into page-sized bands, each
 * at most `pageHpx` tall (one printable page). This is what makes a PDF **auto-paginate**:
 * content taller than one page overflows onto page 2, 3, … even with NO explicit page-break
 * markers. Each entry in `breaks` (source-px Y offsets of forced `.bismuth-page-break` markers,
 * already scaled into canvas px) ends its page early — the next band starts exactly at the
 * marker. Mirrors the natural-vs-forced cut the pager used to inline in htmlToPdf.ts.
 *
 * `stops` are the y positions (canvas px) where a cut is LEGAL — measured from the laid-out
 * document by htmlToPdf.ts's measureCutStops, one per rendered line box and per indivisible
 * element. A natural page bottom is pulled back to the last stop that fits, so a boundary can
 * never saw through a line of text. Passing none keeps the historical raw-height behavior.
 *
 * Why this exists rather than a grid rule (GitHub issue #9, fourth pass): pageHpx is snapped to
 * the 22px baseline grid by pdfSliceMetrics, which only lands on a line boundary if EVERY block
 * in the document is a whole number of rules tall. A `<table>` row (22px line + 2x0.4rem padding
 * + borders) and an `<hr>` (2px + 2x8px margin) are not, so one table shifted every block below
 * it off the grid and every following cut sliced a line in half — measured at 10.5px into an
 * 18px glyph rect, on all four cuts after the table in a six-page probe note. Conforming one
 * more block type per round is unbounded work; measuring where the lines actually are is not.
 *
 * Pure (no DOM) so the pagination math is unit-tested in pageGeometry.test.ts.
 */
export function pageSlices(
    contentHpx: number,
    pageHpx: number,
    breaks: number[] = [],
    stops: number[] = [],
): PageSlice[] {
    const out: PageSlice[] = []
    if (contentHpx <= 0 || pageHpx <= 0) return out
    const sorted = [...breaks].sort((a, b) => a - b)
    const legal = [...stops].sort((a, b) => a - b)
    let offset = 0
    let bi = 0 // cursor into the sorted forced-break offsets
    while (offset < contentHpx) {
        // Skip markers at/above the current offset so a marker on a page boundary never emits an
        // empty page.
        while (bi < sorted.length && sorted[bi] <= offset) bi++
        let end = offset + pageHpx // natural full-page bottom
        if (bi < sorted.length && sorted[bi] < end) {
            // A forced break inside this page ends it early; the next band starts AT the marker.
            end = sorted[bi]
            bi++
        } else if (legal.length && end < contentHpx) {
            // Pull the cut back to the last position where nothing is being sliced through. Only
            // when the page really does overflow: on the LAST page the natural bottom is already
            // past the content end, and pulling back there would drop the tail of the document off
            // the PDF entirely. lastStopIn is strictly greater than `offset`, so the loop always
            // advances; when nothing legal fits (one atom taller than a whole page) the raw bottom
            // stands and that atom is cut — there is no better answer, and looping forever is not
            // one.
            const back = lastStopIn(legal, offset, end)
            if (back !== null) end = back
        }
        end = Math.min(end, contentHpx)
        out.push({ start: offset, height: end - offset })
        offset = end
    }
    return out
}

/** The largest value of the ascending-sorted `stops` inside `(lo, hi]`, or null when none is.
 *  Binary search rather than a scan: a long document has one stop per rendered LINE (thousands),
 *  and this is called once per page. */
function lastStopIn(stops: number[], lo: number, hi: number): number | null {
    let a = 0
    let b = stops.length - 1
    let found: number | null = null
    while (a <= b) {
        const mid = (a + b) >> 1
        if (stops[mid] <= hi) {
            if (stops[mid] > lo) found = stops[mid]
            a = mid + 1
        } else {
            b = mid - 1
        }
    }
    return found
}

/**
 * Parse an html2canvas-safe color string (`rgb()`/`rgba()`/`#rgb`/`#rrggbb`) to `[r,g,b]`
 * 0..255 for jsPDF's numeric `setFillColor`. Alpha is ignored (the PDF page fill is opaque).
 * Anything unrecognized falls back to white so a page is never painted an unexpected color.
 * (Input is already normalized to rgb()/hex by cssColor.normalizeCssColor before reaching here.)
 */
export function parseRgbColor(color: string): [number, number, number] {
    const v = color.trim()
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(v)
    if (rgb) {
        return [clamp255(rgb[1]), clamp255(rgb[2]), clamp255(rgb[3])]
    }
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)
    if (hex) {
        const h = hex[1]
        if (h.length === 3) {
            return [
                parseInt(h[0] + h[0], 16),
                parseInt(h[1] + h[1], 16),
                parseInt(h[2] + h[2], 16),
            ]
        }
        return [
            parseInt(h.slice(0, 2), 16),
            parseInt(h.slice(2, 4), 16),
            parseInt(h.slice(4, 6), 16),
        ]
    }
    return [255, 255, 255]
}

function clamp255(n: string): number {
    return Math.max(0, Math.min(255, Math.round(parseFloat(n))))
}
