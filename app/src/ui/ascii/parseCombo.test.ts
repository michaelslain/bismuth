import { describe, it, expect } from 'bun:test'
import { isGlyph, parseCombo, spaceBetween } from './parseCombo'

/** A chord typed the way Kbd renders it. */
const typed = (keys: string[]) =>
    keys.map((k, i) => (i > 0 && spaceBetween(keys[i - 1], k) ? ` ${k}` : k)).join('')

describe('parseCombo', () => {
    it('splits a chord into its keys', () => {
        expect(parseCombo('Mod+Shift+D', true)).toEqual([['⌘', 'shift', 'D']])
        expect(parseCombo('Mod+Shift+D', false)).toEqual([
            ['ctrl', 'shift', 'D'],
        ])
    })

    it('splits a comma-separated sequence into separate groups', () => {
        expect(parseCombo('Mod+`, Mod+J', true)).toEqual([
            ['⌘', '`'],
            ['⌘', 'J'],
        ])
    })

    it('trims whitespace around commas and pluses', () => {
        expect(parseCombo(' Mod + K , Mod + O ', true)).toEqual([
            ['⌘', 'K'],
            ['⌘', 'O'],
        ])
    })

    it('maps Mod to ⌘ on mac and ctrl elsewhere', () => {
        expect(parseCombo('Mod+K', true)).toEqual([['⌘', 'K']])
        expect(parseCombo('Mod+K', false)).toEqual([['ctrl', 'K']])
    })

    it('maps Cmd/Meta to ⌘ regardless of platform', () => {
        expect(parseCombo('Cmd+K', false)).toEqual([['⌘', 'K']])
        expect(parseCombo('Meta+K', false)).toEqual([['⌘', 'K']])
    })

    it('maps Alt/Option per platform; shift is always a word (not a sanctioned glyph)', () => {
        expect(parseCombo('Alt+Shift+X', true)).toEqual([['⌥', 'shift', 'X']])
        expect(parseCombo('Alt+Shift+X', false)).toEqual([
            ['alt', 'shift', 'X'],
        ])
        expect(parseCombo('Option+X', false)).toEqual([['⌥', 'X']])
    })

    it('maps arrow, escape, and enter cap names', () => {
        expect(parseCombo('Up', true)).toEqual([['↑']])
        expect(parseCombo('Down', true)).toEqual([['↓']])
        expect(parseCombo('Left', true)).toEqual([['<']])
        expect(parseCombo('Right', true)).toEqual([['>']])
        expect(parseCombo('Escape', true)).toEqual([['esc']])
        expect(parseCombo('Esc', true)).toEqual([['esc']])
        expect(parseCombo('Enter', true)).toEqual([['↵']])
        expect(parseCombo('Return', true)).toEqual([['↵']])
        expect(parseCombo('Backspace', true)).toEqual([['bksp']])
        expect(parseCombo('Delete', true)).toEqual([['del']])
        expect(parseCombo('Tab', true)).toEqual([['tab']])
        expect(parseCombo('Space', true)).toEqual([['space']])
    })

    it('passes single characters through literally and lowercases unmapped named keys', () => {
        expect(parseCombo('Mod+`', true)).toEqual([['⌘', '`']])
        expect(parseCombo('Q', true)).toEqual([['Q']])
        expect(parseCombo('PageDown', true)).toEqual([['pagedown']])
    })

    it('returns an empty array for empty/undefined/null input', () => {
        expect(parseCombo('')).toEqual([])
        expect(parseCombo(undefined)).toEqual([])
        expect(parseCombo(null)).toEqual([])
    })

    it('types a chord as one run: glyphs glue, words take a space each side', () => {
        expect(typed(['⌘', 'K'])).toBe('⌘K')
        expect(typed(['⌘', '⌥', 'K'])).toBe('⌘⌥K')
        expect(typed(['⌘', '`'])).toBe('⌘`')
        expect(typed(['⌘', 'shift', '3'])).toBe('⌘ shift 3')
        expect(typed(['ctrl', 'shift', 'D'])).toBe('ctrl shift D')
        expect(typed(['esc'])).toBe('esc')
        expect(typed([])).toBe('')
    })

    it('knows the sanctioned glyphs and nothing else', () => {
        for (const g of ['⌘', '⌥', '↵', '↑', '↓']) expect(isGlyph(g)).toBe(true)
        for (const k of ['K', 'shift', 'esc', '<', '`']) expect(isGlyph(k)).toBe(false)
    })
})
