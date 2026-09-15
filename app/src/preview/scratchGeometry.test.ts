import { describe, expect, test } from 'bun:test'
import {
    blockScreenRect,
    dropAt,
    hitStrip,
    placeAt,
    stripRangeLogical,
} from './scratchGeometry'
import type { PageInkPage } from './PageInk'
import type { LogicalBox } from '../../../core/src/drawing/pageInk'
import {
    SCRATCH_MIN_W,
    SCRATCH_PAD,
    SCRATCH_REF_SCALE,
    type ScratchBlock,
} from '../../../core/src/scratchTypes'

// A US-Letter page (612x792pt) fits the 816x1056 logical page exactly: box = {0, 0, 816, 1056}.
const LETTER: LogicalBox = { x: 0, y: 0, w: 816, h: 1056 }

/** Page `i` of a one-column stack: rendered 612 wide at 1x (k = 0.75 = SCRATCH_REF_SCALE), with a
 *  0.4 strip, 16px gap between pages, 20px left gutter. */
const pageAt = (i: number, zoom = 1): PageInkPage => {
    const w = 612 * zoom
    const h = 792 * zoom
    return {
        rendered: { left: 20, top: 10 + i * (h + 16), w, h },
        nat: { w: 612, h: 792 },
        marginW: 0.4 * w,
    }
}

const block = (patch: Partial<ScratchBlock> = {}): ScratchBlock => ({
    id: 'a',
    page: 0,
    x: 900,
    y: 400,
    w: 200,
    text: '',
    ...patch,
})

describe('stripRangeLogical', () => {
    test('starts at the box right edge and spans marginW in logical units', () => {
        const r = stripRangeLogical(pageAt(0), LETTER)
        expect(r.x0).toBe(816)
        // 244.8px of strip at 612px per 816 units = 326.4 units.
        expect(r.x1).toBeCloseTo(816 + 326.4, 6)
    })

    test('is zoom-independent', () => {
        const a = stripRangeLogical(pageAt(0, 1), LETTER)
        const b = stripRangeLogical(pageAt(0, 2), LETTER)
        expect(b.x0).toBe(a.x0)
        expect(b.x1).toBeCloseTo(a.x1, 6)
    })

    test('no margin -> an empty range at the box edge', () => {
        const p = { ...pageAt(0), marginW: undefined }
        expect(stripRangeLogical(p, LETTER)).toEqual({ x0: 816, x1: 816 })
    })
})

describe('blockScreenRect', () => {
    test('at 1x maps logical -> host px and scale is 1 at the reference scale', () => {
        const r = blockScreenRect(block(), pageAt(0), LETTER)
        expect(r.left).toBeCloseTo(20 + 900 * 0.75, 6)
        expect(r.top).toBeCloseTo(10 + 400 * 0.75, 6)
        expect(r.w).toBeCloseTo(150, 6)
        expect(r.scale).toBeCloseTo(0.75 / SCRATCH_REF_SCALE, 6)
        expect(r.scale).toBeCloseTo(1, 6)
    })

    test('at 2x doubles size + scale and keeps the same logical point', () => {
        const one = blockScreenRect(block({ page: 1 }), pageAt(1, 1), LETTER)
        const two = blockScreenRect(block({ page: 1 }), pageAt(1, 2), LETTER)
        expect(two.scale).toBeCloseTo(one.scale * 2, 6)
        expect(two.w).toBeCloseTo(one.w * 2, 6)
        const p2 = pageAt(1, 2).rendered
        expect(two.left).toBeCloseTo(p2.left + 900 * 1.5, 6)
        expect(two.top).toBeCloseTo(p2.top + 400 * 1.5, 6)
    })

    test('a legacy images[0] box (non-default box.x) offsets by box.x/box.y', () => {
        const legacy: LogicalBox = { x: 100, y: 50, w: 612, h: 792 }
        // k = 612 / 612 = 1
        const r = blockScreenRect(block({ x: 800, y: 150 }), pageAt(0), legacy)
        expect(r.left).toBeCloseTo(20 + 700, 6)
        expect(r.top).toBeCloseTo(10 + 100, 6)
        expect(r.scale).toBeCloseTo(1 / SCRATCH_REF_SCALE, 6)
    })
})

describe('placeAt', () => {
    test('x/y = the click, w runs to the strip right edge minus the pad', () => {
        const page = pageAt(2)
        const { rendered } = page
        // Click 30px into the strip, 100px down the page.
        const hx = rendered.left + rendered.w + 30
        const hy = rendered.top + 100
        const b = placeAt(2, page, LETTER, hx, hy)
        const { x1 } = stripRangeLogical(page, LETTER)
        expect(b.page).toBe(2)
        expect(Math.abs(b.x - (816 + 40))).toBeLessThanOrEqual(1)
        expect(Math.abs(b.y - 100 / 0.75)).toBeLessThanOrEqual(1)
        expect(Math.abs(b.x + b.w - (x1 - SCRATCH_PAD))).toBeLessThanOrEqual(1)
        // Whole logical units, like the companion format writes them.
        expect(Number.isInteger(b.x)).toBe(true)
        expect(Number.isInteger(b.y)).toBe(true)
        expect(Number.isInteger(b.w)).toBe(true)
    })

    test('near the right edge the block shifts left to keep SCRATCH_MIN_W', () => {
        const page = pageAt(0)
        const { rendered } = page
        const hx = rendered.left + rendered.w + (page.marginW ?? 0) - 5
        const b = placeAt(0, page, LETTER, hx, rendered.top + 50)
        const { x1 } = stripRangeLogical(page, LETTER)
        expect(b.w).toBeGreaterThanOrEqual(SCRATCH_MIN_W)
        expect(b.x + b.w).toBeLessThanOrEqual(x1 - SCRATCH_PAD)
        expect(b.x).toBeLessThan(816 + 326.4 - 5 / 0.75)
    })

    test('a strip narrower than MIN_W never shifts left of x0 + pad', () => {
        const narrow: PageInkPage = { ...pageAt(0), marginW: 60 } // 80 logical units
        const { rendered } = narrow
        const b = placeAt(
            0,
            narrow,
            LETTER,
            rendered.left + rendered.w + 50,
            rendered.top,
        )
        expect(b.x).toBeGreaterThanOrEqual(816 + SCRATCH_PAD)
        expect(b.x + b.w).toBeLessThanOrEqual(816 + 80 - SCRATCH_PAD)
    })

    test('a click flush against the strip\'s left edge clamps to x0 + PAD, never flush to the page', () => {
        const page = pageAt(0)
        const { rendered } = page
        // Click exactly at the strip's left edge (the page/strip boundary).
        const b = placeAt(0, page, LETTER, rendered.left + rendered.w, rendered.top + 40)
        expect(b.x).toBe(Math.ceil(816 + SCRATCH_PAD))
        expect(b.y).toBeCloseTo(40 / 0.75, 0)
    })

    test('legacy box: x is measured from box.x', () => {
        const legacy: LogicalBox = { x: 100, y: 50, w: 612, h: 792 }
        const page = pageAt(0)
        const { rendered } = page
        // 30px into the strip — past the pad, so this exercises the box.x offset, not the clamp.
        const b = placeAt(
            0,
            page,
            legacy,
            rendered.left + rendered.w + 30,
            rendered.top + 20,
        )
        expect(b.x).toBe(100 + 612 + 30)
        expect(b.y).toBe(50 + 20)
    })
})

describe('hitStrip', () => {
    const pages = [pageAt(0), pageAt(1), pageAt(2)]
    const boxes = [LETTER, LETTER, LETTER]

    test('a point inside page 1 strip hits page 1 with its logical point', () => {
        const r = pages[1].rendered
        const hit = hitStrip(pages, boxes, r.left + r.w + 12, r.top + 30)
        expect(hit).not.toBeNull()
        expect(hit!.page).toBe(1)
        expect(hit!.x).toBeCloseTo(816 + 16, 6)
        expect(hit!.y).toBeCloseTo(40, 6)
    })

    test('a point on the page itself misses', () => {
        const r = pages[0].rendered
        expect(hitStrip(pages, boxes, r.left + 10, r.top + 10)).toBeNull()
    })

    test('a point in the gap between pages misses', () => {
        const r = pages[0].rendered
        expect(
            hitStrip(pages, boxes, r.left + r.w + 12, r.top + r.h + 8),
        ).toBeNull()
    })

    test('a point right of every strip misses', () => {
        const r = pages[0].rendered
        expect(
            hitStrip(
                pages,
                boxes,
                r.left + r.w + (pages[0].marginW ?? 0) + 5,
                r.top + 5,
            ),
        ).toBeNull()
    })

    test('a page without a margin has no strip', () => {
        const bare = [{ ...pageAt(0), marginW: 0 }]
        const r = bare[0].rendered
        expect(hitStrip(bare, [LETTER], r.left + r.w, r.top + 5)).toBeNull()
    })
})

describe('dropAt', () => {
    const pages = [pageAt(0), pageAt(1)]
    const boxes = [LETTER, LETTER]

    test('dropping over page 1 strip re-anchors the block top-left there, width unchanged', () => {
        const r = pages[1].rendered
        const out = dropAt(
            pages,
            boxes,
            block({ w: 200 }),
            r.left + r.w + 40,
            r.top + 60,
            r.left + r.w + 30,
            r.top + 60,
        )
        expect(out).toEqual({
            page: 1,
            x: Math.round(816 + 30 / 0.75),
            y: Math.round(60 / 0.75),
            w: 200,
        })
    })

    test('a top-left left of the strip clamps to x0 + PAD; past the right edge clamps to x1 - PAD - w', () => {
        const r = pages[0].rendered
        const left = dropAt(
            pages,
            boxes,
            block({ w: 200 }),
            r.left + r.w + 5,
            r.top + 60,
            r.left + r.w - 50,
            r.top + 60,
        )
        expect(left!.x).toBe(Math.ceil(816 + SCRATCH_PAD))
        const { x1 } = stripRangeLogical(pages[0], LETTER)
        const right = dropAt(
            pages,
            boxes,
            block({ w: 200 }),
            r.left + r.w + 200,
            r.top + 60,
            r.left + r.w + 200,
            r.top + 60,
        )
        expect(right!.x + right!.w).toBeLessThanOrEqual(
            Math.floor(x1 - SCRATCH_PAD),
        )
    })

    test('a pointer off every strip -> null (snap back)', () => {
        const r = pages[0].rendered
        expect(
            dropAt(
                pages,
                boxes,
                block(),
                r.left + 10,
                r.top + 10,
                r.left,
                r.top,
            ),
        ).toBeNull()
    })

    test('dropping onto a strip narrower than the block but still >= MIN_W shrinks w to fit, never overflowing', () => {
        // marginW 140 -> ~186.7 logical units of strip, ~154.7 available between the pads: less
        // than the 200-wide block, but still above SCRATCH_MIN_W (120).
        const narrow: PageInkPage = { ...pageAt(0), marginW: 140 }
        const pagesN = [narrow]
        const boxesN = [LETTER]
        const r = narrow.rendered
        const out = dropAt(
            pagesN,
            boxesN,
            block({ w: 200 }),
            r.left + r.w + 20,
            r.top + 60,
            r.left + r.w + 10,
            r.top + 60,
        )
        const { x1 } = stripRangeLogical(narrow, LETTER)
        expect(out).not.toBeNull()
        expect(out!.w).toBeLessThan(200)
        expect(out!.w).toBeGreaterThanOrEqual(SCRATCH_MIN_W)
        expect(out!.x).toBeGreaterThanOrEqual(816 + SCRATCH_PAD)
        expect(out!.x + out!.w).toBeLessThanOrEqual(Math.ceil(x1 - SCRATCH_PAD))
    })

    test('a strip whose available span is under SCRATCH_MIN_W -> null (snap back), never a sliver block', () => {
        const tooNarrow: PageInkPage = { ...pageAt(0), marginW: 60 } // 80 logical units total, 48 available
        const pagesN = [tooNarrow]
        const boxesN = [LETTER]
        const r = tooNarrow.rendered
        expect(
            dropAt(
                pagesN,
                boxesN,
                block({ w: 200 }),
                r.left + r.w + 20,
                r.top + 60,
                r.left + r.w + 10,
                r.top + 60,
            ),
        ).toBeNull()
    })

    test('a strip wider than the block leaves w unchanged', () => {
        const r = pages[0].rendered
        const out = dropAt(
            pages,
            boxes,
            block({ w: 50 }),
            r.left + r.w + 20,
            r.top + 60,
            r.left + r.w + 10,
            r.top + 60,
        )
        expect(out!.w).toBe(50)
    })

    test('y clamps to the page: never above box.y, never below box.y + box.h', () => {
        const r = pages[0].rendered
        const above = dropAt(
            pages,
            boxes,
            block({ w: 100 }),
            r.left + r.w + 20,
            r.top + 5,
            r.left + r.w + 20,
            r.top - 500,
        )
        expect(above!.y).toBe(LETTER.y)

        const below = dropAt(
            pages,
            boxes,
            block({ w: 100 }),
            r.left + r.w + 20,
            r.top + r.h - 5,
            r.left + r.w + 20,
            r.top + r.h + 5000,
        )
        expect(below!.y).toBe(LETTER.y + LETTER.h)
    })

    test('a legacy box (non-zero box.y) clamps y within box.y..box.y+box.h', () => {
        const legacy: LogicalBox = { x: 100, y: 50, w: 612, h: 792 }
        const page = pageAt(0)
        const r = page.rendered
        const above = dropAt(
            [page],
            [legacy],
            block({ w: 100 }),
            r.left + r.w + 20,
            r.top + 5,
            r.left + r.w + 20,
            r.top - 500,
        )
        expect(above!.y).toBe(50)
    })
})
