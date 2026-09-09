// Rewrite emoji task signifiers to bracket fields. Optional: parseTaskLine reads both
// spellings forever, so a vault never NEEDS this — it exists so someone can convert a
// whole vault in one pass if they want to. Pure — no I/O — so the CLI command owns the
// vault walk and the writes.
import { parseTaskLine, type Task } from './tasks'
import { DATE_KEYS, formatDateField } from './taskFields'

// The two spellings disagree about what a valid value is — the sharpest case is a
// calendar-impossible date (`📅 2026-02-30`), which the emoji path accepts by shape
// alone but the bracket grammar rejects, so rebuilding it would drop the date and
// leave `[due 2026-02-30]` sitting in the description as plain text. Comparing every
// field the parser reports, rather than special-casing dates, catches that AND any
// future signifier where the spellings disagree the same way.
function fieldsSurvived(before: Task, after: Task): boolean {
    if (before.statusChar !== after.statusChar) return false
    if (before.description !== after.description) return false
    if (before.priority !== after.priority) return false
    if (before.recurrence !== after.recurrence) return false
    return DATE_KEYS.every(key => before[key] === after[key])
}

/** Rebuild one task line with every field in bracket form, in a fixed, deterministic
 * order: dates in DATE_KEYS order, then priority, then recurrence. Returns the input
 * unchanged (same string) when it is not a task line, when the rebuild would be
 * identical to the input, or when re-parsing the rebuilt line would not reproduce
 * every field of the original — so a caller can tell a real edit from a no-op by
 * `!==`, and a line the migration cannot safely convert simply stays in its old
 * spelling (the parser reads emoji forever, so that is always safe). */
export function migrateTaskLine(line: string): string {
    const task = parseTaskLine(line, '', 0)
    if (!task) return line

    const cr = line.endsWith('\r') ? '\r' : ''
    // TASK_LINE's indent group ends exactly where the bullet character starts, so this
    // reads the original bullet without tasks.ts needing to capture it separately.
    const bullet = line.slice(task.indent.length, task.indent.length + 1)

    const fields: string[] = []
    for (const key of DATE_KEYS) {
        const iso = task[key]
        if (iso) fields.push(formatDateField(key, iso))
    }
    if (task.priority !== 'none') fields.push(`[${task.priority}]`)
    if (task.recurrence) fields.push(`[${task.recurrence}]`)
    const suffix = fields.length ? ` ${fields.join(' ')}` : ''

    const rebuilt = `${task.indent}${bullet} [${task.statusChar}] ${task.description}${suffix}${cr}`
    if (rebuilt === line) return line

    const reparsed = parseTaskLine(rebuilt, '', 0)
    if (!reparsed || !fieldsSurvived(task, reparsed)) return line

    return rebuilt
}

/** Migrate every task line in a file's content, leaving every other line byte for
 * byte untouched. Preserves the file's existing line ending (CRLF vs LF), the way
 * `archiveResolvedTasks` does. `changed` counts only lines that were actually rewritten. */
export function migrateContent(text: string): { content: string; changed: number } {
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    let changed = 0
    const lines = text.split(/\r?\n/).map(line => {
        const migrated = migrateTaskLine(line)
        if (migrated !== line) changed++
        return migrated
    })
    return { content: lines.join(eol), changed }
}
