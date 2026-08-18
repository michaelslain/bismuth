// core/src/theme/tokens.ts
// THE single source of truth for Bismuth's color system. Lives in `core` (not `app`)
// because the dependency runs app → core: core CANNOT import app, so every color a
// core consumer needs (gcal event-color mapping, drawing paper/ink, the settings
// schema's theme enum) must be able to import FROM here. `app/src/themes.ts` is a
// thin, byte-identical re-export of this module so the frontend keeps its import path.
//
// DOM-free + Solid-free + dependency-free (pure data + pure functions) so it unit-tests
// in isolation and is safe to import from the backend, the CLI, and the browser alike.
//
// What lives here:
//   • ColorTokens type + the 4 ASCII-redesign themes' token values + THEME_NAMES/LABELS/DEFAULT.
//     ("ink" default dark, "paper" light, "cathode" phosphor-terminal, "riso" cream+indigo.)
//   • CATEGORY_SWATCHES / ACCENT_RAMP — the fixed teal→rose category ramp that was
//     hand-copied into the drawing toolbar, export theme, gcal, and App.css fallbacks.
//   • THEME_ACCENTS — per-theme accent hex (replaces gcal's hand-mirrored copy).
//   • SEMANTIC_* / SHADOW_* — status colors + elevation, per light/dark (projected by
//     settingsCssVars so components read var(--danger)/var(--shadow-card) not literals).

/** The resolved color tokens every consumer reads. `neutral` is the edge/muted grey;
 *  `accentPalette` is the graph node ramp. Everything past `accentPalette` is optional:
 *  each documents the CSS var it feeds. `settingsCssVars` prefers an explicit field when
 *  present and falls back to its existing color-mix derivation when a theme omits it. */
export interface ColorTokens {
    background: string // canvas / --bg
    foreground: string // text / --fg
    neutral: string // muted text + graph edges / --text-muted
    accent: string // --accent
    border: string // --border
    surface: string // --surface-1 / --panel
    surface2: string // --surface-2
    accentPalette: string[] // graph nodes/clusters/tags
    // Light theme flag: drives color-scheme + the light/dark branch of derived
    // structural surfaces (rail, pop-bg, scrim, label-halo, …) in settingsCssVars.
    isLight?: boolean

    // ── Structural surfaces (each an explicit override of a settingsCssVars derivation) ──
    rail?: string // --rail
    editor?: string // --editor
    surface3?: string // --surface-3
    borderSoft?: string // --border-soft
    faint?: string // --faint
    hoverBg?: string // --hover-bg
    popBg?: string // --pop-bg
    popBgStrong?: string // --pop-bg-strong
    scrimBg?: string // --scrim-bg
    overlayBg?: string // --overlay-bg
    labelHalo?: string // --label-halo
    graphBg?: string // --graph-bg (a FLAT color now, not a gradient)
    graphEdge?: string // --graph-edge
    nodeCold?: string // --node-cold
    nodeSelf?: string // --node-self
    vignetteEdge?: string // --vignette-edge
    termBg?: string // --term-bg
    termFg?: string // --term-fg
    glowAccent?: string // --glow-accent (bloom is a theme decision — only cathode glows)
    glowText?: string // --glow-text
    accentSoft?: string // --accent-soft
    onAccent?: string // --on-accent

    // Category hues (Bases statuses, calendar event categories, map pins, chart series).
    // CATEGORICAL, not semantic — distinct from --success/--danger so destructive/success
    // affordances are untouched. Optional: each defaults to the Bismuth design value in
    // settingsCssVars; a theme only sets them to re-tint categories for its own palette.
    categoryTeal?: string // --teal
    categoryBlue?: string // --blue
    categoryViolet?: string // --violet
    categoryGreen?: string // --green
    categoryGold?: string // --gold
    categoryRose?: string // --rose

    // Semantic status overrides (each theme sets these explicitly; see SEMANTIC_* below
    // for the light/dark fallback pair semanticTokens() uses when a theme omits them).
    danger?: string
    success?: string
    warning?: string
}

/** Ordered theme names; the first (`ink`) is the default. */
export const THEME_NAMES = ['ink', 'paper', 'cathode', 'riso'] as const

export type ThemeName = (typeof THEME_NAMES)[number]

/** The default theme name. */
export const DEFAULT_THEME: ThemeName = 'ink'

/** Human display names (used in the schema doc string). */
export const THEME_LABELS: Record<ThemeName, string> = {
    ink: 'Ink',
    paper: 'Paper',
    cathode: 'Cathode',
    riso: 'Riso',
}

/** The fixed category swatch ramp — the six named `--<token>` hues (teal→rose) a
 *  category color may reference. This is the ONE ramp that was hand-copied (and left to
 *  drift) into the drawing toolbar, the export theme, gcal's color map, and the App.css
 *  :root fallbacks. Every one of those now sources it from here. Values are the `.ink`
 *  scope's category hues (design/ascii/design-system/tokens/colors.css). */
export const CATEGORY_SWATCHES = {
    teal: '#83B4AE',
    blue: '#8296C6',
    violet: '#A190C4',
    green: '#A3BE8C',
    gold: '#CBB27E',
    rose: '#C98CA8',
} as const

export type CategorySwatchName = keyof typeof CATEGORY_SWATCHES

/** The six category swatch hexes in canonical token order (teal, blue, violet, green,
 *  gold, rose). The single source for the "accent ramp" literal. */
export const ACCENT_RAMP: readonly string[] = [
    CATEGORY_SWATCHES.teal,
    CATEGORY_SWATCHES.blue,
    CATEGORY_SWATCHES.violet,
    CATEGORY_SWATCHES.green,
    CATEGORY_SWATCHES.gold,
    CATEGORY_SWATCHES.rose,
]

/** Theme name → full color tokens. Values are transcribed verbatim, per scope, from
 *  design/ascii/design-system/tokens/colors.css (:root/.ink, .paper, .cathode, .riso).
 *  accentPalette = [--graph-0, --graph-1, --graph-2, --graph-3, --graph-4] in that
 *  order (rose, violet, blue, teal, green). --accent-purple is NOT its own field: it
 *  equals accentPalette[1] in every scope, so the existing settingsCssVars derivation
 *  (palette[1]) covers it without a dedicated token. */
export const THEMES: Record<ThemeName, ColorTokens> = {
    ink: {
        background: '#15161A',
        foreground: '#E8E3D6',
        neutral: '#9C998E',
        accent: '#93BDB0',
        border: '#3A3E4A',
        surface: '#20222A',
        surface2: '#272A33',
        accentPalette: ['#C98CA8', '#A190C4', '#8296C6', '#83B4AE', '#A3BE8C'],
        rail: '#101116',
        editor: '#191A1F',
        surface3: '#31353F',
        borderSoft: '#282B34',
        faint: '#6A675E',
        hoverBg: 'rgba(232,227,214,.05)',
        popBg: 'rgba(25,26,31,.88)',
        popBgStrong: 'rgba(25,26,31,.94)',
        scrimBg: 'rgba(10,11,14,.6)',
        overlayBg: 'rgba(10,11,14,.6)',
        labelHalo: '#15161A',
        graphBg: '#121317',
        graphEdge: '#3C4048',
        nodeCold: '#4A4E58',
        nodeSelf: '#E8E3D6',
        vignetteEdge: '#0D0E11',
        termBg: '#101116',
        termFg: '#C9C4B6',
        glowAccent: '0 0 0 1px rgba(147,189,176,0.14)',
        glowText: 'none',
        accentSoft: 'rgba(147,189,176,0.12)',
        onAccent: '#15161A',
        categoryTeal: '#83B4AE',
        categoryBlue: '#8296C6',
        categoryViolet: '#A190C4',
        categoryGreen: '#A3BE8C',
        categoryGold: '#CBB27E',
        categoryRose: '#C98CA8',
        danger: '#C87F72',
        success: '#A3BE8C',
        warning: '#CBB27E',
    },
    paper: {
        background: '#E9E6E0',
        foreground: '#2E2C29',
        neutral: '#6E6A63',
        accent: '#4E7F73',
        border: '#C4BEB3',
        surface: '#EFEDE8',
        surface2: '#E1DDD5',
        accentPalette: ['#A85C7A', '#7A6AA0', '#5A6E9E', '#4E8079', '#6E8A55'],
        isLight: true,
        rail: '#E3E0D9',
        editor: '#F2F0EB',
        surface3: '#D3CEC5',
        borderSoft: '#D8D3C9',
        faint: '#9A958C',
        hoverBg: 'rgba(46,44,41,.05)',
        popBg: 'rgba(242,240,235,.9)',
        popBgStrong: 'rgba(242,240,235,.96)',
        scrimBg: 'rgba(90,86,78,.3)',
        overlayBg: 'rgba(90,86,78,.3)',
        labelHalo: '#F2F0EB',
        graphBg: '#E1DDD5',
        graphEdge: '#C9C3B7',
        nodeCold: '#B6B0A4',
        nodeSelf: '#2E2C29',
        vignetteEdge: '#D8D3C9',
        termBg: '#2E2C29',
        termFg: '#E9E6E0',
        glowAccent: '0 0 0 1px rgba(78,127,115,0.16)',
        glowText: 'none',
        accentSoft: 'rgba(78,127,115,0.12)',
        onAccent: '#F2F0EB',
        categoryTeal: '#4E8079',
        categoryBlue: '#5A6E9E',
        categoryViolet: '#7A6AA0',
        categoryGreen: '#5E7F4B',
        categoryGold: '#A8863F',
        categoryRose: '#A85C7A',
        danger: '#A8503F',
        success: '#5E7F4B',
        warning: '#B54708',
    },
    cathode: {
        background: '#05070A',
        foreground: '#DDF3EA',
        neutral: '#6FA69A',
        accent: '#35F0E0',
        border: '#1B3A38',
        surface: '#0C1116',
        surface2: '#121A20',
        accentPalette: ['#FF5AA8', '#A96BFF', '#5A82F5', '#35E8E0', '#5CFA8A'],
        rail: '#020304',
        editor: '#070A0E',
        surface3: '#18242B',
        borderSoft: '#112524',
        faint: '#3F5F58',
        hoverBg: 'rgba(53,240,224,.07)',
        popBg: 'rgba(7,10,14,.82)',
        popBgStrong: 'rgba(7,10,14,.9)',
        scrimBg: 'rgba(0,0,0,.66)',
        overlayBg: 'rgba(0,0,0,.66)',
        labelHalo: '#05070A',
        graphBg: '#04070A',
        graphEdge: '#1B3A38',
        nodeCold: '#24504B',
        nodeSelf: '#DDF3EA',
        vignetteEdge: '#020405',
        termBg: '#020304',
        termFg: '#9FE6D8',
        // The one scope with bloom.
        glowAccent: '0 0 12px rgba(53,240,224,.35)',
        glowText: '0 0 8px rgba(53,240,224,.28)',
        accentSoft: 'rgba(53,240,224,0.12)',
        onAccent: '#05070A',
        categoryTeal: '#35E8E0',
        categoryBlue: '#5A82F5',
        categoryViolet: '#A96BFF',
        categoryGreen: '#5CFA8A',
        categoryGold: '#FFC23D',
        categoryRose: '#FF4FA3',
        danger: '#FF6B5A',
        success: '#5CFA8A',
        warning: '#FFC23D',
    },
    riso: {
        background: '#EAE4D4',
        foreground: '#22285E',
        neutral: '#5E628C',
        accent: '#2E36A8',
        border: '#B9AE92',
        surface: '#E3DCC8',
        surface2: '#DBD3BC',
        accentPalette: ['#C0387A', '#6B4FA8', '#2E36A8', '#2F7F86', '#5E8A3C'],
        isLight: true,
        rail: '#E1DACA',
        editor: '#F1ECDF',
        surface3: '#CFC5AA',
        borderSoft: '#CFC6AE',
        faint: '#948F86',
        hoverBg: 'rgba(34,40,94,.06)',
        popBg: 'rgba(241,236,223,.92)',
        popBgStrong: 'rgba(241,236,223,.97)',
        scrimBg: 'rgba(60,58,74,.28)',
        overlayBg: 'rgba(60,58,74,.28)',
        labelHalo: '#F1ECDF',
        graphBg: '#DBD3BC',
        graphEdge: '#BCB39A',
        nodeCold: '#AFA68E',
        nodeSelf: '#22285E',
        vignetteEdge: '#CFC6AE',
        termBg: '#22285E',
        termFg: '#EAE4D4',
        glowAccent: '0 0 0 1px rgba(46,54,168,.18)',
        glowText: 'none',
        accentSoft: 'rgba(46,54,168,0.12)',
        onAccent: '#F1ECDF',
        categoryTeal: '#2F7F86',
        categoryBlue: '#2E36A8',
        categoryViolet: '#6B4FA8',
        categoryGreen: '#5E8A3C',
        categoryGold: '#C08A2E',
        categoryRose: '#C0387A',
        danger: '#B03A2E',
        success: '#4F7A34',
        warning: '#A86A18',
    },
}

/** Per-theme `--accent` hex, derived from THEMES so it can never drift. Replaces the
 *  hand-mirrored table gcal/colors.ts used to resolve the `accent` category token. */
export const THEME_ACCENTS: Record<ThemeName, string> = Object.fromEntries(
    THEME_NAMES.map(n => [n, THEMES[n].accent]),
) as Record<ThemeName, string>

// ── Semantic status colors ────────────────────────────────────────────────────
// Invariant across a theme's hue but tuned per light/dark for legibility. Projected
// by settingsCssVars as --danger/--success/--warning so components stop hardcoding
// reds/greens. All four themes also set danger/success/warning explicitly on their
// own ColorTokens (semanticTokens() prefers those); these are the fallback pair for
// any future theme that omits them — ink's values (dark) and paper's (light).
export interface SemanticTokens {
    danger: string
    success: string
    warning: string
}
/** Dark fallback — the `.ink` scope's values. */
export const SEMANTIC_DARK: SemanticTokens = {
    danger: '#C87F72',
    success: '#A3BE8C',
    warning: '#CBB27E',
}
/** Light fallback — the `.paper` scope's values. */
export const SEMANTIC_LIGHT: SemanticTokens = {
    danger: '#A8503F',
    success: '#5E7F4B',
    warning: '#B54708',
}

// ── Elevation shadows ─────────────────────────────────────────────────────────
// Projected as --shadow-{menu,popup,card,modal}. Dark values are the ASCII redesign's
// design/ascii/design-system/tokens/effects.css values; light values are lighter +
// smaller-blur so light themes don't wear the dark themes' heavy near-black shadows.
export interface ShadowTokens {
    menu: string
    popup: string
    card: string
    modal: string
}
export const SHADOW_DARK: ShadowTokens = {
    menu: '0 4px 16px rgba(0,0,0,.3)',
    popup: '0 8px 24px rgba(0,0,0,.4)',
    card: '0 1px 0 rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.35)',
    modal: '0 24px 70px rgba(0,0,0,.5)',
}
export const SHADOW_LIGHT: ShadowTokens = {
    menu: '0 4px 12px rgba(16, 24, 40, 0.10)',
    popup: '0 8px 20px rgba(16, 24, 40, 0.12)',
    card: '0 12px 32px rgba(16, 24, 40, 0.12)',
    modal: '0 24px 64px rgba(16, 24, 40, 0.14)',
}

/** Resolve a theme name to its color tokens; unknown names fall back to the default.
 *  This is also the legacy-settings migration path: a vault's `.settings` saved under
 *  the pre-redesign 12-theme system (any of the old theme-name strings) is an unknown
 *  name here and silently resolves to DEFAULT_THEME ("ink") instead of throwing. */
export function resolveTheme(name: string): ColorTokens {
    return THEMES[name as ThemeName] ?? THEMES[DEFAULT_THEME]
}

/** Resolve the effective colors for an appearance subtree. Initial release: colors
 *  come entirely from the selected theme (no per-color overrides). */
export function resolveAppearance(a: { theme: string }): ColorTokens {
    return resolveTheme(a.theme)
}

/** The semantic status trio for a resolved theme: prefer the theme's own explicit
 *  danger/success/warning, else fall back to the light/dark pair. */
export function semanticTokens(t: ColorTokens): SemanticTokens {
    return {
        danger:
            t.danger ??
            (t.isLight ? SEMANTIC_LIGHT.danger : SEMANTIC_DARK.danger),
        success:
            t.success ??
            (t.isLight ? SEMANTIC_LIGHT.success : SEMANTIC_DARK.success),
        warning:
            t.warning ??
            (t.isLight ? SEMANTIC_LIGHT.warning : SEMANTIC_DARK.warning),
    }
}

/** The elevation shadow set for a resolved theme (light vs dark). */
export function shadowTokens(t: ColorTokens): ShadowTokens {
    return t.isLight ? SHADOW_LIGHT : SHADOW_DARK
}
