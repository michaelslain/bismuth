import { describe, expect, test } from 'bun:test'
import { parseDayValue } from './heatmapDayParse'

describe('parseDayValue', () => {
    test('a number parses, whitespace trimmed', () => {
        expect(parseDayValue('42')).toBe(42)
        expect(parseDayValue('  7.5 ')).toBe(7.5)
        expect(parseDayValue('-3')).toBe(-3)
    })
    test('empty or blank means clear', () => {
        expect(parseDayValue('')).toBeUndefined()
        expect(parseDayValue('   ')).toBeUndefined()
    })
    test('non-numeric text is null (no commit), never a clear and never NaN', () => {
        expect(parseDayValue('abc')).toBeNull()
        expect(parseDayValue('12abc')).toBeNull()
        expect(parseDayValue('Infinity')).toBeNull()
    })
    test('zero is a real value, not a clear', () => {
        expect(parseDayValue('0')).toBe(0)
    })
})
