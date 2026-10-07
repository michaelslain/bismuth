import { describe, expect, it } from 'bun:test'
import { createFrame, putText } from './glyphScene'
import {
    fitScale,
    fitScene,
    frameInterval,
    quantizeAlpha,
    rowRuns,
    shouldRun,
    snapCell,
} from './glyphPaint'

describe('rowRuns', () => {
    it('merges equal colour + alpha, breaks on space and colour', () => {
        const f = createFrame(12, 1)
        putText(f, 0, 0, 'ab', 'fg')
        putText(f, 2, 0, 'cd', 'accent')
        putText(f, 5, 0, 'ef', 'accent')
        expect(rowRuns(f, 0)).toEqual([
            { row: 0, col: 0, text: 'ab', color: 0, alpha: 255 },
            { row: 0, col: 2, text: 'cd', color: 3, alpha: 255 },
            { row: 0, col: 5, text: 'ef', color: 3, alpha: 255 },
        ])
    })
    it('alpha within one quantum merges, alpha 0 is skipped', () => {
        const f = createFrame(4, 1)
        putText(f, 0, 0, 'a', 'fg', 0xf1)
        putText(f, 1, 0, 'b', 'fg', 0xf6)
        putText(f, 2, 0, 'c', 'fg', 0)
        expect(rowRuns(f, 0)).toEqual([
            { row: 0, col: 0, text: 'ab', color: 0, alpha: 240 },
        ])
    })
    it('empty row has no runs', () => {
        expect(rowRuns(createFrame(5, 2), 1)).toEqual([])
    })
})

describe('fitScene', () => {
    it('centres a smaller scene', () => {
        expect(fitScene(96, 16, 62, 9)).toEqual({ col: 17, row: 3 })
    })
    it('a larger scene gets a negative offset (clipped, not thrown)', () => {
        expect(fitScene(40, 8, 62, 9)).toEqual({ col: -11, row: -1 })
    })
})

describe('loop helpers', () => {
    it('runs only when active, visible and not reduced', () => {
        expect(shouldRun(true, false, false)).toBe(true)
        expect(shouldRun(false, false, false)).toBe(false)
        expect(shouldRun(true, true, false)).toBe(false)
        expect(shouldRun(true, false, true)).toBe(false)
    })
    it('quantizes and paces', () => {
        expect(quantizeAlpha(0xff)).toBe(255)
        expect(quantizeAlpha(0xf7)).toBe(0xf0)
        expect(quantizeAlpha(248)).toBe(255)
        expect(quantizeAlpha(247)).toBe(240)
        expect(quantizeAlpha(15)).toBe(0)
        expect(frameInterval(12)).toBeCloseTo(83.333, 2)
    })
})

describe('fitScale', () => {
    it('is 1 for the hero box at the graph cell grid', () => {
        expect(fitScale(604.8, 288, 96, 16, 6.3, 18)).toBe(1)
    })
    it('shrinks when the box is slightly too small', () => {
        expect(fitScale(598.75, 285.12, 96, 16, 6.3, 18)).toBeLessThan(1)
    })
    it('grows to fill a 1.5x box', () => {
        expect(fitScale(907.2, 432, 96, 16, 6.3, 18)).toBeCloseTo(1.5, 5)
    })
    it('shrinks to the limiting axis', () => {
        expect(fitScale(604.8, 216, 96, 16, 6.3, 18)).toBeCloseTo(0.75, 5)
    })
    it('floors at 0.5 and caps at 2', () => {
        expect(fitScale(100, 40, 96, 16, 6.3, 18)).toBe(0.5)
        expect(fitScale(5000, 5000, 24, 5, 6.3, 18)).toBe(2)
    })
    it('takes the cap as a parameter: a host can ask for less than MAX_SCALE', () => {
        expect(fitScale(5000, 5000, 24, 5, 6.3, 18, 4 / 3)).toBe(4 / 3)
        expect(fitScale(5000, 5000, 24, 5, 6.3, 18)).toBe(2)
        // a cap only limits growth: a box that already fits below it is untouched
        expect(fitScale(907.2, 432, 96, 16, 6.3, 18, 4 / 3)).toBeCloseTo(4 / 3, 5)
        expect(fitScale(604.8, 216, 96, 16, 6.3, 18, 4 / 3)).toBeCloseTo(0.75, 5)
    })
})

describe('snapCell', () => {
    const near = (x: number) => Math.abs(x - Math.round(x))
    it('the intro art scale (4/3 on a 6.3 x 18 cell) fits no device grid unsnapped', () => {
        // the defect being fixed: 8.4px at dpr 1 and 16.8 device px at dpr 2
        expect(near(6.3 * (24 / 18) * 1)).toBeGreaterThan(0.3)
        expect(near(6.3 * (24 / 18) * 2)).toBeGreaterThan(0.1)
    })
    for (const dpr of [1, 1.5, 2]) {
        it(`cellW * dpr and cellH * dpr are whole numbers at dpr ${dpr}`, () => {
            for (const s of [0.5, 0.7, 0.889, 1, 1.111, 1.2, 4 / 3, 1.7, 2]) {
                const c = snapCell(s, 6.3, 18, dpr)
                expect(near(c.cellW * dpr)).toBeLessThan(1e-9)
                expect(near(c.cellH * dpr)).toBeLessThan(1e-9)
            }
        })
    }
    it('4/3 snaps to 8 x 23 css px at dpr 1 and 8.5 x 24 at dpr 2', () => {
        const a = snapCell(4 / 3, 6.3, 18, 1)
        expect([a.cellW, a.cellH]).toEqual([8, 23])
        const b = snapCell(4 / 3, 6.3, 18, 2)
        expect([b.cellW, b.cellH]).toEqual([8.5, 24])
    })
    it('shrinks a scale-1 cell at dpr 1 to 6 x 17: a stated decision, not an accident', () => {
        // 6.3 x 18 is the graph's own cell; whole device pixels leave 6 x 17, a 5.6% shrink in row
        // height. The canvas is drawn on that smaller grid, so a host sized exactly to scene x graph
        // cell has a one-cell margin.
        expect(snapCell(1, 6.3, 18, 1)).toMatchObject({ cellW: 6, cellH: 17 })
    })
    it('only ever shrinks, by at most 10%, so a fitted scene still fits', () => {
        for (const dpr of [1, 2])
            for (const s of [0.5, 0.889, 1, 4 / 3, 2]) {
                const c = snapCell(s, 6.3, 18, dpr)
                expect(c.scale).toBeLessThanOrEqual(s + 1e-9)
                expect(c.scale).toBeGreaterThanOrEqual(s * 0.9 - 1 / (18 * dpr))
            }
    })
    it('keeps the width within tolerance of the natural advance', () => {
        const c = snapCell(4 / 3, 6.3, 18, 1)
        expect(Math.abs(c.cellW / (6.3 * c.scale) - 1)).toBeLessThanOrEqual(0.03)
    })
})
