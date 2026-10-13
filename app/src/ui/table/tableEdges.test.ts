import { describe, expect, test } from 'bun:test'
import { cellEdges, type CellPlace } from './tableEdges'

const at = (p: Partial<CellPlace>): CellPlace => ({
    row: 0,
    col: 0,
    rowSpan: 1,
    colSpan: 1,
    rows: 3,
    cols: 2,
    headerRows: 1,
    ...p,
})

describe('cellEdges', () => {
    test('a header cell types top + left and a heavy bottom; the last column adds right', () => {
        expect(cellEdges(at({}))).toEqual({
            edges: ['top', 'left', 'bottom'],
            heavy: ['bottom'],
        })
        expect(cellEdges(at({ col: 1 }))).toEqual({
            edges: ['top', 'left', 'right', 'bottom'],
            heavy: ['bottom'],
        })
    })

    test('the first body row omits top — the header owns that line', () => {
        expect(cellEdges(at({ row: 1 })).edges).toEqual(['left'])
    })

    test('a middle body row types top + left; the last row adds bottom', () => {
        expect(cellEdges(at({ row: 1, rows: 4 })).edges).toEqual(['left'])
        expect(cellEdges(at({ row: 2, rows: 4 })).edges).toEqual([
            'top',
            'left',
        ])
        expect(cellEdges(at({ row: 3, rows: 4, col: 1 })).edges).toEqual([
            'top',
            'left',
            'right',
            'bottom',
        ])
    })

    test('a table without a header types every row top', () => {
        expect(cellEdges(at({ headerRows: 0 })).edges).toEqual(['top', 'left'])
        expect(cellEdges(at({ headerRows: 0, row: 2 })).edges).toEqual([
            'top',
            'left',
            'bottom',
        ])
    })

    test('a merged cell owns the edges of its whole rectangle', () => {
        // spans both columns: reaches the right edge
        expect(cellEdges(at({ row: 1, colSpan: 2 })).edges).toEqual([
            'left',
            'right',
        ])
        // spans to the last row: types the bottom
        expect(cellEdges(at({ row: 1, rowSpan: 2 })).edges).toEqual([
            'left',
            'bottom',
        ])
    })

    test('every boundary is typed exactly once, merges included', () => {
        // 1 header row + 3 body rows x 3 cols; body (1,0) spans 2 cols, body (2,2) spans 2 rows
        const rows = 4
        const cols = 3
        const cells: [number, number, number, number][] = [
            [0, 0, 1, 1],
            [0, 1, 1, 1],
            [0, 2, 1, 1],
            [1, 0, 1, 2],
            [1, 2, 1, 1],
            [2, 0, 1, 1],
            [2, 1, 1, 1],
            [2, 2, 2, 1],
            [3, 0, 1, 1],
            [3, 1, 1, 1],
        ]
        const h = new Map<string, number>()
        const v = new Map<string, number>()
        const bump = (m: Map<string, number>, k: string) =>
            m.set(k, (m.get(k) ?? 0) + 1)
        for (const [row, col, rowSpan, colSpan] of cells) {
            const { edges } = cellEdges({
                row,
                col,
                rowSpan,
                colSpan,
                rows,
                cols,
                headerRows: 1,
            })
            for (let c = col; c < col + colSpan; c++) {
                if (edges.includes('top')) bump(h, `${row}:${c}`)
                if (edges.includes('bottom')) bump(h, `${row + rowSpan}:${c}`)
            }
            for (let r = row; r < row + rowSpan; r++) {
                if (edges.includes('left')) bump(v, `${r}:${col}`)
                if (edges.includes('right')) bump(v, `${r}:${col + colSpan}`)
            }
        }
        // horizontal lines y=0..4 across 3 cols, minus the interior line inside (2,2)'s span
        for (let y = 0; y <= rows; y++)
            for (let c = 0; c < cols; c++) {
                const inside = y === 3 && c === 2
                expect(h.get(`${y}:${c}`) ?? 0).toBe(inside ? 0 : 1)
            }
        // vertical lines x=0..3 across 4 rows, minus the interior line inside (1,0)'s span
        for (let r = 0; r < rows; r++)
            for (let x = 0; x <= cols; x++) {
                const inside = r === 1 && x === 1
                expect(v.get(`${r}:${x}`) ?? 0).toBe(inside ? 0 : 1)
            }
    })
})
