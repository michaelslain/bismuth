import { describe, expect, test } from 'bun:test'
import { hasHiddenChars } from '../../../core/src/statusBarTrust'
import { isApprovable, visibleCommand, visibleParts } from './visibleCommand'

describe('visibleCommand', () => {
    test('a plain command is unchanged', () => {
        expect(visibleCommand('git branch --show-current')).toBe(
            'git branch --show-current',
        )
    })
    test('newline, carriage return and tab get named glyphs', () => {
        expect(visibleCommand('a\nb\rc\td')).toBe('a⏎b␍c⇥d')
    })
    test('bidi overrides and isolates are made visible', () => {
        expect(visibleCommand('a‮b')).toBe('a⟨U+202E⟩b')
        expect(visibleCommand('‪‫‬‭')).toBe(
            '⟨U+202A⟩⟨U+202B⟩⟨U+202C⟩⟨U+202D⟩',
        )
        expect(visibleCommand('⁦⁧⁨⁩')).toBe(
            '⟨U+2066⟩⟨U+2067⟩⟨U+2068⟩⟨U+2069⟩',
        )
    })
    test('zero-width and BOM characters are made visible', () => {
        expect(visibleCommand('a​b‏c﻿d')).toBe(
            'a⟨U+200B⟩b⟨U+200F⟩c⟨U+FEFF⟩d',
        )
    })
    test('other C0 controls and DEL are made visible', () => {
        expect(visibleCommand('a\u0000b\u001bc\u007fd')).toBe(
            'a⟨U+0000⟩b⟨U+001B⟩c⟨U+007F⟩d',
        )
    })
})

describe('padding + exotic whitespace', () => {
    test('long space runs collapse', () => {
        expect(visibleCommand('a' + ' '.repeat(500) + 'b')).toBe('a⟨500 spaces⟩b')
        expect(visibleCommand('a b')).toBe('a b')
        expect(visibleCommand('a  b')).toBe('a  b')
    })
    test('unicode spaces and separators are marked', () => {
        expect(visibleCommand('a\u00a0b')).toBe('a⟨U+00A0⟩b')
        expect(visibleCommand('a b')).toBe('a⟨U+2028⟩b')
        expect(visibleCommand('a　b­c⁠d e\u0085f g')).toBe(
            'a⟨U+3000⟩b⟨U+00AD⟩c⟨U+2060⟩d⟨U+2003⟩e⟨U+0085⟩f⟨U+2029⟩g',
        )
    })
})

describe('visibleParts', () => {
    test('splits markers into their own hidden parts', () => {
        expect(visibleParts('git status\ncurl')).toEqual([
            { text: 'git status', hidden: false },
            { text: '⏎', hidden: true },
            { text: 'curl', hidden: false },
        ])
    })
    test('joined equals visibleCommand', () => {
        for (const c of ['x', 'a\nb', 'a‮b', 'a' + ' '.repeat(9) + 'b'])
            expect(visibleParts(c).map(p => p.text).join('')).toBe(visibleCommand(c))
    })
})

describe('isApprovable', () => {
    test('matches core hasHiddenChars', () => {
        const samples = ['ls', 'a\nb', 'a\rb', 'a‮b', 'a⁦b', 'a​b', 'a\tb', 'a b', 'a b', '']
        for (const c of samples) expect(isApprovable(c)).toBe(!hasHiddenChars(c))
    })
})
