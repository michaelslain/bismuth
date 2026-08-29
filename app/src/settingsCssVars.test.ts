// app/src/settingsCssVars.test.ts
import { describe, expect, it } from 'bun:test'
import { settingsToCssVars } from './settingsCssVars'
import { DEFAULTS } from './settings'
import { THEMES } from './themes'

function withTheme(theme: string) {
    return {
        ...DEFAULTS,
        appearance: { ...DEFAULTS.appearance, theme },
    } as typeof DEFAULTS
}

describe('settingsToCssVars', () => {
    it('maps non-color appearance settings to CSS custom properties with units', () => {
        const vars = settingsToCssVars(DEFAULTS)
        // Derived from DEFAULTS, not a literal: what this asserts is that the mapping appends the UNIT.
        // Pinning "11.5px" made a legitimate change to the default prose size (11.5 -> 13.5, the design's
        // own --fs-body-lg) look like a regression here.
        expect(vars['--editor-font-size']).toBe(
            `${DEFAULTS.appearance.editorFontSize}px`,
        )
        expect(vars['--editor-font-size']).toMatch(/^\d+(\.\d+)?px$/)
        expect(vars['--editor-font']).toBe(
            "'Monaspace Xenon', ui-monospace, monospace",
        ) // resolved through FONT_STACKS
        expect(vars['--ui-font-stack']).toBe(
            "'Monaspace Xenon', ui-monospace, monospace",
        ) // resolved through FONT_STACKS
    })

    it('derives the color tokens from the default theme (ink)', () => {
        const t = THEMES.ink
        const vars = settingsToCssVars(DEFAULTS)
        expect(vars['--bg']).toBe(t.background)
        expect(vars['--fg']).toBe(t.foreground)
        expect(vars['--accent']).toBe(t.accent)
        // Base UI colors come straight from the theme (explicit, not color-mix).
        expect(vars['--border']).toBe(t.border)
        expect(vars['--text-muted']).toBe(t.neutral)
        expect(vars['--panel']).toBe(t.surface)
        expect(vars['--surface-1']).toBe(t.surface)
        expect(vars['--surface-2']).toBe(t.surface2)
        // --accent-purple tracks accentPalette[1].
        expect(vars['--accent-purple']).toBe(t.accentPalette[1])
    })

    it('falls back to the raw font value when not a known stack key', () => {
        const s = structuredClone(DEFAULTS)
        s.appearance.editorFont = 'Comic Sans'
        expect(settingsToCssVars(s)['--editor-font']).toBe('Comic Sans')
    })

    it('maps appearance/ui sizing to px vars and passes CSS lengths through', () => {
        const vars = settingsToCssVars(DEFAULTS)
        expect(vars['--sidebar-width']).toBe('266px') // the ASCII design's 266px vault rail
        expect(vars['--ui-font-size']).toBe('11.5px')
        expect(vars['--tab-font-size']).toBe('11.5px')
        expect(vars['--pane-divider-width']).toBe('5px')
        expect(vars['--palette-top-offset']).toBe('12vh') // CSS length passed through verbatim
    })
})

describe('settingsToCssVars + themes', () => {
    it('selecting a theme recolors all base + accent vars from that theme', () => {
        const t = THEMES.cathode
        const vars = settingsToCssVars(withTheme('cathode'))
        expect(vars['--bg']).toBe(t.background)
        expect(vars['--accent']).toBe(t.accent)
        expect(vars['--surface-1']).toBe(t.surface)
        expect(vars['--border']).toBe(t.border)
    })

    it("an unknown theme falls back to the default theme's colors", () => {
        const vars = settingsToCssVars(withTheme('does-not-exist'))
        expect(vars['--bg']).toBe(THEMES.ink.background)
    })
})

/** WCAG 2.x relative-luminance contrast ratio, so a colour assertion can state the REASON a token
 *  holds its value rather than only pinning the literal. Kept local: this is the only file that
 *  needs it, and importing a shared helper would couple the test to the code it checks. */
const contrast = (a: string, b: string) => {
    const lum = (h: string) => {
        const n = parseInt(h.slice(1), 16)
        const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
            const x = v / 255
            return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
        })
        return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
    }
    const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
}

describe('light themes read their own explicit ASCII scope values, not a derived dark', () => {
    const lightVars = settingsToCssVars(withTheme('paper'))
    const darkVars = settingsToCssVars(DEFAULTS) // ink (dark)
    const t = THEMES.paper

    it('pins the accent to the design value, not a guess', () => {
        // Darkened from #4E7F73 on 2026-08-29: the old value put --on-accent on --accent at
        // 4.00:1 and --accent on --bg at 3.66:1, both under WCAG AA, so accent-filled button text
        // and accent links were sub-AA on the light default. #436D63 is the same hue scaled 0.86
        // toward black and lifts them to 5.11:1 and 4.68:1. The contrast assertion below is the
        // reason this literal has the value it does — without it this test only proves the number
        // did not change, which is not what it is for.
        expect(t.accent).toBe('#436D63')
        expect(lightVars['--accent']).toBe('#436D63')
        expect(contrast(t.accent, t.onAccent!)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.accent, t.background)).toBeGreaterThanOrEqual(4.5)
        // --accent-purple still tracks ramp[1].
        expect(lightVars['--accent-purple']).toBe(t.accentPalette[1])
    })

    it("text on a solid accent fill uses each theme's own explicit on-accent token", () => {
        expect(lightVars['--on-accent']).toBe(t.onAccent)
        expect(darkVars['--on-accent']).toBe(THEMES.ink.onAccent)
    })

    it("the rail is the theme's explicit --rail value, not a derived mix", () => {
        expect(lightVars['--rail']).toBe(t.rail)
        expect(lightVars['--rail']).not.toBe(lightVars['--bg'])
    })

    it("the modal scrim uses the theme's explicit scrimBg token", () => {
        expect(lightVars['--scrim-bg']).toBe(t.scrimBg)
        expect(darkVars['--scrim-bg']).toBe(THEMES.ink.scrimBg)
    })

    it("category swatches use the theme's own explicit category tokens on both light and dark", () => {
        // Preset category swatches read the theme's explicit categoryX field so a category that
        // stores one of these tokens auto-recolors when the theme changes (only custom hex stays fixed).
        expect(lightVars['--green']).toBe(t.categoryGreen)
        expect(lightVars['--gold']).toBe(t.categoryGold)
        expect(lightVars['--rose']).toBe(t.categoryRose)
        // Dark tracks its own theme's explicit tokens the same way.
        const td = THEMES.ink
        expect(darkVars['--green']).toBe(td.categoryGreen)
        expect(darkVars['--gold']).toBe(td.categoryGold)
        expect(darkVars['--rose']).toBe(td.categoryRose)
    })
})
