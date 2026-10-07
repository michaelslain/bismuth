// app/src/chat/typeBubbleTables.ts — types the cell grid of every markdown table inside a rendered
// chat bubble. The bubble's body is an HTML STRING (renderNoteBody → innerHTML), which cannot hold a
// Solid component, and the same renderer feeds notes, cards and exports where nothing could mount
// one — so the typed edges are mounted onto the cells AFTER the string lands, one Solid root per
// cell, into a `display: contents` span so the cell's own content is never touched. Which edges a
// cell owns is chatTableEdges.ts's (pure, tested); the glyphs are ui/ascii/AsciiCellEdges, so the
// grid is `+ - | =` in the UI font, exactly like the Bases table, and the cell carries no `border`.
import { render } from 'solid-js/web'
import AsciiCellEdges from '../ui/ascii/AsciiCellEdges'
import { cellEdges } from './chatTableEdges'

/** Mount the typed edges onto every table under `host`. Returns a disposer for those roots. */
export function typeBubbleTables(host: HTMLElement): () => void {
    const disposers: (() => void)[] = []
    for (const table of Array.from(host.querySelectorAll('table'))) {
        const headRows = Array.from(table.querySelectorAll('thead > tr'))
        const bodyRows = Array.from(table.querySelectorAll('tbody > tr'))
        const place = (row: Element, header: boolean, bodyRow: number) => {
            const cells = Array.from(row.children).filter(
                c => c.tagName === 'TH' || c.tagName === 'TD',
            )
            cells.forEach((cell, col) => {
                const { edges, heavy } = cellEdges({
                    header,
                    bodyRow,
                    bodyRows: bodyRows.length,
                    col,
                    cols: cells.length,
                })
                const mount = document.createElement('span')
                mount.style.display = 'contents'
                cell.appendChild(mount)
                disposers.push(
                    // A component is a function of its props: called directly (no JSX), so this
                    // stays a plain .ts module.
                    render(
                        () =>
                            AsciiCellEdges({
                                edges,
                                edgeWeight: heavy.length ? { bottom: 'heavy' } : undefined,
                            }),
                        mount,
                    ),
                )
            })
        }
        headRows.forEach(r => place(r, true, 0))
        bodyRows.forEach((r, i) => place(r, false, i))
    }
    return () => disposers.forEach(d => d())
}
