import { describe, expect, it } from 'bun:test'
import { clipBox, CLIP_BOX_SRC } from './clipBox'

// bases-gallery--map-pins-land parks the page here after scrollIntoView on the map tile; an
// unshifted clip photographed document y 0.. and returned a flat background frame.
const SCROLL_Y = 3408
const base = { minX: 40, minY: 200, maxX: 640, maxY: 520, vw: 1280, vh: 900, sx: 0, pad: 12, maxH: 1500 }

describe('clipBox (the story audit screenshot clip)', () => {
    it('at scrollY 0 the origin is the padded viewport rect, unchanged', () => {
        expect(clipBox({ ...base, sy: 0 })).toEqual({ x: 28, y: 188, width: 624, height: 344 })
    })
    it('at scrollY 3408 the origin shifts by the scroll offset: y = 3408 + max(0, minY - pad)', () => {
        const box = clipBox({ ...base, sy: SCROLL_Y })
        expect(box.y).toBe(SCROLL_Y + Math.max(0, 200 - 12))
        expect(box.y).toBe(3596)
    })
    it('shifts ONLY the origin: width and height are sizes and match the scroll-0 box', () => {
        const parked = clipBox({ ...base, sy: SCROLL_Y })
        const top = clipBox({ ...base, sy: 0 })
        expect(parked.x).toBe(top.x)
        expect(parked.width).toBe(top.width)
        expect(parked.height).toBe(top.height)
    })
    it('content flush to the viewport top clamps the padded offset to 0, so y is the bare scroll offset', () => {
        expect(clipBox({ ...base, minY: 5, sy: SCROLL_Y }).y).toBe(SCROLL_Y)
    })
    it('shifts x by scrollX the same way', () => {
        expect(clipBox({ ...base, sx: 300, sy: 0 }).x).toBe(300 + 28)
    })
    it('the no-content fallback box also rides the scroll offset', () => {
        const box = clipBox({ ...base, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, sy: SCROLL_Y })
        expect(box).toEqual({ x: 0, y: SCROLL_Y, width: 600, height: 400 })
    })
    it('caps height at maxH and floors both sizes at 32', () => {
        expect(clipBox({ ...base, maxY: 5000, sy: 0 }).height).toBe(1500)
        expect(clipBox({ ...base, maxX: 41, maxY: 201, sy: 0 })).toMatchObject({ width: 32, height: 32 })
    })
    it('the source the probe interpolates is the function under test (plain JS, no TS syntax)', () => {
        expect(CLIP_BOX_SRC.startsWith('function clipBox(')).toBe(true)
        expect(CLIP_BOX_SRC).not.toContain('${')
    })
})
