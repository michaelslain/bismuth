import { describe, expect, test } from 'bun:test'
import { computeAnchorRect } from './anchorPosition'

const VIEWPORT = { width: 400, height: 300 }

describe('computeAnchorRect', () => {
    test('placement below, fits: top under the anchor, left at anchor left', () => {
        const anchor = { top: 50, bottom: 70, left: 20, width: 100 } as DOMRect
        const result = computeAnchorRect(anchor, { width: 100, height: 40 }, VIEWPORT, 'below')
        expect(result).toEqual({ top: 74, left: 20, placement: 'below' })
    })

    test('flip-above: below has no room, above does', () => {
        // anchor near the bottom of a 300px-tall viewport — 260 + 4 + 60 > 300
        const anchor = { top: 240, bottom: 260, left: 20, width: 100 } as DOMRect
        const result = computeAnchorRect(anchor, { width: 100, height: 60 }, VIEWPORT, 'below')
        expect(result.placement).toBe('above')
        // top - gap - height = 240 - 4 - 60
        expect(result.top).toBe(176)
    })

    test('clamp-to-viewport: panel taller than the viewport clamps top to 0', () => {
        const anchor = { top: 10, bottom: 30, left: 20, width: 100 } as DOMRect
        const result = computeAnchorRect(anchor, { width: 100, height: 500 }, VIEWPORT, 'below')
        expect(result.top).toBe(0)
    })

    test('clamp horizontally: anchor near the right edge pulls the panel back inside', () => {
        const anchor = { top: 10, bottom: 30, left: 350, width: 100 } as DOMRect
        const result = computeAnchorRect(anchor, { width: 150, height: 40 }, VIEWPORT, 'below')
        expect(result.left).toBe(250)
    })

    test('placement above requested but no room above falls back to below', () => {
        const anchor = { top: 10, bottom: 30, left: 20, width: 100 } as DOMRect
        const result = computeAnchorRect(anchor, { width: 100, height: 40 }, VIEWPORT, 'above')
        expect(result.placement).toBe('below')
        expect(result.top).toBe(34)
    })

    test('neither fits: stays at the requested placement, clamped', () => {
        const anchor = { top: 140, bottom: 160, left: 20, width: 100 } as DOMRect
        const result = computeAnchorRect(anchor, { width: 100, height: 280 }, VIEWPORT, 'below')
        expect(result.placement).toBe('below')
        expect(result.top).toBe(20) // viewport.height(300) - panel.height(280)
    })
})
