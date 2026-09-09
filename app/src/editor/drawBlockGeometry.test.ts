import { describe, expect, test } from 'bun:test'
import { inkBounds, standaloneHeight } from './drawBlockGeometry'
import type { Stroke } from '../../../core/src/drawing/model'

// pts strides by 3: (x, y, pressure) per point — see the comment at the top of
// drawBlockGeometry.ts. Two points here: (10, 20) and (110, 220).
const box: Stroke[] = [
    { t: 'pen', c: 'fg', w: 5, pts: [10, 20, 180, 110, 220, 180] },
]

describe('drawBlockGeometry', () => {
    test('inkBounds is null for no strokes', () => {
        expect(inkBounds([])).toBeNull()
    })

    test('inkBounds spans every point', () => {
        expect(inkBounds(box)).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 220 })
    })

    test('inkBounds spans across multiple strokes', () => {
        const strokes: Stroke[] = [
            { t: 'pen', c: 'fg', w: 5, pts: [0, 0, 1] },
            { t: 'pen', c: 'fg', w: 5, pts: [-50, 300, 1] },
        ]
        expect(inkBounds(strokes)).toEqual({ minX: -50, minY: 0, maxX: 0, maxY: 300 })
    })

    test('standaloneHeight is zero for no strokes', () => {
        expect(standaloneHeight([], 8)).toBe(0)
    })

    test('standaloneHeight covers the ink plus padding on both sides', () => {
        expect(standaloneHeight(box, 8)).toBe(220 - 20 + 16)
    })

    test('standaloneHeight would be wrong if it ignored padding', () => {
        // Guards against an implementation that returns the raw span with no padding —
        // this would still equal 200, not 216, so a deleted `+ pad * 2` fails this.
        expect(standaloneHeight(box, 8)).not.toBe(220 - 20)
    })
})
