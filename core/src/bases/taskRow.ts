// Browser-safe task<->row helpers. Pure: no filesystem imports, so the frontend
// can import these without pulling node:fs into the bundle. The vault-scanning
// buildTaskRows lives in tasksData.ts (server-only).
import type { Row } from './types'
import type { Task, TaskStatus } from '../tasks'
import { isResolvedStatus, statusToChar } from '../taskReorder'

/** One Row per checkbox line. Task fields live in note.*; line/path kept for write-back.
 *  `resolved` is the derived done-or-cancelled boolean (via `isResolvedStatus`, this
 *  codebase's existing word for the concept), distinct from `done`, which stays the
 *  raw done-DATE. `placed` is a pure function of the task — scheduled falling back to
 *  due — with no notion of today, so nothing here needs a clock. All SIX date keys
 *  (due/scheduled/start/done/created/cancelled) are carried onto note.* — the DSL
 *  translator emits filters against any of the six, so a row exposing only four of
 *  them would make `created`/`cancelled` filters silently match nothing. */
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
            created: task.created,
            cancelled: task.cancelled,
            resolved: isResolved,
            placed,
            recurring: !!task.recurrence,
            recurrence: task.recurrence,
            tags: task.tags,
        },
        formula: {},
    }
}

/** The `note.*` keys `normalizeStoredTaskRow` may FILL IN. Two kinds, and both belong here:
 *  values computed from the stored ones (`statusChar` `resolved` `placed` `recurring`) and
 *  shape defaults that make a stored row match what `taskToRow` always emits (`status`
 *  `priority` `tags`). The defaults are not cosmetic — `taskToRow` emits `priority: "none"`
 *  and `tags: []` unconditionally, so a stored row omitting them sorted and filtered
 *  DIFFERENTLY from a scanned one (`priority is none` translates to
 *  `note.priority == "none"`, which matched a scanned task and not a stored one).
 *
 *  This is the single source the normalizer reads. The stripper does not read it — it reads
 *  the `Row.derived` list the normalizer produced FROM it, which is what makes a user column
 *  that happens to share one of these names safe. */
export const DERIVED_TASK_ROW_KEYS = [
    'status',
    'statusChar',
    'priority',
    'tags',
    'resolved',
    'placed',
    'recurring',
] as const

/** The SECOND producer of the one task-row shape. `taskToRow` above projects a task SCANNED
 *  out of a note's checkbox line; this one takes a task the user STORED as a YAML row in a
 *  base's own body (`mode: tasks` with no `source:`) and fills in the fields a scanned row
 *  gets for free from the parser — so a stored task and a scanned task are indistinguishable
 *  to every view, sort and filter downstream.
 *
 *  It reuses the same helpers `taskToRow` does — `isResolvedStatus` for `resolved`,
 *  `scheduled ?? due` for `placed` — rather than re-deriving them, because two producers
 *  that each own a copy of the rule are exactly how the two drift apart.
 *
 *  **A stored column always wins.** These names are not reserved: a base is just a table, and
 *  someone can legitimately have a column called `placed` holding "shelf 3". Filling only
 *  what is ABSENT means their column keeps its value in the view, and — paired with the
 *  `Row.derived` record a write strips — cannot be deleted by a checkbox tick. The cost is
 *  that the computed value has nowhere to go for that row, so the calendar reads the user's
 *  string, fails to parse it as a date, and treats the row as unplaced. That is the correct
 *  trade: a column the user typed is data, and a value we can always recompute is not.
 *
 *  Idempotent: normalizing an already-normalized row reuses its `derived` list, so a key
 *  this function added on a previous pass is not mistaken for a stored column on the next.
 *
 *  A stored row carries no `line`/`raw` — it has no source line, and that is deliberately
 *  the ONE field-for-field difference between the producers, because it is the discriminator
 *  the write seam keys off: `note.line` means rewrite a markdown line, `row.index` means
 *  rewrite this row. Pure and non-mutating: the caller's `note` object is not touched. */
export function normalizeStoredTaskRow(row: Row): Row {
    const n = row.note
    // A key already recorded as filled was put there by an earlier pass, so it is ours to
    // overwrite again — not a stored column to protect.
    const alreadyFilled = new Set(row.derived ?? [])
    const isStored = (key: string) => key in n && !alreadyFilled.has(key)

    // A row that omits `status` is a task nobody has ticked yet, not a task with no status.
    const status = (
        isStored('status') && typeof n.status === 'string' && n.status
            ? n.status
            : 'todo'
    ) as TaskStatus

    const fills: Record<string, unknown> = {
        status,
        statusChar: statusToChar(status),
        priority: 'none',
        tags: [],
        resolved: isResolvedStatus(status),
        // Placement matches taskToRow and the calendar: scheduled first, due as fallback.
        placed: n.scheduled ?? n.due,
        recurring: !!n.recurrence,
    }

    const note: Record<string, unknown> = { ...n }
    const derived: string[] = []
    for (const key of DERIVED_TASK_ROW_KEYS) {
        if (isStored(key)) continue
        note[key] = fills[key]
        derived.push(key)
    }
    return { ...row, note, derived }
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
        created: n.created as string | undefined,
        cancelled: n.cancelled as string | undefined,
        // note.resolved/note.placed/note.recurring are derived and have no place on a
        // Task — none of the three round-trip back onto the reconstructed Task.
        recurrence: n.recurrence as string | undefined,
    }
}
