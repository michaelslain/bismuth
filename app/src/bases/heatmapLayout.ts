import type { HeatCell } from '../../../core/src/bases/chart'
import { addDaysISO } from '../../../core/src/dates'

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
