// app/src/editor/queryComplete.ts
// Context-aware completion INSIDE a ```query block — the one embedded block that reads
// into a base/notes (see editor/queryBlock.ts). It guides users writing the flat query
// spec: the keys (of:/tasks:/from:/where:/sort:/view:/group:/limit:), the `view:` render
// modes, a starter set of Bases filter snippets for `where:`, and common `group:` fields.
// Picking a key inserts its `key: ` skeleton and re-triggers completion so the value list
// pops immediately (`of:`/`from:` insert `[[]]` and hand off to the existing wikilink
// source for base names).
//
// All matching is split into pure, unit-tested helpers (lineInQueryBlock, classifyQueryLine)
// so the source itself is thin wiring, mirroring wikilink.ts/tag.ts.
import {
    type Completion,
    type CompletionContext,
    type CompletionResult,
    type CompletionSource,
} from '@codemirror/autocomplete'
import { VIEW_TYPES } from '../../../core/src/bases/types'
import { makeApply } from './applyCompletion'

/** Is line `index` (0-based) inside a ```query fence body? Pure over the doc's lines up to
 *  and including that line. A fenced-code state machine: each ``` toggles in/out, and the
 *  OPENING fence's language tag decides whether the block is a query. Works on an UNCLOSED
 *  block too (the common case while a user is still typing the query), since we only look
 *  at lines above the cursor. The current line itself is excluded — a line that is the
 *  opening or closing ``` fence is not a body line. */
export function lineInQueryBlock(lines: string[], index: number): boolean {
    let inBlock = false
    let isQuery = false
    for (let i = 0; i < index; i++) {
        const m = /^```(\w*)/.exec(lines[i])
        if (!m) continue
        if (!inBlock) {
            inBlock = true
            isQuery = m[1] === 'query'
        } else {
            inBlock = false
            isQuery = false
        }
    }
    if (!inBlock || !isQuery) return false
    return !/^```/.test(lines[index]) // a closing-fence line is not body
}

export type QueryCompletion =
    | { kind: 'key'; from: number; query: string }
    | { kind: 'view'; from: number; query: string }
    | { kind: 'where'; from: number; query: string }
    | { kind: 'group'; from: number; query: string }
    | { kind: 'ref'; from: number; refKey: 'of' | 'from' }
    | null

/** Classify the text before the caret on a query-body line into what should be completed.
 *  `from` is the column where the completion's replaced range begins. Value handlers are
 *  checked before the generic key handler (the key form requires there be no colon yet). */
export function classifyQueryLine(textBefore: string): QueryCompletion {
    let m = textBefore.match(/^\s*(?:view|as):\s*([\w-]*)$/)
    if (m)
        return {
            kind: 'view',
            from: textBefore.length - m[1].length,
            query: m[1],
        }

    m = textBefore.match(/^\s*group:\s*([\w.-]*)$/)
    if (m)
        return {
            kind: 'group',
            from: textBefore.length - m[1].length,
            query: m[1],
        }

    m = textBefore.match(/^\s*where:\s*(.*)$/)
    if (m)
        return {
            kind: 'where',
            from: textBefore.length - m[1].length,
            query: m[1],
        }

    // An EMPTY of:/from: value — offer the `[[…]]` skeleton. Once a `[[` is present the
    // wikilink source owns the popup, so we deliberately only match the empty case.
    m = textBefore.match(/^\s*(of|from):\s*$/)
    if (m)
        return {
            kind: 'ref',
            from: textBefore.length,
            refKey: m[1] as 'of' | 'from',
        }

    // Key position: optional indent, a partial word, no colon yet.
    m = textBefore.match(/^(\s*)([\w-]*)$/)
    if (m) return { kind: 'key', from: m[1].length, query: m[2] }

    return null
}

interface KeySpec {
    name: string
    doc: string
    insert: string
    cursor: number
    trigger: boolean
}

// The flat query-spec keys (see queryBlock.ts / parseQueryBlock). Each inserts its skeleton
// and, where a value list exists, re-opens the popup on the value.
const KEY_SPECS: KeySpec[] = [
    {
        name: 'of',
        doc: "Render a base or note's base. Composes — follows that base's own source.",
        insert: 'of: [[]]',
        cursor: 'of: [['.length,
        trigger: true,
    },
    {
        name: 'tasks',
        doc: "Query checkbox tasks. Bare — filter with where: below.",
        insert: 'tasks: ',
        cursor: 'tasks: '.length,
        trigger: false,
    },
    {
        name: 'from',
        doc: "Scope task extraction to a base's notes, e.g. `from: [[Books]]`.",
        insert: 'from: [[]]',
        cursor: 'from: [['.length,
        trigger: true,
    },
    {
        name: 'where',
        doc: 'Filter rows with a Bases expression.',
        insert: 'where: ',
        cursor: 'where: '.length,
        trigger: false,
    },
    {
        name: 'sort',
        doc: 'Sort rows by a property, e.g. `note.due` or `note.due desc`.',
        insert: 'sort: ',
        cursor: 'sort: '.length,
        trigger: false,
    },
    {
        name: 'view',
        doc: 'Render mode: table, cards, list, kanban, calendar, …',
        insert: 'view: ',
        cursor: 'view: '.length,
        trigger: true,
    },
    {
        name: 'group',
        doc: 'Group rows by a property.',
        insert: 'group: ',
        cursor: 'group: '.length,
        trigger: true,
    },
    {
        name: 'limit',
        doc: 'Cap the number of rows.',
        insert: 'limit: ',
        cursor: 'limit: '.length,
        trigger: false,
    },
]

const VIEW_DOCS: Record<string, string> = {
    table: 'Rows × columns grid.',
    cards: 'Card per row.',
    list: 'Compact list with row icons.',
    bullets: 'Plain markdown bullet list, grouped — no table chrome.',
    kanban: 'Columns grouped by a field.',
    calendar: 'Rows placed on a calendar by date.',
    map: 'Rows with coordinates on a map.',
    flashcards: 'Spaced-repetition review of rows.',
    bar: 'Bar chart.',
    line: 'Line chart.',
    stat: 'Single aggregate number.',
    heatmap: 'Calendar heatmap.',
}

// Starter `where:` filters — Bases expressions (see docs/bases/filters.md), the one filter
// language the app has (see translateTaskDsl in core/src/bases/taskDsl.ts for the legacy
// `tasks:` DSL these replace).
const FILTER_SNIPPETS: Array<{ snippet: string; doc: string }> = [
    { snippet: '!note.resolved', doc: 'Open tasks only.' },
    { snippet: 'note.resolved', doc: 'Completed or cancelled tasks.' },
    { snippet: 'note.due == today()', doc: "Due on today's date." },
    { snippet: 'note.placed < today()', doc: 'Overdue (scheduled or due before today).' },
    { snippet: 'note.priority == "high"', doc: 'High-priority.' },
    { snippet: 'note.recurring', doc: 'Recurring tasks.' },
    { snippet: 'file.hasTag("book")', doc: 'Notes tagged #book.' },
]

const GROUP_FIELDS: Array<{ name: string; doc: string }> = [
    { name: 'status', doc: 'Task status (todo / done / …).' },
    { name: 'priority', doc: 'Task priority.' },
    { name: 'due', doc: 'Due date.' },
    { name: 'scheduled', doc: 'Scheduled date.' },
    { name: 'file.folder', doc: 'Containing folder.' },
    { name: 'file.name', doc: 'Note name.' },
]

export function querySource(): CompletionSource {
    return (context: CompletionContext): CompletionResult | null => {
        const line = context.state.doc.lineAt(context.pos)
        // Build the lines up to and including the caret line, then reuse the pure predicate.
        const upto: string[] = []
        for (let n = 1; n <= line.number; n++)
            upto.push(context.state.doc.line(n).text)
        if (!lineInQueryBlock(upto, line.number - 1)) return null

        const textBefore = line.text.slice(0, context.pos - line.from)
        const cls = classifyQueryLine(textBefore)
        if (!cls) return null
        const from = line.from + cls.from

        if (cls.kind === 'key') {
            const options: Completion[] = KEY_SPECS.map(k => ({
                label: k.name,
                type: 'property',
                info: k.doc,
                apply: makeApply(k.insert, k.cursor, k.trigger),
            }))
            return { from, options, validFor: /^[\w-]*$/ }
        }
        if (cls.kind === 'view') {
            const options: Completion[] = VIEW_TYPES.map(v => ({
                label: v,
                type: 'enum',
                info: VIEW_DOCS[v],
            }))
            return { from, options, validFor: /^[\w-]*$/ }
        }
        if (cls.kind === 'group') {
            const options: Completion[] = GROUP_FIELDS.map(g => ({
                label: g.name,
                type: 'enum',
                info: g.doc,
            }))
            return { from, options, validFor: /^[\w.-]*$/ }
        }
        if (cls.kind === 'where') {
            const options: Completion[] = FILTER_SNIPPETS.map(f => ({
                label: f.snippet,
                type: 'enum',
                info: f.doc,
            }))
            return { from, options } // multiword snippets → no validFor, re-query per keystroke
        }
        // ref: empty of:/from: value — offer the [[…]] skeleton, then hand off to wikilink.
        const options: Completion[] = [
            {
                label: '[[ … ]]',
                type: 'note',
                info: 'Pick a base or note',
                apply: makeApply('[[]]', '[['.length, true),
            },
        ]
        return { from, options }
    }
}
