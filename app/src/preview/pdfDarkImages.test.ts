import { describe, expect, test } from 'bun:test'
import { imageQuads, imageRegions, insetQuad, isPhoto, meanLuminance, quadBox } from './pdfDarkImages'

/** RGBA pixels, all one colour. */
const fill = (n: number, r: number, g: number, b: number) => {
    const d = new Uint8ClampedArray(n * 4)
    for (let i = 0; i < n; i++) d.set([r, g, b, 255], i * 4)
    return d
}

describe('pdfDarkImages', () => {
    test('imageQuads turns canvas fractions into pixel corners', () => {
        const q = imageQuads([0.1, 0.2, 0.1, 0.6, 0.5, 0.2], 1000, 500)
        expect(q).toEqual([{ a: { x: 100, y: 100 }, b: { x: 100, y: 300 }, c: { x: 500, y: 100 } }])
        expect(imageQuads(null, 10, 10)).toEqual([])
    })

    test('quadBox covers a rotated image and clamps to the canvas', () => {
        const [q] = imageQuads([0.5, 0, 0, 0.5, 1, 0.5], 100, 100) // a diamond
        expect(quadBox(q, 100, 100)).toEqual({ x: 0, y: 0, w: 100, h: 100 })
        const [off] = imageQuads([-0.5, -0.5, -0.5, -0.1, -0.1, -0.5], 100, 100)
        expect(quadBox(off, 100, 100)).toBeNull()
    })

    test('touching image tiles merge into one region; apart ones stay apart', () => {
        const tiles = imageQuads(
            [0, 0, 0, 0.1, 0.1, 0, 0.1, 0, 0.1, 0.1, 0.2, 0, 0.6, 0.6, 0.6, 0.7, 0.7, 0.6],
            100,
            100,
        )
        const regions = imageRegions(tiles, 100, 100)
        expect(regions.length).toBe(2)
        expect(regions[0].box).toEqual({ x: 0, y: 0, w: 20, h: 10 })
        expect(regions[0].quads.length).toBe(2)
    })

    test('a region whose pixels average dark is a photo; paper is not', () => {
        expect(meanLuminance(fill(4, 255, 255, 255))).toBeCloseTo(1)
        expect(isPhoto(fill(100, 40, 70, 120))).toBe(true) // a dusk sky
        expect(isPhoto(fill(100, 250, 250, 245))).toBe(false) // a scan's paper
        // a chart on white: mostly white, a few dark marks
        const chart = fill(100, 255, 255, 255)
        for (let i = 0; i < 10; i++) chart.set([0, 0, 0, 255], i * 4)
        expect(isPhoto(chart)).toBe(false)
    })

    test('insetQuad pulls every side in, and drops a quad too thin to keep', () => {
        const [q] = imageQuads([0, 0, 0, 0.5, 1, 0], 100, 100)
        expect(insetQuad(q, 1)).toEqual({ a: { x: 1, y: 1 }, b: { x: 1, y: 49 }, c: { x: 99, y: 1 } })
        const [thin] = imageQuads([0, 0, 0, 0.01, 1, 0], 100, 100)
        expect(insetQuad(thin, 1)).toBeNull()
    })
})
