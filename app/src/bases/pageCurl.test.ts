import { describe, expect, test } from 'bun:test'
import { axisDistance, backClipX, cubicBezier, curlAt, curlFromPointer, deform, settle, turnEase } from './pageCurl'

const page = { w: 400, h: 600 }

describe('curlFromPointer', () => {
    test('forward: outer edge ~0, spine ~0.5, past the spine ~1', () => {
        const at = (x: number) => curlFromPointer({ pointer: { x, y: 300 }, page, direction: 'forward' }).progress
        expect(at(400)).toBeCloseTo(0, 5)
        expect(at(0)).toBeCloseTo(0.5, 5)
        expect(at(-400)).toBeCloseTo(1, 5)
        expect(at(-900)).toBe(1)
    })
    test('back mirrors forward', () => {
        const at = (x: number) => curlFromPointer({ pointer: { x, y: 300 }, page, direction: 'back' }).progress
        expect(at(0)).toBeCloseTo(0, 5)
        expect(at(400)).toBeCloseTo(0.5, 5)
        expect(at(800)).toBeCloseTo(1, 5)
    })
    test('a pointer below centre tilts the axis one way, above the other', () => {
        const a = (y: number) => curlFromPointer({ pointer: { x: 100, y }, page, direction: 'forward' }).angle
        expect(a(600)).toBeGreaterThan(0)
        expect(a(0)).toBeLessThan(0)
        expect(a(300)).toBeCloseTo(0, 8)
    })
})

describe('deform', () => {
    const s = curlAt(0.4, page, 'forward')
    test('a point behind the axis is unmoved and flat', () => {
        const p = deform(10, 300, s, page)
        expect(p).toEqual({ x: 10, y: 300, z: 0, back: false })
    })
    test('a point just past the axis lifts', () => {
        const x = s.axisX + s.radius * 0.5
        const p = deform(x, 300, s, page)
        expect(p.z).toBeGreaterThan(0)
        expect(p.back).toBe(false)
    })
    test('a point folded all the way over lands behind the axis, face down', () => {
        const p = deform(page.w, 300, s, page)
        expect(p.back).toBe(true)
        expect(p.z).toBeCloseTo(2 * s.radius, 6)
        expect(axisDistance(p.x, p.y, s, page)).toBeLessThan(0)
        const d = axisDistance(page.w, 300, s, page)
        expect(axisDistance(p.x, p.y, s, page)).toBeCloseTo(-(d - Math.PI * s.radius), 6)
    })
    test('the free edge lands where the progress says', () => {
        const flat = curlFromPointer({ pointer: { x: -200, y: 300 }, page, direction: 'forward' })
        const p = deform(page.w, 300, flat, page)
        expect(p.x).toBeCloseTo(-200, 0)
    })
})

describe('settle', () => {
    test('falls back below 0.5, commits at 0.5', () => {
        expect(settle(0.49)).toEqual({ commit: false, target: 0 })
        expect(settle(0.5)).toEqual({ commit: true, target: 1 })
    })
})

describe('curlAt', () => {
    test('axis only moves towards the spine as progress grows', () => {
        let last = Infinity
        for (let i = 0; i <= 100; i++) {
            const s = curlAt(i / 100, page, 'forward')
            expect(s.progress).toBeCloseTo(i / 100, 8)
            expect(s.axisX).toBeLessThanOrEqual(last)
            last = s.axisX
        }
    })
})

describe('turnEase', () => {
    test('runs from 0 to 1 and never goes backwards', () => {
        expect(turnEase(0)).toBe(0)
        expect(turnEase(1)).toBe(1)
        let prev = 0
        for (let t = 0.02; t <= 1; t += 0.02) {
            const v = turnEase(t)
            expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
            prev = v
        }
    })

    test('lifts softly, glides, and settles gently', () => {
        // a soft lift: the first moments move less than a straight line would
        expect(turnEase(0.05)).toBeLessThan(0.05)
        // most of the travel is done by halfway
        expect(turnEase(0.5)).toBeGreaterThan(0.75)
        // a long landing: the last fifth moves only a little
        expect(1 - turnEase(0.8)).toBeLessThan(0.04)
    })

    test('cubicBezier with the straight-line points is the identity', () => {
        const linear = cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3)
        for (const t of [0.1, 0.37, 0.5, 0.9]) expect(linear(t)).toBeCloseTo(t, 5)
    })
})

describe('backClipX', () => {
    test('a scan keeps its whole underside', () => {
        expect(backClipX(false, 'spread', 'forward', 400)).toBe(Infinity)
        expect(backClipX(false, 'single', 'back', 400)).toBe(Infinity)
    })
    test('a lone text page has no underside at all', () => {
        expect(backClipX(true, 'single', 'forward', 400)).toBe(-1)
        expect(backClipX(true, 'single', 'back', 400)).toBe(-1)
    })
    test('an open book keeps the underside off the text page on a forward turn only', () => {
        expect(backClipX(true, 'spread', 'forward', 400)).toBe(400)
        expect(backClipX(true, 'spread', 'back', 400)).toBe(Infinity)
    })
})
