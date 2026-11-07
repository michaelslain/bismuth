// app/src/ui/monthCalendarModel.ts
// Pure date logic behind MonthCalendar.tsx: the grid it draws, the month a step lands on, and
// where a grid key moves the focused day. No framework imports, so it is unit-tested directly.
// The grid itself is calendar/dates.ts's `monthGrid`, the same one the calendar's month view uses.
import { addDaysISO, todayISO } from '../../../core/src/dates'
import { monthGrid, weekdayNames } from '../calendar/dates'

export type MonthRef = { year: number; month: number }

export type MonthCalendarCell = { iso: string; day: number; inMonth: boolean }

/** The month an ISO `YYYY-MM-DD` falls in; an empty or malformed value falls back to `fallback`. */
export function monthOf(iso: string, fallback: string): MonthRef {
    const m = /^(\d{4})-(\d{2})-\d{2}/.exec(iso) ?? /^(\d{4})-(\d{2})-\d{2}/.exec(fallback)
    if (!m) return { year: 1970, month: 0 }
    return { year: Number(m[1]), month: Number(m[2]) - 1 }
}

/** `ref` moved by `delta` months, carrying across years. */
export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
    const n = ref.year * 12 + ref.month + delta
    return { year: Math.floor(n / 12), month: ((n % 12) + 12) % 12 }
}

/** Every cell of the month's whole-week grid as ISO dates. */
export function calendarCells(ref: MonthRef, mondayFirst: boolean): MonthCalendarCell[] {
    return monthGrid(ref.year, ref.month, mondayFirst).map(c => ({
        iso: todayISO(c.date),
        day: c.date.getDate(),
        inMonth: c.inMonth,
    }))
}

/** The header label, lowercase: "august 2026". */
export function monthLabel(ref: MonthRef, locale?: string): string {
    return new Date(ref.year, ref.month, 1)
        .toLocaleString(locale, { month: 'long', year: 'numeric' })
        .toLowerCase()
}

/** The weekday column heads, two letters, lowercase: "mo tu we …". */
export function weekdayHeads(mondayFirst: boolean, locale?: string): string[] {
    return weekdayNames(mondayFirst, locale).map(n => n.slice(0, 2).toLowerCase())
}

/** `iso` moved by `delta` months, its day clamped to the target month's length (Jan 31 + 1 → Feb 28). */
export function addMonthsISO(iso: string, delta: number): string {
    const [y, m, d] = iso.split('-').map(Number)
    const to = shiftMonth({ year: y, month: m - 1 }, delta)
    const last = new Date(to.year, to.month + 1, 0).getDate()
    return todayISO(new Date(to.year, to.month, Math.min(d, last)))
}

// The grid's own spatial keys (the WAI-ARIA date grid pattern), not rebindable commands — the
// same standing ui/popover/createMenuNav.ts's arrows have.
const DAY_STEPS: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
}
const MONTH_STEPS: Record<string, number> = { PageUp: -1, PageDown: 1 }

/** Where a key moves the focused day, or null when the key is not a grid move. */
export function moveFocus(iso: string, key: string): string | null {
    if (key in DAY_STEPS) return addDaysISO(iso, DAY_STEPS[key])
    if (key in MONTH_STEPS) return addMonthsISO(iso, MONTH_STEPS[key])
    return null
}
