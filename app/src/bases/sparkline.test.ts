import { describe, expect, test } from 'bun:test'
import { sparkline } from './sparkline'

describe('sparkline', () => {
    test('empty series renders nothing', () => {
        expect(sparkline([])).toBe('')
    })

    test('a null entry renders the lowest glyph', () => {
        expect(sparkline([null])).toBe('▁')
    })

    test('all-equal non-null values render the mid glyph', () => {
        expect(sparkline([3, 3, 3])).toBe('▄▄▄')
    })

    test('scales linearly from the series min to its max', () => {
        expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8])).toBe('▁▂▃▄▅▆▇█')
    })

    test('nulls stay at the lowest glyph even among scaled values', () => {
        expect(sparkline([1, null, 8])).toBe('▁▁█')
    })

    test('a single non-null value renders the mid glyph (no range to scale over)', () => {
        expect(sparkline([5])).toBe('▄')
    })

    test('negative values scale the same way as positive ones', () => {
        expect(sparkline([-10, 0, 10])).toBe('▁▅█')
    })
})
