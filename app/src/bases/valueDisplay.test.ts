import { describe, expect, test } from 'bun:test'
import { formatDateValue, isEmptyValue, looksLikeDatetime } from './valueDisplay'

describe('isEmptyValue', () => {
    test('null, undefined, blank and empty list are empty', () => {
        for (const v of [null, undefined, '', '   ', []])
            expect(isEmptyValue(v)).toBe(true)
    })
    test('false, 0 and a filled list are values', () => {
        for (const v of [false, 0, 'a', ['a'], { a: 1 }])
            expect(isEmptyValue(v)).toBe(false)
    })
})

describe('formatDateValue', () => {
    test('a datetime reads with a space, never the stored T', () => {
        expect(formatDateValue('2026-09-14T14:00', true)).toBe('2026-09-14 14:00')
    })
    test('a date-only kind drops the time', () => {
        expect(formatDateValue('2026-09-14T14:00', false)).toBe('2026-09-14')
        expect(formatDateValue('2026-09-14', true)).toBe('2026-09-14')
    })
    test('no date is the empty string', () => {
        expect(formatDateValue(null, true)).toBe('')
        expect(formatDateValue('soon')).toBe('')
    })
})

describe('looksLikeDatetime', () => {
    test('matches only the stored T form', () => {
        expect(looksLikeDatetime('2026-09-14T14:00')).toBe(true)
        expect(looksLikeDatetime('2026-09-14')).toBe(false)
        expect(looksLikeDatetime(5)).toBe(false)
    })
    test('rejects anything that would lose data when shown as date + time', () => {
        // trailing text, an offset and seconds are all dropped by formatDateValue
        expect(looksLikeDatetime('2026-09-14T14:00 standup')).toBe(false)
        expect(looksLikeDatetime('2026-09-14T14:00+02:00')).toBe(false)
        expect(looksLikeDatetime('2026-09-14T14:00Z')).toBe(false)
        expect(looksLikeDatetime('2026-09-14T14:00:30')).toBe(false)
    })
})
