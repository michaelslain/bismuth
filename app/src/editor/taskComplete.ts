// app/src/editor/taskComplete.ts
// Task-line inline metadata completion. While typing a checkbox task line (`- [ ] …`),
// typing a keyword (due, scheduled, start, priority, high, every, …) offers the matching
// bracket field; picking it inserts `[due `, `[every `, `[high]`, … (see
// core/src/taskFields.ts) and, for the dated / recurring ones, re-opens the popup with
// relative-date / recurrence choices that resolve to the ISO format the parser expects,
// then closes the bracket. Bismuth's design system rule is "no emoji, ever" — no emoji is
// ever inserted or shown in the menu.
//
// core/src/tasks.ts no longer reads the old emoji signifiers (📅 ⏳ 🛫 ✅ ➕ ❌ for dates,
// 🔺⏫🔼🔽⏬ for priority, 🔁 for recurrence) — core/src/taskLegacy.ts holds that reader now,
// for migration only. So there is nothing left to complete inside one: a signifier still
// sitting in an un-migrated note is inert description text to the parser, and this module
// offers no value context for it.
//
// Pure, unit-tested helpers (taskDescStart, classifyTaskContext, relativeDateOptions) do
// the matching; the source is thin wiring, mirroring wikilink.ts/tag.ts/queryComplete.ts.
import {
    type Completion,
    type CompletionContext,
    type CompletionResult,
    type CompletionSource,
} from '@codemirror/autocomplete'
import { todayISO, addDaysISO, weekdayName } from '../../../core/src/dates'
import { makeApply } from './applyCompletion'

/** Column where a task's description begins (just past `- [ ] `), or null if the line is
 *  not a checkbox task. Mirrors the TASK_LINE shape in core/src/tasks.ts. */
export function taskDescStart(lineText: string): number | null {
    const m = lineText.match(/^(\s*[-*+] \[.\] )/)
    return m ? m[1].length : null
}

export type TaskContext =
    | { kind: 'date'; from: number; query: string }
    | { kind: 'recurrence'; from: number; query: string }
    | { kind: 'keyword'; from: number; query: string }
    | null

// The date keys are spelled out rather than reusing DATE_KEYS from core/src/taskFields.ts
// to keep this regex self-contained and readable at the call site.
const DATE_KEY_WORDS = 'due|scheduled|start|done|created|cancelled'

/** Classify the text before the caret within a task description. An open bracket field
 *  (`[due `, `[every `) immediately before the caret means we're filling that value;
 *  otherwise the trailing word is a keyword to expand into a field. */
export function classifyTaskContext(textBefore: string): TaskContext {
    // The `+` (not `*`) after the keyword is load-bearing: it requires a real separator
    // between the keyword and whatever follows, so a word that merely STARTS with a keyword
    // (`[everybody`, `[everyone`) does not get treated as `[every` plus a query — the `every`
    // alternative would otherwise match its first five letters and swallow the rest of the
    // word (and, for `[every `, the rest of the sentence) as the recurrence query. This does
    // NOT and cannot distinguish `[due diligence` from a real in-progress date entry — that
    // is unrecoverable lexically, and is already harmless: see the `filter: false` note below.
    // TASK_FIELDS' own inserts (`[due `, `[every `) always carry the trailing space, so the
    // caret lands past it and both keywords still open normally when picked from the menu.
    let m = textBefore.match(
        new RegExp(`\\[(?:${DATE_KEY_WORDS})[ \\t]+([\\w-]*)$`),
    )
    if (m)
        return {
            kind: 'date',
            from: textBefore.length - m[1].length,
            query: m[1],
        }

    m = textBefore.match(/\[every[ \t]+([\w ]*)$/)
    if (m)
        return {
            kind: 'recurrence',
            from: textBefore.length - m[1].length,
            query: m[1],
        }

    // A keyword typed by hand after an open bracket (`[due`) is the SAME keyword — but the
    // insert already carries its own `[`, so `from` has to point at the bracket for the
    // completion to replace it rather than sit after it. The lookbehind excludes both `[`
    // and a letter as the preceding character — not just `[` — because a plain `(?<!\[)`
    // only blocks the match from STARTING right after a bracket; it does not stop the regex
    // engine from retrying one position later and matching a truncated suffix of the word
    // instead (`[[due` would otherwise match `ue`, not fail). Requiring a real word/bracket
    // boundary before the match is what actually keeps `[[due` — a wikilink being typed —
    // out.
    m = textBefore.match(/(?<![\p{L}\[])(\[?)([\p{L}]+)$/u)
    if (m)
        return {
            kind: 'keyword',
            from: textBefore.length - m[0].length,
            query: m[2],
        }

    return null
}

interface TaskField {
    label: string
    keywords: string[]
    insert: string
    follow: 'date' | 'recurrence' | null
}

// Keyword → bracket field. `follow` re-opens the popup with the value list (dates /
// recurrence). Labels carry no emoji — Bismuth's design system rule is "no emoji, ever",
// and that includes menus.
const TASK_FIELDS: TaskField[] = [
    { label: 'due date', keywords: ['due'], insert: '[due ', follow: 'date' },
    {
        label: 'scheduled date',
        keywords: ['scheduled'],
        insert: '[scheduled ',
        follow: 'date',
    },
    {
        label: 'start date',
        keywords: ['start', 'starts'],
        insert: '[start ',
        follow: 'date',
    },
    {
        label: 'recurrence',
        keywords: ['repeat', 'recurring', 'recur', 'every'],
        insert: '[every ',
        follow: 'recurrence',
    },
    {
        label: 'highest priority',
        keywords: ['priority', 'highest', 'urgent'],
        insert: '[highest]',
        follow: null,
    },
    {
        label: 'high priority',
        keywords: ['priority', 'high'],
        insert: '[high]',
        follow: null,
    },
    {
        label: 'medium priority',
        keywords: ['priority', 'medium'],
        insert: '[medium]',
        follow: null,
    },
    {
        label: 'low priority',
        keywords: ['priority', 'low'],
        insert: '[low]',
        follow: null,
    },
    {
        label: 'lowest priority',
        keywords: ['priority', 'lowest'],
        insert: '[lowest]',
        follow: null,
    },
    {
        label: 'done date',
        keywords: ['done', 'completed'],
        insert: '[done ',
        follow: 'date',
    },
    {
        label: 'created date',
        keywords: ['created'],
        insert: '[created ',
        follow: 'date',
    },
    {
        label: 'cancelled date',
        keywords: ['cancelled', 'canceled'],
        insert: '[cancelled ',
        follow: 'date',
    },
]

const RECUR_RULES = [
    'every day',
    'every week',
    'every weekday',
    'every month',
    'every year',
    'every 2 weeks',
]

const DATE_OFFSETS: Array<{ label: string; days: number }> = [
    { label: 'today', days: 0 },
    // "yesterday" sits right after "today" so opts[0] stays 'today' (asserted in tests);
    // negative offsets resolve via addDaysISO just like the positive ones (relativeDateOptions).
    { label: 'yesterday', days: -1 },
    { label: 'tomorrow', days: 1 },
    { label: 'in 2 days', days: 2 },
    { label: 'in 3 days', days: 3 },
    { label: 'in a week', days: 7 },
    { label: 'in two weeks', days: 14 },
]

/** The seven upcoming weekdays by name (`monday`…`sunday`), each resolved to its next
 *  occurrence 1–7 days out — so typing `friday` picks the coming Friday. Today's own
 *  weekday lands at +7 (today itself is the separate "today" choice). */
export function weekdayOptions(
    today: string = todayISO(),
): Array<{ label: string; date: string }> {
    return Array.from({ length: 7 }, (_, i) => {
        const date = addDaysISO(today, i + 1)
        return { label: weekdayName(date), date }
    })
}

/** Relative-date choices resolved to ISO against `today` (pure; `today` injectable for tests).
 *  Includes the named weekdays so a due date can be set by day-of-week ("friday"). */
export function relativeDateOptions(
    today: string = todayISO(),
): Array<{ label: string; date: string }> {
    return [
        ...DATE_OFFSETS.map(o => ({
            label: o.label,
            date: o.days === 0 ? today : addDaysISO(today, o.days),
        })),
        ...weekdayOptions(today),
    ]
}

/** TASK_FIELDS whose any keyword starts with `query` (case-insensitive). Empty query → all. */
export function matchTaskFields(query: string): TaskField[] {
    const q = query.toLowerCase()
    if (!q) return TASK_FIELDS
    return TASK_FIELDS.filter(f => f.keywords.some(k => k.startsWith(q)))
}

export function taskSource(): CompletionSource {
    return (context: CompletionContext): CompletionResult | null => {
        const line = context.state.doc.lineAt(context.pos)
        const descStart = taskDescStart(line.text)
        const col = context.pos - line.from
        if (descStart == null || col < descStart) return null // not in a task description

        const textBefore = line.text.slice(0, col)
        // classifyTaskContext only matches an open bracket field directly under the caret,
        // so on an empty or just-spaced task description it returns null. For an explicit
        // invoke (Ctrl-Space) treat that as an empty keyword query at the caret → the full
        // field menu, inserted at the caret (nothing to clobber). Auto-typing stays quiet.
        const cls =
            classifyTaskContext(textBefore) ??
            (context.explicit
                ? { kind: 'keyword' as const, from: col, query: '' }
                : null)
        if (!cls) return null
        const from = line.from + cls.from

        if (cls.kind === 'date') {
            // The value always closes the bracket field (`[due 2026-09-14]`) — there is no
            // non-bracket variant left now that the legacy emoji contexts are gone (see
            // core/src/taskLegacy.ts). Caret lands past the closing bracket.
            //
            // Deliberately no `filter: false` here (unlike the two keyword branches below).
            // classifyTaskContext cannot tell a real in-progress date from prose that merely
            // follows the same keyword (`[due diligence`) — see the comment above it. Leaving
            // CodeMirror's default filtering ON is what makes that harmless: it narrows
            // `options` against the typed query, a nonsense query like "diligence" matches
            // none of the relative-date labels, and the popup shows nothing and closes
            // itself. Adding `filter: false` for consistency with the keyword branches would
            // silently resurrect the swallowed-prose bug this fix round closed.
            const options: Completion[] = relativeDateOptions().map(d => {
                const insert = `${d.date}]`
                return {
                    label: d.label,
                    detail: d.date,
                    type: 'enum',
                    apply: makeApply(insert, insert.length, false),
                }
            })
            return { from, options, validFor: /^[\w-]*$/ }
        }
        if (cls.kind === 'recurrence') {
            // Same reasoning as the date branch above: no `filter: false`, on purpose.
            const options: Completion[] = RECUR_RULES.map(r => {
                const insert = `${r}]`
                return {
                    label: r,
                    type: 'enum',
                    apply: makeApply(insert, insert.length, false),
                }
            })
            return { from, options, validFor: /^[\w ]*$/ }
        }
        // keyword: expand the trailing word into a bracket field. Quiet unless explicitly
        // invoked or ≥2 chars typed.
        if (!context.explicit && cls.query.length < 2) return null
        const matched = matchTaskFields(cls.query)
        if (matched.length > 0) {
            const options: Completion[] = matched.map(f => ({
                label: f.label,
                type: 'enum',
                apply: makeApply(f.insert, f.insert.length, f.follow != null),
            }))
            return { from, options, filter: false, validFor: /^[\p{L}]*$/u }
        }
        // No field starts with the trailing word (e.g. "book"). On an explicit invoke,
        // offer the whole menu inserted at the caret rather than replacing the word — with a
        // leading space when the caret isn't already preceded by whitespace.
        if (!context.explicit) return null
        const lead =
            col > descStart && !/\s/.test(textBefore[col - 1]) ? ' ' : ''
        const options: Completion[] = TASK_FIELDS.map(f => ({
            label: f.label,
            type: 'enum',
            apply: makeApply(
                lead + f.insert,
                (lead + f.insert).length,
                f.follow != null,
            ),
        }))
        return {
            from: context.pos,
            options,
            filter: false,
            validFor: /^[\p{L}]*$/u,
        }
    }
}
