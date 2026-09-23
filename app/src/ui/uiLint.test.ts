import { describe, it, expect } from 'bun:test'
import { extractText, isLowercaseLabel, labelCaseWarning } from './uiLint'

describe('extractText', () => {
    it('returns strings and numbers, joins arrays, drops non-text', () => {
        expect(extractText('Save')).toBe('Save')
        expect(extractText(42)).toBe('42')
        expect(extractText(['A', ' ', 'B'])).toBe('A B')
        expect(extractText(null)).toBe('')
        expect(extractText(['RESET', 1, null, ['X']])).toBe('RESET1X')
        // a JSX element / function contributes no statically-known text
        expect(extractText(() => 'hi')).toBe('')
    })
})

describe('isLowercaseLabel', () => {
    it('true when no uppercase A-Z letter present', () => {
        expect(isLowercaseLabel('save')).toBe(true)
        expect(isLowercaseLabel('+ add page')).toBe(true)
        expect(isLowercaseLabel('')).toBe(true)
    })
    it('false when any uppercase A-Z letter present', () => {
        expect(isLowercaseLabel('Save')).toBe(false)
        expect(isLowercaseLabel('SAVE')).toBe(false)
    })
})

describe('labelCaseWarning', () => {
    it('warns for non-lowercase labels with a corrected suggestion', () => {
        expect(labelCaseWarning('Reset view')).toContain('reset view')
    })
    it('passes lowercase / empty / non-text children silently', () => {
        expect(labelCaseWarning('reset view')).toBeNull()
        expect(labelCaseWarning('')).toBeNull()
        expect(labelCaseWarning(() => 'x')).toBeNull()
    })
})
