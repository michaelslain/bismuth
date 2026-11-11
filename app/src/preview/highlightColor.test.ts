import { describe, expect, test } from 'bun:test'
import { initialHighlightColor, highlightTint } from './highlightColor'

describe('initialHighlightColor', () => {
    test('a stored palette colour is kept', () => {
        expect(initialHighlightColor('#74C0FC')).toBe('#74C0FC')
    })
    test('nothing stored, or a colour no longer in the palette, starts on yellow', () => {
        expect(initialHighlightColor(null)).toBe('hl')
        expect(initialHighlightColor('#123456')).toBe('hl')
    })
})

describe('highlightTint', () => {
    test('mixes the colour hex toward the foreground', () => {
        expect(highlightTint('#8CE99A')).toBe('color-mix(in srgb, #8CE99A 75%, var(--fg))')
    })
})
