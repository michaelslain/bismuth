import { describe, expect, it } from 'bun:test'
import { createFrame, putText } from './glyphScene'
import {
    fitScene,
    frameInterval,
    quantizeAlpha,
    rowRuns,
    shouldRun,
} from './glyphPaint'

describe('rowRuns', () => {
    it('merges equal colour + alpha, breaks on space and colour', () => {
        const f = createFrame(12, 1)
        putText(f, 0, 0, 'ab', 'fg')
        putText(f, 2, 0, 'cd', 'accent')
        putText(f, 5, 0, 'ef', 'accent')
        expect(rowRuns(f, 0)).toEqual([
            { row: 0, col: 0, text: 'ab', color: 0, alpha: 240 },
            { row: 0, col: 2, text: 'cd', color: 3, alpha: 240 },
            { row: 0, col: 5, text: 'ef', color: 3, alpha: 240 },
        ])
    })
    it('alpha within one quantum merges, alpha 0 is skipped', () => {
        const f = createFrame(4, 1)
        putText(f, 0, 0, 'a', 'fg', 0xf3)
        putText(f, 1, 0, 'b', 'fg', 0xf9)
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
        expect(quantizeAlpha(0xff)).toBe(0xf0)
        expect(frameInterval(12)).toBeCloseTo(83.333, 2)
    })
})
