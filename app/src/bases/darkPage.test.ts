import { describe, expect, test } from 'bun:test'
import { darkenPixels, darkHex, darkRgb, tintOf } from './darkPage'

describe('darkPage', () => {
    test('white paper turns black and black ink white', () => {
        expect(darkHex('#FFFFFF')).toBe('#000000')
        expect(darkHex('#000000')).toBe('#FFFFFF')
    })
    test('a colour keeps its hue: red stays reddish', () => {
        const [r, g, b] = darkRgb(220, 30, 30)
        expect(r).toBeGreaterThan(g)
        expect(r).toBeGreaterThan(b)
    })
    test('greys stay grey', () => {
        const [r, g, b] = darkRgb(140, 135, 127)
        expect(Math.abs(r - g)).toBeLessThan(20)
        expect(Math.abs(g - b)).toBeLessThan(20)
    })
    test('pixels transform in place and keep alpha', () => {
        const px = new Uint8ClampedArray([255, 255, 255, 128, 0, 0, 0, 255])
        darkenPixels(px)
        expect([...px]).toEqual([0, 0, 0, 128, 255, 255, 255, 255])
    })
    test('tintOf builds rgba, light or dark', () => {
        expect(tintOf('#FFFFFF', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
        expect(tintOf('#FFFFFF', 0.5, true)).toBe('rgba(0, 0, 0, 0.5)')
        expect(tintOf('red', 0.5)).toBe('red')
    })
})
