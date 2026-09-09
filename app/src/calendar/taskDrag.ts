// The wire shape for dragging a task chip to another day (native HTML5 drag-and-drop).
// Pure — no DOM, no framework — so TaskChip (the drag source) and the day-cell drop targets
// (MonthView.tsx, TaskAllDayStrip.tsx) share ONE definition of the payload instead of each
// hand-rolling its own JSON shape, which is exactly how a source and a target drift apart.
export const TASK_DRAG_MIME = 'application/x-bismuth-task'

export interface TaskDragPayload {
    path: string
    line: number
    // Which field the drop must rewrite — 'scheduled'/'due'/whatever dateField the view
    // pinned. Computed ONCE at drag-start (taskPlacement.ts's placementField, already known
    // there via PlacedTask.field) and carried along, rather than re-derived at drop time,
    // so the drop target needs no access to the row or the view config at all.
    field: string
}

export function encodeTaskDrag(p: TaskDragPayload): string {
    return JSON.stringify(p)
}

/** Parses a drag payload, or null when it is missing/malformed/foreign — a drop target must
 *  never assume a `dragover` it accepted is one of OUR chips; some other draggable (a file
 *  tree row, browser text selection) can land on the same element. */
export function decodeTaskDrag(raw: string): TaskDragPayload | null {
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
        typeof (v as TaskDragPayload).path === 'string' &&
        typeof (v as TaskDragPayload).line === 'number' &&
        typeof (v as TaskDragPayload).field === 'string'
    )
        return v as TaskDragPayload
    return null
}
