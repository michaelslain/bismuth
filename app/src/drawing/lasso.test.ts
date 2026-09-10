// app/src/drawing/lasso.test.ts
//
// Every assertion here was checked by BREAKING the implementation and watching this specific
// test go red — the plan's own fixture for this task would have passed against a bounding-box
// "lasso" that never casts a ray, and against a `scaleStrokes` that quietly scaled the pressure
// byte along with the geometry. Where a test exists only to close one of those holes, the
// comment says which hole.
import { describe, expect, test } from 'bun:test'
import {
    clampDelta,
    clampScale,
    MIN_SCALE,
    pickOwningBlock,
    pointInPolygon,
    scaleStrokes,
    selectionBounds,
    strokesInLasso,
    translateStrokes,
} from './lasso'
import type { Stroke } from '../../../core/src/drawing/model'

const inside: Stroke = { t: 'pen', c: 'fg', w: 4, pts: [10, 10, 180, 20, 20, 180] }
const outside: Stroke = {
    t: 'pen',
    c: 'fg',
    w: 4,
    pts: [900, 900, 180, 910, 910, 180],
}
const square = [0, 0, 100, 0, 100, 100, 0, 100]

// A "C" opening to the right: the notch at x > 40, 40 < y < 60 is OUTSIDE the polygon even
// though it is well inside the polygon's bounding box.
const horseshoe = [
    0, 0, 100, 0, 100, 40, 40, 40, 40, 60, 100, 60, 100, 100, 0, 100,
]

describe('pointInPolygon', () => {
    test('a point in the middle of a square is inside', () => {
        expect(pointInPolygon(square, 50, 50)).toBe(true)
    })

    test('a point outside the square is outside', () => {
        expect(pointInPolygon(square, 150, 50)).toBe(false)
    })

    // THE test that separates ray casting from a bounding-box check. Both answers are "inside
    // the bbox"; only one of them is right.
    test('a point in a concave notch is outside despite being inside the bounding box', () => {
        expect(pointInPolygon(horseshoe, 70, 50)).toBe(false)
        expect(pointInPolygon(horseshoe, 70, 20)).toBe(true)
    })

    test('a degenerate polygon encloses nothing', () => {
        expect(pointInPolygon([0, 0, 10, 10], 5, 5)).toBe(false)
        expect(pointInPolygon([], 0, 0)).toBe(false)
    })
})

describe('strokesInLasso', () => {
    test('selects a stroke wholly inside the polygon', () => {
        expect(strokesInLasso([inside, outside], square)).toEqual([0])
    })

    test('does not select a stroke only partly inside', () => {
        const straddling: Stroke = {
            t: 'pen',
            c: 'fg',
            w: 4,
            pts: [50, 50, 180, 500, 500, 180],
        }
        expect(strokesInLasso([straddling], square)).toEqual([])
    })

    // The plan's square fixture cannot tell a real lasso from `minX <= x <= maxX`, so this is
    // the case that does: every point of this stroke is inside the horseshoe's BOUNDING BOX and
    // none of them is inside the horseshoe.
    test('does not select a stroke sitting in a concave notch', () => {
        const inNotch: Stroke = {
            t: 'pen',
            c: 'fg',
            w: 4,
            pts: [60, 45, 180, 90, 55, 180],
        }
        expect(strokesInLasso([inNotch], horseshoe)).toEqual([])
        expect(strokesInLasso([inside], horseshoe)).toEqual([0])
    })

    // `every` over an empty point list is vacuously true, so a pointless stroke would otherwise
    // join every selection ever made.
    test('never selects a stroke with no points', () => {
        expect(strokesInLasso([{ t: 'pen', c: 'fg', w: 4, pts: [] }], square)).toEqual(
            [],
        )
    })

    test('returns every matching index, in order', () => {
        const second: Stroke = {
            t: 'pen',
            c: 'fg',
            w: 4,
            pts: [30, 30, 180, 40, 40, 180],
        }
        expect(strokesInLasso([inside, outside, second], square)).toEqual([0, 2])
    })
})

describe('pickOwningBlock', () => {
    const a: Stroke = { t: 'pen', c: 'fg', w: 4, pts: [10, 10, 180, 20, 20, 180] }
    const b: Stroke = { t: 'pen', c: 'fg', w: 4, pts: [30, 30, 180, 40, 40, 180] }
    const c: Stroke = { t: 'pen', c: 'fg', w: 4, pts: [60, 60, 180, 70, 70, 180] }

    test('a lasso spanning two blocks selects from ONE of them, never both', () => {
        const picked = pickOwningBlock(
            [
                { fromLine: 5, strokes: [a] },
                { fromLine: 9, strokes: [b, c] },
            ],
            square,
        )
        // Block 9 contributes two strokes to block 5's one, so it owns the selection — and
        // block 5's stroke is left unselected rather than joining it.
        expect(picked).toEqual({ fromLine: 9, indices: [0, 1] })
    })

    test('a tie goes to the block higher up the page', () => {
        const picked = pickOwningBlock(
            [
                { fromLine: 5, strokes: [a] },
                { fromLine: 9, strokes: [b] },
            ],
            square,
        )
        expect(picked?.fromLine).toBe(5)
    })

    test('a lasso that caught nothing selects nothing', () => {
        expect(
            pickOwningBlock([{ fromLine: 5, strokes: [outside] }], square),
        ).toBeNull()
    })
})

describe('translateStrokes', () => {
    test('moves every point and leaves pressure alone', () => {
        const [s] = translateStrokes([inside], 5, 7)
        expect(s.pts).toEqual([15, 17, 180, 25, 27, 180])
    })

    test('does not write through the input', () => {
        const src: Stroke = { t: 'pen', c: 'fg', w: 4, pts: [1, 2, 180] }
        translateStrokes([src], 100, 100)
        expect(src.pts).toEqual([1, 2, 180])
    })

    test('carries tool, colour and width through untouched', () => {
        const hl: Stroke = {
            t: 'hl',
            c: '#f2b705',
            w: 16,
            straight: true,
            pts: [0, 0, 255],
        }
        const [s] = translateStrokes([hl], 3, 4)
        expect(s.t).toBe('hl')
        expect(s.c).toBe('#f2b705')
        expect(s.w).toBe(16)
        expect(s.straight).toBe(true)
    })
})

describe('scaleStrokes', () => {
    test('scales width along with geometry', () => {
        const [s] = scaleStrokes([inside], 0, 0, 2)
        expect(s.w).toBe(8)
        // The WHOLE pts array, not just the first pair: a scale applied to the pressure byte as
        // well reads as a stroke that got heavier as it grew, and `slice(0, 2)` cannot see it.
        expect(s.pts).toEqual([20, 20, 180, 40, 40, 180])
    })

    test('scale about a non-origin point keeps that point fixed', () => {
        const [s] = scaleStrokes([inside], 10, 10, 3)
        expect(s.pts.slice(0, 2)).toEqual([10, 10])
        expect(s.pts.slice(3, 5)).toEqual([40, 40])
    })

    test('shrinking is the inverse of growing', () => {
        const grown = scaleStrokes([inside], 5, 5, 4)
        const back = scaleStrokes(grown, 5, 5, 0.25)
        expect(back[0].pts).toEqual(inside.pts)
        expect(back[0].w).toBeCloseTo(inside.w, 10)
    })
})

describe('clampDelta', () => {
    const bounds = { minX: 10, minY: 10, maxX: 50, maxY: 50 }
    const limit = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

    test('a move that stays inside is not trimmed', () => {
        expect(clampDelta(bounds, 20, 30, limit)).toEqual({ dx: 20, dy: 30 })
    })

    test('a move past the far edge stops exactly on it', () => {
        // maxY 50 + 90 would be 140; the limit's bottom is 100, so dy trims to 50.
        expect(clampDelta(bounds, 0, 90, limit).dy).toBe(50)
        expect(clampDelta(bounds, 90, 0, limit).dx).toBe(50)
    })

    test('a move past the near edge stops exactly on it', () => {
        expect(clampDelta(bounds, -80, -80, limit)).toEqual({ dx: -10, dy: -10 })
    })

    // The rule that keeps a hand-drawn annotation usable: ink already sticking out of its block
    // must not be yanked back in by the first pixel of drag. A clamp written as a plain
    // Math.min/max against `limit` returns dy = -5 here (shoving the overhang inside); the union
    // rule returns 0 (nothing moves) and lets a later drag move it back.
    test('ink that already overhangs keeps its overhang', () => {
        const over = { minX: 10, minY: -5, maxX: 50, maxY: 50 }
        expect(clampDelta(over, 0, 0, limit).dy).toBe(0)
        expect(clampDelta(over, 0, -10, limit).dy).toBe(0)
        expect(clampDelta(over, 0, 10, limit).dy).toBe(10)
    })

    // THE case that made the design's own canonical annotation immovable: a ring drawn slightly
    // taller than the one-line paragraph it circles overhangs BOTH edges. Widening the limit to
    // contain it leaves an interval exactly the size of the box, so every delta clamped to zero
    // and the selection simply refused to move with nothing on screen to explain why.
    test('ink overhanging BOTH edges can still be nudged either way', () => {
        const both = { minX: 10, minY: -5, maxX: 50, maxY: 25 }
        const band = { minX: 0, minY: 0, maxX: 100, maxY: 20 }
        expect(clampDelta(both, 0, 5, band).dy).toBe(5)
        expect(clampDelta(both, 0, -5, band).dy).toBe(-5)
        // …and no further: past that it would stick out more than it already does.
        expect(clampDelta(both, 0, 40, band).dy).toBe(5)
        expect(clampDelta(both, 0, -40, band).dy).toBe(-5)
    })

    test('a selection box taller than its block travels its own slack, not zero', () => {
        // A 60-tall box in a 20-tall band. It may slide until the band sits at one end of it or
        // the other and no further, so the band never stops being covered: the box's top can
        // reach the band's top (+20) and its bottom can reach the band's bottom (-20).
        const tall = { minX: 10, minY: -20, maxX: 50, maxY: 40 }
        const band = { minX: 0, minY: 0, maxX: 100, maxY: 20 }
        expect(clampDelta(tall, 0, 12, band).dy).toBe(12)
        expect(clampDelta(tall, 0, 999, band).dy).toBe(20)
        expect(clampDelta(tall, 0, -999, band).dy).toBe(-20)
    })

    test('a box larger than its limit on both axes can be nudged, never inverted', () => {
        const huge = { minX: -50, minY: -50, maxX: 150, maxY: 150 }
        // The interval is [-50, 50] per axis — the slack between "the limit sits at one end of
        // the box" and "the other". A refused drag stalls at the edge; it never inverts.
        expect(clampDelta(huge, 40, 40, limit)).toEqual({ dx: 40, dy: 40 })
        expect(clampDelta(huge, 400, -400, limit)).toEqual({ dx: 50, dy: -50 })
    })

    test('the total distance ink sticks out of its block never grows', () => {
        const band = { minX: 0, minY: 0, maxX: 100, maxY: 20 }
        const overhang = (b: {
            minX: number
            minY: number
            maxX: number
            maxY: number
        }) =>
            Math.max(0, band.minY - b.minY) + Math.max(0, b.maxY - band.maxY)
        for (const box of [
            { minX: 10, minY: 4, maxX: 50, maxY: 16 },
            { minX: 10, minY: -5, maxX: 50, maxY: 16 },
            { minX: 10, minY: 4, maxX: 50, maxY: 25 },
            { minX: 10, minY: -5, maxX: 50, maxY: 25 },
            { minX: 10, minY: -20, maxX: 50, maxY: 40 },
        ]) {
            const start = overhang(box)
            for (const want of [-99, -7, -1, 1, 7, 99]) {
                const { dy } = clampDelta(box, 0, want, band)
                const moved = { ...box, minY: box.minY + dy, maxY: box.maxY + dy }
                expect(overhang(moved)).toBeLessThanOrEqual(start + 1e-9)
            }
        }
    })
})

describe('clampScale', () => {
    const bounds = { minX: 10, minY: 10, maxX: 50, maxY: 50 }
    const limit = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

    test('shrinking is never clamped', () => {
        expect(clampScale(bounds, 10, 10, 0.5, limit)).toBe(0.5)
    })

    test('growing within the limit is not clamped', () => {
        // About the top-left corner, the far edge lands at 10 + 40*2 = 90 < 100.
        expect(clampScale(bounds, 10, 10, 2, limit)).toBe(2)
    })

    test('growing past the limit is capped exactly at it', () => {
        // The far edge may reach 100: 10 + 40*f = 100 → f = 2.25.
        expect(clampScale(bounds, 10, 10, 5, limit)).toBeCloseTo(2.25, 10)
    })

    test('the capping edge is the one that would leave first', () => {
        // Origin at the bottom-right: growing pushes minX/minY toward 0, which they reach at
        // f = 40 / 40 = 1.25 (50 - 40*f = 0).
        expect(clampScale(bounds, 50, 50, 5, limit)).toBeCloseTo(1.25, 10)
    })

    test('never collapses a drawing to nothing', () => {
        expect(clampScale(bounds, 10, 10, 0, limit)).toBe(MIN_SCALE)
        expect(clampScale(bounds, 10, 10, -3, limit)).toBe(MIN_SCALE)
    })

    // An annotation ring that already covers its one-line paragraph end to end used to cap at a
    // factor of exactly 1.0: the corner handle moved and the drawing did not. An axis the ink
    // already spans stops constraining; the reading column still bounds the other one, so the
    // resize is loosened rather than unbounded.
    test('an axis the box already spans does not cap the resize', () => {
        const ring = { minX: 40, minY: -5, maxX: 160, maxY: 25 }
        const band = { minX: 0, minY: 0, maxX: 680, maxY: 20 }
        expect(clampScale(ring, 40, -5, 1.8, band)).toBe(1.8)
        // The horizontal edge is real and still caps: 40 + 120f ≤ 680 → f ≤ 5.333…
        expect(clampScale(ring, 40, -5, 99, band)).toBeCloseTo(
            (680 - 40) / 120,
            6,
        )
    })

    test('an axis the box merely overhangs on one side still caps', () => {
        const low = { minX: 10, minY: 4, maxX: 50, maxY: 25 }
        const band = { minX: 0, minY: 0, maxX: 100, maxY: 20 }
        // The bottom already pokes out by 5, so growing downward from the pinned top is refused.
        expect(clampScale(low, 10, 4, 3, band)).toBeCloseTo(1, 6)
    })
})

describe('selectionBounds', () => {
    test('spans only the chosen strokes', () => {
        expect(selectionBounds([inside, outside], [0])).toEqual({
            minX: 10,
            minY: 10,
            maxX: 20,
            maxY: 20,
        })
    })

    test('is null for an empty selection', () => {
        expect(selectionBounds([inside], [])).toBeNull()
    })
})
