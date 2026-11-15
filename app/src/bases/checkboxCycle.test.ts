import { describe, expect, test } from 'bun:test'
import { nextCheckboxValue } from './checkboxCycle'

describe('nextCheckboxValue', () => {
    test('blank becomes checked', () => {
        expect(nextCheckboxValue(null)).toBe(true)
        expect(nextCheckboxValue(undefined)).toBe(true)
    })
    test('checked becomes unchecked', () => {
        expect(nextCheckboxValue(true)).toBe(false)
    })
    test('unchecked becomes checked', () => {
        expect(nextCheckboxValue(false)).toBe(true)
    })
    test('a non-boolean value is checked', () => {
        expect(nextCheckboxValue('yes')).toBe(true)
        expect(nextCheckboxValue(3)).toBe(true)
        expect(nextCheckboxValue('')).toBe(true)
    })
    test('two clicks from blank leave it unchecked, never blank again', () => {
        let v: unknown = null
        for (let i = 0; i < 2; i++) v = nextCheckboxValue(v)
        expect(v).toBe(false)
    })
})
