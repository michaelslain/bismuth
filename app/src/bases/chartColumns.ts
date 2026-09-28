import type { Row } from '../../../core/src/bases/types'

/** A measured character grid for a chart body: how many mono-font columns fit its width, and the
 *  pixel width of one such column (from a hidden 10-character probe — see ChartFrame.tsx). */
export type ChartGrid = { columns: number; cellWidth: number }

/** Column count for a `widthPx`-wide body at `cellPx` per character — floored, never below 20 (a
 *  chart must still render in a narrow ~300px pane). A cell width of 0 or less (not yet measured)
 *  falls back to 20 rather than dividing by zero or going negative. */
export function columnsFor(widthPx: number, cellPx: number): number {
    if (cellPx <= 0) return 20
    return Math.max(20, Math.floor(widthPx / cellPx))
}

/** The label a drill-list row (or any per-bucket note reference) shows for a `Row`. A base-table
 *  row (one parsed out of an inline base body, `row.index` defined) has no real file of its own —
 *  its first non-empty string note value stands in, falling back to `file.basename` when every
 *  note value is empty/non-string. A distinct-note row (`index` undefined) always uses its
 *  `file.basename`. */
export function rowLabel(row: Row): string {
    if (row.index !== undefined) {
        for (const value of Object.values(row.note)) {
            if (typeof value === 'string' && value !== '') return value
        }
    }
    return row.file.basename
}
