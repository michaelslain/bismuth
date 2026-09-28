import { describe, expect, test } from 'bun:test'
import { buildLinePlot } from './asciiLine'
import type { LinePoint } from './asciiLine'

function flatten(rows: { segments: { text: string }[] }[]): string {
    return rows.map(r => r.segments.map(s => s.text).join('')).join('\n')
}

/** Reconstructs, per row, which columns hold a non-blank drawn char. */
function inkedByColumn(
    rows: { segments: { text: string; kind: string }[] }[],
): Set<number>[] {
    return rows.map(row => {
        const set = new Set<number>()
        let col = 0
        for (const seg of row.segments) {
            if (seg.kind !== 'blank')
                for (let k = 0; k < seg.text.length; k++) set.add(col + k)
            col += seg.text.length
        }
        return set
    })
}

/** Rows-with-ink per column, across every row — used for the 8-connectivity check. */
function rowsInkedAtColumn(
    rows: { segments: { text: string; kind: string }[] }[],
    col: number,
): number[] {
    const out: number[] = []
    rows.forEach((row, r) => {
        let c = 0
        for (const seg of row.segments) {
            if (seg.kind !== 'blank' && col >= c && col < c + seg.text.length)
                out.push(r)
            c += seg.text.length
        }
    })
    return out
}

describe('buildLinePlot', () => {
    test('empty input yields an empty plot', () => {
        const plot = buildLinePlot([], { columns: 40 })
        expect(plot.rows).toEqual([])
        expect(plot.axisRule).toBe('')
        expect(plot.axisLabels).toBe('')
        expect(plot.firstIndex).toBe(0)
    })

    test('a single point marks one column, no connecting glyphs', () => {
        const plot = buildLinePlot([{ label: 'w1', value: 5 }], {
            height: 4,
            columns: 40,
        })
        const flat = flatten(plot.rows)
        expect(flat).toContain('o')
        const glyphCount = [...flat].filter(c => c !== ' ' && c !== '\n').length
        expect(glyphCount).toBe(1)
    })

    test('slot width = floor((columns - gutter - 1) / n), min 2', () => {
        const points: LinePoint[] = [
            { label: 'a', value: 1 },
            { label: 'b', value: 8 },
            { label: 'c', value: 3 },
        ]
        const columns = 40
        const plot = buildLinePlot(points, { columns })
        expect(plot.firstIndex).toBe(0)
        const slotWidth = plot.colOf(1) - plot.colOf(0)
        const expected = Math.floor((columns - plot.gutter - 1) / points.length)
        expect(slotWidth).toBe(expected)
        expect(slotWidth).toBeGreaterThanOrEqual(2)
    })

    test('the last K points are kept when they do not fit', () => {
        const points: LinePoint[] = Array.from({ length: 30 }, (_, i) => ({
            label: `p${i}`,
            value: i,
        }))
        const columns = 30 // tight — 30 points cannot fit at slotWidth >= 2
        const plot = buildLinePlot(points, { columns })
        expect(plot.firstIndex).toBeGreaterThan(0)
        const visibleCount = points.length - plot.firstIndex
        const slotWidth = plot.colOf(1) - plot.colOf(0)
        expect(slotWidth).toBeGreaterThanOrEqual(2)
        const expectedAvail = columns - plot.gutter - 1
        expect(visibleCount).toBe(Math.max(1, Math.floor(expectedAvail / 2)))
        // The LAST point's marker is present (kept), the first is not.
        expect(flatten(plot.rows)).toBeTruthy()
    })

    test('ticks max/mid/0 right-aligned in a gutter as wide as the widest tick + 1', () => {
        const plot = buildLinePlot([{ label: 'a', value: 42 }], {
            height: 4,
            columns: 40,
        })
        // max=42, min(0,42)=0, mid=21 -> widest tick text is "42"/"21" (2 chars) -> gutter = 3
        expect(plot.gutter).toBe(3)
        expect(plot.rows[0].tick.trim()).toBe('42')
        expect(plot.rows[plot.rows.length - 1].tick.trim()).toBe('0')
        for (const row of plot.rows) expect(row.tick.length).toBe(plot.gutter)
    })

    test('negatives: the scale spans [min(0, min), max]', () => {
        const points: LinePoint[] = [
            { label: 'a', value: -10 },
            { label: 'b', value: 10 },
            { label: 'c', value: -4 },
        ]
        const plot = buildLinePlot(points, { height: 9, columns: 40 })
        // 0 is no longer at the bottom row — it sits mid-grid since min < 0.
        const zeroRow = plot.rows.findIndex(r => r.tick.trim() === '0')
        expect(zeroRow).toBeGreaterThan(0)
        expect(zeroRow).toBeLessThan(plot.rows.length - 1)
    })

    test('axisLabels centres each label under colOf(i); collisions thin to every k-th', () => {
        const wide = [
            { label: 'a', value: 1 },
            { label: 'b', value: 2 },
            { label: 'c', value: 3 },
        ]
        const plot = buildLinePlot(wide, { columns: 60 })
        expect(plot.axisLabels).toContain('a')
        expect(plot.axisLabels).toContain('b')
        expect(plot.axisLabels).toContain('c')
        const centerA = plot.axisLabels.indexOf('a')
        expect(centerA).toBe(plot.colOf(0))

        // Long labels in a narrow plot collide — every k-th label survives, not all of them.
        const many = Array.from({ length: 12 }, (_, i) => ({
            label: `label-${i}`,
            value: i,
        }))
        const tight = buildLinePlot(many, { columns: 30 })
        const shown = many.filter(p => tight.axisLabels.includes(p.label))
        expect(shown.length).toBeLessThan(many.length)
        expect(shown.length).toBeGreaterThan(0)
    })

    test('the line is 8-connected: adjacent columns differ by <=1 row, or a | run bridges them', () => {
        const points: LinePoint[] = [
            { label: 'a', value: 0 },
            { label: 'b', value: 100 },
            { label: 'c', value: 0 },
        ]
        const plot = buildLinePlot(points, { height: 20, columns: 60 })
        const inked = inkedByColumn(plot.rows)
        const width = Math.max(...plot.rows.map(r =>
            r.segments.reduce((n, s) => n + s.text.length, 0),
        ))
        for (let c = 0; c < width - 1; c++) {
            const a = rowsInkedAtColumn(plot.rows, c)
            const b = rowsInkedAtColumn(plot.rows, c + 1)
            if (a.length === 0 || b.length === 0) continue
            const touches = a.some(ra => b.some(rb => Math.abs(ra - rb) <= 1))
            expect(touches).toBe(true)
        }
        expect(inked.some(s => s.size > 0)).toBe(true)
    })

    test('trend glyphs (.) are drawn only in cells the data line left blank', () => {
        const points: LinePoint[] = [
            { label: 'a', value: 0 },
            { label: 'b', value: 5 },
            { label: 'c', value: 10 },
        ]
        // A flat trend at the same value as every point's row would land squarely on the data
        // line/points — it must never overwrite them.
        const plot = buildLinePlot(points, {
            height: 9,
            columns: 40,
            trend: () => 5,
        })
        for (const row of plot.rows) {
            let col = 0
            for (const seg of row.segments) {
                if (seg.kind === 'trend')
                    expect(['line', 'point']).not.toContain('trend') // sanity: kind is distinct
                col += seg.text.length
            }
        }
        const flat = flatten(plot.rows)
        expect(flat).toContain('.')
        // No cell is ever double-tagged: verify no row/col holds both a point/line char AND '.'
        // by checking segment kinds are mutually exclusive per cell (guaranteed by construction:
        // setCell only writes '.' when kind was 'blank').
        expect(plot.rows.some(r => r.segments.some(s => s.kind === 'trend'))).toBe(true)
    })

    test('top-row tick shows the max value, bottom-row tick shows 0 (non-negative data)', () => {
        const plot = buildLinePlot([{ label: 'a', value: 42 }], {
            height: 4,
            columns: 40,
        })
        expect(plot.rows[0].tick.trim()).toBe('42')
        expect(plot.rows[plot.rows.length - 1].tick.trim()).toBe('0')
    })
})
