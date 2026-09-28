// Pure task LINE editing: rewrite a task's description/dates/priority in place, and find a
// task's BLOCK (the line plus any deeper-indented continuation/sub-task lines) for delete and
// move. Split out of tasks.ts (rather than added there) so the frontend can value-import these
// without dragging tasks.ts's fileAccess -> files.ts (node:fs/node:path) into the WebView
// bundle — same reasoning as taskFields.ts/taskReorder.ts/taskParse.ts (see their headers).
//
// `POST /tasks/update`/`/tasks/delete`/`/tasks/move` (core/src/server.ts) are the write-back
// seam for these; `app/src/bases/taskEdit.ts` is the frontend seam that calls those routes.
import type { Priority } from './tasks'
import { TASK_LINE } from './taskParse'
import { parseFields, formatDateField, type FieldKey } from './taskFields'

export type TaskPatch = {
    description?: string
    due?: string | null
    scheduled?: string | null
    start?: string | null
    priority?: Priority | null
}

const PRIORITY_BRACKET: Record<Exclude<Priority, 'none'>, string> = {
    highest: '[highest]',
    high: '[high]',
    medium: '[medium]',
    low: '[low]',
    lowest: '[lowest]',
}

/**
 * Rewrite one task line's description and/or `due`/`scheduled`/`start`/priority fields,
 * keeping the checkbox char, indentation, tags, and every OTHER bracket field (`done`,
 * `created`, `cancelled`, `every <rule>`) untouched. `patch.due`/`scheduled`/`start`/`priority`
 * set to `null` removes that field; `undefined` (the key simply absent) leaves it as-is.
 * `patch.description` replaces the description text (tags stay, same as parseFields.rest);
 * omitted leaves it as-is. Fields are re-emitted in the canonical order
 * `taskMigrate.ts` already uses (dates due/scheduled/start/done/created/cancelled, then
 * priority, then recurrence) so re-editing a line repeatedly is idempotent in layout, not just
 * content. Throws `"not a task line"` if given a non-task line, matching setTaskLineDate/
 * setTaskLineStatus in tasks.ts.
 */
export function updateTaskLineFields(line: string, patch: TaskPatch): string {
    const cr = line.endsWith('\r') ? '\r' : ''
    const bare = cr ? line.slice(0, -1) : line
    const m = TASK_LINE.exec(bare)
    if (!m) throw new Error('not a task line')
    const [, indent, statusChar, body] = m

    const fields = parseFields(body)
    const description =
        patch.description !== undefined ? patch.description.trim() : fields.rest

    const dates = { ...fields.dates }
    for (const key of ['due', 'scheduled', 'start'] as const) {
        if (!(key in patch)) continue
        const value = patch[key]
        if (value === null || value === undefined) delete dates[key]
        else dates[key] = value
    }

    const priority =
        'priority' in patch ? (patch.priority ?? undefined) : fields.priority

    const parts: string[] = [description]
    const dateOrder: FieldKey[] = [
        'due',
        'scheduled',
        'start',
        'done',
        'created',
        'cancelled',
    ]
    for (const key of dateOrder) {
        const iso = dates[key]
        if (iso) parts.push(formatDateField(key, iso))
    }
    if (priority && priority !== 'none') parts.push(PRIORITY_BRACKET[priority])
    if (fields.recurrence) parts.push(`[${fields.recurrence}]`)

    const newBody = parts
        .filter(p => p.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()

    return `${indent}- [${statusChar}] ${newBody}${cr}`
}

function leadingWidth(line: string): number {
    const m = /^[ \t]*/.exec(line)
    return m ? m[0].length : 0
}

/**
 * The line range `[start, end)` of the task ITEM at `lines[start]` — the head line plus every
 * following line that is deeper-indented and non-blank (a sub-task or a wrapped continuation),
 * stopping at a blank line, a line at or above the head's own indent, or end of file. Mirrors
 * the per-item rule `collectBlock` (taskReorder.ts) applies while walking a whole block, but
 * answers it for exactly ONE item rather than every sibling in the block — what delete/move
 * need, since a sibling task below it must NOT be swept up.
 */
export function taskItemRange(
    lines: string[],
    start: number,
): { start: number; end: number } {
    const baseIndent = leadingWidth(lines[start])
    let end = start + 1
    while (
        end < lines.length &&
        lines[end].trim() !== '' &&
        leadingWidth(lines[end]) > baseIndent
    ) {
        end++
    }
    return { start, end }
}

/**
 * Remove the task item at `line` (head + its indented continuation, via `taskItemRange`) from
 * `content`. Returns the rewritten content and the removed lines (without their EOLs) — the
 * latter is what `POST /tasks/move` re-appends to the destination note. `line` out of range
 * throws (callers map this onto `EINVAL`, same as the other task routes).
 */
export function removeTaskItem(
    content: string,
    line: number,
): { content: string; removed: string[] } {
    const eol = content.includes('\r\n') ? '\r\n' : '\n'
    const lines = content.split(/\r?\n/)
    if (line < 0 || line >= lines.length) throw new Error('line out of range')
    const { start, end } = taskItemRange(lines, line)
    const removed = lines.slice(start, end)
    const rest = [...lines.slice(0, start), ...lines.slice(end)]
    return { content: rest.join(eol), removed }
}
