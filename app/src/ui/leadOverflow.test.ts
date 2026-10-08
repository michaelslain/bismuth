import { describe, expect, test } from 'bun:test'
import leadOverflow from './leadOverflow'

describe('leadOverflow', () => {
    test('a box whose content fits has nothing more to the right', () => {
        expect(leadOverflow({ scrollWidth: 113, clientWidth: 113, scrollLeft: 0 })).toBe(false)
    })
    test('sub-pixel rounding is not overflow', () => {
        expect(leadOverflow({ scrollWidth: 114, clientWidth: 113, scrollLeft: 0 })).toBe(false)
    })
    test('content past the right edge is overflow', () => {
        expect(leadOverflow({ scrollWidth: 176, clientWidth: 120, scrollLeft: 0 })).toBe(true)
    })
    test('scrolled to the end, nothing more is to the right', () => {
        expect(leadOverflow({ scrollWidth: 176, clientWidth: 120, scrollLeft: 56 })).toBe(false)
    })
})
