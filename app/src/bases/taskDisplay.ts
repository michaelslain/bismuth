// The pure display derivations a task row needs, in a plain module with no framework
// imports — so <TaskRow>, <TaskCheck> and <TableView>'s task cells all read the SAME rules
// instead of each carrying a copy. Two of the three used to live inside ListView.tsx, where
// nothing else could reach them; the third (`isOverdue`) was an inline expression there and
// had to become shared the moment the table grew overdue styling of its own.
import type { TaskCheckStatus } from './TaskCheck'

/** Task status (todo/done/in-progress/cancelled/other) -> the checkbox's `data-status`
 *  (matches livePreview's `.cm-task-checkbox` glyph states). Anything unrecognised reads as
 *  todo, which is also what an EMPTY box means — a stored row with no `status` column. */
export function checkStatus(s: unknown): TaskCheckStatus {
    if (s === 'done') return 'done'
    if (s === 'in-progress') return 'doing'
    if (s === 'cancelled') return 'cancelled'
    return 'todo'
}

// The bare reserved-word bracket form the syntax itself uses (`[highest]` … `[lowest]`) —
// not the Obsidian-Tasks emoji ladder (🔺⏫🔼🔽⏬) this used to hold. "No emoji, ever."
export const PRIORITY_MARK: Record<string, string> = {
    highest: '[highest]',
    high: '[high]',
    medium: '[medium]',
    low: '[low]',
    lowest: '[lowest]',
}

/**
 * Is this task late? A due date strictly in the past, on a task nobody has finished.
 *
 * "Finished" is `note.resolved` — the derived done-OR-CANCELLED boolean BOTH row producers
 * emit (`taskToRow` and `normalizeStoredTaskRow`, core/src/bases/taskRow.ts). A cancelled
 * task cannot be late: it is not waiting to be done. The fallback to the raw status exists
 * for a row that never passed through either producer — a hand-built fixture, or a `source:
 * notes` row in tasks mode — where `resolved` is simply absent and the status is all there is.
 *
 * `today` is a parameter, not a `todayISO()` call, for the same reason the write seam takes
 * one: it makes every case assertable without pinning a clock, and it keeps one render's
 * rows from straddling midnight.
 */
export function isOverdue(
    note: Record<string, unknown>,
    today: string,
): boolean {
    const due = note.due
    if (typeof due !== 'string' || !due) return false
    const resolved =
        typeof note.resolved === 'boolean'
            ? note.resolved
            : note.status === 'done'
    return !resolved && due < today
}
