import { test, expect, describe } from 'bun:test'
import {
    containRect,
    ensurePages,
    fitImage,
    logicalToScreen,
    logicalToScreenScale,
    pageBoxFor,
    screenToLogical,
} from '../../src/drawing/pageInk'
import {
    emptyDoc,
    PAGE_W,
    PAGE_H,
    type DrawingDoc,
} from '../../src/drawing/model'

/** Box equality to float precision — 816/1200*1200 is not exactly 816 in doubles. */
function expectBox(
    got: { x: number; y: number; w: number; h: number },
    want: { x: number; y: number; w: number; h: number },
) {
    expect(got.x).toBeCloseTo(want.x, 9)
    expect(got.y).toBeCloseTo(want.y, 9)
    expect(got.w).toBeCloseTo(want.w, 9)
    expect(got.h).toBeCloseTo(want.h, 9)
}

/** A sidecar exactly as the retired ANNOTATE seeder wrote it: blank paper, one page per source
 *  page, each carrying the source as `images[0]` at the given box. */
function legacyDoc(
    boxes: { x: number; y: number; w: number; h: number }[],
): DrawingDoc {
    const doc = emptyDoc()
    doc.paper.bg = 'blank'
    doc.pages = boxes.map(b => ({
        strokes: [],
        images: [{ src: 'data:image/png;base64,AAAA', ...b }],
    }))
    return doc
}

describe('fitImage', () => {
    test('centres a landscape image on the 816x1056 page, scaled to fill the width', () => {
        // The old seeder's math, frozen as numbers: scale = min(816/1200, 1056/800) = 0.68.
        expectBox(fitImage(1200, 800), { x: 0, y: 256, w: 816, h: 544 })
    })

    test('centres a portrait image, scaled to fill the height', () => {
        // scale = min(816/500, 1056/2000) = 0.528 → 264 x 1056, x = (816 - 264) / 2
        expectBox(fitImage(500, 2000), { x: 276, y: 0, w: 264, h: 1056 })
    })

    test('maxScale caps an upscale (the import path)', () => {
        expect(fitImage(100, 50, 1)).toEqual({
            x: (PAGE_W - 100) / 2,
            y: (PAGE_H - 50) / 2,
            w: 100,
            h: 50,
        })
    })
})

describe('pageBoxFor', () => {
    test('a page with no stored image computes the same box the old seeder would have written', () => {
        const doc = emptyDoc()
        expectBox(pageBoxFor(doc, 0, 1200, 800), {
            x: 0,
            y: 256,
            w: 816,
            h: 544,
        })
    })

    test('a page index past the end of the doc still computes a box', () => {
        expect(pageBoxFor(emptyDoc(), 3, 612, 792)).toEqual(fitImage(612, 792))
    })

    test('a legacy stored images[0] box wins over the computed one', () => {
        const stored = { x: 10, y: 20, w: 400, h: 300 }
        const doc = legacyDoc([stored])
        // Deliberately a natural size whose computed box is NOT the stored one.
        expect(fitImage(1200, 800)).not.toEqual(stored)
        expect(pageBoxFor(doc, 0, 1200, 800)).toEqual(stored)
    })

    test('a degenerate stored box is ignored in favour of the computed one', () => {
        const doc = legacyDoc([{ x: 0, y: 0, w: 0, h: 0 }])
        expect(pageBoxFor(doc, 0, 1200, 800)).toEqual(fitImage(1200, 800))
    })

    test('each page resolves its own box (sidecar page i <-> source page i)', () => {
        const a = { x: 0, y: 0, w: 816, h: 1056 }
        const b = { x: 100, y: 0, w: 616, h: 1056 }
        const doc = legacyDoc([a, b])
        expect(pageBoxFor(doc, 0, 612, 792)).toEqual(a)
        expect(pageBoxFor(doc, 1, 612, 792)).toEqual(b)
    })
})

describe('screen <-> logical', () => {
    test('a stroke on a legacy page round-trips to the same screen point', () => {
        // The seeder's box for a 1200x800 image, stored verbatim.
        const box = fitImage(1200, 800)
        const doc = legacyDoc([box])
        const resolved = pageBoxFor(doc, 0, 1200, 800)
        // The image renders 600px wide at (40, 30) in the host.
        const rendered = { left: 40, top: 30, w: 600, h: 400 }
        const stroke = { x: 408, y: 528 } // the page centre, which is the image centre
        const screen = logicalToScreen(stroke, rendered, resolved)
        expect(screen.x).toBeCloseTo(40 + 300, 6)
        expect(screen.y).toBeCloseTo(30 + 200, 6)
        const back = screenToLogical(screen, rendered, resolved)
        expect(back.x).toBeCloseTo(stroke.x, 6)
        expect(back.y).toBeCloseTo(stroke.y, 6)
    })

    test('the box offset is part of the mapping (not just the scale)', () => {
        const box = { x: 0, y: 256, w: 816, h: 544 }
        const rendered = { left: 0, top: 0, w: 816, h: 544 }
        // The image's top-left corner is logical (0, 256), not (0, 0).
        expect(screenToLogical({ x: 0, y: 0 }, rendered, box)).toEqual({
            x: 0,
            y: 256,
        })
    })

    test('inverse within 0.5px at three render widths', () => {
        const box = fitImage(612, 792)
        const pts = [
            { x: box.x, y: box.y },
            { x: box.x + box.w, y: box.y + box.h },
            { x: 333.3, y: 777.7 },
            { x: 12.5, y: 1001 },
        ]
        for (const w of [240, 816, 1733]) {
            const rendered = { left: 17, top: 1234, w, h: w * (box.h / box.w) }
            for (const p of pts) {
                const s = logicalToScreen(p, rendered, box)
                const back = screenToLogical(s, rendered, box)
                // The screen-space error of the round trip, in px.
                const again = logicalToScreen(back, rendered, box)
                expect(Math.abs(again.x - s.x)).toBeLessThan(0.5)
                expect(Math.abs(again.y - s.y)).toBeLessThan(0.5)
                expect(Math.abs(back.x - p.x)).toBeLessThan(0.5)
                expect(Math.abs(back.y - p.y)).toBeLessThan(0.5)
            }
        }
    })

    test('logicalToScreenScale is rendered width over box width', () => {
        expect(logicalToScreenScale({ w: 408 }, { w: 816 })).toBe(0.5)
        expect(logicalToScreenScale({ w: 1632 }, { w: 816 })).toBe(2)
    })
})

describe('ensurePages', () => {
    test('pads with empty pages up to the count', () => {
        const doc = emptyDoc()
        const out = ensurePages(doc, 3)
        expect(out.pages.length).toBe(3)
        expect(out.pages[1]).toEqual({ strokes: [] })
        expect(out.pages[2]).toEqual({ strokes: [] })
        // Pure: the input is untouched.
        expect(doc.pages.length).toBe(1)
    })

    test('never truncates', () => {
        const doc = legacyDoc([fitImage(1, 1), fitImage(1, 1), fitImage(1, 1)])
        const out = ensurePages(doc, 1)
        expect(out.pages.length).toBe(3)
        expect(out).toBe(doc)
    })
})

describe('containRect', () => {
    test('letterboxes a wide image inside a tall content box', () => {
        expect(
            containRect({ left: 10, top: 20, w: 200, h: 400 }, 400, 200),
        ).toEqual({ left: 10, top: 170, w: 200, h: 100 })
    })

    test('pillarboxes a tall image inside a wide content box', () => {
        expect(
            containRect({ left: 0, top: 0, w: 400, h: 100 }, 50, 100),
        ).toEqual({ left: 175, top: 0, w: 50, h: 100 })
    })

    test('a zero natural size returns the content box unchanged', () => {
        const c = { left: 1, top: 2, w: 3, h: 4 }
        expect(containRect(c, 0, 0)).toEqual(c)
    })
})
