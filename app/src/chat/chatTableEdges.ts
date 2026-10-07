// app/src/chat/chatTableEdges.ts — pure: which edges of a markdown table's grid each cell types.
// The Typed Grid Rule (DESIGN.md): a cell grid is typed with `+ - | =` through AsciiCellEdges, never
// drawn with `border`, and each boundary is typed by EXACTLY ONE cell so neighbours never overprint.
// A cell types its top + left; the last column adds right, the last row adds bottom; a header types
// its bottom heavy (`=`) and the first body row omits top (the header's `=` is that line).
export type CellEdge = 'top' | 'right' | 'bottom' | 'left'
export type CellEdges = {
    edges: CellEdge[]
    /** The horizontal edges drawn heavy (`=`). */
    heavy: ('top' | 'bottom')[]
}

export type CellPlace = {
    /** 0-based row within the table's own section: header row = 0 with `header`, else body row. */
    header: boolean
    /** Body row index, 0 = the first row under the header. Ignored for a header cell. */
    bodyRow: number
    bodyRows: number
    col: number
    cols: number
}

export function cellEdges(at: CellPlace): CellEdges {
    const lastCol = at.col === at.cols - 1
    if (at.header) {
        const edges: CellEdge[] = ['top', 'left']
        if (lastCol) edges.push('right')
        edges.push('bottom')
        return { edges, heavy: ['bottom'] }
    }
    const edges: CellEdge[] = []
    // The first body row sits under the header, whose heavy bottom is that boundary.
    if (at.bodyRow > 0) edges.push('top')
    edges.push('left')
    if (lastCol) edges.push('right')
    if (at.bodyRow === at.bodyRows - 1) edges.push('bottom')
    return { edges, heavy: [] }
}
