// app/src/themeGuard.test.ts
// The SAFETY NET for the centralized color system (core/src/theme/tokens.ts →
// settingsCssVars projection → CSS var()). Three invariants:
//   1. Every theme yields every ColorTokens field (no theme is missing a token).
//   2. settingsToCssVars projects the full contract of semantic + palette tokens
//      for EVERY theme — the same key set for all — so no CSS var() is ever unset.
//   3. No CSS var(--x) is "dangling": referenced with no inline fallback yet never
//      projected, defined, or explicitly whitelisted.
// Written before the refactor and kept committed: it fails loudly if a token stops
// being projected, a theme drops a field, or a stylesheet references a phantom var.
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    THEMES,
    THEME_NAMES,
    resolveTheme,
    type ColorTokens,
    ACCENT_RAMP,
    CATEGORY_SWATCHES,
    SEMANTIC_DARK,
    SEMANTIC_LIGHT,
} from './themes'
import { settingsToCssVars } from './settingsCssVars'
import { DEFAULTS } from './settings'

const APP_SRC = dirname(fileURLToPath(import.meta.url))
const ROOT = join(APP_SRC, '..', '..')
// The :root first-paint fallbacks moved out of App.css into styles/tokens.css (the CSS
// modularization's global layer) — App.css only @imports it now. This constant is the one thing
// that had to follow them; every assertion below is unchanged.
const APP_CSS = join(APP_SRC, 'styles', 'tokens.css')
const TOKENS = join(ROOT, 'core', 'src', 'theme', 'tokens.ts')

/** ColorTokens fields every theme MUST define (the base palette). */
const REQUIRED_TOKEN_FIELDS: (keyof ColorTokens)[] = [
    'background',
    'foreground',
    'neutral',
    'accent',
    'border',
    'surface',
    'surface2',
    'accentPalette',
]

/** CSS custom properties settingsToCssVars MUST project for EVERY theme — the projection
 *  contract every stylesheet relies on. Includes the semantic + elevation tokens that this
 *  refactor centralized (previously hardcoded in App.css :root, dark-only). */
const REQUIRED_PROJECTED = [
    // base chrome
    '--bg',
    '--fg',
    '--accent',
    '--border',
    '--border-soft',
    '--text-muted',
    '--faint',
    '--panel',
    '--surface-1',
    '--surface-2',
    '--surface-3',
    '--hover-bg',
    // accent + category ramp
    '--teal',
    '--blue',
    '--violet',
    '--green',
    '--gold',
    '--rose',
    '--grad',
    '--accent-soft',
    '--accent-purple',
    '--on-accent',
    '--graph-0',
    '--graph-1',
    '--graph-2',
    '--graph-3',
    '--graph-4',
    // semantic status (centralized here — must be per-theme, not a dark-only literal)
    '--danger',
    '--success',
    '--warning',
    // elevation (centralized here — light themes get a lighter flat shadow color; the four
    // blurred --shadow-menu/-popup/-card/-modal tokens were deleted 2026-08-27, wave 1 of the
    // visual-unification audit — --shadow-hard is the only one left, see its own doc comment)
    '--shadow-hard',
    // overlay/glow (Stage 1 additions)
    '--overlay-bg',
    '--glow-accent',
    '--glow-text',
]

/** CSS vars intentionally left unprojected (documented escape hatches). */
const VAR_WHITELIST = new Set<string>([
    '--lo', // user decision 2026-07-21: undefined on purpose → inherits --hi brightness. Do NOT define.
    '--chat-tint', // set inline per-pane by ChatView.tsx (JS style binding), never global.
])

function withTheme(theme: string) {
    return {
        ...DEFAULTS,
        appearance: { ...DEFAULTS.appearance, theme },
    } as typeof DEFAULTS
}

function walkCss(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === 'dist') continue
        const p = join(dir, e)
        const s = statSync(p)
        if (s.isDirectory()) walkCss(p, out)
        else if (e.endsWith('.css')) out.push(p)
    }
    return out
}

/** All non-test source files (.ts/.tsx/.css) under app/src + core/src. */
function walkSource(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === 'dist') continue
        const p = join(dir, e)
        const s = statSync(p)
        if (s.isDirectory()) walkSource(p, out)
        else if (/\.(ts|tsx|css)$/.test(e) && !/\.test\.tsx?$/.test(e))
            out.push(p)
    }
    return out
}

/** Files that contain `hex` (case-insensitive) as a raw literal. */
function filesContaining(hex: string): string[] {
    const files = [
        ...walkSource(join(ROOT, 'app', 'src')),
        ...walkSource(join(ROOT, 'core', 'src')),
    ]
    const needle = hex.toLowerCase()
    return files.filter(f =>
        readFileSync(f, 'utf8').toLowerCase().includes(needle),
    )
}

describe('theme guard — every theme yields every token', () => {
    it('resolveTheme returns all required ColorTokens fields for every theme', () => {
        for (const name of THEME_NAMES) {
            const t = resolveTheme(name)
            for (const f of REQUIRED_TOKEN_FIELDS) {
                expect(t[f], `${name}.${String(f)}`).toBeDefined()
            }
            expect(
                t.accentPalette.length,
                `${name}.accentPalette length`,
            ).toBeGreaterThanOrEqual(5)
            for (const c of t.accentPalette)
                expect(c, `${name} palette hex`).toMatch(/^#[0-9a-fA-F]{6}$/)
        }
    })

    it('light themes are flagged isLight; dark themes are not', () => {
        const LIGHT_THEMES = new Set(['paper', 'riso'])
        for (const name of THEME_NAMES) {
            const isLight = LIGHT_THEMES.has(name)
            expect(!!resolveTheme(name).isLight, name).toBe(isLight)
        }
    })
})

describe('theme guard — projection contract', () => {
    it('settingsToCssVars projects every required token for EVERY theme, all non-empty', () => {
        for (const name of THEME_NAMES) {
            const vars = settingsToCssVars(withTheme(name))
            for (const key of REQUIRED_PROJECTED) {
                const v = vars[key]
                expect(v, `${name} ${key}`).toBeDefined()
                expect(
                    String(v).trim().length,
                    `${name} ${key} non-empty`,
                ).toBeGreaterThan(0)
            }
        }
    })

    it('every theme produces the SAME set of projected keys (no theme drops a var)', () => {
        const ref = new Set(
            Object.keys(settingsToCssVars(withTheme(THEME_NAMES[0]))),
        )
        for (const name of THEME_NAMES.slice(1)) {
            const keys = new Set(
                Object.keys(settingsToCssVars(withTheme(name))),
            )
            expect(
                [...ref].filter(k => !keys.has(k)),
                `${name} missing keys`,
            ).toEqual([])
            expect(
                [...keys].filter(k => !ref.has(k)),
                `${name} extra keys`,
            ).toEqual([])
        }
    })
})

describe('theme guard — semantic + elevation tokens re-theme (light ≠ dark)', () => {
    const dark = settingsToCssVars(withTheme('ink'))
    const light = settingsToCssVars(withTheme('paper'))

    it('danger/success/warning have their own accessible light values, not the dark-tuned ones', () => {
        for (const key of ['--danger', '--success', '--warning']) {
            expect(light[key], `${key} light`).not.toBe(dark[key])
        }
    })

    it('light shadows are lighter than the dark ones (not rgba(0,0,0,…))', () => {
        for (const key of ['--shadow-hard']) {
            expect(light[key], `${key} light differs`).not.toBe(dark[key])
            expect(light[key], `${key} light not pure-black`).not.toContain(
                'rgba(0, 0, 0',
            )
        }
    })
})

describe('theme guard — centralized colors never re-duplicate (anti-drift lint)', () => {
    // Step 8: a raw hex for a CENTRALIZED value may live ONLY in the sanctioned sources —
    // core/src/theme/tokens.ts (the source of truth) and, for the dark first-paint fallbacks,
    // app/src/styles/tokens.css :root (split out of App.css, which now only @imports it).
    // If one reappears anywhere else the 5-copies-that-drift problem is back.
    // (A blanket "no hex anywhere" ban is intentionally NOT used: issue/row refs like #100 or
    // #70a and fixed external palettes — Google event colors, xterm ANSI — are false positives.
    // The deliberate exceptions the task names, the FPS meter + chat swatches, are non-centralized
    // hues that never appear in this tracked set, so they need no allowlist here.)

    it('the category swatch ramp lives only in tokens.ts + styles/tokens.css :root fallbacks', () => {
        for (const hex of ACCENT_RAMP) {
            const stray = filesContaining(hex).filter(
                f => f !== TOKENS && f !== APP_CSS,
            )
            expect(
                stray.map(f => f.slice(ROOT.length + 1)),
                `ramp ${hex}`,
            ).toEqual([])
        }
    })

    it('dark semantic status colors live only in tokens.ts + styles/tokens.css :root fallbacks', () => {
        for (const hex of [
            SEMANTIC_DARK.danger,
            SEMANTIC_DARK.success,
            SEMANTIC_DARK.warning,
        ]) {
            const stray = filesContaining(hex).filter(
                f => f !== TOKENS && f !== APP_CSS,
            )
            expect(
                stray.map(f => f.slice(ROOT.length + 1)),
                `semantic ${hex}`,
            ).toEqual([])
        }
    })

    it('light semantic status colors live only in tokens.ts (no styles/tokens.css mirror needed)', () => {
        for (const hex of [
            SEMANTIC_LIGHT.danger,
            SEMANTIC_LIGHT.success,
            SEMANTIC_LIGHT.warning,
        ]) {
            const stray = filesContaining(hex).filter(f => f !== TOKENS)
            expect(
                stray.map(f => f.slice(ROOT.length + 1)),
                `light semantic ${hex}`,
            ).toEqual([])
        }
    })

    it('styles/tokens.css :root fallbacks byte-mirror the tokens source (ramp + dark semantics)', () => {
        const css = readFileSync(APP_CSS, 'utf8').toLowerCase()
        for (const hex of Object.values(CATEGORY_SWATCHES))
            expect(css, `styles/tokens.css has ${hex}`).toContain(
                hex.toLowerCase(),
            )
        for (const hex of [
            SEMANTIC_DARK.danger,
            SEMANTIC_DARK.success,
            SEMANTIC_DARK.warning,
        ]) {
            expect(css, `styles/tokens.css has ${hex}`).toContain(
                hex.toLowerCase(),
            )
        }
    })
})

describe('theme guard — no dangling CSS var', () => {
    it(
        'every var(--x) without an inline fallback is projected, defined, or whitelisted',
        () => {
            // Read once, scan twice. The two passes below need EVERY file's declarations before ANY
            // file's references can be judged, so they cannot merge into one loop — but they were also
            // re-reading every file from disk to do it. Under load that doubled I/O blew this test's 5s
            // timeout at 30s, despite a 286ms normal runtime.
            const sources = walkCss(APP_SRC).map(f => [f, readFileSync(f, 'utf8')] as const)
            const projected = new Set(Object.keys(settingsToCssVars(DEFAULTS)))
            const defined = new Set<string>()
            for (const [, css] of sources) {
                for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1])
                for (const m of css.matchAll(/@property\s+(--[a-z0-9-]+)/gi)) defined.add(m[1])
            }
            const dangling: string[] = []
            for (const [f, css] of sources) {
                for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
                    const name = m[1]
                    if (projected.has(name) || defined.has(name) || VAR_WHITELIST.has(name)) continue
                    dangling.push(`${name} in ${f.slice(APP_SRC.length + 1)}`)
                }
            }
            expect([...new Set(dangling)]).toEqual([])
        },
        // 30s, not the 5s default, and NOT because this test is slow: it runs in ~250ms. It walks
        // every stylesheet under app/src, so its cost scales with machine load rather than with the
        // code under test, and a real run measured 30s while a Storybook and several headless Chromes
        // were competing for I/O. A 5s bound that only holds on an idle machine turns a green suite
        // red for reasons that have nothing to do with the change being tested — the read-once refactor
        // above is the real speed fix; this is the honest bound for a whole-tree scan.
        30_000,
    )
})
