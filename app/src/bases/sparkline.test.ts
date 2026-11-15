import { describe, expect, test } from 'bun:test'
import { sparkline, sparklineCaption, hoverPeriodText, trimSpark } from './sparkline'

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

describe('sparklineCaption', () => {
    test('names the bin word in plural, with the bin count', () => {
        expect(sparklineCaption('week', 12)).toBe('last 12 weeks')
        expect(sparklineCaption('day', 12)).toBe('last 12 days')
        expect(sparklineCaption('month', 6)).toBe('last 6 months')
    })
})

describe('hoverPeriodText', () => {
    test('formats bin word + label + value', () => {
        expect(hoverPeriodText('week', 'Jun 8', 5)).toBe('week of Jun 8 // 5')
        expect(hoverPeriodText('day', 'Jun 8', 2.5)).toBe('day of Jun 8 // 2.5')
    })

    test('a null value renders as —', () => {
        expect(hoverPeriodText('week', 'Jun 8', null)).toBe('week of Jun 8 // —')
    })
})

describe('trimSpark', () => {
    const s = (values: (number | null)[]) => ({
        values,
        keys: values.map((_, i) => `k${i}`),
        labels: values.map((_, i) => `l${i}`),
    })
    test('drops the bins before the first one with rows', () => {
        expect(trimSpark(s([null, null, 3, null, 5]))).toEqual({
            values: [3, null, 5],
            keys: ['k2', 'k3', 'k4'],
            labels: ['l2', 'l3', 'l4'],
        })
    })
    test('nothing to draw when only the last bin has rows', () => {
        expect(trimSpark(s([null, null, null, 15.2]))).toBeUndefined()
    })
    test('nothing to draw with no rows at all', () => {
        expect(trimSpark(s([null, null]))).toBeUndefined()
    })
    test('a full series is kept whole', () => {
        expect(trimSpark(s([1, 2, 3]))?.values).toEqual([1, 2, 3])
    })
})
