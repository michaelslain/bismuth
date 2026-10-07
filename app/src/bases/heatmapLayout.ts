import type { HeatCell } from '../../../core/src/bases/chart'
import { formatValue } from '../../../core/src/bases/chartText'
import { addDaysISO } from '../../../core/src/dates'

// Density glyph per intensity tier — a year of activity, one character per day
// (bases-heatmap.card.html): "intensity is the glyph, never the cell size." `.` is reserved for
// a day with NO data at all; the three non-zero tiers below split (min..max] into equal bands —
// unlike an earlier version of this scale, no positive value collapses back onto the `.`/`lv0`
// no-data glyph, which is what made the legend meaningless (a low day looked identical to an
// empty one, in the same colour).
export const GLYPHS = ['-', '+', '#'] as const
export const LEVEL_CLASS = ['lv0', 'lv1', 'lv2', 'lv3'] // index 0 = no data

/** The two thresholds that split a data range into the three non-zero tiers: a value below the
 *  first is tier 1, from the first up to (not including) the second is tier 2, from the second up
 *  is tier 3. `levelOf` buckets with exactly these and `legendRanges` prints exactly these, so the
 *  legend cannot describe a different split than the grid paints. */
export function levelEdges(min: number, max: number): [number, number] {
    const span = max - min
    return [min + span / 3, min + (2 * span) / 3]
}

export function levelOf(v: number | null, min: number, max: number): number {
    if (v === null || v <= 0) return 0
    const [e1, e2] = levelEdges(min, max)
    // min === max puts both edges on the value itself, so a lone value is the top tier.
    return v >= e2 ? 3 : v >= e1 ? 2 : 1
}

export function glyphOf(level: number): string {
    return level === 0 ? '.' : GLYPHS[Math.min(GLYPHS.length - 1, level - 1)]
}

export interface LegendEntry {
    level: number
    glyph: string
    levelClass: string
    /** `"none"` for the no-data tier, else the inclusive band of values that paint this glyph
     *  (a single value when the band is one wide). */
    range: string
}

/**
 * The legend's numeric meaning per glyph, derived from the SAME thresholds `levelOf` buckets a
 * value with (`levelEdges`) — so the legend can never drift from what a square's glyph actually
 * means. A tier no value can land in is left out rather than printed, and when `min === max` the
 * single value paints the top tier, so the legend is `. none` and ONE `#` entry.
 *
 * Whole-number data (counts) prints exact inclusive integer bands, each located by asking
 * `levelOf` itself; fractional data prints the band's edges.
 */
export function legendRanges(min: number, max: number): LegendEntry[] {
    const none: LegendEntry = { level: 0, glyph: '.', levelClass: 'lv0', range: 'none' }
    if (max <= 0) return [none]
    const entry = (level: number, range: string): LegendEntry => ({
        level,
        glyph: glyphOf(level),
        levelClass: LEVEL_CLASS[level],
        range,
    })
    if (min === max) return [none, entry(3, formatValue(max))]

    const [e1, e2] = levelEdges(min, max)
    const entries: LegendEntry[] = [none]
    if (Number.isInteger(min) && Number.isInteger(max)) {
        const floor = Math.max(1, min)
        const starts = [floor, Math.ceil(e1), Math.ceil(e2)]
        const ends = [Math.ceil(e1) - 1, Math.ceil(e2) - 1, max]
        for (let level = 1; level <= 3; level++) {
            let lo = Math.max(floor, starts[level - 1])
            let hi = Math.min(max, ends[level - 1])
            while (lo <= hi && levelOf(lo, min, max) < level) lo++
            while (hi >= lo && levelOf(hi, min, max) > level) hi--
            if (lo > hi) continue
            entries.push(entry(level, lo === hi ? String(lo) : `${lo}–${hi}`))
        }
        return entries
    }
    const edges = [Math.max(min, 0), e1, e2, max]
    for (let level = 1; level <= 3; level++)
        entries.push(entry(level, `${formatValue(edges[level - 1])}–${formatValue(edges[level])}`))
    return entries
}

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const DOW_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** `Tue Jul 8`-style label for an ISO date — the hover readout's bucket label. */
export function dayLabel(iso: string): string {
    const d = new Date(iso.slice(0, 10) + 'T00:00:00')
    return `${DOW_ABBR[d.getDay()]} ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`
}

/**
 * How many trailing weeks of history the grid should span for a `columns`-wide chart body.
 * Each week is a 2-character-pitch column (glyph + space); `columns - 2` reserves the 2-char
 * day-of-week gutter. Clamped to at least 1 week and at most a year (53 weeks). The grid always
 * ends on the week holding the later of `today` and the latest dated point, so stale data (its
 * most recent entry long past) still ends the grid at today rather than stretching it forward.
 */
export function heatmapRange(
    columns: number,
    latestData: string | null,
    today: string,
): { start: string; end: string } {
    const weeks = Math.min(53, Math.max(1, Math.floor((columns - 2) / 2)))
    const end = latestData && latestData > today ? latestData : today
    const start = addDaysISO(end, -(weeks * 7 - 1))
    return { start, end }
}

/**
 * One label per week column: the month name on the column containing that month's 1st, blank
 * elsewhere. A label with no blank column of clearance before the next one is dropped, keeping
 * the later (fuller) month over an earlier sliver — mirrors GitHub's sparse month row.
 */
export function monthLabels(weeks: HeatCell[][]): string[] {
    const raw = weeks.map(week => {
        for (const cell of week) {
            if (Number(cell.date.slice(8, 10)) === 1) {
                const m = Number(cell.date.slice(5, 7)) - 1
                return MONTH_NAMES[m] ?? ''
            }
        }
        return ''
    })
    let lastKept = -Infinity
    for (let i = 0; i < raw.length; i++) {
        if (!raw[i]) continue
        if (i - lastKept < 2) raw[lastKept] = ''
        lastKept = i
    }
    return raw
}

/**
 * Entries/current-streak/longest-streak over day-binned points. A day "counts" when its value is
 * > 0. `current` is the run ending at the most recent entry — only a live streak when that entry
 * is today (or yesterday, with today still open); otherwise the chain has lapsed and it's 0.
 */
export function streaks(
    points: { date?: string; value: number }[],
    today: string,
): { entries: number; current: number; longest: number } {
    const dates = points
        .filter(p => p.date && p.value > 0)
        .map(p => p.date as string)
        .sort()
    const entries = dates.length
    let longest = 0
    let current = 0
    let prev: string | null = null
    for (const d of dates) {
        current = prev !== null && addDaysISO(prev, 1) === d ? current + 1 : 1
        if (current > longest) longest = current
        prev = d
    }
    if (prev !== null && prev !== today && prev !== addDaysISO(today, -1))
        current = 0
    return { entries, current, longest }
}
