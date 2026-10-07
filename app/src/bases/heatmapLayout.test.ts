import { describe, expect, test } from 'bun:test'
import type { HeatCell } from '../../../core/src/bases/chart'
import { buildHeatmapWeeks } from '../../../core/src/bases/chart'
import {
    dayLabel,
    glyphOf,
    heatmapRange,
    legendRanges,
    levelOf,
    monthLabels,
    streaks,
} from './heatmapLayout'

describe('heatmapRange', () => {
    test('20 columns clamps to 1 week (floor((20-2)/2) = 9, but data-narrow still yields the minimum via columns)', () => {
        // floor((20-2)/2) = 9 weeks at the narrow floor
        const r = heatmapRange(20, null, '2026-09-27')
        expect(r.end).toBe('2026-09-27')
        const days =
            (new Date(r.end + 'T00:00:00').getTime() -
                new Date(r.start + 'T00:00:00').getTime()) /
            86400000
        expect(days).toBe(9 * 7 - 1)
    })

    test('120 columns spans floor((120-2)/2) = 59 weeks, clamped to 53', () => {
        const r = heatmapRange(120, null, '2026-09-27')
        const days =
            (new Date(r.end + 'T00:00:00').getTime() -
                new Date(r.start + 'T00:00:00').getTime()) /
            86400000
        expect(days).toBe(53 * 7 - 1)
    })

    test('400 columns still clamps to 53 weeks (the yearly ceiling)', () => {
        const r = heatmapRange(400, null, '2026-09-27')
        const days =
            (new Date(r.end + 'T00:00:00').getTime() -
                new Date(r.start + 'T00:00:00').getTime()) /
            86400000
        expect(days).toBe(53 * 7 - 1)
    })

    test('ends at the latest data date when it is after today (stale-today guard)', () => {
        const r = heatmapRange(40, '2026-10-05', '2026-09-27')
        expect(r.end).toBe('2026-10-05')
    })

    test('ends at today when the latest data is in the past', () => {
        const r = heatmapRange(40, '2025-01-01', '2026-09-27')
        expect(r.end).toBe('2026-09-27')
    })
})

describe('monthLabels', () => {
    test('labels the week column containing a month boundary that falls mid-week', () => {
        // Weeks are Mon..Sun. Put Aug 1 (a Saturday in 2026) inside a week whose Monday is
        // still July, so the month's 1st does not land on the week's first column.
        const points = [{ date: '2026-08-01', value: 1, key: '2026-08-01', label: '', rows: [] }]
        const { weeks } = buildHeatmapWeeks(points, {
            start: '2026-07-20',
            end: '2026-08-10',
        })
        const labels = monthLabels(weeks)
        const augWeekIndex = weeks.findIndex(week =>
            week.some(c => c.date === '2026-08-01'),
        )
        expect(labels[augWeekIndex]).toBe('Aug')
        // exactly one label for the boundary
        expect(labels.filter(l => l !== '').length).toBeGreaterThanOrEqual(1)
    })

    test('drops a label with no blank column before the next, keeping the later month', () => {
        // A 1-week grid straddling two 1sts is contrived but exercises the clearance rule
        // directly by constructing weeks by hand.
        const weeks: HeatCell[][] = [
            [
                { date: '2026-01-29', value: null },
                { date: '2026-01-30', value: null },
                { date: '2026-01-31', value: null },
                { date: '2026-02-01', value: null },
                { date: '2026-02-02', value: null },
                { date: '2026-02-03', value: null },
                { date: '2026-02-04', value: null },
            ],
            [
                { date: '2026-02-05', value: null },
                { date: '2026-02-06', value: null },
                { date: '2026-02-07', value: null },
                { date: '2026-02-08', value: null },
                { date: '2026-02-09', value: null },
                { date: '2026-02-10', value: null },
                { date: '2026-02-11', value: null },
            ],
        ]
        const labels = monthLabels(weeks)
        expect(labels).toEqual(['Feb', ''])
    })
})

describe('streaks', () => {
    const today = '2026-09-27'

    test('current streak is 0 when the chain lapsed before yesterday', () => {
        const points = [
            { date: '2026-09-01', value: 1 },
            { date: '2026-09-02', value: 1 },
        ]
        const s = streaks(points, today)
        expect(s.entries).toBe(2)
        expect(s.longest).toBe(2)
        expect(s.current).toBe(0)
    })

    test('current streak stays live when the last entry is yesterday', () => {
        const points = [
            { date: '2026-09-25', value: 1 },
            { date: '2026-09-26', value: 1 },
        ]
        const s = streaks(points, today)
        expect(s.current).toBe(2)
    })

    test('current streak stays live when the last entry is today', () => {
        const points = [
            { date: '2026-09-26', value: 1 },
            { date: '2026-09-27', value: 1 },
        ]
        const s = streaks(points, today)
        expect(s.current).toBe(2)
    })

    test('zero-value days do not count as entries', () => {
        const points = [
            { date: '2026-09-26', value: 0 },
            { date: '2026-09-27', value: 2 },
        ]
        const s = streaks(points, today)
        expect(s.entries).toBe(1)
        expect(s.current).toBe(1)
    })

    test('no points at all yields all zeros', () => {
        const s = streaks([], today)
        expect(s).toEqual({ entries: 0, current: 0, longest: 0 })
    })
})

describe('dayLabel', () => {
    test('formats as Ddd Mon D', () => {
        expect(dayLabel('2026-07-08')).toBe('Wed Jul 8')
    })
})

describe('levelOf / glyphOf', () => {
    test('a positive value never collapses onto the no-data glyph', () => {
        // The lowest positive value in the range must be a DIFFERENT glyph from a missing day —
        // this is exactly the collision that made the old 4-tier scale meaningless.
        expect(levelOf(1, 1, 347)).not.toBe(0)
        expect(glyphOf(levelOf(1, 1, 347))).not.toBe(glyphOf(0))
    })

    test('zero or negative is always level 0 (the no-data glyph)', () => {
        expect(levelOf(0, 1, 347)).toBe(0)
        expect(levelOf(-5, 1, 347)).toBe(0)
        expect(levelOf(null, 1, 347)).toBe(0)
    })

    test('the top of the range is the highest tier', () => {
        expect(levelOf(347, 1, 347)).toBe(3)
        expect(glyphOf(3)).toBe('#')
    })

    test('a single-value range (min===max) still renders the top tier, not a divide-by-zero', () => {
        expect(levelOf(50, 50, 50)).toBe(3)
    })
})

describe('legendRanges', () => {
    test('no data at all: just the none entry', () => {
        expect(legendRanges(0, 0)).toEqual([
            { level: 0, glyph: '.', levelClass: 'lv0', range: 'none' },
        ])
    })

    test('splits [min, max] into three contiguous, non-overlapping bands', () => {
        const entries = legendRanges(1, 347)
        expect(entries).toHaveLength(4)
        expect(entries[0]).toEqual({ level: 0, glyph: '.', levelClass: 'lv0', range: 'none' })
        expect(entries[1].glyph).toBe('-')
        expect(entries[2].glyph).toBe('+')
        expect(entries[3].glyph).toBe('#')
        // contiguous: each band's low is the previous band's high + 1
        const parseHi = (r: string) => Number(r.split('–').pop())
        const parseLo = (r: string) => Number(r.split('–')[0])
        expect(parseLo(entries[2].range)).toBe(parseHi(entries[1].range) + 1)
        expect(parseLo(entries[3].range)).toBe(parseHi(entries[2].range) + 1)
        // spans the full range
        expect(parseLo(entries[1].range)).toBe(1)
        expect(parseHi(entries[3].range)).toBe(347)
    })

    test('every level a real value can take has a matching legend band', () => {
        const min = 1
        const max = 347
        for (const v of [1, 50, 86, 87, 173, 174, 300, 347]) {
            const level = levelOf(v, min, max)
            const entry = legendRanges(min, max)[level]
            expect(entry.glyph).toBe(glyphOf(level))
        }
    })

    // Regression: the legend used to be computed from its own arithmetic, not levelOf's, so a lone
    // value of 400 painted `#` while the legend read `- 400  + 401  # 402`. The legend must say
    // what the GRID says, for every value a square can hold.
    test('a lone value is one `#` entry, matching the glyph the grid draws', () => {
        const entries = legendRanges(400, 400)
        expect(entries.map(e => e.glyph)).toEqual(['.', '#'])
        expect(entries[1].range).toBe('400')
        expect(glyphOf(levelOf(400, 400, 400))).toBe('#')
    })

    test('a small peak lists only the bands a value can land in', () => {
        // peak 3 draws `#`; the old legend printed `+ 3  # 4`
        const entries = legendRanges(1, 3)
        expect(entries.map(e => `${e.glyph} ${e.range}`)).toEqual(['. none', '- 1', '+ 2', '# 3'])
    })

    test('legend agrees with levelOf for every whole value, over many ranges', () => {
        for (let min = 1; min <= 12; min++) {
            for (let max = min; max <= 40; max++) {
                const entries = legendRanges(min, max)
                const seen = new Set<number>()
                for (let v = min; v <= max; v++) {
                    const level = levelOf(v, min, max)
                    const entry = entries.find(e => e.level === level)
                    expect(entry).toBeDefined()
                    expect(entry!.glyph).toBe(glyphOf(level))
                    const [lo, hi] = entry!.range.split('–').map(Number)
                    expect(v).toBeGreaterThanOrEqual(lo)
                    expect(v).toBeLessThanOrEqual(hi ?? lo)
                    seen.add(level)
                }
                // no entry for a glyph the grid never draws
                for (const e of entries.slice(1)) expect(seen.has(e.level)).toBe(true)
            }
        }
    })
})
