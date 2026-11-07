import { describe, expect, test } from 'bun:test'
import { EDGE_GAP, placeBelowOrAbove, placeRightOrLeft } from './placeAnchored'

describe('placeBelowOrAbove', () => {
    test('fits below returns y unchanged', () => {
        expect(placeBelowOrAbove({ y: 10, h: 50, viewportH: 200 })).toBe(10)
    })

    test('does not fit below, fits above with flipFrom returns flipFrom - h - gap', () => {
        expect(
            placeBelowOrAbove({ y: 180, h: 50, viewportH: 200, flipFrom: 170, gap: 4 }),
        ).toBe(116)
    })

    test('does not fit below, no flipFrom returns y - h', () => {
        expect(placeBelowOrAbove({ y: 180, h: 50, viewportH: 200 })).toBe(130)
    })

    test('fits neither, clamped to viewportH - h - EDGE_GAP, never less than EDGE_GAP', () => {
        expect(placeBelowOrAbove({ y: 50, h: 45, viewportH: 100 })).toBe(49)
    })

    test('taller than the viewport returns EDGE_GAP', () => {
        expect(placeBelowOrAbove({ y: 50, h: 150, viewportH: 100 })).toBe(EDGE_GAP)
    })

    test('h === 0 returns y (unmeasured first frame)', () => {
        expect(placeBelowOrAbove({ y: 42, h: 0, viewportH: 100 })).toBe(42)
    })
})

describe('placeRightOrLeft', () => {
    test('fits right returns x unchanged', () => {
        expect(placeRightOrLeft({ x: 10, w: 50, viewportW: 200 })).toBe(10)
    })

    test('does not fit right flips its right edge onto the cursor', () => {
        expect(placeRightOrLeft({ x: 180, w: 50, viewportW: 200 })).toBe(130)
    })

    test('flipFrom puts the right edge on that edge instead of on x', () => {
        expect(placeRightOrLeft({ x: 178, w: 50, viewportW: 200, flipFrom: 100 })).toBe(50)
    })

    test('fits neither side, clamped to viewportW - w - EDGE_GAP', () => {
        expect(placeRightOrLeft({ x: 30, w: 80, viewportW: 100 })).toBe(14)
    })

    test('wider than the viewport returns EDGE_GAP', () => {
        expect(placeRightOrLeft({ x: 30, w: 150, viewportW: 100 })).toBe(EDGE_GAP)
    })

    test('w === 0 returns x (unmeasured first frame)', () => {
        expect(placeRightOrLeft({ x: 42, w: 0, viewportW: 100 })).toBe(42)
    })

    test('cursor outside the viewport (window shrunk under the menu) clamps inside it', () => {
        expect(placeRightOrLeft({ x: 1376, w: 170, viewportW: 1050 })).toBe(1050 - 170 - EDGE_GAP)
    })
})

describe('placeBelowOrAbove with an anchor outside the viewport', () => {
    test('cursor below the bottom edge (window shrunk under the menu) clamps inside it', () => {
        expect(placeBelowOrAbove({ y: 800, h: 100, viewportH: 600 })).toBe(600 - 100 - EDGE_GAP)
    })
})
