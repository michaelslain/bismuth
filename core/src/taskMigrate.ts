// Rewrite emoji task signifiers to bracket fields. Optional: parseTaskLine reads both
// spellings forever, so a vault never NEEDS this — it exists so someone can convert a
// whole vault in one pass if they want to. Pure — no I/O — so the CLI command owns the
// vault walk and the writes.
import { parseTaskLine } from './tasks'
import { DATE_KEYS, formatDateField } from './taskFields'

/** Rebuild one task line with every field in bracket form, in a fixed, deterministic
 * order: dates in DATE_KEYS order, then priority, then recurrence. Returns the input
 * unchanged (same string) when it is not a task line, or when the rebuild would be
 * identical to the input — so a caller can tell a real edit from a no-op by `!==`. */
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
    return rebuilt === line ? line : rebuilt
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
