import { describe, test, expect } from 'bun:test'
import type { MemoryNote } from '../src/graph.ts'
import { digestName, parseDigestName, isDigestNote, digestsCovering, rollupPlan, NOW_NOTE, isNowNote } from '../src/digests.ts'

const note = (name: string, type: string = 'daily'): MemoryNote => ({
    name,
    frontmatter: { type: type as MemoryNote['frontmatter']['type'], tags: [], created: '2026-01-01', updated: '2026-01-01' },
    content: '',
    backlinks: [],
})

describe('parseDigestName', () => {
    test('accepts the three exact patterns', () => {
        expect(parseDigestName('day-2026-11-06')).toEqual({ period: 'day', name: 'day-2026-11-06', start: '2026-11-06', end: '2026-11-06' })
        expect(parseDigestName('week-2026-W45')).toEqual({ period: 'week', name: 'week-2026-W45', start: '2026-11-02', end: '2026-11-08' })
        expect(parseDigestName('month-2026-02')).toEqual({ period: 'month', name: 'month-2026-02', start: '2026-02-01', end: '2026-02-28' })
        expect(parseDigestName('month-2028-02')!.end).toBe('2028-02-29')
    })

    test('rejects near misses', () => {
        for (const bad of [
            'day-2026-13-01', 'days-2026-11-06', 'day-2026-11-06-final', 'day-2026-02-30', 'Day-2026-11-06',
            'week-2026-W00', 'week-2026-W54', 'week-2025-W53', 'week-2026-45', 'month-2026-13', 'month-2026-00',
            'month-2026-11-01', '2026-11-06-day', 'day-notes', 'folder/day-2026-11-06', '',
        ])
            expect(parseDigestName(bad)).toBeNull()
    })

    test('week 53 exists only in long years', () => {
        expect(parseDigestName('week-2025-W53')).toBeNull()
        expect(parseDigestName('week-2020-W53')).toEqual({ period: 'week', name: 'week-2020-W53', start: '2020-12-28', end: '2021-01-03' })
    })

    test('week 1 can start in the previous year', () => {
        expect(parseDigestName('week-2025-W01')!.start).toBe('2024-12-30')
    })
})

describe('digestName', () => {
    test('names the period containing a date', () => {
        expect(digestName('day', '2026-11-06')).toBe('day-2026-11-06')
        expect(digestName('week', '2026-11-06')).toBe('week-2026-W45')
        expect(digestName('week', '2024-12-30')).toBe('week-2025-W01')
        expect(digestName('week', '2021-01-01')).toBe('week-2020-W53')
        expect(digestName('month', '2026-11-06')).toBe('month-2026-11')
    })
})

describe('isDigestNote / isNowNote', () => {
    test('needs the exact name and type daily', () => {
        expect(isDigestNote(note('day-2026-11-06'))).toBe(true)
        expect(isDigestNote(note('day-2026-11-06', 'fact'))).toBe(false)
        expect(isDigestNote(note('day-notes'))).toBe(false)
        expect(isDigestNote(note('2026-11-06-day'))).toBe(false)
    })

    test('now note', () => {
        expect(NOW_NOTE).toBe('now')
        expect(isNowNote(note('now', 'now'))).toBe(true)
        expect(isNowNote(note('now', 'fact'))).toBe(false)
        expect(isNowNote(note('nowhere', 'now'))).toBe(false)
    })
})

describe('digestsCovering', () => {
    const names = (ns: MemoryNote[]) => ns.map(n => n.name)

    test('returns the day notes that exist', () => {
        const ns = [note('day-2026-11-03'), note('day-2026-11-05'), note('day-2026-11-09'), note('other', 'fact')]
        expect(names(digestsCovering(ns, '2026-11-02', '2026-11-08'))).toEqual(['day-2026-11-03', 'day-2026-11-05'])
    })

    test('a day with no day note falls back to its week, never week and its own days for one date', () => {
        const ns = [note('day-2026-11-03'), note('week-2026-W45')]
        expect(names(digestsCovering(ns, '2026-11-03', '2026-11-03'))).toEqual(['day-2026-11-03'])
        expect(names(digestsCovering(ns, '2026-11-04', '2026-11-04'))).toEqual(['week-2026-W45'])
        expect(names(digestsCovering(ns, '2026-11-03', '2026-11-04'))).toEqual(['day-2026-11-03', 'week-2026-W45'])
    })

    test('falls back to the month, most specific first', () => {
        const ns = [note('month-2026-05'), note('week-2026-W20'), note('day-2026-05-12')]
        expect(names(digestsCovering(ns, '2026-05-11', '2026-05-13'))).toEqual(['day-2026-05-12', 'week-2026-W20'])
        expect(names(digestsCovering(ns, '2026-05-29', '2026-05-29'))).toEqual(['month-2026-05'])
    })

    test('ignores non-daily lookalikes', () => {
        expect(digestsCovering([note('day-2026-11-03', 'fact')], '2026-11-03', '2026-11-03')).toEqual([])
    })
})

describe('rollupPlan', () => {
    const today = '2026-11-06'

    test('days more than 30 days old group by ISO week', () => {
        const ns = [note('day-2026-10-05'), note('day-2026-10-06'), note('day-2026-10-07'), note('day-2026-09-30'), note('day-2026-10-01')]
        expect(rollupPlan(ns, today)).toEqual([
            { into: 'week-2026-W40', from: ['day-2026-09-30', 'day-2026-10-01'] },
            { into: 'week-2026-W41', from: ['day-2026-10-05', 'day-2026-10-06'] },
        ])
    })

    test('weeks that ended on or before 2026-05-08 group by month', () => {
        const ns = [note('week-2026-W18'), note('week-2026-W19'), note('week-2026-W06'), note('week-2026-W07')]
        // W19 ends 2026-05-10 -> too new. W18 ends 05-03, W06 ends 02-08, W07 ends 02-15
        expect(rollupPlan(ns, today)).toEqual([
            { into: 'month-2026-02', from: ['week-2026-W06', 'week-2026-W07'] },
            { into: 'month-2026-04', from: ['week-2026-W18'] },
        ])
    })

    test('a week spanning two months goes to the month holding its Thursday', () => {
        // W05 2026: Mon 01-26 .. Sun 02-01, Thursday 01-29
        // W14 2026: Mon 03-30 .. Sun 04-05, Thursday 04-02
        expect(rollupPlan([note('week-2026-W05'), note('week-2026-W14')], today)).toEqual([
            { into: 'month-2026-01', from: ['week-2026-W05'] },
            { into: 'month-2026-04', from: ['week-2026-W14'] },
        ])
    })

    test('nothing newer is planned, month notes and non-digests are left alone', () => {
        const ns = [note('day-2026-11-01'), note('week-2026-W44'), note('month-2025-01'), note('day-2026-09-01', 'fact')]
        expect(rollupPlan(ns, today)).toEqual([])
    })
})
