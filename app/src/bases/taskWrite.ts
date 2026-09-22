// The stored-row analogues of `toggleTaskLine` / `setTaskLineStatus` (core/src/tasks.ts).
// A task stored as a YAML row in a base's own body has no source line to rewrite, so the
// same rules have to be expressed over the row's `note` object instead.
//
// Pure: no framework imports, no `api` import, no clock — `today` is a parameter, exactly
// as it is for the line writers. That is what makes every rule below assertable without a
// browser, and it keeps the caller (BaseView's write seam) free to decide what to POST.
//
// The rules are NOT re-derived. Recurrence advancement is `advanceDateByRecurrence` from
// core/src/taskFields.ts — the same function the markdown path calls — because two
// implementations of "every month" is precisely the drift this seam exists to remove.
import { advanceDateByRecurrence } from '../../../core/src/taskFields'
import type { TaskStatus } from '../../../core/src/tasks'
import type { Row } from '../../../core/src/bases/types'

/**
 * Can this row be written back by index? Ask it of the ROW, never of the base — "this is an
 * own-rows base, so every row is writable" is the assumption that makes data loss reachable.
 *
 * `Row.index` is the write-back handle, and a row can legitimately lack one (a note row, a
 * task-line row, a row from a body shape that does not stamp it). `JSON.stringify` DROPS an
 * undefined value, so an unguarded `api.rowUpdate(path, row.index!, note)` sends a body with
 * no `index` key at all — which the server now rejects with a 400 rather than appending a
 * duplicate or deleting row 0, but a 400 the user cannot explain is still a bad outcome.
 * A row that fails this test gets NO write affordance: read-only is correct and safe.
 *
 * `Number.isInteger`, not `typeof === 'number'`: `typeof NaN` is `'number'`, and so is `2.5`.
 * No producer can mint either today — `Row.index` comes from a loop counter — but "no producer
 * currently does" is a weaker guarantee than the check itself, and the server rejects both.
 *
 * A NEGATIVE index is excluded too, and deliberately — it is not the server's grammar, it is
 * KanbanView's own: a card optimistically added ahead of its `rowCreate` round-trip is given a
 * negative placeholder index so it can render before the server has assigned it a real slot.
 * That row is not yet a row the server knows about, so writing to it by index would either hit
 * nothing or, worse, collide with whatever real index the add eventually resolves to. See
 * `isStoredPlaceholder` below, which names this case explicitly for callers that need to tell
 * "not writable because it has no handle" apart from "not writable yet, wait for the add".
 */
export function canWriteStoredRow(row: Row): boolean {
    return Number.isInteger(row.index) && row.index! >= 0
}

/**
 * Is this row a pending placeholder — optimistically added, not yet confirmed by the server?
 * KanbanView mints a negative `Row.index` for a card shown ahead of its `rowCreate` round-trip,
 * so `Number.isInteger(row.index) && row.index! < 0` names exactly that row and nothing else:
 * a real stored row's index is always `>= 0` (a loop counter), and a row with no index at all
 * (a note row, a task-line row) is neither writable nor a placeholder — it is simply not a
 * stored row. Every KanbanView write entry point checks this FIRST and bails with no write
 * when it is true, rather than falling through to `canWriteStoredRow`'s `false` branch, which
 * for some callers (drag, rename, delete) would otherwise fall through to a note-file write
 * keyed off the row's `file.path` — and a placeholder's `file` is the BASE's own file, so that
 * write would silently target the base, not the card.
 */
export function isStoredPlaceholder(row: Row): boolean {
    return Number.isInteger(row.index) && row.index! < 0
}

/** A stored task row's `note`. Every key is whatever the user wrote in the base file. */
export type StoredTask = Record<string, unknown>

/** A write's result: the row as it should now be stored, plus — when completing a recurring
 *  task — the next occurrence to APPEND as a new row. `next` is undefined when there is
 *  nothing to spawn: no recurrence, an unrecognised rule, or no date to roll forward. */
export interface StoredTaskWrite {
    note: StoredTask
    next?: StoredTask
}

// Only the schedulable dates roll forward. `done`/`created`/`cancelled` record when
// something HAPPENED, so advancing them would invent history — same list, same reason, as
// `advanceRecurringBody` in core/src/tasks.ts.
const RECURRING_DATE_KEYS = ['due', 'scheduled', 'start'] as const

const isDate = (v: unknown): v is string =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** The row's note as it is STORED — the normalized note minus exactly the keys
 *  `normalizeStoredTaskRow` recorded as filled in (`Row.derived`).
 *
 *  Not a fixed name list. The names are not reserved: a base is a table, and a user may have
 *  a column called `placed` holding "shelf 3". Stripping by name would delete it on the
 *  first checkbox tick — three of the user's own columns destroyed silently, since the
 *  normalizer never adds a key it did not put there. Stripping by RECORD removes only what
 *  normalization contributed, so the write persists the user's row plus its own change and
 *  nothing else.
 *
 *  A row with no `derived` record (never normalized) strips nothing. That is the safe
 *  direction of the two: at worst a computed value is persisted, never a stored column
 *  deleted.
 *
 *  **Exported because it is the ONLY place `Row.derived` is honoured, and every write path
 *  needs it — not just the two in this file.** `serializeRows` does not strip: handed a
 *  normalized task row it writes all seven computed columns into the user's base body. So any
 *  write that starts from a row a view is holding — a cell edit, a kanban column drag, a
 *  calendar drag-to-reschedule — must build its `note` from this, never from `row.note`:
 *
 *      api.rowUpdate(basePath, row.index!, { ...storedNote(row), due: newDate })
 */
export function storedNote(row: Row): StoredTask {
    const out: StoredTask = { ...row.note }
    for (const key of row.derived ?? []) delete out[key]
    return out
}

/** The next occurrence of a recurring stored task, or undefined when there is none to
 *  spawn. Mirrors `advanceRecurringBody`'s `advanced` flag: a recurring task with no date
 *  to roll (or an unrecognised rule) yields nothing rather than a duplicate. */
function nextOccurrence(note: StoredTask): StoredTask | undefined {
    const rule = note.recurrence
    if (typeof rule !== 'string' || !rule) return undefined
    const out: StoredTask = { ...note, status: 'todo' }
    // A spawned occurrence has not been completed or cancelled — it starts clean. (The
    // markdown path leaves a STALE hand-written done/cancelled marker on the spawned line,
    // because it copies the body verbatim; a row is structured, so it can do better.)
    delete out.done
    delete out.cancelled
    let advanced = false
    for (const key of RECURRING_DATE_KEYS) {
        const cur = out[key]
        if (!isDate(cur)) continue
        const rolled = advanceDateByRecurrence(cur, rule)
        if (rolled) {
            out[key] = rolled
            advanced = true
        }
    }
    return advanced ? out : undefined
}

/** Mark a stored task done: stamp the done date unless one is already present (mirroring
 *  `withDone`, which leaves a hand-written date alone) and spawn the next occurrence. */
function complete(
    stored: StoredTask,
    status: TaskStatus,
    today: string,
): StoredTaskWrite {
    const out: StoredTask = { ...stored, status }
    if (!isDate(out.done)) out.done = today
    const next = nextOccurrence(stored)
    return next ? { note: out, next } : { note: out }
}

/** Mark a stored task not-done: clear the done date, because a task that says both "todo"
 *  and "done 2026-09-09" is the exact inconsistency `stripDone` exists to prevent. */
function uncomplete(stored: StoredTask, status: TaskStatus): StoredTaskWrite {
    const out: StoredTask = { ...stored, status }
    delete out.done
    return { note: out }
}

/**
 * Flip a stored task row between done and not-done — the row analogue of `toggleTaskLine`.
 * Only the DONE status flips back to todo: a cancelled or in-progress task is not done, so
 * ticking it completes it, exactly as ticking its checkbox would.
 *
 * Takes the ROW, not its note, because the write needs `Row.derived` to know which columns
 * are the user's and which normalization contributed. A bare note cannot carry that, and
 * asking the caller to pass both is an invitation to pass only one.
 */
export function toggleStoredTask(row: Row, today: string): StoredTaskWrite {
    const stored = storedNote(row)
    return row.note.status === 'done'
        ? uncomplete(stored, 'todo')
        : complete(stored, 'done', today)
}

/**
 * Set a stored task row to a SPECIFIC status — the row analogue of `setTaskLineStatus`,
 * and what the shared status menu writes. Target `done` stamps the done date and spawns a
 * recurring task's next occurrence; every other target clears the done date.
 *
 * `status` is a `TaskStatus` NAME, deliberately not a `string`. The shared status menu
 * (`app/src/taskStatusMenu.tsx`) hands back a BOX CHAR, and a char widened to `string`
 * compiles here and then takes the wrong branch: `'x' !== 'done'` un-completes, writing
 * `status: 'x'`, deleting the done date and spawning nothing — after which
 * `normalizeStoredTaskRow` reads `'x'` as an unknown status and renders the row UNTICKED.
 * Choosing "Done" would silently untick the task, with no error anywhere. Narrowing the
 * parameter makes that a compile error instead of a convention; bridge with
 * `statusFromChar` from `core/src/taskReorder`.
 */
export function setStoredTaskStatus(
    row: Row,
    status: TaskStatus,
    today: string,
): StoredTaskWrite {
    const stored = storedNote(row)
    return status === 'done'
        ? complete(stored, status, today)
        : uncomplete(stored, status)
}
