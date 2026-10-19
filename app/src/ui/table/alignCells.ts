// app/src/ui/table/alignCells.ts — a rendered markdown table's column alignment. marked carries a
// `:--` / `--:` column as an `align` attribute on each cell, and global.css's shared cell rule
// (`.bismuth-table th, td { text-align: left }`) outranks an attribute, so the alignment is set as
// an inline style instead — the note's table widget does the same (editor/tableWidget.ts). Left
// and right only: a centered column renders left (#53).

/** Carry each cell's `align="left|right"` onto it as an inline `text-align`. */
export function alignCells(table: HTMLTableElement) {
    for (const cell of Array.from(table.querySelectorAll('th, td'))) {
        const a = cell.getAttribute('align')
        if (a === 'left' || a === 'right')
            (cell as HTMLElement).style.textAlign = a
    }
}
