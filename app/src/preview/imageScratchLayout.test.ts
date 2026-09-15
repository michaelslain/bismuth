import { describe, expect, test } from 'bun:test'
import { imageScratchLayout } from './imageScratchLayout'
import { containRect } from '../../../core/src/drawing/pageInk'

const AREA = { left: 10, top: 20, w: 900, h: 500 }

describe('imageScratchLayout', () => {
    test('ratio 0 matches containRect exactly', () => {
        const got = imageScratchLayout(AREA, 400, 300, 0)
        expect(got).toEqual({
            rendered: containRect(AREA, 400, 300),
            marginW: 0,
        })
    })

    test('a negative ratio also falls back to containRect (never a negative strip)', () => {
        const got = imageScratchLayout(AREA, 400, 300, -0.4)
        expect(got).toEqual({
            rendered: containRect(AREA, 400, 300),
            marginW: 0,
        })
    })

    test('width-constrained image + strip: aspect preserved, strip is ratio * imageW', () => {
        // natural aspect 2:1, area aspect 1.8:1 -> width-constrained once the strip is folded in.
        const got = imageScratchLayout(AREA, 400, 200, 0.4)
        expect(got.rendered.w / got.rendered.h).toBeCloseTo(400 / 200, 6)
        expect(got.marginW).toBeCloseTo(got.rendered.w * 0.4, 6)
        // The unit (image + strip) fits exactly inside area.w.
        expect(got.rendered.w + got.marginW).toBeLessThanOrEqual(AREA.w + 1e-6)
    })

    test('height-constrained image: a tall natural image still gets a strip sized off its own width', () => {
        const got = imageScratchLayout(AREA, 200, 800, 0.4)
        expect(got.rendered.h).toBeCloseTo(AREA.h, 6)
        expect(got.marginW).toBeCloseTo(got.rendered.w * 0.4, 6)
    })

    test('centred as one unit: (image + strip) is horizontally centred in area, image alone is not', () => {
        const got = imageScratchLayout(AREA, 400, 200, 0.4)
        const totalW = got.rendered.w + got.marginW
        const leftGap = got.rendered.left - AREA.left
        const rightGap = AREA.left + AREA.w - (got.rendered.left + totalW)
        expect(leftGap).toBeCloseTo(rightGap, 6)
        // Vertically centred too.
        const topGap = got.rendered.top - AREA.top
        const bottomGap = AREA.top + AREA.h - (got.rendered.top + got.rendered.h)
        expect(topGap).toBeCloseTo(bottomGap, 6)
    })

    test('neither image nor strip is clipped: the unit never exceeds area bounds', () => {
        for (const ratio of [0.1, 0.4, 1, 2]) {
            const got = imageScratchLayout(AREA, 700, 300, ratio)
            expect(got.rendered.left).toBeGreaterThanOrEqual(AREA.left - 1e-6)
            expect(got.rendered.top).toBeGreaterThanOrEqual(AREA.top - 1e-6)
            expect(got.rendered.left + got.rendered.w + got.marginW).toBeLessThanOrEqual(
                AREA.left + AREA.w + 1e-6,
            )
            expect(got.rendered.top + got.rendered.h).toBeLessThanOrEqual(
                AREA.top + AREA.h + 1e-6,
            )
        }
    })

    test('a larger ratio shrinks the image (same area, more of it goes to the strip)', () => {
        // Natural size well above AREA so neither ratio's scale hits the 1x cap — isolating the
        // ratio's own effect from the "never upscale" cap covered separately above.
        const small = imageScratchLayout(AREA, 1200, 600, 0.2)
        const big = imageScratchLayout(AREA, 1200, 600, 1.2)
        expect(big.rendered.w).toBeLessThan(small.rendered.w)
    })

    test('invalid natural size returns the area unchanged, no strip', () => {
        expect(imageScratchLayout(AREA, 0, 0, 0.4)).toEqual({
            rendered: AREA,
            marginW: 0,
        })
    })

    test('invalid area returns the area unchanged, no strip', () => {
        const zero = { left: 0, top: 0, w: 0, h: 0 }
        expect(imageScratchLayout(zero, 400, 200, 0.4)).toEqual({
            rendered: zero,
            marginW: 0,
        })
    })

    // Cap at 1 (final review, finding 3): the CSS `<img>` path (`max-width/max-height: 100%`)
    // never upscales past natural size, so SCRATCH must not either — a 200x150 image in a
    // 900x500 area must render at its own 200x150, never ~3x blown up to fill the area.
    test('a small natural size is never upscaled above 1x, even in a large area', () => {
        const got = imageScratchLayout(AREA, 200, 150, 0.4)
        expect(got.rendered.w).toBeCloseTo(200, 6)
        expect(got.rendered.h).toBeCloseTo(150, 6)
        expect(got.marginW).toBeCloseTo(200 * 0.4, 6)
    })

    test('a large natural size still shrinks to fit (the cap is a MAX of 1, not a floor)', () => {
        const got = imageScratchLayout(AREA, 4000, 2000, 0.4)
        expect(got.rendered.w).toBeLessThan(4000)
        expect(got.rendered.w / got.rendered.h).toBeCloseTo(4000 / 2000, 6)
    })
})
