import { describe, expect, test } from 'bun:test'
import { MIN_BAR_CELLS, barHeader, layoutBars } from './barRows'

describe('layoutBars', () => {
    test('widths add up to columns', () => {
        const points = [
            { key: 'a', label: 'short', value: 3 },
            { key: 'b', label: 'a much longer label', value: 9 },
        ]
        const columns = 60
        const rows = layoutBars(points, columns)
        for (const row of rows) {
            expect(row.label.length + row.value.length + row.fill + row.track + 4).toBe(columns)
        }
    })

    test('a non-zero value always draws at least one cell, negative or not; only 0 draws none', () => {
        const points = [
            { key: 'a', label: 'a', value: -1 },
            { key: 'b', label: 'b', value: -4 },
            { key: 'c', label: 'c', value: 1 },
            { key: 'd', label: 'd', value: 0 },
            { key: 'e', label: 'e', value: 400 },
        ]
        const [m1, m4, p1, zero, big] = layoutBars(points, 40)
        expect(m1.fill).toBeGreaterThanOrEqual(1)
        expect(m4.fill).toBeGreaterThanOrEqual(1)
        expect(p1.fill).toBeGreaterThanOrEqual(1)
        expect(zero.fill).toBe(0)
        expect([m1.negative, m4.negative, p1.negative, zero.negative]).toEqual([true, true, false, false])
        // Scaled on magnitude: -4 draws no fewer cells than -1, and the largest value fills the bar.
        expect(m4.fill).toBeGreaterThanOrEqual(m1.fill)
        expect(big.track).toBe(0)
    })

    test('a negative that is the largest magnitude fills the bar', () => {
        const rows = layoutBars(
            [
                { key: 'a', label: 'a', value: -10 },
                { key: 'b', label: 'b', value: 5 },
            ],
            40,
        )
        expect(rows[0].track).toBe(0)
        expect(rows[1].fill).toBeGreaterThan(0)
        expect(rows[1].fill).toBeLessThan(rows[0].fill)
    })

    test('all-zero values give fill 0 with no NaN', () => {
        const points = [
            { key: 'a', label: 'a', value: 0 },
            { key: 'b', label: 'b', value: 0 },
        ]
        const rows = layoutBars(points, 40)
        for (const row of rows) {
            expect(row.fill).toBe(0)
            expect(Number.isNaN(row.fill)).toBe(false)
            expect(Number.isNaN(row.track)).toBe(false)
        }
    })

    test('widest label wins — every label pads to the same width', () => {
        const points = [
            { key: 'a', label: 'x', value: 1 },
            { key: 'b', label: 'a much wider label', value: 2 },
        ]
        const rows = layoutBars(points, 60)
        expect(rows[0].label.length).toBe('a much wider label'.length)
        expect(rows[1].label.length).toBe('a much wider label'.length)
    })

    test('value column right-aligned to the widest value', () => {
        const points = [
            { key: 'a', label: 'a', value: 1 },
            { key: 'b', label: 'b', value: 123 },
        ]
        const rows = layoutBars(points, 40)
        expect(rows[0].value.length).toBe(rows[1].value.length)
        expect(rows[0].value.endsWith('1')).toBe(true)
    })

    test('empty points list produces no rows', () => {
        expect(layoutBars([], 40)).toEqual([])
    })

    test('long label at narrow columns never crashes and never goes negative', () => {
        const points = [
            { key: 'a', label: 'Waiting on review from le', value: 120 },
            { key: 'b', label: 'Short', value: 3 },
        ]
        const columns = 20
        const rows = layoutBars(points, columns)
        for (const row of rows) {
            expect(row.fill).toBeGreaterThanOrEqual(0)
            expect(row.track).toBeGreaterThanOrEqual(0)
            expect(row.label.length + row.value.length + row.fill + row.track + 4).toBeLessThanOrEqual(columns)
        }
    })

    // Regression: at ~40 columns two long labels ate the whole row, the track collapsed to 2 cells,
    // and 340 and 275 both drew the same length — the chart compared nothing.
    test('long labels cannot squeeze the bars: close values still draw different lengths', () => {
        const points = [
            { key: 'a', label: 'Waiting on review from legal', value: 120 },
            { key: 'b', label: 'Blocked on design sign-off', value: 340 },
            { key: 'c', label: 'Needs a follow-up call', value: 275 },
            { key: 'd', label: 'Ready to ship', value: 512 },
        ]
        for (const columns of [36, 40, 44, 52]) {
            const rows = layoutBars(points, columns)
            for (const row of rows) expect(row.fill + row.track).toBeGreaterThanOrEqual(MIN_BAR_CELLS)
            const fill = (key: string) => rows.find(r => r.key === key)!.fill
            expect(fill('b')).not.toBe(fill('c'))
        }
    })

    test('very long label is truncated with an ellipsis', () => {
        const points = [
            { key: 'a', label: 'a'.repeat(40), value: 5 },
            { key: 'b', label: 'b', value: 500 },
        ]
        const columns = 40
        const rows = layoutBars(points, columns)
        expect(rows[0].label.trim().endsWith('…')).toBe(true)
        expect(rows[0].label.length).toBeLessThan(40)
        for (const row of rows) {
            expect(row.fill).toBeGreaterThanOrEqual(0)
            expect(row.track).toBeGreaterThanOrEqual(0)
        }
    })
})

describe('barHeader', () => {
    test('same total length as a layoutBars row — never the thing that overflows', () => {
        const points = [
            { key: 'a', label: 'short', value: 3 },
            { key: 'b', label: 'a much longer label', value: 9 },
        ]
        const columns = 60
        const rows = layoutBars(points, columns)
        const barWidth = rows[0].fill + rows[0].track
        const header = barHeader('status', 'sum priority', rows[0].label.length, rows[0].value.length, barWidth)
        expect(header.length).toBe(columns)
    })

    test('label left-aligned, value right-aligned', () => {
        const header = barHeader('status', 'notes', 6, 5, 5)
        expect(header.startsWith('status')).toBe(true)
        expect(header.endsWith('notes')).toBe(true)
    })

    test('a name longer than its column truncates with an ellipsis, staying in budget', () => {
        const header = barHeader('due (week) of the quarter', 'sum priority', 8, 4, 5)
        expect(header.length).toBe(8 + 2 + 5 + 2 + 4)
        expect(header.slice(0, 8).trim().endsWith('…')).toBe(true)
    })
})
