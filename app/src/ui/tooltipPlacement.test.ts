import { describe, expect, test } from 'bun:test'
import { placeTooltip } from './tooltipPlacement'
import { EDGE_GAP } from './popover/placeAnchored'

const viewport = { w: 800, h: 600 }
const size = { w: 80, h: 22 }
const gap = 4

describe('placeTooltip', () => {
    test('sits gap below the anchor, centred on it', () => {
        const anchor = { top: 100, bottom: 124, left: 300, width: 24 }
        const p = placeTooltip({ anchor, size, viewport, gap })
        expect(p.side).toBe('below')
        expect(p.top).toBe(128)
        expect(p.left).toBe(300 + 12 - 40)
    })

    test('flips above when it does not fit below', () => {
        const anchor = { top: 570, bottom: 594, left: 300, width: 24 }
        const p = placeTooltip({ anchor, size, viewport, gap })
        expect(p.side).toBe('above')
        expect(p.top).toBe(570 - 22 - gap)
    })

    test('clamps inside the right edge', () => {
        const anchor = { top: 100, bottom: 124, left: 780, width: 24 }
        const p = placeTooltip({ anchor, size, viewport, gap })
        expect(p.left).toBe(800 - 80 - EDGE_GAP)
    })

    test('clamps inside the left edge', () => {
        const anchor = { top: 100, bottom: 124, left: 0, width: 24 }
        const p = placeTooltip({ anchor, size, viewport, gap })
        expect(p.left).toBe(EDGE_GAP)
    })

    test('a bubble wider than the viewport pins to the left gap', () => {
        const p = placeTooltip({
            anchor: { top: 100, bottom: 124, left: 10, width: 24 },
            size: { w: 900, h: 22 },
            viewport,
            gap,
        })
        expect(p.left).toBe(EDGE_GAP)
    })

    test('unmeasured size places at the natural position below', () => {
        const p = placeTooltip({
            anchor: { top: 100, bottom: 124, left: 300, width: 24 },
            size: { w: 0, h: 0 },
            viewport,
            gap,
        })
        expect(p.side).toBe('below')
        expect(p.top).toBe(128)
    })
})
