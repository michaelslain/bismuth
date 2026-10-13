// app/src/ui/table/typeTable.ts — makes a rendered markdown `<table>` the one Bismuth table, wherever
// it was built: a chat message's HTML string (chat/ChatTable.tsx) or a note's editable table widget
// (editor/tableWidget.ts). Neither can hold a Solid component tree around its cells — the chat's
// cells come from an HTML string, the editor's are rewritten on every focus and blur — so the table
// is adopted after it exists:
//   - `bismuth-table` on the `<table>` picks up global.css's table section: cell padding, top
//     alignment, and wrapping only between whole words, so auto layout sizes every column from its
//     real content (a one-word column takes its word's width, the prose column takes the wrapping);
//   - every code token in a cell gets `<wbr>`s at its joints (codeBreaks.ts), so one long path cannot
//     set its column's minimum width to the whole path;
//   - every visible cell hosts its own AsciiCellEdges (DESIGN.md's Typed Grid Rule), with the edges
//     it owns decided by tableEdges.ts from its place and span in the grid.
import { render } from 'solid-js/web'
import AsciiCellEdges from '../ascii/AsciiCellEdges'
import { codeBreaks } from './codeBreaks'
import { cellEdges } from './tableEdges'

export type TypedTable = {
    /** Put a cell's edges back after its content was rewritten (innerHTML, replaceChildren). */
    reattach(cell: Element): void
    dispose(): void
}

const isCell = (el: Element) => el.tagName === 'TH' || el.tagName === 'TD'
const isShown = (el: Element) => (el as HTMLElement).style.display !== 'none'

/** Give every code token under `root` its break opportunities as `<wbr>`s (copied text is unchanged). */
export function breakCode(root: Element) {
    for (const code of Array.from(root.querySelectorAll('code'))) {
        if (code.querySelector('wbr')) continue
        for (const node of Array.from(code.childNodes)) {
            if (node.nodeType !== Node.TEXT_NODE) continue
            const pieces = codeBreaks(node.textContent ?? '')
            if (pieces.length < 2) continue
            const frag = document.createDocumentFragment()
            pieces.forEach((piece, i) => {
                if (i) frag.appendChild(document.createElement('wbr'))
                frag.appendChild(document.createTextNode(piece))
            })
            node.replaceWith(frag)
        }
    }
}

/** Each shown cell's place in the grid, resolving row and column spans. */
function placeCells(table: HTMLTableElement) {
    const rows = Array.from(table.rows)
    const taken: boolean[][] = rows.map(() => [])
    const placed: {
        cell: Element
        row: number
        col: number
        rowSpan: number
        colSpan: number
    }[] = []
    let cols = 0
    rows.forEach((tr, row) => {
        let col = 0
        for (const cell of Array.from(tr.children)) {
            if (!isCell(cell) || !isShown(cell)) continue
            while (taken[row][col]) col++
            const td = cell as HTMLTableCellElement
            const rowSpan = Math.max(
                1,
                Math.min(td.rowSpan || 1, rows.length - row),
            )
            const colSpan = Math.max(1, td.colSpan || 1)
            for (let r = row; r < row + rowSpan; r++)
                for (let c = col; c < col + colSpan; c++) taken[r][c] = true
            placed.push({ cell, row, col, rowSpan, colSpan })
            col += colSpan
            cols = Math.max(cols, col)
        }
    })
    // leading rows whose shown cells are all header cells
    let headerRows = 0
    while (
        headerRows < rows.length &&
        Array.from(rows[headerRows].children).some(
            c => isCell(c) && isShown(c),
        ) &&
        Array.from(rows[headerRows].children)
            .filter(c => isCell(c) && isShown(c))
            .every(c => c.tagName === 'TH')
    )
        headerRows++
    return { placed, rows: rows.length, cols, headerRows }
}

/** Type `table` as a Bismuth table. Call again (after `dispose`) when its shape or merges change. */
export function typeTable(table: HTMLTableElement): TypedTable {
    table.classList.add('bismuth-table')
    breakCode(table)
    const mounts = new Map<Element, HTMLElement>()
    const disposers: (() => void)[] = []
    const { placed, rows, cols, headerRows } = placeCells(table)
    for (const { cell, row, col, rowSpan, colSpan } of placed) {
        const { edges, heavy } = cellEdges({
            row,
            col,
            rowSpan,
            colSpan,
            rows,
            cols,
            headerRows,
        })
        // `display: contents`, so the overlay's host box is the cell itself
        const mount = document.createElement('span')
        mount.style.display = 'contents'
        mount.setAttribute('data-table-edges', '')
        cell.appendChild(mount)
        mounts.set(cell, mount)
        disposers.push(
            // A component is a function of its props: called directly (no JSX), so this stays a
            // plain .ts module.
            render(
                () =>
                    AsciiCellEdges({
                        edges,
                        edgeWeight: heavy.length
                            ? { bottom: 'heavy' }
                            : undefined,
                    }),
                mount,
            ),
        )
    }
    return {
        reattach(cell) {
            const mount = mounts.get(cell)
            if (mount && mount.parentNode !== cell) cell.appendChild(mount)
            breakCode(cell)
        },
        dispose() {
            disposers.forEach(d => d())
            mounts.forEach(m => m.remove())
            mounts.clear()
        },
    }
}
