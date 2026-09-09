// Browser-safe task<->row helpers. Pure: no filesystem imports, so the frontend
// can import these without pulling node:fs into the bundle. The vault-scanning
// buildTaskRows lives in tasksData.ts (server-only).
import type { Row } from './types'
import type { Task } from '../tasks'
import { isResolvedStatus } from '../taskReorder'

/** One Row per checkbox line. Task fields live in note.*; line/path kept for write-back.
 *  `resolved` is the derived done-or-cancelled boolean (via `isResolvedStatus`, this
 *  codebase's existing word for the concept), distinct from `done`, which stays the
 *  raw done-DATE. `placed` is a pure function of the task — scheduled falling back to
 *  due — with no notion of today, so nothing here needs a clock. */
export function taskToRow(task: Task): Row {
    const slash = task.path.lastIndexOf('/')
    const folder = slash >= 0 ? task.path.slice(0, slash) : ''
    const file = slash >= 0 ? task.path.slice(slash + 1) : task.path
    const name = file.replace(/\.md$/, '')
    const isResolved = isResolvedStatus(task.status)
    // Placement matches the calendar: scheduled first, due as the fallback.
    const placed = task.scheduled ?? task.due
    return {
        file: {
            name,
            basename: name,
            path: task.path,
            folder,
            ext: 'md',
            size: 0,
            ctime: 0,
            mtime: 0,
            tags: task.tags ?? [],
            links: [],
        },
        note: {
            description: task.description,
            status: task.status,
            statusChar: task.statusChar,
            priority: task.priority,
            line: task.line,
            raw: task.raw,
            due: task.due,
            scheduled: task.scheduled,
            start: task.start,
            done: task.done,
            resolved: isResolved,
            placed,
            recurring: !!task.recurrence,
            recurrence: task.recurrence,
            tags: task.tags,
        },
        formula: {},
    }
}

export function rowToTask(r: Row): Task {
    const n = r.note
    return {
        path: r.file.path,
        line: n.line as number,
        raw: n.raw as string,
        indent: '',
        status: n.status as Task['status'],
        statusChar: n.statusChar as string,
        description: n.description as string,
        priority: n.priority as Task['priority'],
        tags: (n.tags as string[]) ?? [],
        due: n.due as string | undefined,
        scheduled: n.scheduled as string | undefined,
        start: n.start as string | undefined,
        done: n.done as string | undefined,
        // note.resolved/note.placed/note.recurring are derived and have no place on a
        // Task — none of the three round-trip back onto the reconstructed Task.
        recurrence: n.recurrence as string | undefined,
    }
}
