// app/src/preview/pageLayout.test.ts
import { describe, expect, test } from 'bun:test'
import { layoutPages, visiblePageRange } from './pageLayout'

describe('layoutPages', () => {
    test('fit-width at zoom 1: a page takes the full container width, height scaled to its own aspect', () => {
        const { boxes, contentH } = layoutPages(
            [{ w: 200, h: 300 }],
            400,
            1,
            10,
        )
        expect(boxes).toEqual([{ top: 0, left: 0, w: 400, h: 600 }])
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
        expect(boxes[0]).toEqual({ top: 0, left: 0, w: 100, h: 100 })
        expect(boxes[1]).toEqual({ top: 120, left: 0, w: 100, h: 100 })
        expect(contentH).toBe(220) // 100 + 20 + 100, not +20 again
    })

    test('empty doc: no boxes, zero content height', () => {
        expect(layoutPages([], 400, 1, 10)).toEqual({
            boxes: [],
            contentH: 0,
        })
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
