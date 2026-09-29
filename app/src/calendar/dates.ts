import { ViewType } from './types'
import { todayISO } from '../../../core/src/dates'

/** Parse an ISO `YYYY-MM-DD` as local midnight, the one date-string convention for this module. */
export function parseLocalDate(iso: string): Date {
    return new Date(iso + 'T00:00:00')
}

export function formatTime(time: string, military: boolean): string {
    if (military) return time
    const [h, m] = time.split(':').map(Number)
    const h12 = h % 12 || 12
    return `${h12}:${String(m).padStart(2, '0')}`
}

export function formatGutterHour(h: number, military: boolean): string {
    if (h === 0) return ''
    if (military) return `${h}:00`
    const h12 = h % 12 || 12
    const period = h < 12 ? 'AM' : 'PM'
    return `${h12} ${period}`
}

/** Format an ISO `YYYY-MM-DD` as a localized "Mon D, YYYY"; passes invalid input through. */
export function prettyDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) return iso
    return parseLocalDate(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

export function addDays(d: Date, n: number): Date {
    const result = new Date(d)
    result.setDate(result.getDate() + n)
    return result
}

/** Returns the first day of the ISO week (Monday) or Sunday week containing `d`. */
export function startOfWeek(d: Date, mondayFirst: boolean): Date {
    const offset = mondayFirst ? -((d.getDay() + 6) % 7) : -d.getDay()
    return addDays(d, offset)
}

/** Returns [startDateStr, endDateStr] for the week containing `d`. */
export function weekRange(d: Date, mondayFirst: boolean): [string, string] {
    const start = startOfWeek(d, mondayFirst)
    return [todayISO(start), todayISO(addDays(start, 6))]
}

/** The calendar toolbar's subject line: which slice of time is on screen.
 *
 *  TWO LENGTHS, deliberately. The toolbar collapses to the short form in a narrow pane through a
 *  container query, and CSS cannot rewrite text — so both strings are produced here and the bar
 *  hides one. Before this existed the toolbar built its label from `todayISO`, so week and 3-day
 *  read "2026-01-12 — 2026-01-18": 23 characters of ISO in a header slot, and the single reason
 *  the label ellipsized to "2026-…" at an ordinary split-pane width. Month meanwhile read
 *  "January 2026", so the same slot spoke two different vocabularies depending on the view. */
export type RangeLabel = { long: string; short: string }

const monthName = (d: Date, long: boolean) =>
    d.toLocaleString(undefined, { month: long ? 'long' : 'short' })

/** A day span with every component the two ends already agree on dropped:
 *  "12 – 18 Jan 2026" · "29 Jan – 4 Feb 2026" · "29 Dec 2025 – 4 Jan 2026". */
function spanLabel(a: Date, b: Date, withYear: boolean): string {
    const sameYear = a.getFullYear() === b.getFullYear()
    const year = (d: Date) => (withYear ? ` ${d.getFullYear()}` : '')
    if (sameYear && a.getMonth() === b.getMonth())
        return `${a.getDate()} – ${b.getDate()} ${monthName(b, false)}${year(b)}`
    const left = `${a.getDate()} ${monthName(a, false)}${sameYear ? '' : year(a)}`
    return `${left} – ${b.getDate()} ${monthName(b, false)}${year(b)}`
}

/** The label for the range `view` shows around `d`. Pure — the toolbar's only date logic. */
export function rangeLabel(
    d: Date,
    view: ViewType,
    mondayFirst: boolean,
): RangeLabel {
    if (view === 'month')
        return {
            long: `${monthName(d, true)} ${d.getFullYear()}`,
            short: `${monthName(d, false)} ${d.getFullYear()}`,
        }
    if (view === 'day') {
        const weekday = d.toLocaleString(undefined, { weekday: 'short' })
        const day = `${weekday} ${d.getDate()} ${monthName(d, false)}`
        return { long: `${day} ${d.getFullYear()}`, short: day }
    }
    const start = view === 'week' ? startOfWeek(d, mondayFirst) : new Date(d)
    const end = addDays(start, view === 'week' ? 6 : 2)
    return {
        long: spanLabel(start, end, true),
        short: spanLabel(start, end, false),
    }
}

/** How far one press of prev/next moves the cursor, in days — except `month`, which moves a
 *  calendar month rather than a fixed day count and is handled by the caller. */
export const VIEW_STEP_DAYS: Record<Exclude<ViewType, 'month'>, number> = {
    week: 7,
    '3day': 3,
    day: 1,
}

/** Move `d` one `dir` step in `view`'s own unit. Pure — returns a new Date. */
export function stepDate(d: Date, view: ViewType, dir: -1 | 1): Date {
    const next = new Date(d)
    if (view === 'month') next.setMonth(next.getMonth() + dir)
    else next.setDate(next.getDate() + dir * VIEW_STEP_DAYS[view])
    return next
}

/** Number of days in the calendar month containing `d` (local). */
function daysInMonth(d: Date): number {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/** One cell of a month grid: a real date, and whether it belongs to the shown month (the
 *  leading/trailing days that spill in from the neighbours are `inMonth: false`). */
export type MonthGridCell = { date: Date; inMonth: boolean }

/** The whole-week grid for `month` (0-based) of `year`: 5 or 6 rows of 7. Pure. */
export function monthGrid(
    year: number,
    month: number,
    mondayFirst: boolean,
): MonthGridCell[] {
    const firstOfMonth = new Date(year, month, 1)
    const weekStart = startOfWeek(firstOfMonth, mondayFirst)
    const lead = Math.round(
        (firstOfMonth.getTime() - weekStart.getTime()) / 86400000,
    )
    const inMonthDays = daysInMonth(firstOfMonth)
    const total = Math.ceil((lead + inMonthDays) / 7) * 7
    const cells: MonthGridCell[] = []
    for (let i = 0; i < total; i++) {
        const offset = i - lead
        cells.push({
            date: new Date(year, month, 1 + offset),
            inMonth: offset >= 0 && offset < inMonthDays,
        })
    }
    return cells
}

/** The seven short weekday names in display order, localized. 2023-01-01 is a Sunday. */
export function weekdayNames(
    weekStartsOnMonday: boolean,
    locale?: string,
): string[] {
    const first = weekStartsOnMonday ? 2 : 1
    return Array.from({ length: 7 }, (_, i) =>
        new Date(2023, 0, first + i).toLocaleString(locale, {
            weekday: 'short',
        }),
    )
}
