// app/src/preview/zoomGesture.test.ts
import { describe, expect, test } from 'bun:test'
import { clampZoom, easeZoom, wheelZoomFactor } from './zoomGesture'

describe('wheelZoomFactor', () => {
    test('a small pinch delta zooms a little, proportionally', () => {
        expect(wheelZoomFactor(-2)).toBeCloseTo(Math.exp(0.02))
        expect(wheelZoomFactor(-4)).toBeCloseTo(wheelZoomFactor(-2) ** 2)
    })

    test('negative deltaY zooms in, positive zooms out, and they invert each other', () => {
        expect(wheelZoomFactor(-5)).toBeGreaterThan(1)
        expect(wheelZoomFactor(5)).toBeLessThan(1)
        expect(wheelZoomFactor(-5) * wheelZoomFactor(5)).toBeCloseTo(1)
    })

    test('a mouse-wheel notch is clamped to one comfortable step', () => {
        expect(wheelZoomFactor(-100)).toBeCloseTo(wheelZoomFactor(-28))
        expect(wheelZoomFactor(-100)).toBeLessThan(1.4)
    })

    test('line and page delta modes normalize to px before clamping', () => {
        expect(wheelZoomFactor(-1, 1)).toBeCloseTo(wheelZoomFactor(-16))
        expect(wheelZoomFactor(-1, 2)).toBeCloseTo(wheelZoomFactor(-28))
    })
})

describe('easeZoom', () => {
    test('starts at from, ends at to', () => {
        expect(easeZoom(1, 4, 0)).toBeCloseTo(1)
        expect(easeZoom(1, 4, 1)).toBeCloseTo(4)
    })

    test('interpolates in log space with an ease-out', () => {
        // Half-way in time is past half-way in log space (ease-out), and log-symmetric.
        const mid = easeZoom(1, 4, 0.5)
        expect(mid).toBeGreaterThan(2)
        expect(easeZoom(4, 1, 0.5)).toBeCloseTo(4 / mid)
    })

    test('t outside 0..1 is clamped', () => {
        expect(easeZoom(1, 2, -1)).toBeCloseTo(1)
        expect(easeZoom(1, 2, 3)).toBeCloseTo(2)
    })
})

describe('clampZoom', () => {
    test('clamps into range', () => {
        expect(clampZoom(0.1, 0.25, 4)).toBe(0.25)
        expect(clampZoom(9, 0.25, 4)).toBe(4)
        expect(clampZoom(2, 0.25, 4)).toBe(2)
    })
})
