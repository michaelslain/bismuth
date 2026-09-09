// Rewrite emoji task signifiers to bracket fields. Optional: parseTaskLine reads both
// spellings forever, so a vault never NEEDS this — it exists so someone can convert a
// whole vault in one pass if they want to. Pure — no I/O — so the CLI command owns the
// vault walk and the writes.
import { parseTaskLine, type Task } from './tasks'
import { DATE_KEYS, formatDateField } from './taskFields'

function sameTags(before: string[], after: string[]): boolean {
    if (before.length !== after.length) return false
    const a = [...before].sort()
    const b = [...after].sort()
    return a.every((t, i) => t === b[i])
}

// The two spellings disagree about what a valid value is. The sharpest case is a
// calendar-impossible date (`📅 2026-02-30`), which the emoji path accepts by shape
// alone but the bracket grammar rejects, so rebuilding it would drop the date and
// leave `[due 2026-02-30]` sitting in the description as plain text. A second case:
// the emoji parser computes `tags` from the body BEFORE cutting the 🔁 recurrence
// tail, so a tag written AFTER the marker still counts — but wrapping that tail into
// one bracket makes the reparse swallow it whole as the recurrence value, and the tag
// is never re-extracted. Comparing every field the parser reports — status,
// description, priority, recurrence, tags, and all six dates — rather than
// special-casing either failure, catches both AND any future signifier where the
// spellings disagree the same way.
export function fieldsSurvived(before: Task, after: Task): boolean {
    if (before.statusChar !== after.statusChar) return false
    if (before.description !== after.description) return false
    if (before.priority !== after.priority) return false
    if (before.recurrence !== after.recurrence) return false
    if (!sameTags(before.tags, after.tags)) return false
    return DATE_KEYS.every(key => before[key] === after[key])
}

/** Rebuild one task line with every field in bracket form, in a fixed, deterministic
 * order: dates in DATE_KEYS order, then priority, then recurrence. Returns the input
 * unchanged (same string) when it is not a task line, when the rebuild would be
 * identical to the input, or when re-parsing the rebuilt line would not reproduce
 * every field of the original — status, description, priority, recurrence, tags, and
 * all six dates — so a caller can tell a real edit from a no-op by `!==`, and a line
 * the migration cannot safely convert simply stays in its old spelling (the parser
 * reads emoji forever, so that is always safe). */
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
 * byte untouched. Preserves EACH LINE'S OWN terminator rather than normalizing the
 * whole file to one EOL — a file mixing CRLF and LF keeps every line's original
 * ending, so a one-line migration stays a one-line diff instead of rewriting every
 * terminator in the file. `changed` counts only lines that were actually rewritten. */
export function migrateContent(text: string): { content: string; changed: number } {
    // A capturing group in the split regex keeps each terminator as its own array
    // element, alternating with the line content ahead of it, so every line can be
    // rejoined with the EXACT terminator it started with.
    const parts = text.split(/(\r\n|\r|\n)/)
    let changed = 0
    let content = ''
    for (let i = 0; i < parts.length; i += 2) {
        const line = parts[i]
        const term = parts[i + 1] ?? ''
        const migrated = migrateTaskLine(line)
        if (migrated !== line) changed++
        content += migrated + term
    }
    return { content, changed }
}
