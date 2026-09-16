import { describe, expect, test } from 'bun:test'
import { EDGE_GAP, placeBelowOrAbove } from './placeAnchored'

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
