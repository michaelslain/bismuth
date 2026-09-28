// The frontend write seam for editing/deleting/moving a task, regardless of whether it is a
// checkbox LINE (in some other note) or a row STORED in a base's own body. Mirrors the split
// `toggleTaskRow`/`setTaskRowStatus` (BaseView.tsx) already make between the two origins, so a
// caller (TaskEditModal, TaskRow's edit button) asks one question — `isEditableTask` — and then
// calls one function each for update/delete/move without re-deriving which write path applies.
//
// Framework-free except for `api` — pure enough to unit test the branching without Solid or a
// DOM, matching taskWrite.ts's own discipline.
import { api } from '../api'
import type { Row } from '../../../core/src/bases/types'
import { canWriteStoredRow, storedNote } from './taskWrite'

export type TaskPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest'

export type TaskPatch = {
    description?: string
    due?: string | null
    scheduled?: string | null
    priority?: TaskPriority | null
    // Stored rows only — a free-text/select column naming the task's category. Ignored for a
    // task LINE, which has no such column at all.
    category?: string | null
}

/** Can this row be edited/deleted/moved from the UI at all? A task LINE (has a source line
 *  number) or a stored row this Row can address by index (canWriteStoredRow) — anything else
 *  (a placeholder row still waiting on its rowCreate round-trip, a row with no write handle)
 *  gets no edit affordance, matching BaseView's own toggle/status-menu guards. */
export function isEditableTask(row: Row): boolean {
    return typeof row.note.line === 'number' || canWriteStoredRow(row)
}

/** Apply `patch` to a task — a LINE patches its source note via `POST /tasks/update`; a
 *  STORED row patches the base file's row via `rowUpdate`, built from `storedNote(row)` (never
 *  `row.note` directly) so a normalizer-derived column is never baked back in as a stale value
 *  — see taskWrite.ts's `storedNote` header for why. `opts.categoryField` names which column
 *  `patch.category` writes (default `'category'`); `null` deletes that key rather than storing
 *  an empty string. Throws (rejects) on a write failure — callers show it via pushToast, same
 *  as every other write in BaseView. */
export async function updateTask(
    row: Row,
    patch: TaskPatch,
    opts?: { categoryField?: string },
): Promise<void> {
    const line = row.note.line
    if (typeof line === 'number') {
        await api.updateTaskLine(row.file.path, line, {
            description: patch.description,
            due: patch.due,
            scheduled: patch.scheduled,
            priority: patch.priority,
        })
        return
    }
    if (!canWriteStoredRow(row)) throw new Error('task is not editable')
    const note = { ...storedNote(row) }
    if (patch.description !== undefined) note.description = patch.description
    if (patch.due !== undefined) {
        if (patch.due === null) delete note.due
        else note.due = patch.due
    }
    if (patch.scheduled !== undefined) {
        if (patch.scheduled === null) delete note.scheduled
        else note.scheduled = patch.scheduled
    }
    if (patch.priority !== undefined) {
        if (patch.priority === null) delete note.priority
        else note.priority = patch.priority
    }
    if (patch.category !== undefined) {
        const field = opts?.categoryField ?? 'category'
        if (patch.category === null) delete note[field]
        else note[field] = patch.category
    }
    await api.rowUpdate(row.file.path, row.index!, note)
}

/** Delete a task — a LINE removes its block via `POST /tasks/delete`; a STORED row deletes
 *  the row via `rowDelete`. */
export async function deleteTask(row: Row): Promise<void> {
    const line = row.note.line
    if (typeof line === 'number') {
        await api.deleteTaskLine(row.file.path, line)
        return
    }
    if (!canWriteStoredRow(row)) throw new Error('task is not editable')
    await api.rowDelete(row.file.path, row.index!)
}

/** Move a task LINE to another note (`to`: a taskFile-style ref — wikilink, bare name, or
 *  path — resolved server-side). Returns the path it now lives in. Stored rows have no note
 *  to move TO in this sense (their "note" is the base file itself); callers gate this behind
 *  a line-task check (`typeof row.note.line === 'number'`), same as `isEditableTask` implies
 *  when offering the move UI. */
export async function moveTask(row: Row, to: string): Promise<string> {
    const line = row.note.line
    if (typeof line !== 'number')
        throw new Error('only a task line can be moved to another note')
    const { path } = await api.moveTaskLine(row.file.path, line, to)
    return path
}
