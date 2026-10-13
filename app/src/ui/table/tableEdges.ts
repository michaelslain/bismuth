// app/src/ui/table/tableEdges.ts — pure: which edges of a markdown table's grid each cell types.
// The Typed Grid Rule (DESIGN.md): a cell grid is typed with `+ - | =` through AsciiCellEdges, never
// drawn with `border`, and each boundary is typed by EXACTLY ONE cell so neighbours never overprint.
// A cell types its top + left; a cell reaching the last column adds right, one reaching the last row
// adds bottom; the last header row types its bottom heavy (`=`) and the first body row omits top
// (the header's `=` is that line). A merged cell is placed by its span, so it owns the edges of the
// whole rectangle it covers.
export type CellEdge = 'top' | 'right' | 'bottom' | 'left'
export type CellEdges = {
    edges: CellEdge[]
    /** The horizontal edges drawn heavy (`=`). */
    heavy: ('top' | 'bottom')[]
}

export type CellPlace = {
    /** 0-based grid row and column of the cell's top-left slot. */
    row: number
    col: number
    rowSpan: number
    colSpan: number
    rows: number
    cols: number
    /** How many leading rows are the header (0 for a table without one). */
    headerRows: number
}

export function cellEdges(at: CellPlace): CellEdges {
    const endRow = at.row + at.rowSpan
    const edges: CellEdge[] = []
    // The first body row sits under the header, whose heavy bottom is that boundary.
    if (!(at.headerRows > 0 && at.row === at.headerRows)) edges.push('top')
    edges.push('left')
    if (at.col + at.colSpan === at.cols) edges.push('right')
    const headerBottom = at.row < at.headerRows && endRow === at.headerRows
    if (headerBottom || endRow === at.rows) edges.push('bottom')
    return { edges, heavy: headerBottom ? ['bottom'] : [] }
}
