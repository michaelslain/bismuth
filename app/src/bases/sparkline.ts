import type { Bin } from '../../../core/src/dates'
import { formatValue } from '../../../core/src/bases/chartText'

// A 12-bin sparkline of a stat metric's history, rendered as plain text (bases-stat.card.html:
// the "Typed, not drawn" north star — no SVG, no canvas for this either).
const GLYPHS = '▁▂▃▄▅▆▇█'
const LOWEST = GLYPHS[0]
const MID = GLYPHS[Math.floor((GLYPHS.length - 1) / 2)]

/**
 * One glyph per entry, scaled linearly over the series' own min…max: `null` (a bin with no
 * matching rows) always renders the lowest glyph, and a series whose non-null values are all
 * equal (including a single value) renders them all at the mid glyph — there is no range to
 * place them within.
 */
export function sparkline(series: (number | null)[]): string {
    if (series.length === 0) return ''
    const nums = series.filter((n): n is number => n !== null)
    if (nums.length === 0) return series.map(() => LOWEST).join('')
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    if (min === max) return series.map(v => (v === null ? LOWEST : MID)).join('')
    return series
        .map(v => {
            if (v === null) return LOWEST
            const t = (v - min) / (max - min)
            const idx = Math.round(t * (GLYPHS.length - 1))
            return GLYPHS[idx]
        })
        .join('')
}

/** The sparkline's faint window caption, e.g. "last 12 weeks" — names the bin word so a
 *  reader who has never seen the chart knows what each glyph spans. */
export function sparklineCaption(bin: Bin, binCount: number): string {
    return `last ${binCount} ${bin}s`
}

/** The tile's period line while a sparkline glyph is hovered, e.g. `week of Jun 8 // 5` —
 *  replaces the tile's normal `X this week // Y last week` line for as long as the hover
 *  lasts. `null` renders as `—`, matching StatTiles' own empty-value convention. */
export function hoverPeriodText(bin: Bin, label: string, value: number | null): string {
    return `${bin} of ${label} // ${value === null ? '—' : formatValue(value)}`
}
