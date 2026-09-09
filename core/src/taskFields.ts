// The bracket-field grammar for task lines: `[due 2026-09-14]`, `[every week]`, `[high]`.
// Pure — no I/O, no framework — so the editor, the cards markup and the parser all read
// ONE definition of what a field is. A second copy of these rules is how the raw text and
// the rendered chip drift apart.
import type { Priority } from './tasks'

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

export interface ParsedFields {
    dates: Partial<Record<FieldKey, string>>
    priority?: Priority
    recurrence?: string
    rest: string
}

/** Classify one bracket's inner text. Returns null when it is not a field at all. */
function classify(
    inner: string,
):
    | { kind: 'date'; key: FieldKey; iso: string }
    | { kind: 'priority'; value: Priority }
    | { kind: 'recurrence'; rule: string }
    | null {
    const trimmed = inner.trim()
    const priority = PRIORITY_WORDS.find(p => p === trimmed)
    if (priority) return { kind: 'priority', value: priority }

    const space = trimmed.indexOf(' ')
    if (space < 0) return null
    const key = trimmed.slice(0, space)
    const value = trimmed.slice(space + 1).trim()

    if (key === 'every') return value ? { kind: 'recurrence', rule: trimmed } : null

    const dateKey = DATE_KEYS.find(k => k === key)
    // A key we know with a value we do not: NOT a field. The bracket stays in the
    // description so a mistyped date is visible rather than silently dropped.
    if (dateKey && ISO.test(value)) return { kind: 'date', key: dateKey, iso: value }
    return null
}

export function parseFields(body: string): ParsedFields {
    const dates: Partial<Record<FieldKey, string>> = {}
    let priority: Priority | undefined
    let recurrence: string | undefined
    const drop: Array<[number, number]> = []

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
        drop.push([m.index!, m.index! + m[0].length])
    }

    let rest = body
    for (const [from, to] of drop.reverse()) {
        rest = rest.slice(0, from) + ' ' + rest.slice(to)
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
