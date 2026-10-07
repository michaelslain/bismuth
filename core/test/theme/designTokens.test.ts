import { describe, expect, it } from 'bun:test'
import {
    DESIGN_TOKENS,
    TOKEN_GROUPS,
    applyColorTokens,
    checkTokenValue,
    describeKind,
    legacyTokens,
    nonFieldTokens,
    parseTokenMap,
    suggestTokenKey,
    tokenDef,
    type TokenDef,
    type TokenKind,
} from '../../src/theme/designTokens'
import { MONO_FONTS, PROSE_FONTS } from '../../src/theme/fontFamilies'
import { THEMES } from '../../src/theme/tokens'

/** A throwaway def of `kind` (not a field token, so CSS-only colour formulas are allowed). */
const def = (kind: TokenKind, field?: TokenDef['field']): TokenDef => ({
    key: 'x',
    kind,
    group: 'surface',
    default: '',
    doc: '',
    field,
})
const ok = (kind: TokenKind, raw: unknown) => checkTokenValue(def(kind), raw)

describe('checkTokenValue, one pass and one fail per kind', () => {
    it('color', () => {
        expect(ok('color', '#fff')).toEqual({ ok: true, value: '#fff' })
        expect(ok('color', 'rgba(0, 0, 0, 0.5)').ok).toBe(true)
        expect(ok('color', 'hsl(120deg 40% 50% / .5)').ok).toBe(true)
        expect(ok('color', 'transparent').ok).toBe(true)
        expect(ok('color', 'rgb(a b c)')).toEqual({
            ok: false,
            problem:
                'not a color: rgb(a b c) (#rrggbb, rgba(0, 0, 0, 0.5), or transparent)',
        })
        expect(ok('color', 'red').ok).toBe(false)
    })
    it('a FIELD colour is plain only; a CSS-only colour may be a formula', () => {
        const f = 'color-mix(in srgb, var(--accent) 38%, transparent)'
        expect(checkTokenValue(def('color'), f).ok).toBe(true)
        expect(checkTokenValue(def('color', 'accent'), f).ok).toBe(false)
        expect(checkTokenValue(def('color'), 'var(--nope)').ok).toBe(false)
    })
    it('length', () => {
        expect(ok('length', 6)).toEqual({ ok: true, value: '6px' })
        expect(ok('length', '0.5em')).toEqual({ ok: true, value: '0.5em' })
        expect(ok('length', '0').ok).toBe(true)
        expect(ok('length', 'max(var(--fs-display), 3px)').ok).toBe(true)
        expect(ok('length', 'big')).toEqual({
            ok: false,
            problem: 'not a length: big (6px, 0.5em, or a number of px)',
        })
    })
    it('number normalizes numbers and numeric strings', () => {
        expect(ok('number', 1.5)).toEqual({ ok: true, value: '1.5' })
        expect(ok('number', '.45')).toEqual({ ok: true, value: '0.45' })
        expect(ok('number', '1,5')).toEqual({
            ok: false,
            problem: 'not a number: 1,5 (1.5)',
        })
        expect(ok('number', Infinity).ok).toBe(false)
    })
    it('duration', () => {
        expect(ok('duration', 120)).toEqual({ ok: true, value: '120ms' })
        expect(ok('duration', '0.2s').ok).toBe(true)
        expect(ok('duration', 'calc(80ms * var(--motion-scale))').ok).toBe(true)
        expect(ok('duration', 'soon')).toEqual({
            ok: false,
            problem:
                'not a duration: soon (120ms, 0.2s, or a number of ms)',
        })
    })
    it('easing', () => {
        expect(ok('easing', 'ease-in-out').ok).toBe(true)
        expect(ok('easing', 'cubic-bezier(0.34, 1.56, 0.64, 1)').ok).toBe(true)
        expect(ok('easing', 'cubic-bezier(1.5, 0, 0, 1)').ok).toBe(false)
        expect(ok('easing', 'bouncy')).toEqual({
            ok: false,
            problem:
                'not an easing: bouncy (ease, linear, or cubic-bezier(0.2, 0, 0, 1))',
        })
    })
    it('shadow', () => {
        expect(ok('shadow', 'none').ok).toBe(true)
        expect(ok('shadow', 'inset 0 0 0 1px var(--accent)').ok).toBe(true)
        expect(ok('shadow', '2px 2px 0 rgba(0,0,0,.4), 0 0 4px #fff').ok).toBe(true)
        expect(ok('shadow', '2px 2px 0 var(--nope)').ok).toBe(false)
        expect(ok('shadow', '2px 2px 0 url(x)').ok).toBe(false)
        expect(ok('shadow', '2px 2px 0 red; x').ok).toBe(false)
        expect(ok('shadow', 'blurry')).toEqual({
            ok: false,
            problem:
                'not a shadow: blurry (none, or 2px 2px 0 rgba(0, 0, 0, 0.4))',
        })
    })
    it('border', () => {
        expect(ok('border', '1px solid #3a3e4a').ok).toBe(true)
        expect(ok('border', '2px dashed var(--accent)').ok).toBe(true)
        expect(ok('border', 'none').ok).toBe(true)
        expect(ok('border', '1px wavy #fff')).toEqual({
            ok: false,
            problem: 'not a border: 1px wavy #fff (1px solid #3a3e4a)',
        })
    })
    it('gradient', () => {
        expect(
            ok('gradient', 'linear-gradient(120deg, #c98ca8, var(--accent) 40%, #8296c6)').ok,
        ).toBe(true)
        expect(ok('gradient', 'radial-gradient(circle at 50% 30%, #fff, #000)').ok).toBe(true)
        expect(ok('gradient', 'linear-gradient(red, blue)').ok).toBe(false)
        expect(ok('gradient', 'linear-gradient(#fff, #000')).toEqual({
            ok: false,
            problem:
                'not a gradient: linear-gradient(#fff, #000 (linear-gradient(120deg, #c98ca8, #8296c6))',
        })
    })
    it('fonts match the family lists exactly', () => {
        expect(ok('font-mono', MONO_FONTS[1])).toEqual({ ok: true, value: MONO_FONTS[1] })
        expect(ok('font-mono', 'Lora').ok).toBe(false)
        expect(ok('font-prose', 'Lora').ok).toBe(true)
        expect(ok('font-prose', 'lora').ok).toBe(false)
        expect(PROSE_FONTS).toEqual(['Libron', 'IBM Plex Serif', 'Lora', ...MONO_FONTS])
    })
    it('scheme', () => {
        expect(ok('scheme', 'light')).toEqual({ ok: true, value: 'light' })
        expect(ok('scheme', 'dim')).toEqual({
            ok: false,
            problem: 'not a color scheme: dim (light or dark)',
        })
    })
    it('truncates a long value to 80 chars', () => {
        const r = ok('length', 'x'.repeat(200))
        expect(r.ok === false && r.problem).toContain(`${'x'.repeat(80)}…`)
    })
    it('describeKind names the kind', () => {
        expect(describeKind('length')).toBe('a length: 6px, 0.5em, or a number of px')
    })
})

describe('tokenDef', () => {
    it('finds a token and is prototype-safe', () => {
        expect(tokenDef('accent')?.field).toBe('accent')
        expect(tokenDef('constructor')).toBeUndefined()
        expect(tokenDef('__proto__')).toBeUndefined()
    })
})

describe('parseTokenMap', () => {
    it('null and undefined are empty', () => {
        expect(parseTokenMap(undefined)).toEqual({ tokens: {}, diagnostics: [] })
        expect(parseTokenMap(null)).toEqual({ tokens: {}, diagnostics: [] })
    })
    it('a non-map is one error', () => {
        for (const raw of ['x', 3, ['a']])
            expect(parseTokenMap(raw).diagnostics.map(d => [d.severity, d.message])).toEqual([
                ['error', 'tokens must be a map of token: value'],
            ])
    })
    it('an unknown key warns with a near suggestion', () => {
        const r = parseTokenMap({ acent: '#fff', zzzzzzzz: '#fff' })
        expect(r.tokens).toEqual({})
        expect(r.diagnostics.map(d => d.message)).toEqual([
            'acent: unknown token, ignored (did you mean accent?)',
            'zzzzzzzz: unknown token, ignored',
        ])
    })
    it('a bad value is an error and is dropped; keys are case-sensitive', () => {
        const r = parseTokenMap({ 'r-card': 'big', 'dur-fast': 100, Accent: '#fff' })
        expect(r.tokens).toEqual({ 'dur-fast': '100ms' })
        expect(r.diagnostics.map(d => [d.severity, d.message])).toEqual([
            ['error', 'r-card: not a length: big (6px, 0.5em, or a number of px)'],
            ['warning', 'Accent: unknown token, ignored (did you mean accent?)'],
        ])
    })
})

describe('applyColorTokens', () => {
    it('returns a new object and never mutates base or its palette', () => {
        const base = THEMES.ink
        const before = JSON.stringify(base)
        const out = applyColorTokens(base, { accent: '#ff0000', 'graph-2': '#00ff00' })
        expect(out).not.toBe(base)
        expect(out.accent).toBe('#ff0000')
        expect(out.accentPalette[2]).toBe('#00ff00')
        expect(out.accentPalette[0]).toBe(base.accentPalette[0])
        expect(out.accentPalette).not.toBe(base.accentPalette)
        expect(JSON.stringify(base)).toBe(before)
    })
    it('color-scheme sets isLight; non-field keys are ignored', () => {
        expect(applyColorTokens(THEMES.ink, { 'color-scheme': 'light' }).isLight).toBe(true)
        expect(applyColorTokens(THEMES.paper, { 'color-scheme': 'dark' }).isLight).toBe(false)
        expect(applyColorTokens(THEMES.ink, { 'r-card': '9px' })).toEqual(THEMES.ink)
    })
    it('nonFieldTokens drops the field tokens', () => {
        expect(nonFieldTokens({ accent: '#fff', 'r-card': '9px' })).toEqual({ 'r-card': '9px' })
    })
})

describe('legacyTokens', () => {
    it('reads valid values and skips invalid ones', () => {
        expect(
            legacyTokens({ appearance: { editorFontSize: 16, uiFont: 'Nope' } }),
        ).toEqual({ 'editor-font-size': '16px' })
    })
    it('skips out-of-range values and converts units', () => {
        expect(
            legacyTokens({
                appearance: {
                    editorFontSize: 99,
                    cursorGlideMs: 90,
                    cursorBlinkSeconds: 1.5,
                    monoScale: 0.8,
                    proseFont: 'Lora',
                },
                editor: { lineHeight: 1.4 },
            }),
        ).toEqual({
            'cursor-glide': '90ms',
            'cursor-blink': '1.5s',
            'mono-scale': '0.8',
            'prose-font': 'Lora',
            'prose-line-height': '1.4',
        })
        expect(legacyTokens({})).toEqual({})
    })
})

describe('the registry', () => {
    it('keys are unique kebab-case', () => {
        const keys = DESIGN_TOKENS.map(d => d.key)
        expect(new Set(keys).size).toBe(keys.length)
        for (const k of keys) expect(k).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    })
    it('every field is a real ColorTokens key', () => {
        const real = new Set(Object.keys(THEMES.paper).concat(Object.keys(THEMES.ink)))
        for (const d of DESIGN_TOKENS)
            if (d.field) expect(real.has(d.field), d.key).toBe(true)
    })
    it('every default passes its own check', () => {
        for (const d of DESIGN_TOKENS) {
            const r = checkTokenValue(d, d.default)
            expect(r.ok, `${d.key}: ${r.ok ? '' : r.problem}`).toBe(true)
        }
    })
    it('every group has a token and tokens are grouped in TOKEN_GROUPS order', () => {
        for (const g of TOKEN_GROUPS)
            expect(DESIGN_TOKENS.some(d => d.group === g), g).toBe(true)
        const order = DESIGN_TOKENS.map(d => TOKEN_GROUPS.indexOf(d.group))
        expect(order).toEqual([...order].sort((a, b) => a - b))
    })
})

describe('token references', () => {
    const real = (key: string) => DESIGN_TOKENS.find(d => d.key === key)!
    it('rejects a value that refers to its own token', () => {
        for (const [key, v] of [
            ['sp-3', 'calc(var(--sp-3) * 2)'],
            ['dur', 'var(--dur)'],
            ['lift', 'var(--lift)'],
        ] as const) {
            const r = checkTokenValue(real(key), v)
            expect(r.ok).toBe(false)
            if (!r.ok) expect(r.problem).toBe(`refers to itself: ${v}`)
        }
    })
    it('rejects a reference to a token of the wrong kind', () => {
        expect(checkTokenValue(real('sp-3'), 'calc(var(--bg) * 2)').ok).toBe(false)
        expect(checkTokenValue(real('ease'), 'var(--dur)').ok).toBe(false)
        expect(checkTokenValue(real('sp-3'), 'var(--sp-2)').ok).toBe(true)
    })
})

describe('formula structure', () => {
    const len = (v: string) => checkTokenValue(def('length'), v).ok
    it('accepts well-formed formulas', () => {
        for (const v of [
            'calc(var(--sp-3) * 2)',
            'calc(1px + 2px)',
            'calc(1px - -2px)',
            'calc((1px + 2px) * 3)',
            'calc(100% - var(--sp-3))',
            'min(1px, 2px)',
            'max(var(--sp-2), var(--sp-3), 4px)',
            'clamp(1px, var(--sp-3), 9px)',
            'calc(min(1px, 2px) + 3px)',
            'max(var(--fs-display), 13px)',
        ])
            expect(len(v), v).toBe(true)
    })
    it('rejects operands with no operator between them', () => {
        for (const v of [
            'calc(1 var(--sp-3))',
            'calc(1px 2px)',
            'calc(var(--sp-2) var(--sp-3))',
            'calc(1px -2px)',
            'calc(1px-2px)',
        ])
            expect(len(v), v).toBe(false)
    })
    it('rejects dangling operators, empty groups and wrong argument counts', () => {
        for (const v of [
            'calc(1px +)',
            'calc(* 2px)',
            'calc(-var(--sp-3))',
            'calc()',
            'min()',
            'min(1px,)',
            'clamp(1px, 2px)',
            'clamp(1px, 2px, 3px, 4px)',
            'calc(1px, 2px)',
            'calc(1px + (2px)',
            'calc(1px) calc(2px)',
            'calc(1px) + 2px',
            'calc(1vmin + 2px)',
        ])
            expect(len(v), v).toBe(false)
    })
    it('applies to durations too', () => {
        const dur = (v: string) => checkTokenValue(def('duration'), v).ok
        expect(dur('calc(80ms * var(--motion-scale))')).toBe(true)
        expect(dur('calc(80ms 2)')).toBe(false)
    })
})

describe('suggestTokenKey', () => {
    it('names the nearest registered key within 2 edits', () => {
        expect(suggestTokenKey('acent')).toBe('accent')
        expect(suggestTokenKey('sp-33')).toBe('sp-3')
    })
    it('is undefined when nothing is close', () => {
        expect(suggestTokenKey('zzzzzzzz')).toBeUndefined()
    })
    it('agrees with the hint parseTokenMap prints', () => {
        const [d] = parseTokenMap({ acent: '#fff' }).diagnostics
        expect(d.message).toBe(`acent: unknown token, ignored (did you mean ${suggestTokenKey('acent')}?)`)
    })
})
