import { describe, expect, test } from 'bun:test'
import { splitStrokeAtSeams } from '../../src/drawing/splitStroke'
import type { Stroke } from '../../src/drawing/model'

const vertical = (ys: number[]): Stroke => ({
    t: 'pen',
    c: 'fg',
    w: 5,
    pts: ys.flatMap(y => [100, y, 180]),
})

describe('splitStrokeAtSeams', () => {
    test('a stroke crossing no seam comes back whole, in band 0', () => {
        const s = vertical([10, 20, 30])
        const out = splitStrokeAtSeams(s, [500])
        expect(out).toHaveLength(1)
        expect(out[0].band).toBe(0)
        expect(out[0].stroke.pts).toEqual(s.pts)
    })

    test('a stroke crossing one seam yields two pieces that meet on it', () => {
        const out = splitStrokeAtSeams(vertical([10, 90]), [50])
        expect(out.map(p => p.band)).toEqual([0, 1])
        const first = out[0].stroke.pts
        const second = out[1].stroke.pts
        expect(first.slice(-3)).toEqual([100, 50, 180])
        expect(second.slice(0, 3)).toEqual([100, 50, 180])
    })

    test('a stroke crossing three seams yields four pieces in draw order', () => {
        const out = splitStrokeAtSeams(vertical([10, 350]), [100, 200, 300])
        expect(out.map(p => p.band)).toEqual([0, 1, 2, 3])
    })

    test('a stroke drawn entirely below every seam lands in the last band', () => {
        const out = splitStrokeAtSeams(vertical([700, 720]), [100, 200])
        expect(out).toHaveLength(1)
        expect(out[0].band).toBe(2)
    })

    test('a piece with a single point is dropped rather than emitted', () => {
        const out = splitStrokeAtSeams(vertical([49, 51]), [50])
        for (const piece of out) {
            expect(piece.stroke.pts.length).toBeGreaterThanOrEqual(6)
        }
    })

    test('interpolates pressure at the seam', () => {
        const s: Stroke = { t: 'pen', c: 'fg', w: 5, pts: [0, 0, 100, 0, 100, 200] }
        const out = splitStrokeAtSeams(s, [50])
        expect(out[0].stroke.pts.slice(-1)[0]).toBe(150)
    })

    test('preserves tool, colour and width on every piece', () => {
        const out = splitStrokeAtSeams(
            { t: 'hl', c: 'accent', w: 12, pts: [0, 10, 180, 0, 90, 180] },
            [50],
        )
        for (const piece of out) {
            expect(piece.stroke.t).toBe('hl')
            expect(piece.stroke.c).toBe('accent')
            expect(piece.stroke.w).toBe(12)
        }
    })
})
