import { test, expect } from 'bun:test'
import { todayISO } from '../src/dates'
import {
    expandRecurrence,
    matchesRecurrence,
    addDays,
    type Recurrence,
} from '../src/bases/recurrence'

// The pre-optimisation algorithm: walk day by day from the series start.
function expandFromSeriesStart(
    r: Recurrence,
    rangeStart: string,
    rangeEnd: string,
): string[] {
    const out: string[] = []
    const start = new Date(r.startDate + 'T00:00:00')
    const end = r.endDate
        ? new Date(r.endDate + 'T00:00:00')
        : new Date('2100-01-01')
    const rStart = new Date(rangeStart + 'T00:00:00')
    const rEnd = new Date(rangeEnd + 'T00:00:00')
    let cursor = new Date(start)
    while (cursor <= end && cursor <= rEnd) {
        if (cursor >= rStart && matchesRecurrence(r, todayISO(cursor)))
            out.push(todayISO(cursor))
        cursor = addDays(cursor, 1)
    }
    return out
}

const base = { startDate: '2021-03-31', seriesId: 's' }
const series: Recurrence[] = [
    { ...base, type: 'daily' },
    { ...base, type: 'weekly' },
    { ...base, type: 'weekly', daysOfWeek: [1, 3, 5] },
    { ...base, type: 'biweekly' },
    { ...base, type: 'biweekly', daysOfWeek: [0, 4] },
    { ...base, type: 'monthly' },
    { ...base, type: 'monthly', endDate: '2026-04-15' },
]
const ranges: [string, string][] = [
    ['2026-02-01', '2026-02-28'],
    ['2026-09-01', '2026-09-30'],
    ['2026-03-30', '2026-05-03'],
    ['2021-03-01', '2021-04-10'], // straddles the series start
    ['2020-01-01', '2020-01-31'], // entirely before the series
    ['2026-09-15', '2026-09-15'],
]

for (const r of series) {
    test(`range-only walk matches full walk: ${r.type} ${r.daysOfWeek ?? ''} ${r.endDate ?? ''}`, () => {
        for (const [a, b] of ranges)
            expect(expandRecurrence(r, a, b)).toEqual(
                expandFromSeriesStart(r, a, b),
            )
    })
}

test('a 5-year-old biweekly series keeps its parity from the start date', () => {
    const r: Recurrence = { ...base, type: 'biweekly', startDate: '2021-09-06' }
    const got = expandRecurrence(r, '2026-09-01', '2026-09-30')
    expect(got.length).toBeGreaterThan(0)
    for (const d of got) {
        const days = Math.round(
            (new Date(d + 'T00:00:00').getTime() -
                new Date('2021-09-06T00:00:00').getTime()) /
                86400000,
        )
        expect(Math.floor(days / 7) % 2).toBe(0)
    }
})
