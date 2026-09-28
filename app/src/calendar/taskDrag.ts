// The wire shape for dragging a task chip to another day (native HTML5 drag-and-drop), and for
// naming which row a reschedule (drag OR Alt+arrow) rewrites. Pure — no DOM, no framework — so
// TaskChip (the drag source) and the day-cell drop targets (MonthView.tsx, TaskAllDayStrip.tsx)
// share ONE definition of "which row, which field" instead of each hand-rolling its own shape,
// which is exactly how a source and a target drift apart.
export const TASK_DRAG_MIME = 'application/x-bismuth-task'

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

/** @deprecated alias of `TaskRowRef` — kept so existing imports of the drag payload's shape
 *  keep working; new code should name `TaskRowRef` directly. */
export type TaskDragPayload = TaskRowRef

export function encodeTaskDrag(p: TaskRowRef): string {
    return JSON.stringify(p)
}

/** Parses a drag payload, or null when it is missing/malformed/foreign — a drop target must
 *  never assume a `dragover` it accepted is one of OUR chips; some other draggable (a file
 *  tree row, browser text selection) can land on the same element. */
export function decodeTaskDrag(raw: string): TaskRowRef | null {
    if (!raw) return null
    let v: unknown
    try {
        v = JSON.parse(raw)
    } catch {
        return null
    }
    if (
        v &&
        typeof v === 'object' &&
        typeof (v as TaskRowRef).path === 'string' &&
        typeof (v as TaskRowRef).field === 'string' &&
        (typeof (v as TaskRowRef).line === 'number' ||
            typeof (v as TaskRowRef).index === 'number')
    )
        return v as TaskRowRef
    return null
}
