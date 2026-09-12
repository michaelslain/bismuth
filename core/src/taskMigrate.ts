// Rewrite emoji task signifiers to bracket fields. No longer optional: `parseTaskLine` reads
// the bracket spelling only, so an un-migrated line silently stops being a dated, prioritised
// or recurring task. This is the one path that still understands the old spelling — it reads
// through `core/src/taskLegacy.ts` and writes through the bracket grammar. Pure — no I/O — so
// the caller owns the vault walk and the writes.
import { parseTaskLine, type Task } from './tasks'
import { readLegacyLine, hasLegacySignifier } from './taskLegacy'
import { DATE_KEYS, formatDateField } from './taskFields'

function sameTags(before: string[], after: string[]): boolean {
    if (before.length !== after.length) return false
    const a = [...before].sort()
    const b = [...after].sort()
    return a.every((t, i) => t === b[i])
}

// The two spellings disagree about what a valid value is. The sharpest case is a
// calendar-impossible date (`📅 2026-02-30`), which the emoji path accepts by shape
// alone but the bracket grammar rejects, so the rebuilt line carries `[due 2026-02-30]`
// as plain description text rather than a date. Comparing every field the parser reports
// — status, description, priority, recurrence, tags, and all six dates — rather than
// special-casing that one failure, catches it AND any future signifier where the
// spellings disagree the same way.
//
// This used to be the guard that made migration REFUSE a line. It is now the predicate
// behind `flagged`: the rewrite happens either way and this only decides whether the
// migration report names the line for a human to look at.
export function fieldsSurvived(before: Task, after: Task): boolean {
    if (before.statusChar !== after.statusChar) return false
    if (before.description !== after.description) return false
    if (before.priority !== after.priority) return false
    if (before.recurrence !== after.recurrence) return false
    if (!sameTags(before.tags, after.tags)) return false
    return DATE_KEYS.every(key => before[key] === after[key])
}

/** Rebuild one line with every field in bracket form, in a fixed, deterministic order:
 *  dates in DATE_KEYS order, then priority, then recurrence. Reads the line with the LEGACY
 *  reader (core/src/taskLegacy.ts) — that is the whole point: `parseTaskLine` no longer sees
 *  emoji, so this is the last place the old spelling is understood.
 *
 *  It never declines. Refusing was correct while the reader lived forever and a skipped line
 *  kept working; with the reader gone, a skipped line silently stops being a task, which is
 *  strictly worse than a visibly wrong one. So the rewrite always happens, and `flagged` says
 *  whether re-parsing it reproduces every field. The one case that flags in practice is a
 *  calendar-impossible date (`📅 2026-02-30`): the emoji path validated only the SHAPE, the
 *  bracket grammar additionally requires a real day, so it becomes `[due 2026-02-30]` sitting
 *  in the description as literal text — which is the intended outcome. The user finally SEES
 *  the typo instead of carrying a date that can never match a real day, and the migration
 *  report names the file and line so it is findable.
 *
 *  The input is returned unchanged, and unflagged, when it is not a task line at all or when
 *  the rebuild is byte-identical to it — so a caller can tell a real edit from a no-op by
 *  `!==`, and a second run over an already-migrated vault reports nothing. */
export function migrateTaskLine(line: string): { line: string; flagged: boolean } {
    const task = readLegacyLine(line, '', 0)
    if (!task) return { line, flagged: false }

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
    if (rebuilt === line) return { line, flagged: false }

    const reparsed = parseTaskLine(rebuilt, '', 0)
    return { line: rebuilt, flagged: !reparsed || !fieldsSurvived(task, reparsed) }
}

// A fenced code block's delimiter: up to three leading spaces, then three or more backticks or
// tildes, then an info string. A BACKTICK fence's info string may not itself contain a backtick
// (CommonMark), which is what stops a line that merely holds an inline code span from reading as
// a fence opener.
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

function fenceOpener(line: string): string | null {
    const m = FENCE.exec(line)
    if (!m) return null
    if (m[1][0] === '`' && m[2].includes('`')) return null
    return m[1]
}

function fenceCloses(line: string, open: string): boolean {
    const m = FENCE.exec(line)
    if (!m) return false
    // Same delimiter character, at least as long, and no info string.
    return m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()
}

/** The contents of every inline code span on the line (paired runs of equal-length backticks).
 *  An UNMATCHED run is not a span and yields nothing, so a stray backtick cannot make a real
 *  task line invisible to migration. */
function codeSpans(line: string): string[] {
    const spans: string[] = []
    let i = 0
    while (i < line.length) {
        if (line[i] !== '`') {
            i++
            continue
        }
        let n = 0
        while (line[i + n] === '`') n++
        let j = i + n
        while (j < line.length) {
            if (line[j] !== '`') {
                j++
                continue
            }
            let m = 0
            while (line[j + m] === '`') m++
            if (m === n) {
                spans.push(line.slice(i + n, j))
                i = j + m
                break
            }
            j += m
        }
        if (j >= line.length) i += n // unmatched opener — literal backticks, not a span
    }
    return spans
}

/** Migrate every LEGACY task line in a file's content, leaving every other line byte for
 *  byte untouched. Preserves EACH LINE'S OWN terminator rather than normalizing the
 *  whole file to one EOL — a file mixing CRLF and LF keeps every line's original
 *  ending, so a one-line migration stays a one-line diff instead of rewriting every
 *  terminator in the file. `changed` counts the lines that were actually rewritten;
 *  `flagged` lists the 0-indexed line numbers whose rewrite did not round-trip, which
 *  is a subset of the changed ones.
 *
 *  The gate is PER LINE, and that is load-bearing. `migrateTaskLine` rebuilds any task
 *  line it is handed into a canonical field order (dates, then priority, then recurrence)
 *  and collapses runs of whitespace, so an already-correct `- [ ] milk [high] [due …]`
 *  comes back reordered. Callers pre-filter whole FILES with `hasLegacySignifier`, so
 *  without this a note containing ONE emoji task would have every other already-correct
 *  task line beside it silently reformatted — someone's notes rewritten for no reason.
 *
 *  Two kinds of line are held back for the same reason: they are QUOTED CODE, not tasks.
 *  Anything inside a fenced block is left alone, so a note that documents the old syntax keeps
 *  its own example intact; and so is a line whose signifier sits inside an inline code span,
 *  which the rebuild would rip open (`- [ ] fix the \`📅 2026-01-01\` parser` would come back
 *  as `- [ ] fix the \`\` parser [due 2026-01-01]`). Frontmatter needs no such guard — a task
 *  line inside it is not one this reader recognises. */
export function migrateContent(text: string): {
    content: string
    changed: number
    flagged: number[]
} {
    // A capturing group in the split regex keeps each terminator as its own array
    // element, alternating with the line content ahead of it, so every line can be
    // rejoined with the EXACT terminator it started with.
    const parts = text.split(/(\r\n|\r|\n)/)
    let changed = 0
    const flagged: number[] = []
    let content = ''
    // The opening delimiter of the fenced block we are inside, or null. An UNCLOSED fence runs
    // to the end of the file, which is what CommonMark says and is also the safe reading.
    let fence: string | null = null
    for (let i = 0; i < parts.length; i += 2) {
        const line = parts[i]
        const term = parts[i + 1] ?? ''
        if (fence !== null) {
            if (fenceCloses(line, fence)) fence = null
            content += line + term
            continue
        }
        const opener = fenceOpener(line)
        if (opener !== null) {
            fence = opener
            content += line + term
            continue
        }
        if (!hasLegacySignifier(line)) {
            content += line + term
            continue
        }
        if (codeSpans(line).some(hasLegacySignifier)) {
            content += line + term
            continue
        }
        const migrated = migrateTaskLine(line)
        if (migrated.line !== line) changed++
        if (migrated.flagged) flagged.push(i / 2)
        content += migrated.line + term
    }
    return { content, changed, flagged }
}
