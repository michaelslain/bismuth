import { describe, expect, test } from 'bun:test'
import {
    arrowDirection,
    buildLinePlot,
    columnAt,
    nearestIndex,
    stepIndex,
    timeOffsets,
} from './asciiLine'
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
        // The first point's label is dropped, and the LAST point's marker is present (kept).
        expect(plot.axisLabels).not.toContain(points[0].label)
        const lastLocalCol = plot.colOf(visibleCount - 1) - plot.gutter
        let foundLastMarker = false
        for (const row of plot.rows) {
            let col = 0
            for (const seg of row.segments) {
                if (
                    seg.kind === 'point' &&
                    lastLocalCol >= col &&
                    lastLocalCol < col + seg.text.length
                )
                    foundLastMarker = true
                col += seg.text.length
            }
        }
        expect(foundLastMarker).toBe(true)
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
        const opts = { height: 9, columns: 40 }
        // A flat trend at the same value as every point's row would land squarely on the data
        // line/points — it must never overwrite them, and adding it must not disturb any cell
        // that was already drawn by the data line/points themselves.
        const withoutTrend = buildLinePlot(points, opts)
        const withTrend = buildLinePlot(points, { ...opts, trend: () => 5 })

        const toGrid = (rows: { segments: { text: string; kind: string }[] }[]) =>
            rows.map(row => {
                const cells: { ch: string; kind: string }[] = []
                for (const seg of row.segments)
                    for (const ch of seg.text) cells.push({ ch, kind: seg.kind })
                return cells
            })
        const gridA = toGrid(withoutTrend.rows)
        const gridB = toGrid(withTrend.rows)
        for (let r = 0; r < gridA.length; r++) {
            for (let c = 0; c < gridA[r].length; c++) {
                if (gridA[r][c].kind === 'blank' && gridB[r][c].kind === 'trend') continue
                expect(gridB[r][c]).toEqual(gridA[r][c])
            }
        }

        const flat = flatten(withTrend.rows)
        expect(flat).toContain('.')
        expect(withTrend.rows.some(r => r.segments.some(s => s.kind === 'trend'))).toBe(true)
    })

    test('top-row tick shows the max value, bottom-row tick shows 0 (non-negative data)', () => {
        const plot = buildLinePlot([{ label: 'a', value: 42 }], {
            height: 4,
            columns: 40,
        })
        expect(plot.rows[0].tick.trim()).toBe('42')
        expect(plot.rows[plot.rows.length - 1].tick.trim()).toBe('0')
    })

    test('a steep single-column drop is still 8-connected (no hole)', () => {
        const points: LinePoint[] = []
        for (let i = 0; i < 84; i++)
            points.push({ label: `p${i}`, value: i % 2 === 0 ? 1 : 7 })
        const plot = buildLinePlot(points, { height: 12, columns: 180 })
        const inked = inkedByColumn(plot.rows)
        const width = Math.max(
            ...plot.rows.map(r => r.segments.reduce((n, s) => n + s.text.length, 0)),
        )
        for (let c = 0; c < width - 1; c++) {
            const a = rowsInkedAtColumn(plot.rows, c)
            const b = rowsInkedAtColumn(plot.rows, c + 1)
            if (a.length === 0 || b.length === 0) continue
            const touches = a.some(ra => b.some(rb => Math.abs(ra - rb) <= 1))
            expect(touches).toBe(true)
        }
        expect(inked.some(s => s.size > 0)).toBe(true)
    })

    test('0/100/0 at a tight 10 columns stays 8-connected', () => {
        const points: LinePoint[] = [
            { label: 'a', value: 0 },
            { label: 'b', value: 100 },
            { label: 'c', value: 0 },
        ]
        const plot = buildLinePlot(points, { height: 12, columns: 10 })
        const width = Math.max(
            ...plot.rows.map(r => r.segments.reduce((n, s) => n + s.text.length, 0)),
        )
        for (let c = 0; c < width - 1; c++) {
            const a = rowsInkedAtColumn(plot.rows, c)
            const b = rowsInkedAtColumn(plot.rows, c + 1)
            if (a.length === 0 || b.length === 0) continue
            const touches = a.some(ra => b.some(rb => Math.abs(ra - rb) <= 1))
            expect(touches).toBe(true)
        }
    })

    test('y-scale: all-positive data near 0 gets a zero floor, ticks max/mid/min', () => {
        const points: LinePoint[] = [
            { label: 'a', value: 1 },
            { label: 'b', value: 3 },
            { label: 'c', value: 2 },
        ]
        const plot = buildLinePlot(points, { height: 9, columns: 40 })
        expect(plot.rows[plot.rows.length - 1].tick.trim()).toBe('0')
        expect(plot.rows[0].tick.trim()).toBe('3')
    })

    test('y-scale: all-positive data far from 0 gets a fitted floor, not squeezed to the top', () => {
        const points: LinePoint[] = [
            { label: 'a', value: 5 },
            { label: 'b', value: 6 },
            { label: 'c', value: 5.5 },
        ]
        const plot = buildLinePlot(points, { height: 12, columns: 40 })
        // The min tick is NOT 0 — the floor is fitted just under the data's own minimum.
        const bottomTick = plot.rows[plot.rows.length - 1].tick.trim()
        expect(bottomTick).not.toBe('0')
        expect(Number(bottomTick)).toBeLessThan(5)
        // Ink spans more than just the top row or two.
        const inked = inkedByColumn(plot.rows)
        const inkedRows = inked.map((s, r) => (s.size > 0 ? r : -1)).filter(r => r >= 0)
        expect(Math.max(...inkedRows) - Math.min(...inkedRows)).toBeGreaterThan(2)
    })

    test('y-scale: mixed negative/positive keeps a labelled min tick at the bottom', () => {
        const points: LinePoint[] = [
            { label: 'a', value: -8 },
            { label: 'b', value: 4 },
            { label: 'c', value: -2 },
        ]
        const plot = buildLinePlot(points, { height: 9, columns: 40 })
        expect(plot.rows[plot.rows.length - 1].tick.trim()).toBe('-8')
        expect(plot.rows[0].tick.trim()).toBe('4')
    })

    test('xs spacing places points by real time distance, not even index spacing', () => {
        const points: LinePoint[] = [
            { label: 'd0', value: 1 },
            { label: 'd2', value: 2 },
            { label: 'd21', value: 3 },
        ]
        // Day offsets from the first point: gaps of 2 days then 19 days.
        const xs = [0, 2, 21]
        const plot = buildLinePlot(points, { columns: 60, xs })
        const gapSmall = plot.colOf(1) - plot.colOf(0)
        const gapBig = plot.colOf(2) - plot.colOf(1)
        expect(gapBig).toBeGreaterThan(gapSmall * 5)
    })

    test('trend cells never land left of the first point or right of the last', () => {
        const points: LinePoint[] = [
            { label: 'd0', value: 1 },
            { label: 'd2', value: 2 },
            { label: 'd21', value: 3 },
            { label: 'd25', value: 2.5 },
        ]
        const xs = [0, 2, 21, 25]
        const plot = buildLinePlot(points, {
            columns: 60,
            xs,
            trend: t => 1 + t * 0.1,
        })
        const firstCol = plot.colOf(0) - plot.gutter
        const lastCol = plot.colOf(points.length - 1) - plot.gutter
        for (const row of plot.rows) {
            let col = 0
            for (const seg of row.segments) {
                if (seg.kind === 'trend')
                    for (let k = 0; k < seg.text.length; k++) {
                        const c = col + k
                        expect(c).toBeGreaterThanOrEqual(firstCol)
                        expect(c).toBeLessThanOrEqual(lastCol)
                    }
                col += seg.text.length
            }
        }
    })
})

describe('timeOffsets', () => {
    test('day bins are whole-day diffs from the first key', () => {
        expect(timeOffsets(['2026-08-01', '2026-08-03', '2026-08-22'], 'day')).toEqual([0, 2, 21])
    })
    test('week bins are day diffs over seven', () => {
        expect(timeOffsets(['2026-08-03', '2026-08-10', '2026-08-24'], 'week')).toEqual([0, 1, 3])
    })
    test('month bins are calendar-month diffs across a year boundary', () => {
        expect(timeOffsets(['2025-11-01', '2026-01-01', '2026-03-01'], 'month')).toEqual([0, 2, 4])
    })
    test('no keys, no offsets', () => {
        expect(timeOffsets([], 'day')).toEqual([])
    })
})

describe('columnAt', () => {
    test('rounds the pointer offset to a character column', () => {
        expect(columnAt(130, 100, 10)).toBe(3)
        expect(columnAt(126, 100, 10)).toBe(3)
        expect(columnAt(124, 100, 10)).toBe(2)
    })
    test('an unmeasured grid has no column', () => {
        expect(columnAt(130, 100, 0)).toBeNull()
    })
})

describe('nearestIndex', () => {
    const colOf = (i: number) => 3 + i * 4
    test('picks the closest point column', () => {
        expect(nearestIndex(colOf, 4, 0)).toBe(0)
        expect(nearestIndex(colOf, 4, 8)).toBe(1)
        expect(nearestIndex(colOf, 4, 99)).toBe(3)
    })
    test('an empty plot has none', () => {
        expect(nearestIndex(colOf, 0, 5)).toBeNull()
    })
})

describe('arrowDirection', () => {
    test('maps the four navigation keys and ignores the rest', () => {
        expect(arrowDirection({ key: 'ArrowLeft' })).toBe('prev')
        expect(arrowDirection({ key: 'ArrowRight' })).toBe('next')
        expect(arrowDirection({ key: 'Home' })).toBe('first')
        expect(arrowDirection({ key: 'End' })).toBe('last')
        expect(arrowDirection({ key: 'a' })).toBeNull()
    })
})

describe('stepIndex', () => {
    test('from nothing, next lands on the first point and prev on the last', () => {
        expect(stepIndex(null, 'next', 5)).toBe(0)
        expect(stepIndex(null, 'prev', 5)).toBe(4)
    })
    test('steps clamp at both ends', () => {
        expect(stepIndex(2, 'next', 5)).toBe(3)
        expect(stepIndex(4, 'next', 5)).toBe(4)
        expect(stepIndex(0, 'prev', 5)).toBe(0)
    })
    test('home and end jump', () => {
        expect(stepIndex(2, 'first', 5)).toBe(0)
        expect(stepIndex(2, 'last', 5)).toBe(4)
    })
    test('nothing to step over', () => {
        expect(stepIndex(null, 'next', 0)).toBeNull()
    })
})

describe('buildLinePlot x-axis labels', () => {
    const days = ['Aug 8', 'Aug 10', 'Aug 12', 'Aug 13', 'Aug 14', 'Aug 20', 'Aug 21', 'Sep 1']
    const points = (labels: string[]): LinePoint[] => labels.map((label, i) => ({ label, value: i + 1 }))

    /** Walks the label line left to right, matching each point's label in order. Returns what is
     *  wrong with it: a label glued to its neighbour, or ink that is no whole label (an overwrite). */
    function labelDefects(axisLabels: string, labels: string[]): string[] {
        const defects: string[] = []
        let from = 0
        let prevEnd = -2
        let rest = axisLabels
        for (const label of labels) {
            const at = axisLabels.indexOf(label, from)
            if (at < 0) continue // thinned away — allowed
            if (at <= prevEnd + 1) defects.push(`"${label}" touches the label before it`)
            rest = rest.slice(0, at) + ' '.repeat(label.length) + rest.slice(at + label.length)
            prevEnd = at + label.length - 1
            from = prevEnd + 1
        }
        if (rest.trim()) defects.push(`stray ink "${rest.trim()}"`)
        return defects
    }

    test('real-time spacing never glues two labels together or overwrites one', () => {
        // days apart: 0,2,4,5,6,12,13,24 — uneven, so some neighbours sit 1 column apart
        const xs = [0, 2, 4, 5, 6, 12, 13, 24]
        for (let columns = 14; columns <= 120; columns++) {
            const plot = buildLinePlot(points(days), { columns, xs })
            expect(labelDefects(plot.axisLabels, days.slice(plot.firstIndex))).toEqual([])
        }
    })

    test('evenly spaced labels also keep a blank column between them, at every width', () => {
        for (let columns = 10; columns <= 120; columns++) {
            const plot = buildLinePlot(points(days), { columns })
            expect(labelDefects(plot.axisLabels, days.slice(plot.firstIndex))).toEqual([])
        }
    })

    test('the first label survives at the left edge when a neighbour is close', () => {
        const plot = buildLinePlot(points(['Aug 8', 'Aug 10']), { columns: 26, xs: [0, 1] })
        expect(plot.axisLabels.trimStart().startsWith('Aug 8')).toBe(true)
        expect(plot.axisLabels).not.toContain('Aug 8Aug')
    })
})
