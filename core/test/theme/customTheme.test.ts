import { describe, expect, it } from 'bun:test'
import { parse } from 'yaml'
import {
    THEME_NAME_RE,
    LEGACY_THEME_KEYS,
    buildThemesFeed,
    customOverrideMap,
    contrastRatio,
    customTokenMap,
    isColor,
    isThemePath,
    parseCustomTheme,
    themeFilePath,
    themeNameFromPath,
    themeTemplate,
} from '../../src/theme/customTheme'
import {
    THEMES,
    THEME_NAMES,
    isBuiltinTheme,
    resolveAppearance,
    resolveTheme,
} from '../../src/theme/tokens'
import { DESIGN_TOKENS, TOKEN_GROUPS } from '../../src/theme/designTokens'
import { SETTINGS_SCHEMA } from '../../src/schema/settingsSchema'
import { settingsSchemaFor } from '../../src/schema/themedSettingsSchema'

const parseYml = (text: string, name = 'dusk') => parseCustomTheme(name, text)
const errors = (p: ReturnType<typeof parseCustomTheme>) =>
    p.diagnostics.filter(d => d.severity === 'error')

describe('paths + names', () => {
    it('builds and recognises theme paths', () => {
        expect(themeFilePath('dusk')).toBe('.themes/dusk.yaml')
        expect(isThemePath('.themes/dusk.yaml')).toBe(true)
        expect(isThemePath('.themes/Dusk.yaml')).toBe(false)
        expect(isThemePath('.themes/dusk.txt')).toBe(false)
        expect(isThemePath('.themes/a/dusk.yaml')).toBe(false)
        expect(themeNameFromPath('.themes/dusk.yaml')).toBe('dusk')
        expect(themeNameFromPath('notes/dusk.yaml')).toBeNull()
        expect(THEME_NAME_RE.test('a'.repeat(40))).toBe(true)
        expect(THEME_NAME_RE.test('a'.repeat(41))).toBe(false)
    })
})

describe('isColor + contrastRatio', () => {
    it('accepts the colour forms', () => {
        for (const c of [
            '#fff',
            '#ffff',
            '#15161A',
            '#15161A80',
            'rgb(1,2,3)',
            'rgba(1, 2, 3, .5)',
            'hsl(200 50% 40%)',
            'hsla(200,50%,40%,.3)',
            'transparent',
        ])
            expect(isColor(c), c).toBe(true)
        for (const c of ['purple-ish', '#ff', '#fffff', 'rgb(1,2', '', 'red'])
            expect(isColor(c), c).toBe(false)
    })
    it('computes WCAG contrast', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
        expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 5)
        expect(contrastRatio('rgb(0,0,0)', '#fff')).toBeCloseTo(21, 1)
        expect(contrastRatio('rgba(0,0,0,.5)', '#fff')).toBeNull()
        expect(contrastRatio('#ffffff80', '#000')).toBeNull()
        expect(contrastRatio('nope', '#000')).toBeNull()
    })
})

describe('parseCustomTheme v2', () => {
    it('empty text and a null document are valid stock themes', () => {
        for (const text of ['', '# just a comment\n', 'null', '~']) {
            const p = parseYml(text)
            expect(p.diagnostics, JSON.stringify(text)).toEqual([])
            expect(p.theme).toMatchObject({
                name: 'dusk',
                label: 'dusk',
                extends: 'ink',
                tokens: {},
            })
            expect(p.theme?.colors).toEqual(THEMES.ink)
        }
    })
    it('non-map or broken yaml is one error with field empty', () => {
        for (const text of ['- a\n- b', 'just a string', '5', ': : :\n\t[']) {
            const p = parseYml(text)
            expect(p.theme).toBeUndefined()
            expect(p.diagnostics).toHaveLength(1)
            expect(p.diagnostics[0].field).toBe('')
            expect(p.diagnostics[0].severity).toBe('error')
        }
    })
    it('bad name and built-in name error on field name', () => {
        for (const n of ['Dusk', '-x', 'a b', 'ink', 'riso', '']) {
            const p = parseYml('label: X', n)
            expect(p.theme).toBeUndefined()
            expect(errors(p).some(d => d.field === 'name')).toBe(true)
        }
        expect(errors(parseYml('', 'Bad')).map(d => d.field)).toEqual(['name'])
    })
    it('label must be a non-empty string when present', () => {
        for (const v of ["''", '5', 'null', '[a]']) {
            const p = parseYml(`label: ${v}`)
            expect(p.theme, v).toBeUndefined()
            expect(errors(p).map(d => d.field)).toEqual(['label'])
        }
        expect(parseYml("label: '  Dusk  '").theme?.label).toBe('Dusk')
    })
    it('extends must be a built-in theme', () => {
        const p = parseYml('extends: dusk')
        expect(p.theme).toBeUndefined()
        expect(errors(p)).toEqual([
            {
                field: 'extends',
                severity: 'error',
                message: 'extends: must be one of ink, paper, cathode, riso',
            },
        ])
        expect(errors(parseYml('extends: 5')).map(d => d.field)).toEqual(['extends'])
        expect(parseYml('extends: riso').theme?.extends).toBe('riso')
    })
    it('a bad token value is an error naming the token', () => {
        const p = parseYml("tokens:\n  accent: 'purple-ish'\n")
        expect(p.theme).toBeUndefined()
        expect(errors(p)).toHaveLength(1)
        expect(errors(p)[0].field).toBe('accent')
        expect(errors(p)[0].message).toContain('accent: not a color: purple-ish')
    })
    it('tokens that is not a map is an error', () => {
        const p = parseYml('tokens: [a, b]')
        expect(p.theme).toBeUndefined()
        expect(errors(p)).toHaveLength(1)
    })
    it('an unknown token warns and the theme parses', () => {
        const p = parseYml("tokens:\n  sparkle: '#fff'\n")
        expect(p.theme).toBeDefined()
        expect(p.diagnostics).toHaveLength(1)
        expect(p.diagnostics[0]).toMatchObject({ field: 'sparkle', severity: 'warning' })
        expect(p.theme?.tokens).toEqual({})
    })
    it('unknown top-level key warns', () => {
        const p = parseYml('sparkle: 1')
        expect(p.theme).toBeDefined()
        expect(p.diagnostics).toEqual([
            {
                field: 'sparkle',
                severity: 'warning',
                message: 'sparkle: unknown field, ignored',
            },
        ])
    })
    it('legacy top-level keys warn with the pinned text', () => {
        const p = parseYml("background: '#000000'\nonAccent: '#fff'\nisLight: true\naccentPalette: []\n")
        expect(p.theme).toBeDefined()
        expect(p.diagnostics.map(d => d.message)).toEqual([
            'background: moved — write it under tokens: as bg (see bismuth theme tokens)',
            'onAccent: moved — write it under tokens: as on-accent (see bismuth theme tokens)',
            'isLight: moved — write it under tokens: as color-scheme (see bismuth theme tokens)',
            'accentPalette: moved — write it under tokens: as graph-0..4 (see bismuth theme tokens)',
        ])
        expect(p.diagnostics.every(d => d.severity === 'warning')).toBe(true)
        expect(LEGACY_THEME_KEYS.background).toBe('bg')
        expect(LEGACY_THEME_KEYS.surface2).toBe('surface-2')
    })
    it('extends paper + overrides resolves colours and override map', () => {
        const p = parseYml("extends: paper\ntokens:\n  accent: '#7a3cff'\n  r-card: 4px\n")
        expect(errors(p)).toEqual([])
        expect(p.theme?.colors.accent).toBe('#7a3cff')
        expect(p.theme?.colors.isLight).toBe(true)
        expect(p.theme?.colors.background).toBe(THEMES.paper.background)
        const feed = buildThemesFeed([p])
        expect(feed.themes[0]).toMatchObject({ name: 'dusk', extends: 'paper', isLight: true })
        expect(customOverrideMap(feed)).toEqual({ dusk: { 'r-card': '4px' } })
        expect(customTokenMap(feed).dusk.accent).toBe('#7a3cff')
        expect(THEMES.paper.accent).not.toBe('#7a3cff')
    })
    it('buildThemesFeed splits valid and invalid', () => {
        const feed = buildThemesFeed([parseYml(''), parseYml('extends: x', 'bad')])
        expect(feed.themes.map(t => t.name)).toEqual(['dusk'])
        expect(feed.invalid.map(t => t.name)).toEqual(['bad'])
    })
})

describe('contrast warnings', () => {
    it('fg == bg warns on fg but the theme is kept', () => {
        const p = parseYml("tokens:\n  fg: '#15161A'\n")
        expect(p.theme).toBeDefined()
        expect(p.diagnostics.map(d => d.field)).toContain('fg')
    })
    it('text-muted and on-accent warnings', () => {
        const p = parseYml("tokens:\n  text-muted: '#15161A'\n  on-accent: '#93BDB0'\n")
        const fields = p.diagnostics.map(d => d.field)
        expect(fields).toContain('text-muted')
        expect(fields).toContain('on-accent')
        expect(p.diagnostics.every(d => d.severity === 'warning')).toBe(true)
    })
    it('no warning when a colour is translucent (incomputable)', () => {
        expect(parseYml("tokens:\n  on-accent: 'rgba(0,0,0,.5)'\n").diagnostics).toEqual([])
    })
})

describe('themeTemplate', () => {
    it('minimal file is stock and parses clean', () => {
        const text = themeTemplate({ label: 'X', extends: 'paper' })
        expect(text).toContain("label: 'X'")
        expect(text).toContain('extends: paper')
        expect(text).toContain('tokens: {}')
        const p = parseYml(text)
        expect(p.diagnostics).toEqual([])
        expect(p.theme?.colors).toEqual({ ...THEMES.paper, isLight: true })
    })
    it('given tokens are written in registry order, quoted', () => {
        const text = themeTemplate({
            label: 'X',
            extends: 'ink',
            tokens: { 'r-card': '4px', accent: '#7a3cff' },
        })
        expect(text).toContain("  accent: '#7a3cff'")
        expect(text.indexOf('  accent:')).toBeLessThan(text.indexOf('  r-card:'))
        expect(parseYml(text).theme?.tokens).toEqual({ accent: '#7a3cff', 'r-card': '4px' })
    })
    for (const n of THEME_NAMES) {
        it(`full ${n} round-trips with zero diagnostics`, () => {
            const text = themeTemplate({ label: 'X', extends: n, full: THEMES[n] })
            const p = parseYml(text, 'x-' + n)
            expect(p.diagnostics).toEqual([])
            expect(p.theme?.label).toBe('X')
            expect(p.theme?.colors).toEqual({
                ...THEMES[n],
                isLight: THEMES[n].isLight ?? false,
            })
        })
    }
    it('full template: group headers, docs, non-field tokens commented', () => {
        const text = themeTemplate({ label: 'X', extends: 'ink', full: THEMES.ink })
        for (const g of TOKEN_GROUPS) expect(text).toContain(`  # ── ${g}`)
        for (const d of DESIGN_TOKENS) {
            expect(text).toContain(`  # ${d.doc}`)
            const line = d.field ? `  ${d.key}: '` : `  # ${d.key}: '`
            expect(text, d.key).toContain(line)
        }
        expect(Object.keys(parse(text).tokens).length).toBe(
            DESIGN_TOKENS.filter(d => d.field).length,
        )
    })
    it('full template writes a given non-field token live', () => {
        const text = themeTemplate({
            label: 'X',
            extends: 'ink',
            tokens: { 'sp-3': '9px' },
            full: THEMES.ink,
        })
        expect(text).toContain("  sp-3: '9px'")
        expect(parseYml(text).theme?.tokens['sp-3']).toBe('9px')
    })
})

describe('resolveTheme with custom themes', () => {
    const dusk = { ...THEMES.paper, accent: '#123456' }
    it('returns a custom theme by name', () => {
        expect(resolveTheme('dusk', { dusk })).toBe(dusk)
        expect(resolveAppearance({ theme: 'dusk' }, { dusk })).toBe(dusk)
    })
    it('a built-in name always wins', () => {
        expect(resolveTheme('ink', { ink: dusk })).toEqual(THEMES.ink)
    })
    it('unknown still falls back to ink', () => {
        expect(resolveTheme('nope', { dusk })).toEqual(THEMES.ink)
        expect(resolveTheme('constructor', {})).toEqual(THEMES.ink)
    })
    it('isBuiltinTheme', () => {
        expect(isBuiltinTheme('cathode')).toBe(true)
        expect(isBuiltinTheme('dusk')).toBe(false)
    })
    it('customTokenMap maps names to tokens', () => {
        expect(
            customTokenMap({
                themes: [
                    {
                        name: 'dusk',
                        label: 'D',
                        extends: 'paper',
                        isLight: true,
                        tokens: {},
                        colors: dusk,
                    },
                ],
                invalid: [],
            }),
        ).toEqual({ dusk })
    })
})

describe('settingsSchemaFor', () => {
    it('is SETTINGS_SCHEMA itself when empty', () => {
        expect(settingsSchemaFor([])).toBe(SETTINGS_SCHEMA)
    })
    it('extends the theme enum without mutating', () => {
        const before = JSON.stringify(SETTINGS_SCHEMA.appearance)
        const s = settingsSchemaFor(['dusk', 'ink'])
        const t = s.appearance.type as { kind: 'object'; fields: any }
        expect(t.fields.theme.type).toEqual({
            kind: 'enum',
            values: [...THEME_NAMES, 'dusk'],
        })
        expect(t.fields.icon).toBe(
            (SETTINGS_SCHEMA.appearance.type as any).fields.icon,
        )
        expect(s.keybindings).toBe(SETTINGS_SCHEMA.keybindings)
        expect(JSON.stringify(SETTINGS_SCHEMA.appearance)).toBe(before)
    })
})
