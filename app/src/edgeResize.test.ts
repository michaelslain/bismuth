import { describe, expect, test } from 'bun:test'
import { dragWidth, widthBounds } from './edgeResize'

describe('edgeResize', () => {
    test('bounds come from the settings schema', () => {
        expect(widthBounds('sidebarWidth')).toEqual([200, 600])
        expect(widthBounds('tabRailWidth')).toEqual([160, 480])
    })
    test('a left panel grows with rightward travel', () => {
        expect(dragWidth('sidebarWidth', 266, 40, 1)).toBe(306)
        expect(dragWidth('sidebarWidth', 266, -40, 1)).toBe(226)
    })
    test('a right panel grows with leftward travel', () => {
        expect(dragWidth('tabRailWidth', 232, -40, -1)).toBe(272)
        expect(dragWidth('tabRailWidth', 232, 40, -1)).toBe(192)
    })
    test('clamps to the schema range and rounds to whole px', () => {
        expect(dragWidth('sidebarWidth', 266, -500, 1)).toBe(200)
        expect(dragWidth('sidebarWidth', 266, 5000, 1)).toBe(600)
        expect(dragWidth('tabRailWidth', 232, 1000, -1)).toBe(160)
        expect(dragWidth('tabRailWidth', 232, -0.6, -1)).toBe(233)
    })
})
