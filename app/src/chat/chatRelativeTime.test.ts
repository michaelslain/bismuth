// app/src/chat/chatRelativeTime.test.ts
import { describe, expect, test } from 'bun:test'
import { relativeTime } from './chatRelativeTime'

describe('relativeTime', () => {
    test('under 45s reads as just now', () => {
        expect(relativeTime(Date.now() - 10_000)).toBe('just now')
        expect(relativeTime(Date.now() - 44_000)).toBe('just now')
    })

    test('minutes', () => {
        expect(relativeTime(Date.now() - 5 * 60_000)).toBe('5m ago')
        expect(relativeTime(Date.now() - 59 * 60_000)).toBe('59m ago')
    })

    test('hours', () => {
        expect(relativeTime(Date.now() - 60 * 60_000)).toBe('1h ago')
        expect(relativeTime(Date.now() - 23 * 3_600_000)).toBe('23h ago')
    })

    test('days', () => {
        expect(relativeTime(Date.now() - 24 * 3_600_000)).toBe('1d ago')
        expect(relativeTime(Date.now() - 6 * 86_400_000)).toBe('6d ago')
    })

    test('a week or more falls back to a short date, not a day count', () => {
        const out = relativeTime(Date.now() - 8 * 86_400_000)
        expect(out).not.toMatch(/ago$/)
        expect(out.length).toBeGreaterThan(0)
    })

    test('a future or non-finite timestamp never throws or goes negative', () => {
        expect(relativeTime(Date.now() + 60_000)).toBe('just now')
        expect(relativeTime(NaN)).toBe('just now')
    })
})
