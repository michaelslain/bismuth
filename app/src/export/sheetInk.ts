// app/src/export/sheetInk.ts
// The ink an export preview's PAPER carries. The sheet is a fixed print-cream when the export theme
// is light, whatever the app's own theme is — so the app's ink tokens (--fg is cream-on-dark in ink
// and cathode) cannot be left to inherit onto it: the app's `--fg` on this cream is 1.18:1 in ink
// and 1.07:1 in cathode. The sheet re-scopes the three ink tokens from the export palette instead
// (resolvePalette.readThemePalette), which is built for exactly this surface.
import type { ThemePalette } from './types'

/** Print paper — never a UI theme colour. ExportView's `--paper-bg` and the light theme swatch. */
export const SHEET_PAPER = '#f7f6f2'

/** The custom properties to set on the sheet so every descendant that reads the app's ink tokens
 *  (the loading line, the failure text, an EmptyState) reads palette ink instead. `--faint` takes
 *  the muted ink too: nothing on a sheet is structure-only, and the palette has no separate faint
 *  step that clears 4.5:1 on cream. */
export function sheetInkVars(palette: ThemePalette): Record<string, string> {
    return {
        '--fg': palette.fg,
        '--text-muted': palette.muted,
        '--faint': palette.muted,
    }
}

/** WCAG 2.x contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
    const lum = (hex: string): number => {
        const n = parseInt(hex.slice(1), 16)
        const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
            const c = v / 255
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl
    }
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}
