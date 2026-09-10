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

    // The box runs from the WIDGET TOP — y=0 in the stored frame, the block boundary the ink is
    // anchored to — down to one pad past the ink. NOT from the ink's own top: the space above the
    // ink is the gap the user left between that boundary and their pen, and reserving less than
    // it would paint the drawing higher than it was drawn.
    test('standaloneHeight runs from the widget top to a pad past the ink', () => {
        expect(standaloneHeight(box, 8)).toBe(220 + 8)
    })

    test('standaloneHeight would be wrong if it ignored padding', () => {
        // Guards against an implementation that stops at the ink's lowest point — that would
        // equal 220, not 228, so a deleted `+ pad` fails this.
        expect(standaloneHeight(box, 8)).not.toBe(220)
    })

    // The two cases the rule has to get right, side by side. They are the same ink, moved: the
    // span is 200 in both, and the reserved height differs by exactly the one pad that used to
    // be reserved above ink already flush with its own widget.
    test('ink anchored flush to the boundary reserves no dead strip above itself', () => {
        // minY 0 is what a drawing anchored to the block boundary above it stores — the case
        // `span + 2*pad` reserved a top pad for and then left empty.
        const flush: Stroke[] = [
            { t: 'pen', c: 'fg', w: 5, pts: [10, 0, 180, 110, 200, 180] },
        ]
        expect(standaloneHeight(flush, 8)).toBe(200 + 8)
    })

    test('a NORMALIZED drawing reserves exactly what it always did', () => {
        // minY === pad is the shape planCommit still normalizes to when there is no boundary
        // above to anchor against, and its height must not change: span + pad above + pad below.
        const normalized: Stroke[] = [
            { t: 'pen', c: 'fg', w: 5, pts: [10, 8, 180, 110, 208, 180] },
        ]
        expect(standaloneHeight(normalized, 8)).toBe(200 + 8 * 2)
    })
})
