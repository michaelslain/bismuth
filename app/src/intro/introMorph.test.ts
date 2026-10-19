import { describe, expect, test } from 'bun:test'
import { createFrame } from '../ui/ascii/glyphScene'
import { MORPH_MS } from './morph/morphFrame'
import {
    frameToGrid,
    morphOnMove,
    morphProgress,
    MORPH_IDLE,
    type MorphState,
} from './introMorph'

describe('morphOnMove', () => {
    test('a move from idle starts running', () => {
        expect(morphOnMove(MORPH_IDLE, 0, 1, 100, false)).toEqual({
            phase: 'running',
            fromIndex: 0,
            toIndex: 1,
            startedAt: 100,
        })
    })
    test('reduced motion cuts: idle, even mid-morph', () => {
        expect(morphOnMove(MORPH_IDLE, 0, 1, 100, true)).toEqual(MORPH_IDLE)
        const running = morphOnMove(MORPH_IDLE, 0, 1, 100, false)
        expect(morphOnMove(running, 1, 2, 200, true)).toEqual(MORPH_IDLE)
    })
    test('a move to the same slide changes nothing', () => {
        expect(morphOnMove(MORPH_IDLE, 2, 2, 100, false)).toEqual(MORPH_IDLE)
    })
    test('a move while running retargets, keeps running, does not queue', () => {
        const running = morphOnMove(MORPH_IDLE, 0, 1, 100, false)
        const next = morphOnMove(running, 1, 2, 400, false)
        expect(next).toEqual({
            phase: 'running',
            fromIndex: 1,
            toIndex: 2,
            startedAt: 400,
        })
    })
})

describe('morphProgress', () => {
    const running: MorphState = {
        phase: 'running',
        fromIndex: 0,
        toIndex: 1,
        startedAt: 1000,
    }
    test('idle reads as settled', () => {
        expect(morphProgress(MORPH_IDLE, 5)).toBe(1)
    })
    test('runs linearly over MORPH_MS and clamps', () => {
        expect(morphProgress(running, 1000)).toBe(0)
        expect(morphProgress(running, 1000 + MORPH_MS / 2)).toBeCloseTo(0.5)
        expect(morphProgress(running, 1000 + MORPH_MS * 3)).toBe(1)
        expect(morphProgress(running, 900)).toBe(0)
    })
})

describe('frameToGrid', () => {
    test('keeps only non-blank cells, row-major, with the colour name', () => {
        const f = createFrame(4, 2)
        f.chars[1] = 'a'.charCodeAt(0)
        f.color[1] = 3
        f.alpha[1] = 255
        f.chars[4 + 2] = 'b'.charCodeAt(0)
        f.color[4 + 2] = 0
        f.alpha[4 + 2] = 200
        f.chars[3] = 'z'.charCodeAt(0)
        f.alpha[3] = 0
        expect(frameToGrid(f)).toEqual({
            cols: 4,
            rows: 2,
            cells: [
                { col: 1, row: 0, ch: 'a', color: 'accent' },
                { col: 2, row: 1, ch: 'b', color: 'fg' },
            ],
        })
    })
})
