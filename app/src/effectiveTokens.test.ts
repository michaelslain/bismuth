import { describe, expect, it } from 'bun:test'
import { overridePx, overrideVars, tokenOverride } from './effectiveTokens'
import { DEFAULTS, FONT_STACKS, PROSE_SCALES, type Settings } from './settings'

const withTokens = (tokens: Record<string, string>, theme = 'ink'): Settings => ({
    ...DEFAULTS,
    appearance: { ...DEFAULTS.appearance, theme, tokens },
})

describe('tokenOverride', () => {
    it('settings tokens beat the active theme; other themes are ignored', () => {
        const themes = { dusk: { 'sp-3': '9px' }, other: { 'sp-3': '1px' } }
        expect(tokenOverride(withTokens({}, 'dusk'), themes, 'sp-3')).toBe('9px')
        expect(tokenOverride(withTokens({ 'sp-3': '10px' }, 'dusk'), themes, 'sp-3')).toBe('10px')
        expect(tokenOverride(withTokens({}, 'ink'), themes, 'sp-3')).toBeUndefined()
    })
})

describe('overridePx', () => {
    it('reads a plain px length, nothing else', () => {
        expect(overridePx('16px')).toBe(16)
        expect(overridePx('12.5px')).toBe(12.5)
        for (const v of ['1em', '2rem', '50%', 'calc(1px + 2px)', 'clamp(1px, 2px, 3px)', '', undefined])
            expect(overridePx(v)).toBeUndefined()
    })
})

describe('overrideVars', () => {
    it('is empty with no overrides', () => {
        expect(overrideVars(withTokens({}), {})).toEqual({})
    })

    it('theme first, then settings; keys become --key', () => {
        const v = overrideVars(withTokens({ 'sp-3': '10px' }, 'dusk'), {
            dusk: { 'sp-3': '9px', 'r-card': '0' },
        })
        expect(v).toEqual({ '--sp-3': '10px', '--r-card': '0' })
    })

    it('skips field tokens and unregistered keys', () => {
        const v = overrideVars(withTokens({ accent: '#ff6b6b', 'not-a-token': 'x' }), {})
        expect(v).toEqual({})
    })

    it('converts a font name to its stack and derives --prose-scale', () => {
        const v = overrideVars(withTokens({ 'ui-font-stack': 'Monaspace Neon', 'prose-font': 'Lora' }), {})
        expect(v['--ui-font-stack']).toBe(FONT_STACKS['Monaspace Neon'])
        expect(v['--prose-font']).toBe(FONT_STACKS['Lora'])
        expect(v['--prose-scale']).toBe(String(PROSE_SCALES['Lora']))
    })

    it('an explicit prose-scale wins over the derived one', () => {
        const v = overrideVars(withTokens({ 'prose-font': 'Lora', 'prose-scale': '1.2' }), {})
        expect(v['--prose-scale']).toBe('1.2')
    })
})
