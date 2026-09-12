// The Obsidian-Tasks emoji signifiers, read ONE LAST TIME. This module is the migration's
// input side and nothing else: `core/src/tasks.ts` no longer reads emoji at all, so an
// un-migrated line is not a dated/prioritised/recurring task to the app — it is a task whose
// description happens to contain an emoji. Everything here exists so `taskMigrate.ts` can
// convert such a line to bracket fields exactly once, then never look at it again.
//
// Do not import this from a render or query path. If a second reader ever appears, the two
// spellings are live again and the whole removal is undone.
//
// Pure — no I/O — so the caller owns the vault walk and the writes.
import { splitRecurrence, parseFields } from './taskFields'
import { INLINE_TAG_REGEX } from './tags'
import type { Task, Priority, DateField } from './tasks'
import { TASK_LINE, statusFromChar } from './tasks'

const PRIORITY_EMOJI: Array<[string, Priority]> = [
    ['🔺', 'highest'],
    ['⏫', 'high'],
    ['🔼', 'medium'],
    ['🔽', 'low'],
    ['⏬', 'lowest'],
]

const DATE_FIELDS: Array<[string, DateField]> = [
    ['📅', 'due'],
    ['⏳', 'scheduled'],
    ['🛫', 'start'],
    ['✅', 'done'],
    ['➕', 'created'],
    ['❌', 'cancelled'],
]

// U+FE0F, the emoji VARIATION SELECTOR. Every signifier here is emoji-presentation by default,
// so the selector is redundant — but plenty of keyboards, phones and pasted snippets insert it
// anyway, and it is INVISIBLE, so a user cannot see that their line differs from the one that
// converts. It matters in both directions: a date matcher written `<emoji>\s*<date>` never
// matches `✅️ 2026-01-01` (the selector is not whitespace), so the line is skipped forever
// while still tripping the whole-file pre-filter on every boot; and a priority signifier
// stripped by its base codepoint alone leaves the orphan selector behind — invisible garbage
// written into the note. One optional selector in each pattern closes both.
const VS = '\\uFE0F?'

// Precompiled `<emoji> YYYY-MM-DD` matchers, one per DATE_FIELDS signifier, built once at
// module load instead of `new RegExp(...)` per line (a migration scan runs this once per
// markdown line across the whole vault).
const DATE_FIELD_REGEX = new Map<string, RegExp>(
    DATE_FIELDS.map(
        ([emoji]) =>
            [
                emoji,
                new RegExp(emoji + VS + '\\s*(\\d{4}-\\d{2}-\\d{2})'),
            ] as const,
    ),
)

// Same signifier plus its optional selector, for the strip-from-description passes. Global:
// a line may carry the same priority signifier more than once, and every copy must go.
const PRIORITY_STRIP = new Map<string, RegExp>(
    PRIORITY_EMOJI.map(
        ([emoji]) => [emoji, new RegExp(emoji + VS, 'gu')] as const,
    ),
)

const RECURRENCE_SIGNIFIER = new RegExp('\u{1F501}' + VS, 'u')

// One alternation over every signifier, so a whole-file scan is a single pass rather than
// twelve `includes` calls per line. Non-global on purpose: a global regex's `.test()`
// advances `lastIndex` between calls, so a shared instance would silently alternate
// right and wrong answers.
const ANY_SIGNIFIER = /📅|⏳|🛫|✅|➕|❌|🔁|🔺|⏫|🔼|🔽|⏬/u

/** Does this text carry any emoji signifier at all? The cheap pre-filter a vault-wide
 *  migration scan runs per file before doing any per-line work. */
export function hasLegacySignifier(text: string): boolean {
    return ANY_SIGNIFIER.test(text)
}

/**
 * `parseTaskLine` as it stood before the emoji reader was removed, verbatim: bracket fields
 * first, then emoji filling only what the brackets left unset. Both halves are needed because
 * a real vault holds lines written in one spelling, the other, and both at once — migration
 * has to read whatever it finds and re-emit it in the bracket form.
 */
export function readLegacyLine(
    line: string,
    path: string,
    lineNo: number,
): Task | null {
    const m = TASK_LINE.exec(line)
    if (!m) return null
    const [, indent, statusChar, body] = m

    // Brackets first: they are the form this app writes, so they win a conflict.
    const fields = parseFields(body)
    let rest = fields.rest
    let priority: Priority = fields.priority ?? 'none'
    const dates: Partial<Record<string, string>> = { ...fields.dates }
    let recurrence: string | undefined = fields.recurrence

    // Emoji second, filling only what the brackets left unset. The emoji is always stripped
    // from `rest` even when a bracket already set the value — an emoji left dangling in the
    // description is the same bug as a date, and here it would be re-emitted into the
    // migrated line as literal text.
    for (const [emoji, p] of PRIORITY_EMOJI) {
        if (rest.includes(emoji)) {
            if (priority === 'none') priority = p
            rest = rest.replace(PRIORITY_STRIP.get(emoji)!, ' ')
            break
        }
    }

    for (const [emoji, field] of DATE_FIELDS) {
        const re = DATE_FIELD_REGEX.get(emoji)!
        const dm = re.exec(rest)
        if (dm) {
            if (dates[field] === undefined) dates[field] = dm[1]
            rest = rest.replace(dm[0], ' ')
        }
    }

    const tags = [
        ...new Set([...rest.matchAll(INLINE_TAG_REGEX)].map(t => t[1])),
    ]

    // Recurrence is the trailing 🔁 signifier; dates/priority are already stripped, so the
    // text after 🔁 is the rule (e.g. "every weekday"). A #tag written after the marker is a
    // TAG, not part of the rule — splitRecurrence cuts there and the tag stays in the
    // description, where `tags` (computed above) already saw it.
    const recMatch = RECURRENCE_SIGNIFIER.exec(rest)
    if (recMatch) {
        const tail = splitRecurrence(
            rest.slice(recMatch.index + recMatch[0].length),
        )
        if (recurrence === undefined) recurrence = tail.rule || undefined
        rest = `${rest.slice(0, recMatch.index)} ${tail.trailing}`
    }

    const description = rest.replace(/\s+/g, ' ').trim()

    return {
        path,
        line: lineNo,
        raw: line,
        indent,
        status: statusFromChar(statusChar),
        statusChar,
        description,
        priority,
        tags,
        recurrence,
        ...dates,
    }
}
