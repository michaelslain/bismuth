import { describe, test, expect } from 'bun:test'
import { parseBase } from '../../src/bases/parse'
import {
    metricResults,
    defaultMetric,
} from '../../src/bases/metrics'
import { buildChartData } from '../../src/bases/chart'
import type { Row, ViewConfig } from '../../src/bases/types'
import { EMPTY_FILE } from '../../src/bases/types'

function row(note: Record<string, unknown>): Row {
    return {
        file: { ...EMPTY_FILE, name: 'n', basename: 'n', path: 'n.md' },
        note,
        formula: {},
    }
}
const view = (v: Partial<ViewConfig>): ViewConfig => ({
    type: 'stat',
    ...v,
})

describe('parseBase stats normalization', () => {
    test('a bare string entry sets label = value = the string', () => {
        const cfg = parseBase(
            'views:\n  - type: stat\n    name: S\n    stats:\n      - "sum(priority)"\n',
        )
        expect(cfg.view.stats).toEqual([
            { label: 'sum(priority)', value: 'sum(priority)' },
        ])
    })

    test('an object entry keeps its label, defaulting to value when absent', () => {
        const cfg = parseBase(
            'views:\n  - type: stat\n    name: S\n    stats:\n      - label: Total\n        value: "sum(priority)"\n      - value: "count()"\n',
        )
        expect(cfg.view.stats).toEqual([
            { label: 'Total', value: 'sum(priority)' },
            { label: 'count()', value: 'count()' },
        ])
    })

    test('malformed entries are dropped', () => {
        const cfg = parseBase(
            'views:\n  - type: stat\n    name: S\n    stats:\n      - 5\n      - {}\n      - label: NoValue\n',
        )
        expect(cfg.view.stats).toBeUndefined()
    })

    test('a non-array stats key is dropped', () => {
        const cfg = parseBase(
            'views:\n  - type: stat\n    name: S\n    stats: "sum(priority)"\n',
        )
        expect(cfg.view.stats).toBeUndefined()
    })
})

describe('defaultMetric', () => {
    test('count() labelled notes when aggregate is count', () => {
        const rows = [row({ cat: 'a' }), row({ cat: 'b' })]
        const data = buildChartData(rows, view({ x: 'cat', aggregate: 'count' }))
        expect(defaultMetric(data)).toEqual({
            label: 'notes',
            value: 'count()',
        })
    })

    test('count() labelled notes when no y resolves', () => {
        const rows = [row({ cat: 'a' })]
        const data = buildChartData(rows, view({ x: 'cat' }))
        expect(defaultMetric(data)).toEqual({
            label: 'notes',
            value: 'count()',
        })
    })

    test('sum of y labelled "sum of <name>"', () => {
        const rows = [row({ date: '2026-05-01', priority: 3 })]
        const v = view({ x: 'date', y: 'priority', aggregate: 'sum' })
        const data = buildChartData(rows, v)
        expect(defaultMetric(data)).toEqual({
            label: 'sum of priority',
            value: 'sum(priority)',
        })
    })

    test('avg of y labelled "average of <name>"', () => {
        const rows = [row({ date: '2026-05-01', priority: 3 })]
        const v = view({ x: 'date', y: 'priority', aggregate: 'avg' })
        const data = buildChartData(rows, v)
        expect(defaultMetric(data)).toEqual({
            label: 'average of priority',
            value: 'avg(priority)',
        })
    })
})

describe('metricResults', () => {
    const today = '2026-06-15' // a Monday

    test('uses declared stats when present', () => {
        const rows = [row({ date: '2026-06-15', priority: 2 })]
        const v = view({
            x: 'date',
            bin: 'week',
            stats: [{ label: 'Total', value: 'sum(priority)' }],
        })
        const results = metricResults(rows, v, today)
        expect(results).toHaveLength(1)
        expect(results[0].label).toBe('Total')
        expect(results[0].source).toBe('sum(priority)')
        expect(results[0].value).toBe(2)
    })

    test('synthesizes a default metric when no stats declared', () => {
        const rows = [row({ date: '2026-06-15', priority: 2 })]
        const v = view({ x: 'date', y: 'priority', aggregate: 'sum', bin: 'week' })
        const results = metricResults(rows, v, today)
        expect(results).toHaveLength(1)
        expect(results[0].label).toBe('sum of priority')
    })

    test('current/previous/series bin by the current date when x is a date axis', () => {
        const rows = [
            row({ date: '2026-06-15', priority: 2 }), // this week (Mon)
            row({ date: '2026-06-08', priority: 5 }), // last week
        ]
        const v = view({
            x: 'date',
            bin: 'week',
            stats: [{ label: 'Total', value: 'sum(priority)' }],
        })
        const [r] = metricResults(rows, v, today)
        expect(r.hasTime).toBe(true)
        expect(r.bin).toBe('week')
        expect(r.current).toBe(2)
        expect(r.previous).toBe(5)
        expect(r.series).toHaveLength(12)
        expect(r.series[11]).toBe(2) // last entry = current bin
        expect(r.series[10]).toBe(5) // previous bin
        expect(r.seriesKeys).toHaveLength(12)
        expect(r.seriesKeys[11]).toBe('2026-06-15') // current bin's own key
        expect(r.seriesKeys[10]).toBe('2026-06-08') // previous bin's key
        expect(r.seriesLabels).toHaveLength(12)
        expect(r.seriesLabels[11]).toBe('Jun 15')
        expect(r.seriesLabels[10]).toBe('Jun 8')
    })

    test('seriesKeys/seriesLabels are empty when x is not a date axis', () => {
        const rows = [row({ cat: 'a', priority: 2 })]
        const v = view({
            x: 'cat',
            stats: [{ label: 'Total', value: 'sum(priority)' }],
        })
        const [r] = metricResults(rows, v, today)
        expect(r.seriesKeys).toEqual([])
        expect(r.seriesLabels).toEqual([])
    })

    test('a bin with no rows evaluates over an empty set', () => {
        const rows = [row({ date: '2026-06-15', priority: 2 })]
        const v = view({
            x: 'date',
            bin: 'week',
            stats: [{ label: 'Total', value: 'count()' }],
        })
        const [r] = metricResults(rows, v, today)
        expect(r.previous).toBe(0) // count() over [] is 0
    })

    test('hasTime is false and current/previous/series are null/empty when x is not a date', () => {
        const rows = [row({ cat: 'a', priority: 2 })]
        const v = view({
            x: 'cat',
            stats: [{ label: 'Total', value: 'sum(priority)' }],
        })
        const [r] = metricResults(rows, v, today)
        expect(r.hasTime).toBe(false)
        expect(r.current).toBeNull()
        expect(r.previous).toBeNull()
        expect(r.series).toEqual([])
        expect(r.value).toBe(2)
    })

    test('an evaluation error sets error and nulls the numbers rather than throwing', () => {
        const rows = [row({ date: '2026-06-15', priority: 2 })]
        const v = view({
            x: 'date',
            bin: 'week',
            stats: [{ label: 'Bad', value: 'priority' }], // bare ident outside aggregate
        })
        const results = metricResults(rows, v, today)
        expect(results).toHaveLength(1)
        expect(results[0].error).toBeTruthy()
        expect(results[0].value).toBeNull()
        expect(results[0].current).toBeNull()
        expect(results[0].previous).toBeNull()
        expect(results[0].series).toEqual([])
    })
})
