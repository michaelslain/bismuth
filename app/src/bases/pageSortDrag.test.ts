import { describe, expect, test } from 'bun:test'
import { edgeScrollStep, ghostLabel, moveTarget, pastThreshold, slotForTile } from './pageSortDrag'

describe('pageSortDrag', () => {
    test('a press becomes a drag only past the threshold', () => {
        expect(pastThreshold(2, 2)).toBe(false)
        expect(pastThreshold(4, 0)).toBe(false)
        expect(pastThreshold(3, 3)).toBe(true)
    })

    test('the left half of a tile is the slot before it, the right half the slot after', () => {
        expect(slotForTile(100, 140, 120, 3)).toBe(3)
        expect(slotForTile(100, 140, 230, 3)).toBe(4)
    })

    test('dropping later in the list lands one back, since the lifted tile left a gap', () => {
        expect(moveTarget(0, 3)).toBe(2)
        expect(moveTarget(4, 1)).toBe(1)
        expect(moveTarget(2, 2)).toBe(2)
        expect(moveTarget(2, 3)).toBe(2)
        expect(moveTarget(0, 6)).toBe(5)
    })

    test('the grid scrolls near its edges, faster deeper in, and not in the middle', () => {
        expect(edgeScrollStep(0, 600, 300)).toBe(0)
        expect(edgeScrollStep(0, 600, 10)).toBeLessThan(0)
        expect(edgeScrollStep(0, 600, 590)).toBeGreaterThan(0)
        expect(edgeScrollStep(0, 600, 0)).toBeLessThan(edgeScrollStep(0, 600, 40))
    })

    test('a bare page number reads as page n in the ghost', () => {
        expect(ghostLabel('3')).toBe('page 3')
        expect(ghostLabel('lecture.pdf // 12 pages')).toBe('lecture.pdf // 12 pages')
    })
})
