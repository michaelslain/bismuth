import { expect, test } from 'bun:test'
import { fitImage } from '../../../core/src/drawing/pageInk'
import { regionInImage } from './bookRegion'

test('a rect on a letterboxed image is measured against the image, not the page', () => {
    const image = fitImage(400, 400) // square image centred in the 816x1056 page
    const r = regionInImage({ x: image.x + image.w / 4, y: image.y + image.h / 2, w: image.w / 2, h: image.h / 4 }, image)
    expect(r.x).toBeCloseTo(0.25)
    expect(r.y).toBeCloseTo(0.5)
    expect(r.w).toBeCloseTo(0.5)
    expect(r.h).toBeCloseTo(0.25)
})

test('a rect spilling past the image is clamped to 0..1', () => {
    const image = fitImage(400, 400)
    const r = regionInImage({ x: image.x - 50, y: image.y + image.h - 10, w: 100, h: 100 }, image)
    expect(r.x).toBe(0)
    expect(r.x + r.w).toBeLessThanOrEqual(1)
    expect(r.y + r.h).toBe(1)
})
