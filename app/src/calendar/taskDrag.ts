// Which row, and which date field, a reschedule rewrites — a chip dragged to another day
// (taskPointerDrag.ts) or moved with Alt+arrows. Pure, so the drag source (TaskChip), the day-cell
// drop targets (MonthCell, AllDayRow) and the writer share ONE definition of the shape.

/** Identifies one writable task row plus the date field a reschedule must rewrite. Exactly one
 *  of `line`/`index` is present: `line` for a markdown checkbox line (`POST /tasks/reschedule`
 *  addresses it by path+line), `index` for a row a base owns (`POST /rows` addresses it by
 *  path+index — see app/src/bases/taskWrite.ts's `canWriteStoredRow`). */
export interface TaskRowRef {
    path: string
    field: string
    line?: number
    index?: number
}
