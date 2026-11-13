import { describe, expect, test } from 'bun:test'
import { nextCheckboxValue } from './checkboxCycle'

describe('nextCheckboxValue', () => {
    test('absent becomes checked', () => {
        expect(nextCheckboxValue(null)).toBe(true)
        expect(nextCheckboxValue(undefined)).toBe(true)
    })
    test('checked becomes unchecked', () => {
        expect(nextCheckboxValue(true)).toBe(false)
    })
    test('unchecked clears to unanswered', () => {
        expect(nextCheckboxValue(false)).toBe(null)
    })
    test('a non-boolean value is checked', () => {
        expect(nextCheckboxValue('yes')).toBe(true)
        expect(nextCheckboxValue(3)).toBe(true)
        expect(nextCheckboxValue('')).toBe(true)
    })
    test('three clicks return to unanswered', () => {
        let v: unknown = null
        for (let i = 0; i < 3; i++) v = nextCheckboxValue(v)
        expect(v).toBe(null)
    })
    test('an untyped column toggles and never clears', () => {
        expect(nextCheckboxValue(false, false)).toBe(true)
        expect(nextCheckboxValue(true, false)).toBe(false)
        expect(nextCheckboxValue(null, false)).toBe(true)
    })
})
