// app/src/preview/pageLayout.test.ts
import { describe, expect, test } from 'bun:test'
import {
    currentPageIndex,
    layoutPages,
    scrollTopForPage,
    visiblePageRange,
} from './pageLayout'

describe('layoutPages', () => {
    test('fit-width at zoom 1: a page takes the full container width, height scaled to its own aspect', () => {
        const { boxes, contentH } = layoutPages(
            [{ w: 200, h: 300 }],
            400,
            1,
            10,
        )
        expect(boxes).toEqual([{ top: 0, left: 0, w: 400, h: 600, marginW: 0 }])
        expect(contentH).toBe(600) // one page — no trailing gap
    })

    test('zoom 2 doubles both the box width and, proportionally, its height', () => {
        const { boxes } = layoutPages([{ w: 200, h: 300 }], 400, 2, 10)
        expect(boxes[0]!.w).toBe(800)
        expect(boxes[0]!.h).toBe(1200)
    })

    test('zoom < 1 centers the narrower page instead of left-aligning it', () => {
        const { boxes } = layoutPages([{ w: 200, h: 200 }], 400, 0.5, 10)
        expect(boxes[0]!.w).toBe(200)
        expect(boxes[0]!.left).toBe(100) // (400 - 200) / 2
    })

    test('gap accounting: each later page top = running height + gap, and contentH sums it all without a trailing gap', () => {
        const { boxes, contentH } = layoutPages(
            [
                { w: 100, h: 100 },
                { w: 100, h: 100 },
            ],
            100,
            1,
            20,
        )
        expect(boxes[0]).toEqual({
            top: 0,
            left: 0,
            w: 100,
            h: 100,
            marginW: 0,
        })
        expect(boxes[1]).toEqual({
            top: 120,
            left: 0,
            w: 100,
            h: 100,
            marginW: 0,
        })
        expect(contentH).toBe(220) // 100 + 20 + 100, not +20 again
    })

    test('empty doc: no boxes, zero content height', () => {
        expect(layoutPages([], 400, 1, 10)).toEqual({
            boxes: [],
            contentH: 0,
        })
    })
})

describe('layoutPages with a margin', () => {
    test('page + margin together take containerW * zoom; the margin is a fraction of the page width', () => {
        // 0.5 margin at zoom 1 in 600px: page 400 + margin 200 = 600.
        const { boxes } = layoutPages([{ w: 200, h: 300 }], 600, 1, 10, 0.5)
        expect(boxes[0]!.w).toBeCloseTo(400, 9)
        expect(boxes[0]!.marginW).toBeCloseTo(200, 9)
        expect(boxes[0]!.h).toBeCloseTo(600, 9) // height follows the PAGE width, not page+margin
        expect(boxes[0]!.left).toBe(0)
    })

    test('a narrower page + margin is centred as one unit', () => {
        // zoom 0.5 of 600 = 300 total → page 200 + margin 100, centred: (600 - 300) / 2.
        const { boxes } = layoutPages([{ w: 100, h: 100 }], 600, 0.5, 0, 0.5)
        expect(boxes[0]!.w).toBeCloseTo(200, 9)
        expect(boxes[0]!.marginW).toBeCloseTo(100, 9)
        expect(boxes[0]!.left).toBeCloseTo(150, 9)
    })

    test('marginRatio 0 reproduces the no-margin boxes exactly', () => {
        const sizes = [
            { w: 200, h: 300 },
            { w: 300, h: 100 },
        ]
        expect(layoutPages(sizes, 500, 0.8, 12, 0)).toEqual(
            layoutPages(sizes, 500, 0.8, 12),
        )
    })

    test('stacking accounts for the shrunken page heights', () => {
        const { boxes, contentH } = layoutPages(
            [
                { w: 100, h: 100 },
                { w: 100, h: 100 },
            ],
            300,
            1,
            10,
            2,
        )
        // page w = 300 / 3 = 100 → h 100; margin 200.
        expect(boxes[1]!.top).toBeCloseTo(110, 9)
        expect(contentH).toBeCloseTo(210, 9)
    })
})

describe('layoutPages with a page-frame pad', () => {
    test('fit width insets the page pad px from every side, and contentH carries the bottom pad too', () => {
        // 400 container, pad 24 → band 352, zoom 1 → page fills the band exactly.
        const { boxes, contentH } = layoutPages(
            [{ w: 100, h: 200 }],
            400,
            1,
            10,
            0,
            24,
        )
        expect(boxes[0]!.left).toBe(24)
        expect(boxes[0]!.top).toBe(24)
        expect(boxes[0]!.w).toBe(352)
        expect(boxes[0]!.h).toBe(704) // 200 * (352 / 100)
        expect(contentH).toBe(24 + 704 + 24) // top pad + page height + bottom pad
    })

    test('pad = 0 reproduces the unpadded layout exactly (default stays the old behaviour)', () => {
        const sizes = [{ w: 200, h: 300 }]
        expect(layoutPages(sizes, 500, 0.8, 12, 0, 0)).toEqual(
            layoutPages(sizes, 500, 0.8, 12),
        )
    })

    test('zoom < 1 centres the page WITHIN the padded band, never left of pad', () => {
        // band = 400 - 48 = 352; zoom 0.5 → page 176 wide, centred: 24 + (352 - 176) / 2.
        const { boxes } = layoutPages([{ w: 100, h: 100 }], 400, 0.5, 10, 0, 24)
        expect(boxes[0]!.w).toBe(176)
        expect(boxes[0]!.left).toBe(24 + 88)
    })

    test('a page at or beyond the padded band width still starts flush at pad, not 0', () => {
        const { boxes } = layoutPages([{ w: 100, h: 100 }], 400, 2, 10, 0, 24)
        expect(boxes[0]!.left).toBe(24)
    })

    test('margin + pad together: page+margin fill the padded band, pad is untouched by the ratio', () => {
        // band = 600 - 48 = 552; zoom 1, ratio 0.5 → page 552/1.5=368, margin 184.
        const { boxes } = layoutPages(
            [{ w: 200, h: 300 }],
            600,
            1,
            10,
            0.5,
            24,
        )
        expect(boxes[0]!.left).toBe(24)
        expect(boxes[0]!.w).toBeCloseTo(368, 9)
        expect(boxes[0]!.marginW).toBeCloseTo(184, 9)
        // page + margin's right edge sits pad px from the container's right edge.
        expect(boxes[0]!.left + boxes[0]!.w + boxes[0]!.marginW).toBeCloseTo(
            600 - 24,
            9,
        )
    })

    test('stacking still accounts for pad on the SECOND page too (top carries pad + running height)', () => {
        const { boxes, contentH } = layoutPages(
            [
                { w: 100, h: 100 },
                { w: 100, h: 100 },
            ],
            348, // band 300 at pad 24
            1,
            10,
            0,
            24,
        )
        expect(boxes[0]!.top).toBe(24)
        expect(boxes[1]!.top).toBe(24 + 300 + 10) // pad + first page's height + gap
        expect(contentH).toBe(24 + 300 + 10 + 300 + 24)
    })
})

describe('currentPageIndex', () => {
    // Three 100px pages, gap 20: tops 0 / 120 / 240.
    const boxes = layoutPages(
        Array.from({ length: 3 }, () => ({ w: 100, h: 100 })),
        100,
        1,
        20,
    ).boxes

    test('the page under the point one third down the viewport', () => {
        // viewport 300 → probe at scrollTop + 100.
        expect(currentPageIndex(boxes, 0, 300)).toBe(0) // probe 100, inside page 0 (0-100)
        expect(currentPageIndex(boxes, 30, 300)).toBe(1) // probe 130, inside page 1
        expect(currentPageIndex(boxes, 150, 300)).toBe(2) // probe 250, inside page 2
    })

    test('a probe in the gap between pages belongs to the page above', () => {
        expect(currentPageIndex(boxes, 10, 300)).toBe(0) // probe 110, in the 100-120 gap
    })

    test('clamps past either end', () => {
        expect(currentPageIndex(boxes, 10_000, 300)).toBe(2)
        expect(currentPageIndex(boxes, -500, 300)).toBe(0)
    })

    test('empty doc is page 0', () => {
        expect(currentPageIndex([], 0, 300)).toBe(0)
    })
})

describe('scrollTopForPage', () => {
    const boxes = layoutPages(
        Array.from({ length: 3 }, () => ({ w: 100, h: 200 })),
        100,
        1,
        20,
    ).boxes // tops 0 / 220 / 440, h 200

    test('the top of the page by default', () => {
        expect(scrollTopForPage(boxes, 2)).toBe(440)
    })

    test('yFraction offsets into the page and is clamped to 0..1', () => {
        expect(scrollTopForPage(boxes, 1, 0.5)).toBe(320)
        expect(scrollTopForPage(boxes, 1, 3)).toBe(420)
        expect(scrollTopForPage(boxes, 1, -1)).toBe(220)
    })

    test('an out-of-range index clamps to the nearest page; empty is 0', () => {
        expect(scrollTopForPage(boxes, 99)).toBe(440)
        expect(scrollTopForPage(boxes, -3)).toBe(0)
        expect(scrollTopForPage([], 2)).toBe(0)
    })

    test('round-trips with currentPageIndex', () => {
        for (let i = 0; i < boxes.length; i++) {
            expect(
                currentPageIndex(boxes, scrollTopForPage(boxes, i), 600),
            ).toBe(i)
        }
    })
})

describe('visiblePageRange', () => {
    // Five 100px-tall pages (gap 0), so tops are 0/100/200/300/400.
    const boxes = layoutPages(
        Array.from({ length: 5 }, () => ({ w: 100, h: 100 })),
        100,
        1,
        0,
    ).boxes

    test('picks only the pages intersecting the viewport, no overscan', () => {
        // viewport [150, 250) intersects page 1 (100-200) and page 2 (200-300).
        expect(visiblePageRange(boxes, 150, 100, 0)).toEqual([1, 2])
    })

    test('overscan pads both sides and clamps to the array bounds', () => {
        expect(visiblePageRange(boxes, 150, 100, 1)).toEqual([0, 3])
        // overscan of 10 clamps to [0, 4] rather than going negative / past the end.
        expect(visiblePageRange(boxes, 150, 100, 10)).toEqual([0, 4])
    })

    test('viewport scrolled past the end pins to the last page', () => {
        expect(visiblePageRange(boxes, 10_000, 100, 0)).toEqual([4, 4])
    })

    test('viewport at the very top includes the first page', () => {
        expect(visiblePageRange(boxes, 0, 50, 0)).toEqual([0, 0])
    })

    test('empty doc: an empty inclusive range', () => {
        expect(visiblePageRange([], 0, 500, 1)).toEqual([0, -1])
    })
})
