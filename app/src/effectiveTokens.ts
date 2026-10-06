// app/src/effectiveTokens.ts
// Pure: which design tokens the user (or the active custom theme) has OVERRIDDEN, and the
// `:root` custom properties that follow. Field tokens (colours read through ColorTokens) are
// NOT handled here — they arrive through resolveAppearance. Everything else projects straight
// onto :root, so a token edit retargets the live app with no component change.
import { tokenDef, type TokenMap } from '../../core/src/theme/designTokens'
import { FONT_STACKS, PROSE_SCALES, DEFAULT_PROSE_SCALE, type Settings } from './settings'

type ThemeOverrides = Readonly<Record<string, TokenMap>>

/** The overriding value for `key`: settings tokens > the active theme's non-field tokens; undefined = not overridden. */
export function tokenOverride(
    s: Settings,
    themeOverrides: ThemeOverrides,
    key: string,
): string | undefined {
    const own = s.appearance.tokens
    if (own && Object.hasOwn(own, key)) return own[key]
    const theme = themeOverrides[s.appearance.theme]
    if (theme && Object.hasOwn(theme, key)) return theme[key]
    return undefined
}

/** px number from a length override ('16px' → 16), else undefined; em/rem/%/calc → undefined (caller keeps its default). */
export function overridePx(v: string | undefined): number | undefined {
    if (v === undefined) return undefined
    const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim())
    return m ? Number(m[1]) : undefined
}

/** CSS custom-property map for every non-field override: `--key` → css value, applying the font-stack / prose-scale conversion. */
export function overrideVars(
    s: Settings,
    themeOverrides: ThemeOverrides,
): Record<string, string> {
    const merged: TokenMap = {
        ...themeOverrides[s.appearance.theme],
        ...s.appearance.tokens,
    }
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
        const def = tokenDef(key)
        if (!def || def.field) continue
        if (key === 'ui-font-stack') {
            const stack = FONT_STACKS[value]
            if (stack) out['--ui-font-stack'] = stack
        } else if (key === 'prose-font') {
            const stack = FONT_STACKS[value]
            if (stack) {
                out['--prose-font'] = stack
                if (!('prose-scale' in merged))
                    out['--prose-scale'] = String(
                        PROSE_SCALES[value] ?? DEFAULT_PROSE_SCALE,
                    )
            }
        } else out[`--${key}`] = value
    }
    return out
}
