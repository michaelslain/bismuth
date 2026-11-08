// Digest notes: day-YYYY-MM-DD, week-YYYY-Www (ISO week) and month-YYYY-MM, written with type
// daily, plus the single `now` note. Pure: dates are plain YYYY-MM-DD strings on the local
// calendar (callers get "today" from todayISO); arithmetic runs in UTC only to dodge DST.
import type { MemoryNote } from './graph'

export type DigestPeriod = 'day' | 'week' | 'month'
export type DigestRef = { period: DigestPeriod; name: string; start: string; end: string }
export type Rollup = { into: string; from: string[] }

export const NOW_NOTE = 'now'
export const isNowNote = (n: MemoryNote): boolean => n.name === NOW_NOTE && n.frontmatter.type === 'now'

const DAY_MS = 86400000
const ROLLUP_DAY_AGE = 30
const ROLLUP_WEEK_AGE = 182

const p2 = (n: number): string => String(n).padStart(2, '0')
const toUtc = (iso: string): Date => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)))
const fromUtc = (d: Date): string => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`

export const addDaysISO = (iso: string, n: number): string => fromUtc(new Date(toUtc(iso).getTime() + n * DAY_MS))
/** Whole days from a to b (b later = positive). */
export const daysBetweenISO = (a: string, b: string): number => Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / DAY_MS)
/** 0 = Monday .. 6 = Sunday. */
export const weekdayISO = (iso: string): number => (toUtc(iso).getUTCDay() + 6) % 7

function validDate(iso: string): boolean {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    return !!m && fromUtc(toUtc(iso)) === iso && +m[2]! >= 1
}

function isoWeekOf(iso: string): { year: number; week: number } {
    const thursday = toUtc(addDaysISO(iso, 3 - weekdayISO(iso)))
    const year = thursday.getUTCFullYear()
    const jan1 = Date.UTC(year, 0, 1)
    return { year, week: Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1 }
}

const weekStart = (year: number, week: number): string => {
    const jan4 = fromUtc(new Date(Date.UTC(year, 0, 4)))
    return addDaysISO(addDaysISO(jan4, -weekdayISO(jan4)), (week - 1) * 7)
}

const weeksInYear = (year: number): number => isoWeekOf(`${year}-12-28`).week

export function digestName(period: DigestPeriod, date: string): string {
    if (period === 'day') return `day-${date}`
    if (period === 'month') return `month-${date.slice(0, 7)}`
    const { year, week } = isoWeekOf(date)
    return `week-${year}-W${p2(week)}`
}

export function parseDigestName(name: string): DigestRef | null {
    let m = /^day-(\d{4}-\d{2}-\d{2})$/.exec(name)
    if (m) return validDate(m[1]!) ? { period: 'day', name, start: m[1]!, end: m[1]! } : null
    m = /^week-(\d{4})-W(\d{2})$/.exec(name)
    if (m) {
        const year = +m[1]!
        const week = +m[2]!
        if (week < 1 || week > weeksInYear(year)) return null
        const start = weekStart(year, week)
        return { period: 'week', name, start, end: addDaysISO(start, 6) }
    }
    m = /^month-(\d{4})-(\d{2})$/.exec(name)
    if (m) {
        const month = +m[2]!
        if (month < 1 || month > 12) return null
        const start = `${m[1]}-${m[2]}-01`
        return { period: 'month', name, start, end: fromUtc(new Date(Date.UTC(+m[1]!, month, 0))) }
    }
    return null
}

/** Exact name pattern AND type daily: `day-notes` and `2026-11-06-day` are ordinary notes. */
export const isDigestNote = (n: MemoryNote): boolean => n.frontmatter.type === 'daily' && parseDigestName(n.name) !== null

const SPECIFICITY: Record<DigestPeriod, number> = { day: 0, week: 1, month: 2 }

/** For each date in the range, the most specific digest note holding it (day, else week, else month). */
export function digestsCovering(notes: MemoryNote[], start: string, end: string): MemoryNote[] {
    const refs = notes.flatMap(n => {
        const ref = isDigestNote(n) ? parseDigestName(n.name) : null
        return ref ? [{ n, ref }] : []
    })
    const picked = new Map<string, { n: MemoryNote; ref: DigestRef }>()
    for (let d = start; d <= end; d = addDaysISO(d, 1)) {
        const best = refs
            .filter(r => r.ref.start <= d && d <= r.ref.end)
            .sort((a, b) => SPECIFICITY[a.ref.period] - SPECIFICITY[b.ref.period])[0]
        if (best) picked.set(best.n.name, best)
    }
    return [...picked.values()]
        .sort((a, b) => SPECIFICITY[a.ref.period] - SPECIFICITY[b.ref.period] || a.ref.start.localeCompare(b.ref.start))
        .map(r => r.n)
}

/** Old day notes fold into their week; old week notes into the month holding their Thursday. */
export function rollupPlan(notes: MemoryNote[], today: string): Rollup[] {
    const groups = new Map<string, string[]>()
    const push = (into: string, from: string) => groups.set(into, [...(groups.get(into) ?? []), from])
    for (const n of notes) {
        const ref = isDigestNote(n) ? parseDigestName(n.name) : null
        if (!ref) continue
        if (ref.period === 'day' && daysBetweenISO(ref.end, today) > ROLLUP_DAY_AGE) push(digestName('week', ref.start), n.name)
        else if (ref.period === 'week' && daysBetweenISO(ref.end, today) >= ROLLUP_WEEK_AGE) push(`month-${addDaysISO(ref.start, 3).slice(0, 7)}`, n.name)
    }
    return [...groups]
        .map(([into, from]) => ({ into, from: from.sort() }))
        .sort((a, b) => a.into.localeCompare(b.into))
}
