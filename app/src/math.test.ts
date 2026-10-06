import { describe, expect, test } from 'bun:test'
import { clamp, clamp01 } from './math'

describe('clamp', () => {
    test('passes through values in range and limits both ends', () => {
        expect(clamp(5, 0, 10)).toBe(5)
        expect(clamp(-3, 0, 10)).toBe(0)
        expect(clamp(42, 0, 10)).toBe(10)
    })
    test('inverted bounds resolve to lo, like Math.max(lo, Math.min(hi, v))', () => {
        expect(clamp(5, 3, -1)).toBe(3)
    })
    test('NaN stays NaN', () => {
        expect(clamp(NaN, 0, 1)).toBeNaN()
    })
})

describe('clamp01', () => {
    test('limits to 0..1', () => {
        expect(clamp01(-0.5)).toBe(0)
        expect(clamp01(0.25)).toBe(0.25)
        expect(clamp01(7)).toBe(1)
    })
})
