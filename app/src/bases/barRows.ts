import { formatValue } from '../../../core/src/bases/chartText'

export type BarRow = {
    key: string
    label: string
    fill: number
    track: number
    value: string
}

/**
 * Lays out one meter row per point on a `columns`-wide character grid: `<label>  <fill><track>
 * <value>` (bases-bar.card.html). The label column is right-padded to the longest label, the
 * value column left-padded to the widest formatted value, and `fill + track` fills whatever
 * width is left after those two columns plus two 2-space gutters (4 columns). `fill` scales
 * `max(0, value)` against the largest value in the set — a negative value draws no fill, and an
 * all-zero set (max === 0) draws no fill rather than dividing by zero.
 */
export function layoutBars(
    points: { key: string; label: string; value: number }[],
    columns: number,
): BarRow[] {
    if (points.length === 0) return []

    const labelWidth = points.reduce((w, p) => Math.max(w, p.label.length), 0)
    const formatted = points.map(p => formatValue(p.value))
    const valueWidth = formatted.reduce((w, v) => Math.max(w, v.length), 0)
    const barWidth = columns - labelWidth - valueWidth - 4
    const max = points.reduce((m, p) => Math.max(m, p.value), 0)

    return points.map((p, i) => {
        const fill = max > 0 ? Math.round((Math.max(0, p.value) / max) * barWidth) : 0
        const track = barWidth - fill
        return {
            key: p.key,
            label: p.label.padEnd(labelWidth),
            fill,
            track,
            value: formatted[i].padStart(valueWidth),
        }
    })
}
