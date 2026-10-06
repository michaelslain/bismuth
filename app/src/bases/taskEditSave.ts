// The write half of the task edit modal: which fields changed, the status / patch / move writes
// that follow, and an undoable delete. Framework-free (only `api` + the task write seams) so the
// branching between a task LINE and a STORED row is unit-tested without a DOM.
import { api } from '../api'
import type { Row } from '../../../core/src/bases/types'
import type { TaskStatus } from '../../../core/src/tasks'
import { statusFromChar, statusToChar } from '../../../core/src/taskReorder'
import { leadingWidth, removeTaskItem } from '../../../core/src/taskEdit'
import { todayISO } from '../../../core/src/dates'
import { restoreRowAt } from './restoreRow'
import { setStoredTaskStatus, storedNote } from './taskWrite'
import {
    updateTask,
    deleteTask,
    moveTask,
    type TaskPatch,
    type TaskPriority,
} from './taskEdit'
import { clamp } from '../math'

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

/** Writes the status and returns the row later field patches must build on: a stored row's
 *  patch rebuilds the note from the row it is given, so it must see the new status. */
async function writeStatus(row: Row, statusChar: string): Promise<Row> {
    if (isLine(row)) {
        await api.toggleTask(row.file.path, row.note.line as number, statusChar)
        return row
    }
    const write = setStoredTaskStatus(
        row,
        statusFromChar(statusChar),
        todayISO(),
    )
    await api.rowUpdate(row.file.path, row.index!, write.note)
    if (write.next) await api.rowCreate(row.file.path, write.next)
    return { ...row, note: write.note, derived: [] }
}

/** Write only what differs between `initial` and `next`: status first, then one field patch,
 *  then (line tasks) the move. Rejects on a write failure; the caller toasts it. */
export async function saveTaskEdit(
    row: Row,
    initial: TaskEditFields,
    next: TaskEditFields,
    opts: { categoryField: string },
): Promise<void> {
    let target = row
    if (next.statusChar !== initial.statusChar)
        target = await writeStatus(row, next.statusChar)

    const patch: TaskPatch = {}
    if (next.description !== initial.description)
        patch.description = next.description
    if (next.due !== initial.due) patch.due = next.due
    if (next.scheduled !== initial.scheduled) patch.scheduled = next.scheduled
    if (next.priority !== initial.priority) patch.priority = next.priority
    if (!isLine(row) && next.category !== initial.category)
        patch.category = next.category || null
    if (Object.keys(patch).length)
        await updateTask(target, patch, { categoryField: opts.categoryField })

    if (isLine(row) && next.destPath !== initial.destPath)
        await moveTask(row, next.destPath)
}

/** Put a removed task block back into `content`, verbatim. `anchor` is the line that sat directly
 *  above the block at delete time: if it is still above `index` the block goes at `index`; if the
 *  note shifted and the anchor occurs exactly once, the block goes right after it; otherwise
 *  `index`, clamped to the note's current length (before a trailing newline's empty tail), so a
 *  note that shrank since the delete still gets the block back rather than an error. Whichever
 *  way `at` was chosen it then steps past any lines indented deeper than the block's own head:
 *  at delete time the line after the block was at or above the block's indent, so a deeper line
 *  now sitting there is new and belongs to the line above, not to the block. Pure. */
export function reinsertTaskBlock(
    content: string,
    block: string[],
    index: number,
    anchor?: string,
): string {
    const eol = content.includes('\r\n') ? '\r\n' : '\n'
    const lines = content.split(/\r?\n/)
    const max =
        lines.length > 1 && lines[lines.length - 1] === ''
            ? lines.length - 1
            : lines.length
    let at = clamp(index, 0, max)
    if (anchor !== undefined && lines[index - 1] !== anchor) {
        const first = lines.indexOf(anchor)
        if (first !== -1 && first === lines.lastIndexOf(anchor)) at = first + 1
    }
    const head = leadingWidth(block[0] ?? '')
    while (
        at < lines.length &&
        lines[at].trim() !== '' &&
        leadingWidth(lines[at]) > head
    )
        at++
    lines.splice(at, 0, ...block)
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
        const before = await api.read(path)
        const { removed } = removeTaskItem(before, line)
        const anchor = before.split(/\r?\n/)[line - 1]
        restore = async () => {
            await api.write(
                path,
                reinsertTaskBlock(await api.read(path), removed, line, anchor),
            )
        }
    } else {
        const note = { ...storedNote(row) }
        const index = row.index!
        restore = async () => {
            await restoreRowAt(path, note, index)
        }
    }
    await deleteTask(row)
    return restore
}
