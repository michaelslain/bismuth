import { test, expect } from 'bun:test'
import {
    toDateStr,
    addDays,
    expandRecurrence,
    formatTime,
    startOfWeek,
    weekRange,
    rangeLabel,
    stepDate,
} from './dates'

test('toDateStr / addDays', () => {
    expect(toDateStr(new Date('2026-05-27T00:00:00'))).toBe('2026-05-27')
    expect(toDateStr(addDays(new Date('2026-05-27T00:00:00'), 5))).toBe(
        '2026-06-01',
    )
})

test('formatTime 12h', () => {
    expect(formatTime('13:05', false)).toBe('1:05')
    expect(formatTime('13:05', true)).toBe('13:05')
})

test('daily recurrence fills range', () => {
    const r = { type: 'daily' as const, startDate: '2026-05-01', seriesId: 's' }
    expect(expandRecurrence(r, '2026-05-01', '2026-05-03')).toEqual([
        '2026-05-01',
        '2026-05-02',
        '2026-05-03',
    ])
})

test('weekly recurrence honors daysOfWeek', () => {
    const r = {
        type: 'weekly' as const,
        startDate: '2026-05-01',
        daysOfWeek: [1],
        seriesId: 's',
    } // Mondays
    expect(expandRecurrence(r, '2026-05-01', '2026-05-31')).toEqual([
        '2026-05-04',
        '2026-05-11',
        '2026-05-18',
        '2026-05-25',
    ])
})

test('endDate truncates recurrence', () => {
    const r = {
        type: 'daily' as const,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        seriesId: 's',
    }
    expect(expandRecurrence(r, '2026-05-01', '2026-05-10')).toEqual([
        '2026-05-01',
        '2026-05-02',
    ])
})

test('monthly on the 31st clamps to the last day of shorter months', () => {
    const r = {
        type: 'monthly' as const,
        startDate: '2026-01-31',
        seriesId: 's',
    }
    expect(expandRecurrence(r, '2026-02-01', '2026-02-28')).toEqual([
        '2026-02-28',
    ]) // non-leap Feb
    expect(expandRecurrence(r, '2026-04-01', '2026-04-30')).toEqual([
        '2026-04-30',
    ]) // 30-day month
    expect(expandRecurrence(r, '2026-03-01', '2026-03-31')).toEqual([
        '2026-03-31',
    ]) // exact match
})

test('startOfWeek sundayFirst — 2026-05-27 (Wed) → 2026-05-24 (Sun)', () => {
    const d = new Date('2026-05-27T00:00:00')
    expect(toDateStr(startOfWeek(d, false))).toBe('2026-05-24')
})

test('startOfWeek mondayFirst — 2026-05-27 (Wed) → 2026-05-25 (Mon)', () => {
    const d = new Date('2026-05-27T00:00:00')
    expect(toDateStr(startOfWeek(d, true))).toBe('2026-05-25')
})

test('startOfWeek mondayFirst — on Monday itself returns same day', () => {
    const d = new Date('2026-05-25T00:00:00') // Monday
    expect(toDateStr(startOfWeek(d, true))).toBe('2026-05-25')
})

test('startOfWeek sundayFirst — on Sunday itself returns same day', () => {
    const d = new Date('2026-05-24T00:00:00') // Sunday
    expect(toDateStr(startOfWeek(d, false))).toBe('2026-05-24')
})

test('weekRange mondayFirst — correct start+end', () => {
    const d = new Date('2026-05-27T00:00:00') // Wednesday
    const [s, e] = weekRange(d, true)
    expect(s).toBe('2026-05-25')
    expect(e).toBe('2026-05-31')
})

test('weekRange sundayFirst — correct start+end', () => {
    const d = new Date('2026-05-27T00:00:00') // Wednesday
    const [s, e] = weekRange(d, false)
    expect(s).toBe('2026-05-24')
    expect(e).toBe('2026-05-30')
})

// ---- rangeLabel / stepDate: the toolbar's date vocabulary --------------------------------
// The toolbar shows ONE label slot and used to fill it two different ways — "January 2026" in
// month view, raw ISO ("2026-01-12 — 2026-01-18") in week/3-day/day. These pin the one
// vocabulary, and pin that the SHORT form (what a narrow pane renders) is genuinely shorter.

test('rangeLabel month — full month name long, abbreviated short', () => {
    const l = rangeLabel(new Date(2026, 0, 12), 'month', true)
    expect(l.long).toBe('January 2026')
    expect(l.short).toBe('Jan 2026')
})

test('rangeLabel week — a day span, not two ISO stamps', () => {
    const l = rangeLabel(new Date(2026, 0, 14), 'week', true)
    expect(l.long).toBe('12 – 18 Jan 2026')
    expect(l.short).toBe('12 – 18 Jan')
    // The defect this replaced: 23 chars of ISO, which is what forced the truncation.
    expect(l.long.length).toBeLessThan('2026-01-12 — 2026-01-18'.length)
})

test('rangeLabel week — sunday-first start differs from monday-first', () => {
    const d = new Date(2026, 0, 14) // a Wednesday
    expect(rangeLabel(d, 'week', false).long).toBe('11 – 17 Jan 2026')
})

test('rangeLabel span — repeats the month only when the ends disagree', () => {
    // Same month: named once, at the end.
    expect(rangeLabel(new Date(2026, 0, 14), 'week', true).long).toBe(
        '12 – 18 Jan 2026',
    )
    // Crossing a month boundary: both ends named, year still once.
    expect(rangeLabel(new Date(2026, 0, 28), 'week', true).long).toBe(
        '26 Jan – 1 Feb 2026',
    )
    // Crossing a year boundary: both ends carry their own year.
    expect(rangeLabel(new Date(2025, 11, 31), 'week', true).long).toBe(
        '29 Dec 2025 – 4 Jan 2026',
    )
})

test('rangeLabel 3day — a three-day span starting at the cursor', () => {
    const l = rangeLabel(new Date(2026, 0, 12), '3day', true)
    expect(l.long).toBe('12 – 14 Jan 2026')
    expect(l.short).toBe('12 – 14 Jan')
})

test('rangeLabel day — names the weekday, drops the year when short', () => {
    const l = rangeLabel(new Date(2026, 0, 12), 'day', true)
    expect(l.long).toBe('Mon 12 Jan 2026')
    expect(l.short).toBe('Mon 12 Jan')
})

test('rangeLabel — short is never longer than long, in every view', () => {
    const views = ['month', 'week', '3day', 'day'] as const
    for (const v of views) {
        const l = rangeLabel(new Date(2025, 11, 31), v, true)
        expect(l.short.length).toBeLessThanOrEqual(l.long.length)
    }
})

test('rangeLabel — does not mutate the date it is handed', () => {
    const d = new Date(2026, 0, 14)
    const before = d.getTime()
    rangeLabel(d, 'week', true)
    rangeLabel(d, '3day', true)
    expect(d.getTime()).toBe(before)
})

test('stepDate — each view moves in its own unit, both directions', () => {
    const d = new Date(2026, 0, 12)
    expect(toDateStr(stepDate(d, 'month', 1))).toBe('2026-02-12')
    expect(toDateStr(stepDate(d, 'month', -1))).toBe('2025-12-12')
    expect(toDateStr(stepDate(d, 'week', 1))).toBe('2026-01-19')
    expect(toDateStr(stepDate(d, '3day', 1))).toBe('2026-01-15')
    expect(toDateStr(stepDate(d, 'day', -1))).toBe('2026-01-11')
})

test('stepDate — does not mutate its input', () => {
    const d = new Date(2026, 0, 12)
    stepDate(d, 'month', 1)
    expect(toDateStr(d)).toBe('2026-01-12')
})
