// The bracket-field grammar for task lines: `[due 2026-09-14]`, `[every week]`, `[high]`.
// Pure — no I/O, no framework — so the editor, the cards markup and the parser all read
// ONE definition of what a field is. A second copy of these rules is how the raw text and
// the rendered chip drift apart.
import type { Priority } from './tasks'
import { addDaysISO, isRealISODate } from './dates'

export type FieldKey =
    | 'due'
    | 'scheduled'
    | 'start'
    | 'done'
    | 'created'
    | 'cancelled'

export const DATE_KEYS: readonly FieldKey[] = [
    'due',
    'scheduled',
    'start',
    'done',
    'created',
    'cancelled',
]

const PRIORITY_WORDS: readonly Priority[] = [
    'highest',
    'high',
    'medium',
    'low',
    'lowest',
]

// A candidate bracket group. Two guards are baked in rather than checked after:
//   (?<!\[)  — the second `[` of a `[[wikilink]]` never starts a candidate
//   (?!\()   — `[text](url)` is a markdown link, not a field
// A candidate still has to pass validation below to count as a field, so a bracket group
// that merely LOOKS like one (`[chapter 3]`) stays literal text.
export const FIELD_SCAN = /(?<!\[)\[([^[\]]+)\](?!\()/g

const ISO = /^\d{4}-\d{2}-\d{2}$/

// Shape alone accepts calendar-impossible strings like `2026-13-45` or `2026-02-30`.
// `isRealISODate` (core/src/dates.ts) catches that with a UTC round-trip: `Date.UTC`
// silently normalizes overflow (day 30 of February becomes March 2) rather than
// rejecting it, so a plain `isNaN(getTime())` check would miss it.

export interface ParsedFields {
    dates: Partial<Record<FieldKey, string>>
    priority?: Priority
    recurrence?: string
    rest: string
}

// A `#tag` written after a recurrence marker is a TAG, not part of the rule. Without this
// cut, `every month #home` is handed to advanceDateByRecurrence, whose rule regex is
// anchored (`^every … $`), so it matches nothing and the task never rolls forward. The
// trailing half is returned rather than dropped so the caller can put it back in the
// description, where the tag extractor can still see it.
const RECURRENCE_TAG = /(?:^|\s)#[A-Za-z0-9_][A-Za-z0-9_/-]*/

export function splitRecurrence(text: string): {
    rule: string
    trailing: string
} {
    const m = RECURRENCE_TAG.exec(text)
    if (!m) return { rule: text.trim(), trailing: '' }
    return {
        rule: text.slice(0, m.index).trim(),
        trailing: text.slice(m.index).trim(),
    }
}

/** Classify one bracket's inner text. Returns null when it is not a field at all. */
function classify(
    inner: string,
):
    | { kind: 'date'; key: FieldKey; iso: string }
    | { kind: 'priority'; value: Priority }
    | { kind: 'recurrence'; rule: string; trailing: string }
    | null {
    const trimmed = inner.trim()
    const priority = PRIORITY_WORDS.find(p => p === trimmed)
    if (priority) return { kind: 'priority', value: priority }

    const space = trimmed.indexOf(' ')
    if (space < 0) return null
    const key = trimmed.slice(0, space)
    const value = trimmed.slice(space + 1).trim()

    if (key === 'every') {
        if (!value) return null
        const { rule, trailing } = splitRecurrence(trimmed)
        return { kind: 'recurrence', rule, trailing }
    }

    const dateKey = DATE_KEYS.find(k => k === key)
    // A key we know with a value we do not — shape-invalid, or shape-valid but not a
    // real calendar date (`2026-13-45`, `2026-02-30`) — is NOT a field. The bracket
    // stays in the description so a mistyped date is visible rather than silently
    // absorbed into a date that can never match a real day.
    if (dateKey && ISO.test(value) && isRealISODate(value))
        return { kind: 'date', key: dateKey, iso: value }
    return null
}

// The one question a caller outside this module is allowed to ask: "is this bracket's inner
// text an ACCEPTED field", not merely a FIELD_SCAN candidate. Delegates to `classify` rather
// than re-checking the key whitelist or date validity itself, so a consumer like the editor's
// chip decoration can gate FIELD_SCAN's matches without holding a second copy of these rules —
// the exact drift this module's header comment warns about.
export function isFieldText(inner: string): boolean {
    return classify(inner) !== null
}

export function parseFields(body: string): ParsedFields {
    const dates: Partial<Record<FieldKey, string>> = {}
    let priority: Priority | undefined
    let recurrence: string | undefined
    const drop: Array<[number, number, string]> = []

    FIELD_SCAN.lastIndex = 0
    for (const m of body.matchAll(FIELD_SCAN)) {
        const parsed = classify(m[1])
        if (!parsed) continue
        if (parsed.kind === 'date') {
            // First occurrence of a key wins, so a duplicate is inert rather than
            // silently overriding what the reader sees first.
            if (dates[parsed.key] === undefined) dates[parsed.key] = parsed.iso
        } else if (parsed.kind === 'priority') {
            if (priority === undefined) priority = parsed.value
        } else if (recurrence === undefined) {
            recurrence = parsed.rule
        }
        drop.push([
            m.index!,
            m.index! + m[0].length,
            parsed.kind === 'recurrence' && parsed.trailing
                ? ` ${parsed.trailing} `
                : ' ',
        ])
    }

    let rest = body
    for (const [from, to, fill] of drop.reverse()) {
        rest = rest.slice(0, from) + fill + rest.slice(to)
    }
    return {
        dates,
        priority,
        recurrence,
        rest: rest.replace(/\s+/g, ' ').trim(),
    }
}

export function formatDateField(key: FieldKey, iso: string): string {
    return `[${key} ${iso}]`
}

/**
 * Advance a single ISO date by one period of the given Obsidian-Tasks recurrence rule.
 * Supports the core natural-language forms: "every day", "every N days", "every week",
 * "every N weeks", "every month(s)", "every year(s)", and "every weekday". Returns null
 * when the rule isn't recognized (caller then leaves the date untouched).
 *
 * Lives here, beside `splitRecurrence` — the other half of what an `[every …]` field means —
 * rather than in tasks.ts, so a task stored as a base ROW can roll forward through the SAME
 * arithmetic a checkbox line does. `app/src/bases/taskWrite.ts` imports it, and an app-side
 * value-import of tasks.ts would drag its fileAccess → files.ts (node:fs) into the WebView
 * bundle. tasks.ts re-exports it, so nothing on the core side changed import path.
 */
export function advanceDateByRecurrence(
    iso: string,
    rule: string,
): string | null {
    const r = rule.toLowerCase().trim()

    // "every weekday" — next Monday–Friday.
    if (/^every\s+weekday$/.test(r)) {
        let next = addDaysISO(iso, 1)
        // getUTCDay(): 0 = Sunday, 6 = Saturday.
        while ([0, 6].includes(new Date(next + 'T00:00:00Z').getUTCDay())) {
            next = addDaysISO(next, 1)
        }
        return next
    }

    const m = /^every\s+(?:(\d+)\s+)?(day|week|month|year)s?$/.exec(r)
    if (!m) return null
    const n = m[1] ? parseInt(m[1], 10) : 1
    const unit = m[2]
    if (unit === 'day') return addDaysISO(iso, n)
    if (unit === 'week') return addDaysISO(iso, n * 7)

    // Month/year advance by calendar field (UTC-safe), clamping overflow days
    // (e.g. Jan 31 + 1 month → Feb 28/29) the same way Obsidian/moment does.
    const d = new Date(iso + 'T00:00:00Z')
    const day = d.getUTCDate()
    if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n)
    else d.setUTCFullYear(d.getUTCFullYear() + n)
    // If the day-of-month overflowed into the next month, clamp to that month's last day.
    if (d.getUTCDate() !== day) d.setUTCDate(0)
    return d.toISOString().slice(0, 10)
}
