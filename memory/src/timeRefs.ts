// Time words in a prompt -> date ranges (local calendar). Pure; `now` is the caller's clock.
// Conservative on purpose: a bare weekday or month name is not a time reference ("Monday.com",
// "may I ask"); it needs `on`/`last`, a possessive, or a day number.
import { todayISO } from './dates'
import { addDaysISO, weekdayISO } from './digests'

export type TimeRange = { start: string; end: string; label: string }

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const CODE_CONTEXT = '(?!\\s+(?:button|view|column|tab|filter|header|places|default|steps)\\b)(?!\\s*[=(])'
const APOS = "['\u2019]"
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

const WD = WEEKDAYS.join('|')
const MON_FULL = MONTHS.join('|')
const MON_ABBR = 'jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec'
const MON = `${MON_FULL}|${MON_ABBR}`
const NUM = `\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')}`

const monthOf = (word: string): number => {
    const w = word.toLowerCase()
    const i = MONTHS.indexOf(w)
    return i >= 0 ? i : MONTHS.findIndex(m => m.startsWith(w.slice(0, 3)))
}

function lastDayOfMonth(year: number, month0: number): string {
    return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()).padStart(2, '0')}`
}

/** The most recent past occurrence (today counts) of month/day, or null for an impossible date. */
function monthDay(month0: number, day: number, today: string): string | null {
    const year = +today.slice(0, 4)
    for (const y of [year, year - 1]) {
        const iso = `${y}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        if (day >= 1 && day <= +lastDayOfMonth(y, month0).slice(8) && iso <= today) return iso
    }
    return null
}

type Hit = { index: number; length: number; range: [string, string] | null }

export function timeRefs(text: string, now: Date): TimeRange[] {
    const today = todayISO(now)
    const monday = addDaysISO(today, -weekdayISO(today))
    const lower = text.toLowerCase()
    const hits: Hit[] = []
    const used: [number, number][] = []
    const free = (i: number, l: number) => used.every(([s, e]) => i + l <= s || i >= e)
    const add = (m: RegExpExecArray, range: [string, string] | null) => {
        if (!range || !free(m.index, m[0].length)) return
        used.push([m.index, m.index + m[0].length])
        hits.push({ index: m.index, length: m[0].length, range })
    }
    const scan = (re: RegExp, f: (m: RegExpExecArray) => [string, string] | null) => {
        for (const m of lower.matchAll(re)) add(m as RegExpExecArray, f(m as RegExpExecArray))
    }
    const day = (iso: string): [string, string] => [iso, iso]
    const dayAgo = (n: number): [string, string] => day(addDaysISO(today, -n))
    const pastWeekday = (name: string, allowToday: boolean): [string, string] => {
        const back = (weekdayISO(today) - WEEKDAYS.indexOf(name) + 7) % 7
        return dayAgo(back === 0 && !allowToday ? 7 : back)
    }

    // explicit dates first so their digits never read as day counts
    scan(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g, m => {
        const iso = `${m[1]}-${m[2]}-${m[3]}`
        const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!))
        return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]! ? day(iso) : null
    })
    scan(new RegExp(`\\b(${MON})\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b(?![:.%\\d])${CODE_CONTEXT}`, 'g'), m => {
        const iso = monthDay(monthOf(m[1]!), +m[2]!, today)
        return iso ? day(iso) : null
    })
    scan(new RegExp(`\\b(\\d{1,2})(?:(st|nd|rd|th)(?: of)?| of)? (${MON_FULL.replace('|may', '')}|${MON_ABBR})\\b${CODE_CONTEXT}|\\b(\\d{1,2})(?:st|nd|rd|th)(?: of)? (may)\\b${CODE_CONTEXT}`, 'g'), m => {
        const iso = monthDay(monthOf(m[3] ?? m[5]!), +(m[1] ?? m[4]!), today)
        return iso ? day(iso) : null
    })
    scan(/\blast weekend\b/g, () => {
        const sat = addDaysISO(monday, -2)
        return [sat, addDaysISO(sat, 1)]
    })
    scan(/\blast week\b/g, () => [addDaysISO(monday, -7), addDaysISO(monday, -1)])
    scan(new RegExp(`\\bthis week\\b${CODE_CONTEXT}`, 'g'), () => [monday, today])
    scan(/\blast month\b/g, () => {
        const y = +today.slice(0, 4)
        const m0 = +today.slice(5, 7) - 2
        const first = new Date(Date.UTC(y, m0, 1))
        return [first.toISOString().slice(0, 10), lastDayOfMonth(first.getUTCFullYear(), first.getUTCMonth())]
    })
    scan(new RegExp(`\\bthis month\\b${CODE_CONTEXT}`, 'g'), () => [`${today.slice(0, 7)}-01`, today])
    scan(/\bthe other day\b/g, () => [addDaysISO(today, -4), addDaysISO(today, -2)])
    scan(new RegExp(`\\b(${NUM}) days? ago\\b`, 'g'), m => {
        const n = NUMBER_WORDS[m[1]!] ?? +m[1]!
        return n >= 1 ? dayAgo(n) : null
    })
    scan(/\byesterday\b/g, () => dayAgo(1))
    scan(new RegExp(`\\btoday\\b${CODE_CONTEXT}`, 'g'), () => day(today))
    scan(new RegExp(`\\blast (${WD})\\b(?!\\.[a-z])`, 'g'), m => pastWeekday(m[1]!, false))
    scan(new RegExp(`\\bon (${WD})\\b(?!\\.[a-z])`, 'g'), m => pastWeekday(m[1]!, true))
    scan(new RegExp(`\\b(${WD})${APOS}s\\b`, 'g'), m => pastWeekday(m[1]!, true))

    return hits
        .sort((a, b) => a.index - b.index)
        .map(h => {
            const [start, end] = h.range!
            const phrase = text.slice(h.index, h.index + h.length).toLowerCase().replace(/['\u2019]s$/, '')
            const when = start === end ? start : `${start}..${end}`
            return { start, end, label: /^\d{4}-/.test(phrase) ? phrase : `${phrase} (${when})` }
        })
}
