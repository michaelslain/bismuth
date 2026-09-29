import { describe, expect, test } from 'bun:test'
import { sparklineWindowCaption } from './sparklineWindow'

describe('sparklineWindowCaption', () => {
    test('names the window and its first and last bin', () => {
        expect(sparklineWindowCaption('week', ['Jul 6', 'Jul 13', 'Sep 21'])).toBe(
            'last 3 weeks // Jul 6 – Sep 21',
        )
    })
    test('two bins still show both endpoints', () => {
        expect(sparklineWindowCaption('day', ['Sep 10', 'Sep 11'])).toBe(
            'last 2 days // Sep 10 – Sep 11',
        )
    })
    test('a single bucket has no range, and the bin word is singular', () => {
        expect(sparklineWindowCaption('week', ['Jul 6'])).toBe('last 1 week')
    })
    test('no buckets at all', () => {
        expect(sparklineWindowCaption('month', [])).toBe('last 0 months')
    })
})
