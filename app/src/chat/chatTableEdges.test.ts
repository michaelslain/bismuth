import { describe, expect, test } from 'bun:test'
import { cellEdges } from './chatTableEdges'

describe('cellEdges', () => {
    test('a header cell types top + left and a heavy bottom; the last column adds right', () => {
        expect(
            cellEdges({ header: true, bodyRow: 0, bodyRows: 2, col: 0, cols: 2 }),
        ).toEqual({ edges: ['top', 'left', 'bottom'], heavy: ['bottom'] })
        expect(
            cellEdges({ header: true, bodyRow: 0, bodyRows: 2, col: 1, cols: 2 }),
        ).toEqual({ edges: ['top', 'left', 'right', 'bottom'], heavy: ['bottom'] })
    })

    test('the first body row omits top — the header owns that line', () => {
        const e = cellEdges({ header: false, bodyRow: 0, bodyRows: 3, col: 0, cols: 2 })
        expect(e.edges).toEqual(['left'])
    })

    test('a middle body row types top + left; the last row adds bottom', () => {
        expect(
            cellEdges({ header: false, bodyRow: 1, bodyRows: 3, col: 0, cols: 2 }).edges,
        ).toEqual(['top', 'left'])
        expect(
            cellEdges({ header: false, bodyRow: 2, bodyRows: 3, col: 1, cols: 2 }).edges,
        ).toEqual(['top', 'left', 'right', 'bottom'])
    })

    test('a single body row is the first AND the last: left + right + bottom (one column)', () => {
        expect(
            cellEdges({ header: false, bodyRow: 0, bodyRows: 1, col: 0, cols: 1 }).edges,
        ).toEqual(['left', 'right', 'bottom'])
    })

    test('no horizontal boundary is typed twice (header + 2 body rows x 2 cols = 4 lines)', () => {
        // horizontal lines: top of the header, header bottom (= first body top), row-1 top, final
        // bottom — each typed by exactly one cell per column. Vertical boundaries are counted below.
        const cols = 2
        const bodyRows = 2
        const count = { top: 0, bottom: 0, left: 0, right: 0 }
        for (let c = 0; c < cols; c++) {
            const h = cellEdges({ header: true, bodyRow: 0, bodyRows, col: c, cols })
            count.top += h.edges.includes('top') ? 1 : 0
            count.bottom += h.edges.includes('bottom') ? 1 : 0
            count.left += h.edges.includes('left') ? 1 : 0
            count.right += h.edges.includes('right') ? 1 : 0
            for (let r = 0; r < bodyRows; r++) {
                const b = cellEdges({ header: false, bodyRow: r, bodyRows, col: c, cols })
                count.top += b.edges.includes('top') ? 1 : 0
                count.bottom += b.edges.includes('bottom') ? 1 : 0
                count.left += b.edges.includes('left') ? 1 : 0
                count.right += b.edges.includes('right') ? 1 : 0
            }
        }
        // 4 horizontal lines x 2 cols (see above).
        expect(count.top + count.bottom).toBe(4 * cols)
        // vertical: every cell types its own left; only the last column types the table's right
        expect(count.left).toBe(cols * (bodyRows + 1))
        expect(count.right).toBe(bodyRows + 1)
    })
})
