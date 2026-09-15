// app/src/preview/selectionRects.test.ts
import { describe, expect, test } from 'bun:test'
import { rectsToPages, type ClientRectLike } from './selectionRects'
import type { PageInkPage } from './PageInk'
import type { LogicalBox } from '../../../core/src/drawing/pageInk'

// A single Letter page rendered 816px wide at host origin (0, 0) — box == the full 816x1056
// logical page (a Letter PDF's own aspect ratio matches it exactly, see pageHighlights' header),
// so host px and logical px are identical here, which keeps the expected numbers simple to
// hand-check. A second scenario below uses a non-trivial box/scale to prove the conversion math
// itself, not just the identity case.
const IDENTITY_PAGE: PageInkPage = {
    rendered: { left: 0, top: 0, w: 816, h: 1056 },
    nat: { w: 612, h: 792 },
}
const IDENTITY_BOX: LogicalBox = { x: 0, y: 0, w: 816, h: 1056 }

function rect(left: number, top: number, width: number, height: number): ClientRectLike {
    return { left, top, width, height }
}

describe('rectsToPages', () => {
    test('a rect whose centre lands on the one page converts 1:1 at identity scale', () => {
        const out = rectsToPages(
            [rect(100, 200, 50, 14)],
            { left: 0, top: 0 },
            [IDENTITY_PAGE],
            () => IDENTITY_BOX,
        )
        expect(out.get(0)).toEqual([{ x: 100, y: 200, w: 50, h: 14 }])
    })

    test('hostOrigin shifts client coordinates into host space before hit-testing', () => {
        // The host itself sits at (40, 30) in the viewport; a client rect at (140, 230) is at
        // (100, 200) in host space, same as the previous test.
        const out = rectsToPages(
            [rect(140, 230, 50, 14)],
            { left: 40, top: 30 },
            [IDENTITY_PAGE],
            () => IDENTITY_BOX,
        )
        expect(out.get(0)).toEqual([{ x: 100, y: 200, w: 50, h: 14 }])
    })

    test('a rect whose centre lands on no page is dropped, not clamped', () => {
        const out = rectsToPages(
            [rect(2000, 2000, 50, 14)],
            { left: 0, top: 0 },
            [IDENTITY_PAGE],
            () => IDENTITY_BOX,
        )
        expect(out.size).toBe(0)
    })

    test('zero-width/height rects are dropped', () => {
        const out = rectsToPages(
            [rect(100, 200, 0, 14), rect(100, 200, 50, 0)],
            { left: 0, top: 0 },
            [IDENTITY_PAGE],
            () => IDENTITY_BOX,
        )
        expect(out.size).toBe(0)
    })

    test('picks the page whose rendered rect the centre falls in, in a two-page stack', () => {
        const pageA: PageInkPage = {
            rendered: { left: 0, top: 0, w: 816, h: 1056 },
            nat: { w: 612, h: 792 },
        }
        const pageB: PageInkPage = {
            rendered: { left: 0, top: 1072, w: 816, h: 1056 }, // GAP below page A
            nat: { w: 612, h: 792 },
        }
        const out = rectsToPages(
            [rect(10, 10, 20, 20), rect(10, 1100, 20, 20)],
            { left: 0, top: 0 },
            [pageA, pageB],
            () => IDENTITY_BOX,
        )
        expect(out.get(0)).toEqual([{ x: 10, y: 10, w: 20, h: 20 }])
        // Page B's box is expressed in ITS OWN logical space, which starts back at y=0 — the
        // conversion subtracts page B's `rendered.top` before scaling.
        expect(out.get(1)).toEqual([{ x: 10, y: 28, w: 20, h: 20 }])
    })

    test('multiple rects on the same page accumulate in one array, in order', () => {
        const out = rectsToPages(
            [rect(10, 10, 20, 5), rect(10, 30, 20, 5)],
            { left: 0, top: 0 },
            [IDENTITY_PAGE],
            () => IDENTITY_BOX,
        )
        expect(out.get(0)).toEqual([
            { x: 10, y: 10, w: 20, h: 5 },
            { x: 10, y: 30, w: 20, h: 5 },
        ])
    })

    test('scales through a non-trivial box (page rendered at half its logical size)', () => {
        const page: PageInkPage = {
            rendered: { left: 5, top: 5, w: 408, h: 528 }, // half of 816x1056
            nat: { w: 612, h: 792 },
        }
        const box: LogicalBox = { x: 0, y: 0, w: 816, h: 1056 }
        // A 40x10 client rect at host (55, 55) -> logical: k = 816/408 = 2, so top-left maps to
        // ((55-5)*2, (55-5)*2) = (100, 100), and the size doubles to (80, 20).
        const out = rectsToPages(
            [rect(55, 55, 40, 10)],
            { left: 0, top: 0 },
            [page],
            () => box,
        )
        expect(out.get(0)).toEqual([{ x: 100, y: 100, w: 80, h: 20 }])
    })
})
