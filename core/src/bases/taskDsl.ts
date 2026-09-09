// One-way translation of the (now-legacy) Tasks-DSL query language into the Bases filter
// language `source: notes` already uses. This is the only survivor of `tasks-query.ts`:
// the evaluator itself is deleted once every DSL form translates to an equivalent
// expression, so the app is left with ONE filter language instead of two.
//
// The boolean STRUCTURE (parens, AND/OR, precedence) is identical between the two
// languages — only the leaf spellings and the operator spellings (`AND`/`OR` vs `&&`/`||`)
// differ — so the tokenizer/parser below is a straight port of the old evaluator's, with
// each leaf emitting a Bases expression STRING instead of a predicate function.
import { DATE_FIELD_NAMES, type DateField } from '../tasks'
import { addDaysISO, nextWeekdayISO } from '../dates'
import { compareForSort } from './query'
import type { SortSpec } from './types'

export interface TaskDslTranslation {
    where?: string
    sort?: SortSpec[]
    /** Leaf text that didn't match a known DSL form and degraded to `true` (see
     *  `translateBool`'s doc comment). Mirrors the old evaluator's `errors[]` — a caller
     *  that wants "unrecognized filter: X" diagnostics for a typo'd query reads this. */
    unrecognized?: string[]
    /** Set — with `where`/`sort`/`unrecognized` left undefined — when `TranslateOptions.
     *  liveDates` was requested and a date leaf had no clean relative Bases form (a
     *  weekday name: `friday`, `next monday`, …). The WHOLE translation is abandoned
     *  rather than letting that one leaf degrade to `true`, because a migration tool is
     *  the only caller that asks for live dates, and it must not silently drop part of a
     *  query while writing the rest to disk as if it were complete. Contains the raw
     *  leaf text(s) that blocked translation, for the caller's report. */
    blocked?: string[]
}

/** Options for `translateTaskDsl`. Only `bismuth base migrate-queries` sets `liveDates` —
 *  every other caller (the read-time shim in `source.ts`, the CLI's `task list --query`)
 *  gets the default, unchanged behaviour: a resolved literal. */
export interface TranslateOptions {
    /** Emit a RELATIVE Bases date expression (`today()`, `today().format("YYYY-MM-DD")`,
     *  or an offset of one of those) for a DSL date word instead of resolving it to a
     *  literal ISO date. A translation that runs once and gets written to a file must
     *  stay relative — freezing "tomorrow" into today's answer is exactly the bug this
     *  option exists to avoid (see taskDsl's migrate-queries caller). The read-time shim
     *  is correct to use a literal instead, because it re-resolves on every render. */
    liveDates?: boolean
}

const DATE_ALT = DATE_FIELD_NAMES.join('|')
const SORT_BY_RE = new RegExp(
    `^sort by (priority|${DATE_ALT}|description)(?: (reverse))?$`,
    'i',
)
const DATE_FILTER_RE = new RegExp(`^(${DATE_ALT})(?: (before|after))? (.+)$`)
const IGNORED_INSTRUCTION =
    /^(group by|limit|hide|show|short mode|full mode|explain)\b/i

// The cheap discriminator between legacy DSL text and a Bases expression, used by
// source.ts on a `where` string it doesn't yet know the language of. A Bases expression
// always names a property with a dot (`note.due`); DSL text never contains one. Combined
// with the DSL's own opening keywords, the two languages don't collide.
const DSL_OPENERS = new RegExp(
    `^(?:done\\b|not\\s+done\\b|is\\s+(?:not\\s+)?(?:cancelled|recurring)\\b|priority\\s+is\\b|sort\\s+by\\b|(?:${DATE_ALT})\\s+\\S)`,
    'i',
)

// Line-aware, matching how translateTaskDsl itself walks a body: a blank or `#`-comment
// line carries no meaning and is skipped, and a leading paren group ("(priority is
// high) OR ...") is still DSL once the parens are peeled. Anchoring on a SINGLE line
// (the previous version) misread `(priority is high) OR (due before today)` and
// `# a comment\nnot done` as Bases expressions — passesFilter then threw on the DSL
// text and every row silently failed to match, which is worse than a wrong answer: it
// looks like an empty task list, not a bug. The dot-check gate still runs first and
// cheaply rejects anything that names a `note.`/`file.` property, so peeling parens
// here can't turn a real Bases expression into a false positive.
export function looksLikeTaskDsl(text: string): boolean {
    const t = text.trim()
    if (!t || t.includes('.')) return false
    return t.split(/\r?\n/).some(line => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) return false
        return DSL_OPENERS.test(trimmed.replace(/^\(+\s*/, ''))
    })
}

/** Resolve a relative date word (`today`, `in 3 days`, `friday`, …) to an ISO date,
 *  anchored at `today`. Ported unchanged from the old evaluator — it is already tested
 *  and is the one piece of `tasks-query.ts` worth keeping. */
export function resolveDateExpr(expr: string, today: string): string | null {
    const e = expr.trim().toLowerCase()
    if (e === 'today') return today
    if (e === 'tomorrow') return addDaysISO(today, 1)
    if (e === 'yesterday') return addDaysISO(today, -1)
    if (/^\d{4}-\d{2}-\d{2}$/.test(e)) return e
    const inM = e.match(/^in (\d+) days?$/)
    if (inM) return addDaysISO(today, Number(inM[1]))
    const agoM = e.match(/^(\d+) days? ago$/)
    if (agoM) return addDaysISO(today, -Number(agoM[1]))
    // Day-of-week words: `friday`, `next friday`, `mon`, … → the coming occurrence.
    const wd = nextWeekdayISO(today, e.replace(/^next\s+/, ''))
    if (wd) return wd
    return null
}

// The Bases `.format("YYYY-MM-DD")` call, not the no-arg `.format()`. `today()` returns a
// Date built from LOCAL midnight (`new Date(); setHours(0,0,0,0)`), while a bare `note.*`
// field is a plain "YYYY-MM-DD" STRING parsed from the vault. `.format()` with no argument
// falls back to `d.toISOString().slice(0, 10)` — UTC — which for any non-UTC timezone
// names a DIFFERENT calendar day than the one `today()` actually represents (verified: in
// UTC-7, `today().format()` names YESTERDAY's date). `.format("YYYY-MM-DD")` instead reads
// the Date's LOCAL year/month/day getters, which agree with `today()`'s own local
// construction — so `note.due < (today() + "1d").format("YYYY-MM-DD")` compares two
// LOCAL-calendar-date strings, exactly like the literal form this replaces, instead of
// silently mixing a local day boundary with a UTC one.
const LIVE_FMT = '.format("YYYY-MM-DD")'

/** Live-relative counterpart to `resolveDateExpr`, for `TranslateOptions.liveDates`.
 *  Returns a BASES EXPRESSION FRAGMENT (not a resolved value) — `today()<fmt>`,
 *  `(today() + "Nd")<fmt>`, a quoted literal for an already-absolute DSL date, or `null`
 *  when the word has no clean relative form (a weekday name), which the caller must treat
 *  as a hard failure — see `TaskDslTranslation.blocked`. */
function resolveDateExprLive(expr: string): string | null {
    const e = expr.trim().toLowerCase()
    if (e === 'today') return `today()${LIVE_FMT}`
    if (e === 'tomorrow') return `(today() + "1d")${LIVE_FMT}`
    if (e === 'yesterday') return `(today() - "1d")${LIVE_FMT}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(e)) return `"${e}"` // already absolute — nothing to keep live
    const inM = e.match(/^in (\d+) days?$/)
    if (inM) return `(today() + "${inM[1]}d")${LIVE_FMT}`
    const agoM = e.match(/^(\d+) days? ago$/)
    if (agoM) return `(today() - "${agoM[1]}d")${LIVE_FMT}`
    return null // weekday words (`friday`, `next monday`, …): no live Bases equivalent
}

/** Translate one leaf (no AND/OR/parens) to a Bases expression, or null when unrecognized.
 *  `blocked` collects the raw text of a date leaf that `TranslateOptions.liveDates` could
 *  not keep live — see `TaskDslTranslation.blocked`. */
function translateLeaf(
    raw: string,
    today: string,
    opts: TranslateOptions | undefined,
    blocked: string[],
): string | null {
    const s = raw.trim().toLowerCase()
    if (s === '') return null

    if (s === 'done') return 'note.resolved'
    if (s === 'not done') return '!note.resolved'
    if (s === 'is cancelled') return 'note.status == "cancelled"'
    if (s === 'is not cancelled') return 'note.status != "cancelled"'

    let m = s.match(/^is( not)? recurring$/)
    if (m) return m[1] ? '!note.recurring' : 'note.recurring'

    m = s.match(/^priority is( not)? (highest|high|medium|low|lowest|none)$/)
    if (m) return `note.priority ${m[1] ? '!=' : '=='} "${m[2]}"`

    m = s.match(DATE_FILTER_RE)
    if (m) {
        const field = m[1] as DateField
        const cmp = m[2] as 'before' | 'after' | undefined
        const op = cmp === 'before' ? '<' : cmp === 'after' ? '>' : '=='
        if (opts?.liveDates) {
            const live = resolveDateExprLive(m[3])
            if (live === null) {
                blocked.push(raw)
                return null
            }
            return `note.${field} ${op} ${live}`
        }
        const resolved = resolveDateExpr(m[3], today)
        if (!resolved) return null
        return `note.${field} ${op} "${resolved}"`
    }

    return null
}

// ── boolean expression: parentheses + AND/OR over leaves, same grammar as the old
// evaluator's tokenizer/parser, emitting a joined STRING instead of a predicate. ──────
type Tok =
    | { t: '(' }
    | { t: ')' }
    | { t: 'and' }
    | { t: 'or' }
    | { t: 'leaf'; v: string }

function tokenize(line: string): Tok[] {
    const toks: Tok[] = []
    let buf = ''
    const flush = () => {
        const v = buf.trim()
        if (v) toks.push({ t: 'leaf', v })
        buf = ''
    }
    for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === '(') {
            flush()
            toks.push({ t: '(' })
        } else if (c === ')') {
            flush()
            toks.push({ t: ')' })
        } else {
            const op = line.slice(i).match(/^(AND|OR)\b/i)
            if (op && (buf === '' || /\s$/.test(buf))) {
                flush()
                toks.push({ t: op[1].toLowerCase() as 'and' | 'or' })
                i += op[1].length - 1 // -1 because for loop increments
            } else {
                buf += c
            }
        }
    }
    flush()
    return toks
}

/** Translate one whole line's boolean expression to a Bases expression string. An
 *  unrecognized leaf (or any other malformed token: an unbalanced paren, a stray
 *  trailing token) becomes the literal `true` rather than invalidating the line —
 *  this reproduces the old evaluator's own behaviour exactly: `parseFactor` there
 *  logged an error but still returned `() => true`, so `not done AND banana` filtered
 *  exactly like `not done` alone, and `banana OR not done` passed everything.
 *
 *  This is NOT the same as dropping the line. A dropped line fails OPEN — the whole
 *  query loses a clause, and a list meant to hide resolved tasks would silently start
 *  showing them again. `true` fails to the line's RECOGNISED half, which is what the
 *  DSL text actually said and the parser actually understood. Since this translator
 *  exists so no existing note changes behaviour, matching the old degrade-to-true
 *  semantics is the correct contract here, not a simpler one. */
function translateBool(
    toks: Tok[],
    today: string,
    unrecognized: string[],
    opts: TranslateOptions | undefined,
    blocked: string[],
): string {
    let pos = 0
    const peek = () => toks[pos]
    const next = () => toks[pos++]

    function parseExpr(): string {
        let left = parseTerm()
        while (peek() && peek().t === 'or') {
            next()
            left = `${left} || ${parseTerm()}`
        }
        return left
    }
    function parseTerm(): string {
        let left = parseFactor()
        while (peek() && peek().t === 'and') {
            next()
            left = `${left} && ${parseFactor()}`
        }
        return left
    }
    function parseFactor(): string {
        const tk = peek()
        if (!tk) return 'true' // "unexpected end of filter" in the old evaluator
        if (tk.t === '(') {
            next()
            const e = parseExpr()
            if (peek() && peek().t === ')') next()
            // A missing closing paren was logged as an error but the parsed inner
            // expression was still used — no special-casing needed here either.
            return `(${e})`
        }
        if (tk.t === 'leaf') {
            next()
            const p = translateLeaf(tk.v, today, opts, blocked)
            if (p === null) unrecognized.push(tk.v)
            return p ?? 'true'
        }
        next() // a stray token, e.g. an extra ")" — logged, degraded to true
        return 'true'
    }

    // Trailing tokens after a full expression parses are ignored, exactly like the old
    // evaluator: it logged "trailing tokens in filter" but still used what it had built.
    return parseExpr()
}

/** Translate a legacy Tasks-DSL query string into a Bases `where` expression plus any
 *  `sort by …` lines as a SortSpec list. Filter lines are ANDed together, each wrapped in
 *  parens EXCEPT when only one survives. Every non-blank, non-comment, non-instruction
 *  line contributes a filter — `translateBool` never fails a line, it degrades an
 *  unrecognized leaf to `true` instead (see its doc comment) — EXCEPT under
 *  `opts.liveDates`, where a date leaf with no relative Bases form blocks the whole
 *  translation instead (see `TaskDslTranslation.blocked`). */
export function translateTaskDsl(
    dsl: string,
    today: string,
    opts?: TranslateOptions,
): TaskDslTranslation {
    const filters: string[] = []
    const sort: SortSpec[] = []
    const unrecognized: string[] = []
    const blocked: string[] = []

    for (const line of dsl.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const sortM = trimmed.match(SORT_BY_RE)
        if (sortM) {
            sort.push({
                property: `note.${sortM[1].toLowerCase()}`,
                direction: sortM[2] ? 'DESC' : 'ASC',
            })
            continue
        }
        if (IGNORED_INSTRUCTION.test(trimmed)) continue

        filters.push(
            translateBool(tokenize(trimmed), today, unrecognized, opts, blocked),
        )
    }

    if (blocked.length) return { blocked }

    const where =
        filters.length === 0
            ? undefined
            : filters.length === 1
              ? filters[0]
              : filters.map(f => `(${f})`).join(' && ')

    return {
        where,
        sort: sort.length ? sort : undefined,
        unrecognized: unrecognized.length ? unrecognized : undefined,
    }
}

// ── sort: the DSL's `sort by …` used to run in the same pass as filtering (the old
// evaluator's makeSorter), and every caller of translateTaskDsl needs the identical
// comparator — so `compareForSort` lives in query.ts (the general Bases sort path now
// ranks priority the same way) and this file just applies it. ──────────────────────

/** Apply a translated `sort` to a list of items, in place of the old evaluator's
 *  single filter-then-sort pass. Generic over the item shape so both a `Row[]` (via
 *  `resolveProperty`) and a raw `Task[]` (via a `taskToRow`-backed accessor) share this
 *  ONE comparator rather than three call sites re-implementing it — see
 *  `compareForSort`'s doc comment for why that matters (priority rank, undated-last). */
export function applyTaskSort<T>(
    items: T[],
    sort: SortSpec[] | undefined,
    getProperty: (item: T, property: string) => unknown,
): T[] {
    if (!sort?.length) return items
    return [...items].sort((a, b) => {
        for (const s of sort) {
            const c = compareForSort(
                getProperty(a, s.property),
                getProperty(b, s.property),
                s,
            )
            if (c !== 0) return c
        }
        return 0
    })
}
