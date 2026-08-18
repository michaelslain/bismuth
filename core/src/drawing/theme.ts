import type { ThemeColors } from './model'
import { THEMES, DEFAULT_THEME } from '../theme/tokens'

// Which named theme supplies the paper/ink for each coarse light/dark bucket the drawing
// callers pass (headless export + canvas both work in "dark"|"light", not a theme name).
const LIGHT_THEME = 'paper'

/** Resolve the document paper/ink colors for a theme bucket, sourced from the color source
 *  of truth (core/src/theme/tokens.ts) so a drawing's paper + default ink track the app theme
 *  instead of a hand-copied literal that had drifted from it. `border`/`borderSoft` feed the
 *  paper ground (see `paperLineColor`/`paperDotColor` below), tracking the theme's own
 *  hairline tokens instead of a derived alpha wash. */
export function themeColors(theme: 'dark' | 'light'): ThemeColors {
    const t = theme === 'light' ? THEMES[LIGHT_THEME] : THEMES[DEFAULT_THEME]
    return {
        bg: t.background,
        fg: t.foreground,
        border: t.border,
        borderSoft: t.borderSoft ?? t.border,
    }
}

/** "fg" => theme ink; any explicit hex passes through. */
export function makeColorResolver(t: ThemeColors): (c: string) => string {
    return c => (c === 'fg' ? t.fg : c)
}

/** Grid/ruled line color = the theme's soft-border hairline token (never plain `border`),
 *  matching design/ascii-extended's paper ground (PORTING.md §2c: "all from --border-soft
 *  at a 14px pitch"). */
export function paperLineColor(t: ThemeColors): string {
    return t.borderSoft
}

/** Dot paper color = the theme's border token (design/ascii-extended's dot ground reads
 *  `--border`, not `--border-soft`, unlike grid/ruled). */
export function paperDotColor(t: ThemeColors): string {
    return t.border
}
