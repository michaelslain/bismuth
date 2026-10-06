// app/src/preview/imageZoomLayout.test.ts
import { describe, expect, test } from 'bun:test'
import { imageZoomLayout } from './imageZoomLayout'
import { imageScratchLayout } from './imageScratchLayout'

const body = { w: 800, h: 600 }
const G = 16

describe('imageZoomLayout', () => {
    test('zoom 1 is the centred fit, and the stage is the body', () => {
        const { rendered, marginW, stage } = imageZoomLayout(body, G, 2000, 1000, 0, 1)
        expect(rendered.w).toBeCloseTo(768)
        expect(rendered.h).toBeCloseTo(384)
        expect(rendered.left).toBeCloseTo(16)
        expect(rendered.top).toBeCloseTo(108)
        expect(marginW).toBe(0)
        expect(stage).toEqual(body)
    })

    test('zoom 1 never upscales a small image past its natural size', () => {
        const { rendered } = imageZoomLayout(body, G, 100, 50, 0, 1)
        expect(rendered.w).toBeCloseTo(100)
        expect(rendered.left).toBeCloseTo(350)
    })

    test('zoom 1 with a strip matches imageScratchLayout exactly', () => {
        const area = { left: G, top: G, w: 768, h: 568 }
        const want = imageScratchLayout(area, 2000, 1000, 0.5)
        const got = imageZoomLayout(body, G, 2000, 1000, 0.5, 1)
        expect(got.rendered.left).toBeCloseTo(want.rendered.left)
        expect(got.rendered.top).toBeCloseTo(want.rendered.top)
        expect(got.rendered.w).toBeCloseTo(want.rendered.w)
        expect(got.marginW).toBeCloseTo(want.marginW)
    })

    test('zoomed past the body: starts at the gutter and the stage grows to hold it', () => {
        const { rendered, stage } = imageZoomLayout(body, G, 2000, 1000, 0, 3)
        expect(rendered.w).toBeCloseTo(768 * 3)
        expect(rendered.left).toBe(G)
        expect(rendered.top).toBe(G)
        expect(stage.w).toBeCloseTo(G + 768 * 3 + G)
        expect(stage.h).toBeCloseTo(G + 384 * 3 + G)
    })

    test('the strip scales with the picture', () => {
        const one = imageZoomLayout(body, G, 2000, 1000, 0.5, 1)
        const two = imageZoomLayout(body, G, 2000, 1000, 0.5, 2)
        expect(two.marginW).toBeCloseTo(one.marginW * 2)
        expect(two.rendered.w).toBeCloseTo(one.rendered.w * 2)
    })
})
