// app/src/export/pageGeometry.ts
// Pure geometry for html2canvas — the FALLBACK PDF exporter (htmlToPdf.ts), used by browser dev
// and iPad, where there is no native WebKit print engine to hand the document to. The desktop app
// prints through WebKit itself (pdfPrint.ts); this module only serves the raster path.
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
import { parseHex } from '../color/parseHex'

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

// --- painted-blank cut gate (fallback only) ---
//
// GitHub issue #9, fifth pass: the DOM was right, the canvas was not. `legalCutStops` measures
// where a cut is legal from the LAID-OUT DOCUMENT, but html2canvas does not paint pixels exactly
// where the DOM says they are — measured in the diagnosis at ±40-110 canvas px (2x scale) of
// drift between a DOM-measured atom edge and where its ink actually lands on the raster. A stop
// that is legal by the DOM can still land on inked pixels on the canvas. This gate reads the
// raster itself and only allows a cut where the PIXELS are blank (or a legitimate row to cut
// through, like a table's horizontal rule) — the pixel truth overrides the DOM's opinion.

/** Channel-sum |Δr|+|Δg|+|Δb| above which two pixels are considered visually different. */
export const INK_THRESHOLD = 60
/** A row with at least this fraction of its sampled pixels differing from `bg` is a "rule" row —
 *  a table border or `<hr>`, painted full-width, as opposed to a partial line of text/glyphs. */
export const FULL_FRACTION = 0.9
/** Sample every Nth pixel horizontally when classifying a row — full-width sampling is wasted
 *  precision for this purpose and multiplies the cost of scanning a multi-thousand-row canvas. */
export const SAMPLE_STEP = 2
/** css px: the measured html2canvas drift bound (±110 canvas px at 2x scale) used to pad a
 *  formula's forbidden band, since a display fraction has genuinely blank rows between its
 *  numerator and denominator that would otherwise look like a safe (blank) cut site. */
export const DRIFT_PAD_CSS = 60
/** Never search for a safe cut above `offset + pageHpx * MIN_PAGE_FRACTION` — a page that shrinks
 *  below half its natural height in search of a blank row would rather cut through ink than
 *  produce a near-empty page. */
export const MIN_PAGE_FRACTION = 0.5

/** Per-row classification of a rasterized canvas region. Index = canvas row (0-based from the top
 *  of the classified range); each array holds 1 (true) or 0 (false) per row. */
export interface RowClasses {
    /** uniform[y] = 1 when every sampled pixel in row y is within INK_THRESHOLD of the row's own
     *  first sampled pixel — true of a genuinely blank row, but ALSO true of a solid fill (a code
     *  block's padding, a callout's background) and of a full-width rule, since every pixel in
     *  those rows matches every other pixel in the same row even though the row is not blank.
     *  "uniform" is deliberately not "blank": a code block's `p.head` fill and a table border are
     *  legitimate cut sites even though they are painted, because cutting through a flat colour
     *  (or exactly at a rule) reads as clean, unlike cutting through a line of text. */
    uniform: Uint8Array
    /** full[y] = 1 when at least FULL_FRACTION of row y's sampled pixels differ from `bg` by more
     *  than INK_THRESHOLD — a row painted edge-to-edge with something other than the page
     *  background, i.e. a table border or `<hr>`, as opposed to a partial-width line of text. */
    full: Uint8Array
}

/**
 * Classify `rows` rows of one RGBA chunk (`data` is `width * rows * 4` bytes, top row first).
 * Samples `x = 0, SAMPLE_STEP, 2*SAMPLE_STEP, …` while `x < width`, for each row.
 *
 * `uniform[y]` compares every sample in row y to that row's OWN first sample — not to `bg` — so
 * a solid non-background fill (a code block's padding) reads as uniform too, deliberately: it is
 * a legal cut site (see the `uniform` doc above), just not a "blank" one. `full[y]` compares every
 * sample to `bg` instead, since a rule/border is only a rule if it actually differs from the page
 * background across most of the row.
 *
 * Pure — no DOM, no canvas context — so it is unit-tested directly against synthetic RGBA buffers
 * in pageGeometry.test.ts; the caller (`renderLetterPages` in htmlToPdf.ts) supplies `data` via
 * `ctx.getImageData()` in chunks of at most 1024 rows to bound peak memory on a tall document.
 */
export function classifyRows(
    data: Uint8ClampedArray,
    width: number,
    rows: number,
    bg: [number, number, number],
): RowClasses {
    const uniform = new Uint8Array(rows)
    const full = new Uint8Array(rows)
    const sampleCount = Math.max(1, Math.ceil(width / SAMPLE_STEP))
    for (let y = 0; y < rows; y++) {
        const rowStart = y * width * 4
        let isUniform = 1
        let diffFromBgCount = 0
        let sampled = 0
        let firstR = 0
        let firstG = 0
        let firstB = 0
        for (let x = 0; x < width; x += SAMPLE_STEP) {
            const i = rowStart + x * 4
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            if (sampled === 0) {
                firstR = r
                firstG = g
                firstB = b
            } else {
                const dFirst =
                    Math.abs(r - firstR) +
                    Math.abs(g - firstG) +
                    Math.abs(b - firstB)
                if (dFirst > INK_THRESHOLD) isUniform = 0
            }
            const dBg =
                Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2])
            if (dBg > INK_THRESHOLD) diffFromBgCount++
            sampled++
        }
        uniform[y] = isUniform
        full[y] = diffFromBgCount / sampleCount >= FULL_FRACTION ? 1 : 0
    }
    return { uniform, full }
}

/**
 * A cut at canvas row `y` is safe iff `y` is in range, falls strictly inside no `forbidden` band
 * (a formula's drift-padded extent — see `formulaBands`), and either:
 *   - `uniform[y-1] && uniform[y]` — two blank (or uniformly-filled) rows in a row, the ordinary
 *     "nothing here" case; or
 *   - `uniform[y-1] && full[y-1]` — the row just above `y` is a full-width rule (a table border,
 *     an `<hr>`), so `y` is the row immediately BELOW a horizontal line. This is deliberately
 *     `full[y-1]`, not `full[y]`: a bordered table's INTERIOR rows are never `uniform` (the
 *     vertical cell borders ink a thin stripe down every row, so no two consecutive rows inside
 *     the table are ever both blank) — the only place such a table is ever cuttable is directly
 *     beneath one of its horizontal rules, never mid-row.
 *
 * `y = 0` is never safe — there is no row above it to test uniformity against, and a cut at the
 * very top of the canvas is meaningless (nothing precedes it to have been cut FROM).
 *
 * Pure. Unit-tested directly in pageGeometry.test.ts.
 */
export function cutSafe(
    rows: RowClasses,
    y: number,
    forbidden: readonly [number, number][],
): boolean {
    if (y < 1 || y >= rows.uniform.length) return false
    for (const [lo, hi] of forbidden) {
        if (y > lo && y < hi) return false
    }
    const upBlank = rows.uniform[y - 1] === 1
    if (!upBlank) return false
    return rows.uniform[y] === 1 || rows.full[y - 1] === 1
}

/**
 * Canvas-px forbidden bands `[top*scale - pad, bottom*scale + pad]` for every atom taller than
 * `minHeightCss` (CSS px) — a stacked fraction or display formula, the shapes whose rendered
 * interior has genuinely blank rows (the gap between a numerator and denominator) that would
 * otherwise look, pixel-for-pixel, exactly like a safe blank cut site. `padCanvasPx` accounts for
 * html2canvas's paint drift (see `DRIFT_PAD_CSS` above) so the band still covers the formula's
 * true painted extent even though its DOM-measured top/bottom are not where the ink actually is.
 *
 * Only atoms flagged `isFormula` and taller than `minHeightCss` produce a band — a single-line
 * inline formula (`x^2`) has no blank interior row to protect and would otherwise turn every
 * inline-math line into an unnecessarily wide dead zone.
 *
 * Pure. Unit-tested directly in pageGeometry.test.ts.
 */
export function formulaBands(
    atoms: CutAtom[],
    scale: number,
    minHeightCss: number,
    padCanvasPx: number,
): [number, number][] {
    const bands: [number, number][] = []
    for (const a of atoms) {
        if (!a.isFormula) continue
        if (a.bottom - a.top <= minHeightCss) continue
        const top = a.top * scale - padCanvasPx
        const bottom = a.bottom * scale + padCanvasPx
        bands.push([top, bottom])
    }
    return bands
}

/** The painted-blank cut gate `pageSlices` consults when given one: the per-row raster
 *  classification of the WHOLE content canvas, plus the forbidden formula bands. Optional —
 *  omitting it keeps `pageSlices`' historical DOM-only behaviour exactly as it was. */
export interface CutGate {
    rows: RowClasses
    forbidden: readonly [number, number][]
}

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
    /** True for a KaTeX formula atom. A formula is indivisible even from a NON-enclosing
     *  neighbour — see the interior-of-formula rule in `legalCutStops` below. */
    isFormula?: boolean
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
 * One narrower rule sits alongside the enclosure test: a candidate bottom is also illegal when it
 * falls strictly INSIDE a formula atom's vertical extent (starts above the formula's top and ends
 * within it, without enclosing the formula). That covers a text line whose bottom lands inside a
 * `.katex` span that started above it — the enclosure test alone misses this, since the text atom
 * doesn't end below the formula and so doesn't enclose it. This rule is deliberately restricted to
 * atoms flagged `isFormula` rather than "no atom may overlap this edge" — that is the general test
 * described above, already tried and rejected for disqualifying every text edge at tight leading.
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
    const formulas = sorted.filter(a => a.isFormula)
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
        // Interior-of-formula: a formula that starts above this bottom and ends below it (but
        // does not enclose `a`, or the enclosure check above would already have caught it) still
        // makes this an illegal cut. Only formula atoms get this stronger rule.
        if (
            formulas.some(
                f => f.top < a.bottom - 0.5 && f.bottom > a.bottom + 0.5,
            )
        )
            continue
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
 * GitHub issue #9, fifth pass: the DOM was right, the canvas was not. `stops` alone (the DOM's
 * opinion) is not enough for the html2canvas fallback, because html2canvas paints ink up to ~110
 * canvas px away from where the DOM says it is. The optional `gate` (from htmlToPdf.ts's
 * `renderLetterPages`, painted-blank cut gate) is the PIXEL truth: when given, a DOM stop is only
 * used if `cutSafe` agrees the raster is actually blank there; when it disagrees, this searches
 * for the nearest row at or below the stop (and above the page's natural bottom) where the pixels
 * ARE safe, so the boundary never lands on painted ink even when the DOM was wrong about where
 * that ink would land.
 *
 * Pure (no DOM, no canvas context — `gate.rows`/`gate.forbidden` are plain data) so the
 * pagination math is unit-tested in pageGeometry.test.ts.
 */
export function pageSlices(
    contentHpx: number,
    pageHpx: number,
    breaks: number[] = [],
    stops: number[] = [],
    gate?: CutGate,
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
        } else if (gate && end < contentHpx) {
            // The painted-blank cut gate (fallback only, GitHub issue #9 fifth pass): the DOM's
            // stop is only trusted once the raster agrees it is actually safe. When it isn't,
            // search downward from the natural bottom for the nearest row the PIXELS say is
            // blank, never above MIN_PAGE_FRACTION of a page (a near-empty page is worse than an
            // imperfect cut). If nothing in range is safe, fall back to the DOM stop (better than
            // the raw bottom, even though the pixels disagree) or, failing that, the raw bottom —
            // always advancing, so the loop always terminates.
            const s = lastStopIn(legal, offset, end)
            if (s !== null && cutSafe(gate.rows, s, gate.forbidden)) {
                end = s
            } else {
                const lo = Math.max(offset + 1, offset + pageHpx * MIN_PAGE_FRACTION)
                const safe = lastSafeIn(gate.rows, gate.forbidden, lo, end)
                if (safe !== null) end = safe
                else if (s !== null) end = s
            }
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

/** The largest `y` in `[lo, hi]` for which `cutSafe` is true, or null when none is. A linear scan
 *  downward from `hi` — the range is at most one page tall (a few hundred to ~1000 canvas px),
 *  unlike `lastStopIn`'s stops list which can hold one entry per rendered line. */
function lastSafeIn(
    rows: RowClasses,
    forbidden: readonly [number, number][],
    lo: number,
    hi: number,
): number | null {
    const start = Math.min(Math.floor(hi), rows.uniform.length - 1)
    const bottom = Math.ceil(lo)
    for (let y = start; y >= bottom; y--) {
        if (cutSafe(rows, y, forbidden)) return y
    }
    return null
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
 *
 * The hex branch delegates to the shared color/parseHex.ts (exactly 3 or 6 hex digits — this
 * site's own regex already matched that exact shape, so the swap is behavior-preserving); the
 * rgb()/rgba() branch and the white fallback are this site's own and stay local — see the note on
 * AsciiGraphRenderer.ts's parseColorToRGB for how this disagrees with the other hex-to-RGB call
 * sites on malformed input (e.g. a 7-digit hex falls back to white here, but returns null in
 * bloomColor.ts and a truncated triple in AsciiGraphRenderer.ts/clusterVisual.ts).
 */
export function parseRgbColor(color: string): [number, number, number] {
    const v = color.trim()
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(v)
    if (rgb) {
        return [clamp255(rgb[1]), clamp255(rgb[2]), clamp255(rgb[3])]
    }
    const hex = parseHex(v)
    if (hex) return [hex[0], hex[1], hex[2]]
    return [255, 255, 255]
}

function clamp255(n: string): number {
    return Math.max(0, Math.min(255, Math.round(parseFloat(n))))
}
