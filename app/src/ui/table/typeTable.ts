// app/src/ui/table/typeTable.ts — makes a rendered markdown `<table>` the one Bismuth table, wherever
// it was built: a note's editable table widget (editor/tableWidget.ts), or an HTML string of rendered
// markdown — a chat message, a card face, a transclusion (MarkdownTable.tsx) or an html/pdf export
// (exportTables.ts). None of them can hold a Solid component tree around its cells — an HTML
// string's cells exist before any component does, the editor's are rewritten on every focus and
// blur — so the table is adopted after it exists:
//   - `bismuth-table` on the `<table>` picks up global.css's table section: cell padding, top
//     alignment, and wrapping only between whole words, so auto layout sizes every column from its
//     real content (a one-word column takes its word's width, the prose column takes the wrapping);
//   - a `:--` / `--:` column keeps its alignment (alignCells.ts): marked carries it as an `align`
//     attribute, which the shared cell rule outranks, so it is set inline instead, as the note's
//     table widget does. Left and right only — a centered column renders left (tableWidget.ts, #53);
//   - every code token in a cell gets `<wbr>`s at its joints (codeBreaks.ts), so one long path cannot
//     set its column's minimum width to the whole path;
//   - every run of text too long to keep whole (longRuns.ts: a bare URL, a long link label or word)
//     is wrapped in `bismuth-long-run`, which may break anywhere, so it wraps at its cell's edge
//     instead of widening its column past the table's frame;
//   - every visible cell hosts its own AsciiCellEdges (DESIGN.md's Typed Grid Rule), with the edges
//     it owns decided by tableEdges.ts from its place and span in the grid.
import { render } from 'solid-js/web'
import AsciiCellEdges from '../ascii/AsciiCellEdges'
import { alignCells } from './alignCells'
import { codeBreaks } from './codeBreaks'
import { longRuns } from './longRuns'
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

/** Wrap every run under `root` too long to keep whole in a `bismuth-long-run` span. Math lays out its
 *  own glyphs, the typed edges are not text, and an in-cell editor owns its DOM, so all three are
 *  left alone. A note's whole table sits inside the note editor's own `contenteditable`, so only an
 *  editor inside `root` counts. */
export function breakLongRuns(root: Element) {
    const skip = (node: Node) => {
        const el = node.parentElement
        if (!el) return true
        if (el.closest('.bismuth-long-run, .katex, [data-table-edges]'))
            return true
        const editor = el.closest('[contenteditable="true"]')
        return !!editor && root.contains(editor)
    }
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node =>
            skip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    })
    const texts: Text[] = []
    for (let n = walk.nextNode(); n; n = walk.nextNode()) texts.push(n as Text)
    for (const node of texts) {
        const pieces = longRuns(node.textContent ?? '')
        if (!pieces.some(p => p.long)) continue
        const frag = document.createDocumentFragment()
        for (const piece of pieces) {
            if (!piece.long) {
                frag.appendChild(document.createTextNode(piece.text))
                continue
            }
            const run = document.createElement('span')
            run.className = 'bismuth-long-run'
            run.textContent = piece.text
            frag.appendChild(run)
        }
        node.replaceWith(frag)
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
    alignCells(table)
    breakCode(table)
    breakLongRuns(table)
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
            breakLongRuns(cell)
        },
        dispose() {
            disposers.forEach(d => d())
            mounts.forEach(m => m.remove())
            mounts.clear()
        },
    }
}
