// The write half of the task edit modal: which fields changed, the status / patch / move writes
// that follow, and an undoable delete. Framework-free (only `api` + the task write seams) so the
// branching between a task LINE and a STORED row is unit-tested without a DOM.
import { api } from '../api'
import type { Row } from '../../../core/src/bases/types'
import type { TaskStatus } from '../../../core/src/tasks'
import { statusFromChar, statusToChar } from '../../../core/src/taskReorder'
import { removeTaskItem } from '../../../core/src/taskEdit'
import { parseBaseFile } from '../../../core/src/bases/parse'
import { todayISO } from '../../../core/src/dates'
import { setStoredTaskStatus, storedNote } from './taskWrite'
import {
    updateTask,
    deleteTask,
    moveTask,
    type TaskPatch,
    type TaskPriority,
} from './taskEdit'

// A Record over the union, so adding a priority to `TaskPriority` is a compile error here.
const PRIORITY_KEYS: Record<TaskPriority, true> = {
    highest: true,
    high: true,
    medium: true,
    low: true,
    lowest: true,
}
export const TASK_PRIORITIES = Object.keys(PRIORITY_KEYS) as TaskPriority[]

export type TaskEditFields = {
    description: string
    statusChar: string
    due: string | null
    scheduled: string | null
    priority: TaskPriority | null
    category: string
    destPath: string
}

function normPriority(v: unknown): TaskPriority | null {
    const s = typeof v === 'string' ? v : ''
    return s && s !== 'none' ? (s as TaskPriority) : null
}

const isLine = (row: Row) => typeof row.note.line === 'number'

/** The form's starting values, read off the row. */
export function initialTaskFields(
    row: Row,
    categoryField: string,
): TaskEditFields {
    const n = row.note
    return {
        description: String(n.description ?? ''),
        statusChar: isLine(row)
            ? String(n.statusChar ?? ' ')
            : statusToChar(String(n.status ?? 'todo') as TaskStatus),
        due: (n.due as string) || null,
        scheduled: (n.scheduled as string) || null,
        priority: normPriority(n.priority),
        category: (n[categoryField] as string) || '',
        destPath: row.file.path,
    }
}

async function writeStatus(row: Row, statusChar: string): Promise<void> {
    if (isLine(row)) {
        await api.toggleTask(row.file.path, row.note.line as number, statusChar)
        return
    }
    const write = setStoredTaskStatus(
        row,
        statusFromChar(statusChar),
        todayISO(),
    )
    await api.rowUpdate(row.file.path, row.index!, write.note)
    if (write.next) await api.rowCreate(row.file.path, write.next)
}

/** Write only what differs between `initial` and `next`: status first, then one field patch,
 *  then (line tasks) the move. Rejects on a write failure; the caller toasts it. */
export async function saveTaskEdit(
    row: Row,
    initial: TaskEditFields,
    next: TaskEditFields,
    opts: { categoryField: string },
): Promise<void> {
    if (next.statusChar !== initial.statusChar)
        await writeStatus(row, next.statusChar)

    const patch: TaskPatch = {}
    if (next.description !== initial.description)
        patch.description = next.description
    if (next.due !== initial.due) patch.due = next.due
    if (next.scheduled !== initial.scheduled) patch.scheduled = next.scheduled
    if (next.priority !== initial.priority) patch.priority = next.priority
    if (!isLine(row) && next.category !== initial.category)
        patch.category = next.category || null
    if (Object.keys(patch).length)
        await updateTask(row, patch, { categoryField: opts.categoryField })

    if (isLine(row) && next.destPath !== initial.destPath)
        await moveTask(row, next.destPath)
}

/** Put a removed task block back into `content` at line `index`, verbatim. `index` is clamped to
 *  the note's current length (before a trailing newline's empty tail), so a note that shrank
 *  since the delete still gets the block back rather than an error. Pure. */
export function reinsertTaskBlock(
    content: string,
    block: string[],
    index: number,
): string {
    const eol = content.includes('\r\n') ? '\r\n' : '\n'
    const lines = content.split(/\r?\n/)
    const max =
        lines.length > 1 && lines[lines.length - 1] === ''
            ? lines.length - 1
            : lines.length
    lines.splice(Math.max(0, Math.min(index, max)), 0, ...block)
    return lines.join(eol)
}

/** Delete now; resolves to the function that puts the task back EXACTLY. A line task's whole
 *  block (the line and its sub-tasks, verbatim) is snapshotted from the note first and undo
 *  re-inserts it at its original line index. A stored row returns at its original index (the
 *  rows API appends, then `rowReorder` moves it up). */
export async function deleteTaskUndoable(
    row: Row,
): Promise<() => Promise<void>> {
    const path = row.file.path
    let restore: () => Promise<void>
    if (isLine(row)) {
        const line = row.note.line as number
        const { removed } = removeTaskItem(await api.read(path), line)
        restore = async () => {
            await api.write(
                path,
                reinsertTaskBlock(await api.read(path), removed, line),
            )
        }
    } else {
        const note = { ...storedNote(row) }
        const index = row.index!
        restore = async () => {
            const meta = { name: row.file.name, path }
            const count = parseBaseFile(await api.read(path), meta).rows.length
            await api.rowCreate(path, note)
            if (index < count) await api.rowReorder(path, count, index)
        }
    }
    await deleteTask(row)
    return restore
}
