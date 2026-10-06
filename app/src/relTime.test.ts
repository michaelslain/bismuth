// app/src/relTime.test.ts
import { describe, expect, test } from 'bun:test'
import { relTimeChat, relTimeISO, relTimeMs } from './relTime'

describe('relTimeChat', () => {
    test('under 45s reads as just now', () => {
        expect(relTimeChat(Date.now() - 10_000)).toBe('just now')
        expect(relTimeChat(Date.now() - 44_000)).toBe('just now')
    })

    test('minutes', () => {
        expect(relTimeChat(Date.now() - 5 * 60_000)).toBe('5m ago')
        expect(relTimeChat(Date.now() - 59 * 60_000)).toBe('59m ago')
    })

    test('hours', () => {
        expect(relTimeChat(Date.now() - 60 * 60_000)).toBe('1h ago')
        expect(relTimeChat(Date.now() - 23 * 3_600_000)).toBe('23h ago')
    })

    test('days', () => {
        expect(relTimeChat(Date.now() - 24 * 3_600_000)).toBe('1d ago')
        expect(relTimeChat(Date.now() - 6 * 86_400_000)).toBe('6d ago')
    })

    test('a week or more falls back to a short date, not a day count', () => {
        const out = relTimeChat(Date.now() - 8 * 86_400_000)
        expect(out).not.toMatch(/ago$/)
        expect(out.length).toBeGreaterThan(0)
    })

    test('a future or non-finite timestamp never throws or goes negative', () => {
        expect(relTimeChat(Date.now() + 60_000)).toBe('just now')
        expect(relTimeChat(NaN)).toBe('just now')
    })
})

describe('relTimeMs', () => {
    test('floored, no seconds bucket', () => {
        expect(relTimeMs(Date.now() - 59_000)).toBe('just now')
        expect(relTimeMs(Date.now() - 119_000)).toBe('1m ago')
        expect(relTimeMs(Date.now() - 10 * 86_400_000)).toBe('10d ago')
    })

    test('measures against an explicit now', () => {
        expect(relTimeMs(1_000, 1_000 + 5 * 60_000)).toBe('5m ago')
    })
})

describe('relTimeISO', () => {
    test('seconds bucket, rounded', () => {
        const iso = (ms: number) => new Date(Date.now() - ms).toISOString()
        expect(relTimeISO(iso(30_000))).toBe('30s ago')
        expect(relTimeISO(iso(90_000))).toMatch(/^(1|2)m ago$/)
        expect(relTimeISO(iso(3 * 3_600_000))).toBe('3h ago')
    })

    test('empty and unparseable input', () => {
        expect(relTimeISO('')).toBe('never seen')
        expect(relTimeISO('nope')).toBe('nope')
    })
})
