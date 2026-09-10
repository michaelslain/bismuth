// app/src/export/pageGeometry.test.ts
import { test, expect, describe } from 'bun:test'
import {
    PAGE_W_PT,
    PAGE_H_PT,
    MARGIN_PT,
    CONTENT_W_PT,
    CONTENT_H_PT,
    PAGE_W_PX,
    CONTENT_W_PX,
    pdfSliceMetrics,
    pageSlices,
    parseRgbColor,
    snapDownToGrid,
    legalCutStops,
} from './pageGeometry'
import { RULE_PX } from './htmlTemplate'

describe('page constants', () => {
    test('US Letter portrait at 72pt/in', () => {
        expect(PAGE_W_PT).toBe(8.5 * 72) // 612
        expect(PAGE_H_PT).toBe(11 * 72) // 792
    })

    test('1 inch margin on every side', () => {
        expect(MARGIN_PT).toBe(72)
    })

    test('printable box = Letter minus 1in on each edge', () => {
        expect(CONTENT_W_PT).toBe(PAGE_W_PT - 2 * MARGIN_PT) // 468 = 6.5in
        expect(CONTENT_H_PT).toBe(PAGE_H_PT - 2 * MARGIN_PT) // 648 = 9in
        expect(CONTENT_W_PT).toBe(6.5 * 72)
        expect(CONTENT_H_PT).toBe(9 * 72)
    })

    test('source raster width is 8.5in @ 96dpi', () => {
        expect(PAGE_W_PX).toBe(8.5 * 96) // 816
    })

    test('PDF content raster width is the 6.5in printable box @ 96dpi', () => {
        expect(CONTENT_W_PX).toBe(6.5 * 96) // 624
        // Laid out at the printable width, the raster maps 1:1 into the printable box with no
        // horizontal squeeze — 96 source px == 72 PDF pt == 1 inch.
        expect(CONTENT_W_PT / CONTENT_W_PX).toBeCloseTo(72 / 96, 10) // 0.75 pt per px
    })

    test('laying out at CONTENT_W_PX makes points true (1 CSS pt -> 1 PDF pt)', () => {
        // At 1x scale the source canvas is exactly CONTENT_W_PX wide. pdfSliceMetrics maps source px
        // to PDF pt; the density must be the pure 72/96 dpi ratio, so a 12pt CSS font (16px @96dpi)
        // measures 12pt in the PDF.
        const { scale } = pdfSliceMetrics(CONTENT_W_PX)
        expect(scale).toBeCloseTo(72 / 96, 10)
        const cssPx = (12 / 72) * 96 // 12pt in CSS px @96dpi = 16px
        expect(cssPx * scale).toBeCloseTo(12, 10) // -> 12pt in the PDF
    })

    test('one printable page holds AT MOST 9in (CONTENT_H) of content at CONTENT_W_PX, snapped to the ruled grid', () => {
        const { pageHpx } = pdfSliceMetrics(CONTENT_W_PX)
        // 9in @ 96dpi = 864 source px is the raw geometric bound. Defect 1's grid-snapping fix
        // rounds DOWN to the nearest whole rule (RULE_PX canvas px at 1x scale, since canvasWidthPx
        // === CONTENT_W_PX here) so a page boundary can only land on a text baseline.
        expect(pageHpx).toBeLessThanOrEqual(9 * 96) // 864
        expect(pageHpx % RULE_PX).toBe(0)
        expect(pageHpx).toBeGreaterThan(0)
    })
})

describe('pdfSliceMetrics', () => {
    test('maps a full-width canvas into the printable box', () => {
        // A 1x-scale raster: canvas.width == PAGE_W_PX.
        const { scale, pageHpx } = pdfSliceMetrics(816)
        // 468pt / 816px -> content px map into the 6.5in printable width.
        expect(scale).toBeCloseTo(CONTENT_W_PT / 816, 10)
        // One printable page holds AT MOST CONTENT_H_PT worth of source px — defect 1's
        // grid-snapping fix rounds pageHpx DOWN to a whole multiple of the ruled-paper baseline,
        // so it is strictly <= the raw (unsnapped) geometric bound, never equal in general.
        expect(pageHpx).toBeLessThanOrEqual(Math.floor(CONTENT_H_PT / scale))
        expect(pageHpx).toBeGreaterThan(0)
        // A page of source px scaled back up lands within the printable height (never overshoots).
        expect(pageHpx * scale).toBeLessThanOrEqual(CONTENT_H_PT + 1e-6)
    })

    test('2x raster scales proportionally (twice the px per page)', () => {
        const one = pdfSliceMetrics(816)
        const two = pdfSliceMetrics(1632)
        expect(two.scale).toBeCloseTo(one.scale / 2, 10)
        expect(two.pageHpx).toBeGreaterThanOrEqual(one.pageHpx * 2 - 1)
    })

    // GitHub issue #9, defect 1: at every raster scale the un-snapped page height (648pt /
    // scale, in canvas px) divided by the 22px baseline grid landed on 39.2727... lines — never
    // a whole number — so every page boundary cut through the middle of a text line. The fix
    // snaps pageHpx DOWN to a whole multiple of the grid, in CANVAS px (the raster may be scaled
    // up from CSS px by a device-pixel factor: canvasWidthPx / CONTENT_W_PX).
    describe('pageHpx is grid-aligned at 1x/2x/3x raster scale (defect 1)', () => {
        for (const devScale of [1, 2, 3]) {
            test(`${devScale}x scale: pageHpx is an exact whole multiple of the rule height in canvas px`, () => {
                const canvasWidthPx = CONTENT_W_PX * devScale
                const { pageHpx } = pdfSliceMetrics(canvasWidthPx)
                const ruleCanvasPx = RULE_PX * devScale // the 22px CSS rule scaled into canvas px
                expect(pageHpx).toBeGreaterThan(0)
                expect(pageHpx % ruleCanvasPx).toBe(0)
            })
        }
    })

    // NOTE: with today's constants (RULE_PX=22, CONTENT_W_PT=468, CONTENT_H_PT=648,
    // CONTENT_W_PX=624) the ratio rawPageHpx/ruleCanvasPx is scale-invariant — it always works
    // out to ~39.27 for ANY positive canvasWidthPx, since canvasWidthPx cancels out of both the
    // numerator and denominator. So the zero/negative guard can never actually be exercised by
    // varying canvasWidthPx alone; testing it that way would be a vacuous test that can never
    // fail. The guard is genuinely tested below, directly, on the extracted pure helper.
    describe('snapDownToGrid — the zero/negative guard behind pdfSliceMetrics', () => {
        test('snaps down to the nearest whole multiple of the unit', () => {
            expect(snapDownToGrid(100, 22)).toBe(88) // floor(100/22)=4, 4*22=88
        })

        test('an exact multiple is left unchanged', () => {
            expect(snapDownToGrid(88, 22)).toBe(88)
        })

        test('falls back to the floored raw value when the unit is bigger than the raw height (snapping would zero it out)', () => {
            // A grid unit (1000) bigger than the raw page height (5): naive snapping gives
            // floor(5/1000)*1000 = 0, which would make pageSlices' `while (offset < contentHpx)`
            // loop forever on a zero-height slice. The guard must fall back to floor(raw) instead.
            expect(snapDownToGrid(5, 1000)).toBe(5)
            expect(snapDownToGrid(5, 1000)).toBeGreaterThan(0)
        })

        test('a non-positive unit is ignored entirely (falls back to the floored raw value)', () => {
            expect(snapDownToGrid(123.7, 0)).toBe(123)
            expect(snapDownToGrid(123.7, -5)).toBe(123)
        })
    })
})

describe('pageSlices — auto-pagination of overflow content', () => {
    test('content shorter than one page -> a single slice covering all of it (no forced break needed)', () => {
        expect(pageSlices(500, 1000)).toEqual([{ start: 0, height: 500 }])
    })

    test('content exactly one page tall -> exactly one slice', () => {
        expect(pageSlices(1000, 1000)).toEqual([{ start: 0, height: 1000 }])
    })

    // THE regression the user reported: a long doc with NO explicit page-break markers must still
    // split into multiple fixed-height pages, not render onto one endless page.
    test('content 2.5x a page tall with NO breaks -> auto-flows onto 3 pages', () => {
        const slices = pageSlices(2500, 1000)
        expect(slices).toEqual([
            { start: 0, height: 1000 },
            { start: 1000, height: 1000 },
            { start: 2000, height: 500 },
        ])
    })

    test('every full page is exactly pageHpx tall; only the last is shorter', () => {
        const pageHpx = 640
        const slices = pageSlices(pageHpx * 4 + 123, pageHpx)
        expect(slices).toHaveLength(5)
        for (const s of slices.slice(0, -1)) expect(s.height).toBe(pageHpx)
        expect(slices.at(-1)).toEqual({ start: pageHpx * 4, height: 123 })
        // Slices tile the whole content with no gaps/overlap.
        for (let i = 1; i < slices.length; i++) {
            expect(slices[i].start).toBe(
                slices[i - 1].start + slices[i - 1].height,
            )
        }
    })

    test('a forced break inside a page ends it early; the next page starts AT the marker', () => {
        // Break at 300 (< pageHpx 1000): page 1 is [0,300), page 2 resumes at 300.
        const slices = pageSlices(1500, 1000, [300])
        expect(slices).toEqual([
            { start: 0, height: 300 },
            { start: 300, height: 1000 },
            { start: 1300, height: 200 },
        ])
    })

    test('multiple forced breaks each cut a page, and overflow between them still auto-paginates', () => {
        // Breaks at 300 and 2600; between 300 and 2600 (2300px) is >2 pages, so it auto-splits.
        const slices = pageSlices(2800, 1000, [300, 2600])
        expect(slices).toEqual([
            { start: 0, height: 300 }, // forced break at 300
            { start: 300, height: 1000 }, // auto page
            { start: 1300, height: 1000 }, // auto page
            { start: 2300, height: 300 }, // forced break at 2600
            { start: 2600, height: 200 }, // remainder
        ])
    })

    test('a break exactly on the natural page bottom is a no-op (never an empty page)', () => {
        // From offset 0 the page naturally ends at 1000; a marker AT 1000 adds nothing.
        expect(pageSlices(1500, 1000, [1000])).toEqual([
            { start: 0, height: 1000 },
            { start: 1000, height: 500 },
        ])
    })

    test('breaks are honored regardless of input order (sorted internally)', () => {
        // Same result whether passed [1200,400] or [400,1200].
        const expected = [
            { start: 0, height: 400 },
            { start: 400, height: 800 },
            { start: 1200, height: 400 },
        ]
        expect(pageSlices(1600, 1000, [1200, 400])).toEqual(expected)
        expect(pageSlices(1600, 1000, [400, 1200])).toEqual(expected)
    })

    test('empty / degenerate inputs -> no slices (never loops forever)', () => {
        expect(pageSlices(0, 1000)).toEqual([])
        expect(pageSlices(1000, 0)).toEqual([])
        expect(pageSlices(-5, 1000)).toEqual([])
    })

    // GitHub issue #9, defect 1: given a pageHpx that is itself grid-aligned (defect 1's fix in
    // pdfSliceMetrics), every slice boundary pageSlices produces must ALSO land on the grid — a
    // page can only ever start/end on a rule line, never mid-line, for content whose own height
    // is also a whole number of lines (true of every real export document, built on the same
    // 22px baseline grid — see htmlTemplate.ts).
    test('no slice boundary ever falls mid-line, given a grid-aligned pageHpx', () => {
        const ruleCanvasPx = 22 // 1x-scale rule height in canvas px
        const pageHpx = 39 * ruleCanvasPx // 858 — a grid-aligned page height
        const contentHpx = 130 * ruleCanvasPx // an arbitrary content height, also grid-aligned
        const slices = pageSlices(contentHpx, pageHpx)
        expect(slices.length).toBeGreaterThan(1) // exercise more than a single trivial slice
        for (const s of slices) {
            expect(s.start % ruleCanvasPx).toBe(0)
            expect((s.start + s.height) % ruleCanvasPx).toBe(0)
        }
    })
})

describe('parseRgbColor', () => {
    test('rgb()', () => {
        expect(parseRgbColor('rgb(18, 20, 24)')).toEqual([18, 20, 24])
    })
    test('rgba() ignores alpha', () => {
        expect(parseRgbColor('rgba(255, 0, 128, 0.5)')).toEqual([255, 0, 128])
    })
    test('#rrggbb', () => {
        expect(parseRgbColor('#ffffff')).toEqual([255, 255, 255])
        expect(parseRgbColor('#000000')).toEqual([0, 0, 0])
    })
    test('#rgb shorthand', () => {
        expect(parseRgbColor('#fff')).toEqual([255, 255, 255])
        expect(parseRgbColor('#123')).toEqual([0x11, 0x22, 0x33])
    })
    test('clamps and rounds channels', () => {
        expect(parseRgbColor('rgb(300, 5, 12.7)')).toEqual([255, 5, 13])
    })
    test('unrecognized -> white fallback', () => {
        expect(parseRgbColor('papayawhip')).toEqual([255, 255, 255])
        expect(parseRgbColor('')).toEqual([255, 255, 255])
    })
})

describe('pageSlices — cuts land on a legal stop, never mid-line', () => {
    test('cuts back to the last stop at or below the natural page bottom', () => {
        // Natural bottom is 100; the last legal cut below it is 96.
        const stops = [20, 40, 60, 80, 96, 118, 140]
        const out = pageSlices(200, 100, [], stops)
        expect(out[0]).toEqual({ start: 0, height: 96 })
        expect(out[1].start).toBe(96)
    })

    test('a stop exactly on the natural bottom is used as-is', () => {
        const out = pageSlices(200, 100, [], [50, 100, 150])
        expect(out[0]).toEqual({ start: 0, height: 100 })
    })

    test('falls back to the raw page height when no stop fits', () => {
        // One unbreakable block taller than a page: no stop inside (0, 100].
        const out = pageSlices(300, 100, [], [140, 280])
        expect(out[0]).toEqual({ start: 0, height: 100 })
        expect(out.length).toBeGreaterThan(1)
    })

    test('never emits a zero-height slice, so the pager always advances', () => {
        const out = pageSlices(500, 100, [], [0, 0, 0])
        for (const s of out) expect(s.height).toBeGreaterThan(0)
        expect(out.length).toBeLessThan(20)
    })

    test('a forced break still wins over a stop inside the same page', () => {
        const out = pageSlices(300, 100, [70], [40, 90, 200])
        expect(out[0]).toEqual({ start: 0, height: 70 })
    })

    test('with no stops the behavior is byte-identical to the 3-arg form', () => {
        expect(pageSlices(500, 120, [200])).toEqual(
            pageSlices(500, 120, [200], []),
        )
    })

    test('unsorted stops are handled', () => {
        const out = pageSlices(200, 100, [], [96, 20, 140, 60])
        expect(out[0]).toEqual({ start: 0, height: 96 })
    })

    test('the last page is never pulled back — its bottom is the content end', () => {
        // A stop at 150 sits below the final content bottom (170); pulling back to it would
        // drop the last 20px of the document off the end of the PDF entirely.
        const out = pageSlices(170, 100, [], [96, 150])
        expect(out[out.length - 1]).toEqual({ start: 96, height: 74 })
    })

})

describe('legalCutStops — the enclosure test behind measureCutStops', () => {
    test('pre-fix shape: a formula with no enclosing atom leaks an interior stop', () => {
        // A formula's rendered fragments (numerator/denominator/exponent), each its own atom,
        // with NOTHING spanning the whole formula — this is what measureCutStops saw before
        // `.katex` was added to ATOM_SELECTOR: KaTeX has no atom of its own, only its interior
        // text rects. The formula's true extent is [480, 520).
        const fragments = [
            { top: 480, bottom: 498 }, // numerator
            { top: 500, bottom: 520 }, // denominator
        ]
        const stops = legalCutStops(fragments, 1)
        // The numerator's bottom (498) is strictly inside the formula's [480, 520) extent, and
        // with no enclosing atom to disqualify it, it comes back as a "legal" stop. This is the
        // bug: a page boundary here would cut the formula in half.
        expect(stops).toContain(498)
    })

    test('post-fix shape: an atom spanning the whole formula disqualifies every interior stop', () => {
        // Same fragments, PLUS the `.katex` element itself as an atom spanning [480, 520) — what
        // measureCutStops sees now that `.katex` is in ATOM_SELECTOR. The enclosure test should
        // disqualify both interior fragment edges, leaving only the formula's own bottom (520)
        // as a legal stop.
        const fragments = [
            { top: 480, bottom: 498 }, // numerator
            { top: 500, bottom: 520 }, // denominator
            { top: 480, bottom: 520 }, // the .katex atom itself, enclosing both fragments
        ]
        const stops = legalCutStops(fragments, 1)
        for (const s of stops) {
            expect(s > 480 && s < 520).toBe(false)
        }
        expect(stops).toContain(520)
    })

    test('scale multiplies every stop into canvas px, same as measureCutStops did inline', () => {
        const atoms = [{ top: 10, bottom: 20 }]
        expect(legalCutStops(atoms, 2)).toEqual([40])
    })

    test('an atom never disqualifies its own edge', () => {
        // A single atom's bottom must always be a legal stop — the enclosure test must not treat
        // an atom as enclosing itself.
        expect(legalCutStops([{ top: 0, bottom: 100 }], 1)).toEqual([100])
    })

    test('a tie on `top` does not falsely disqualify a same-height sibling', () => {
        // Two atoms starting at the same top and ending at the same bottom (e.g. a table row and
        // a cell that both start/end together) must not be treated as enclosing each other.
        const atoms = [
            { top: 0, bottom: 50 },
            { top: 0, bottom: 50 },
        ]
        expect(legalCutStops(atoms, 1)).toEqual([50])
    })

    test('a text line whose bottom lands inside a formula it does not enclose is illegal (task 5)', () => {
        // Exact measured geometry from the plan: a text atom that starts ABOVE the formula's top
        // and ends INSIDE it, never enclosing the formula (it doesn't end below it), so the
        // enclosure test alone lets its bottom through as "legal". Cutting there leaves most of
        // the formula on the next page.
        const atoms = [
            { top: 415.9, bottom: 442.9 }, // text line
            { top: 439.9, bottom: 464.1, isFormula: true }, // formula
        ]
        // legalCutStops rounds bottoms into canvas px (Math.round(a.bottom * scale)), so 442.9
        // comes back as 443 at scale 1 — check for the rounded value the function actually emits.
        const stops = legalCutStops(atoms, 1)
        expect(stops).not.toContain(443)
    })

    test('two consecutive overlapping TEXT atoms at tight leading both stay legal (no general-overlap regression)', () => {
        // The trap this task must not reintroduce: a general "no atom overlaps this edge" test
        // was already tried and rejected, because getClientRects() ink boxes overlap between
        // consecutive text lines at tight leading, and disqualifying every overlapping edge
        // dropped the pager back to raw grid cuts. Neither atom here is a formula, so the new
        // interior-of-formula rule must not touch them.
        const atoms = [
            { top: 0, bottom: 22 },
            { top: 18, bottom: 40 }, // overlaps the previous atom's ink box by 4px
        ]
        const stops = legalCutStops(atoms, 1)
        expect(stops).toContain(22)
        expect(stops).toContain(40)
    })
})

describe('ATOM_SELECTOR includes .katex (htmlToPdf.ts)', () => {
    test('the selector string that feeds legalCutStops treats a formula as an atom', () => {
        // A cheap textual guard: legalCutStops itself has no opinion on WHICH DOM elements are
        // atoms, so nothing above catches a regression that simply drops `.katex` back out of
        // ATOM_SELECTOR in htmlToPdf.ts. This closes that one gap.
        const src = require('node:fs').readFileSync(
            require('node:path').join(__dirname, 'htmlToPdf.ts'),
            'utf8',
        )
        const match = /const ATOM_SELECTOR = '([^']+)'/.exec(src)
        expect(match).not.toBeNull()
        const selector = match?.[1] ?? ''
        expect(
            selector
                .split(',')
                .map(s => s.trim())
                .includes('.katex'),
        ).toBe(true)
    })
})
