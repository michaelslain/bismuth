import { describe, expect, it } from 'bun:test'
import {
    THEMES,
    THEME_NAMES,
    DEFAULT_THEME,
    resolveTheme,
    resolveAppearance,
} from './themes'

describe('themes registry', () => {
    it('exposes the 4 ASCII scopes, ink first (the default)', () => {
        expect(THEME_NAMES[0]).toBe('ink')
        expect(DEFAULT_THEME).toBe('ink')
        expect(THEME_NAMES).toEqual(['ink', 'paper', 'cathode', 'riso'])
    })

    it('every theme carries the full base color token set', () => {
        for (const name of THEME_NAMES) {
            const t = THEMES[name]
            for (const key of [
                'background',
                'foreground',
                'neutral',
                'accent',
                'border',
                'surface',
                'surface2',
            ] as const) {
                expect(t[key], `${name}.${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/)
            }
            expect(t.accentPalette.length).toBeGreaterThanOrEqual(5)
        }
    })

    it("ink holds the ASCII redesign's default values", () => {
        expect(THEMES.ink.background).toBe('#15161A')
        expect(THEMES.ink.accent).toBe('#93BDB0')
        expect(THEMES.ink.surface).toBe('#20222A')
    })
})

describe('resolveTheme / resolveAppearance', () => {
    it('resolves a known theme to its tokens', () => {
        expect(resolveTheme('cathode')).toEqual(THEMES.cathode)
    })

    it('falls back to the default theme for an unknown name', () => {
        expect(resolveTheme('nope')).toEqual(THEMES.ink)
    })

    it('resolveAppearance reads the theme off the appearance subtree', () => {
        expect(resolveAppearance({ theme: 'cathode' })).toEqual(THEMES.cathode)
        expect(resolveAppearance({ theme: '' })).toEqual(THEMES.ink)
    })
})
