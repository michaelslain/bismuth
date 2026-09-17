import type {
    BaseConfig,
    EvalContext,
    Row,
    ViewConfig,
    ViewResult,
    ResultGroup,
    SortSpec,
} from './types'
import type { Expr } from './ast'
import { viewMode } from './types'
import { parseExpr } from './parser'
import { evaluate } from './evaluate'
import { passesFilter, combineFilters } from './filters'
import { compare, toNumber } from './values'
import { declaredFormulas } from './properties'

// Declared-formula source text -> its parsed AST (or null on a parse failure), so a
// formula shared across many runView() calls (e.g. the same base rendered repeatedly)
// is parsed once, not once per call. Keyed on the SOURCE TEXT itself, not the formula
// name, so an edited formula's new text is a cache miss and gets freshly parsed rather
// than reusing a stale AST under the same name.
const formulaAstCache = new Map<string, Expr | null>()

export function toContext(
    row: Row,
    hostThis?: Record<string, unknown>,
): EvalContext {
    return {
        file: row.file,
        note: row.note,
        formula: row.formula,
        this: hostThis,
    }
}

function computeFormulas(
    rows: Row[],
    formulas: Record<string, string> | undefined,
    hostThis?: Record<string, unknown>,
): void {
    if (!formulas) return
    const compiled = Object.entries(formulas).map(([name, src]) => {
        if (formulaAstCache.has(src))
            return [name, formulaAstCache.get(src)!] as const
        let ast: Expr | null
        try {
            ast = parseExpr(src)
        } catch {
            ast = null
        }
        formulaAstCache.set(src, ast)
        return [name, ast] as const
    })
    for (const row of rows) {
        const ctx = toContext(row, hostThis)
        for (const [name, ast] of compiled) {
            if (!ast) {
                row.formula[name] = undefined
                continue
            }
            try {
                row.formula[name] = evaluate(ast, ctx)
            } catch {
                row.formula[name] = undefined
            }
        }
    }
}

// Canonicalize a property id so bare frontmatter names line up with the
// "note."-prefixed form used for auto-derived columns (e.g. "price" -> "note.price").
export function canonicalId(id: string): string {
    if (
        id.startsWith('file.') ||
        id.startsWith('note.') ||
        id.startsWith('formula.') ||
        id.startsWith('this.')
    )
        return id
    return `note.${id}`
}

// Resolve a property id (e.g. "file.name", "note.price", "formula.ppu", bare "price")
// to a value for a given row.
export function resolveProperty(
    id: string,
    row: Row,
    hostThis?: Record<string, unknown>,
): unknown {
    if (id.startsWith('file.'))
        return (row.file as unknown as Record<string, unknown>)[id.slice(5)]
    if (id.startsWith('note.')) return row.note[id.slice(5)]
    if (id.startsWith('formula.')) return row.formula[id.slice(8)]
    if (id.startsWith('this.')) return hostThis?.[id.slice(5)]
    return row.note[id]
}

// Priority sorts by URGENCY, not alphabetically. The generic `compare()` below would sort
// the *strings* "high" < "highest" < "low" < … alphabetically, which is not what "sort by
// priority" means.
const PRIORITY_RANK: Record<string, number> = {
    highest: 1,
    high: 2,
    medium: 3,
    none: 4,
    low: 5,
    lowest: 6,
}

// Compare two values for one SortSpec key: priority by rank (see PRIORITY_RANK), matched
// against any property whose BARE name (dropping its note./file./formula./this. namespace)
// is "priority" — a declared formula or a differently-namespaced priority column ranks too.
// Any other key with a MISSING value on either side sorts that item LAST regardless of
// direction — "undated sorts last" is not something `direction` should flip.
export function compareForSort(av: unknown, bv: unknown, s: SortSpec): number {
    const dir = s.direction === 'DESC' ? -1 : 1
    const dot = s.property.indexOf('.')
    const bare = (dot >= 0 ? s.property.slice(dot + 1) : s.property).toLowerCase()
    if (bare === 'priority') {
        // Rank ONLY when BOTH sides are the task vocabulary. `PRIORITY_RANK[x] ?? none`
        // used to fall back to rank 4 for anything outside the six words, which silently
        // collapsed a NUMERIC priority column (`priority: 1..5`, sorted correctly by the
        // old plain compare()) into one bucket — a no-op sort. A missing lookup now falls
        // through to the generic path below instead of inventing a rank for it.
        const rank = (v: unknown) => PRIORITY_RANK[String(v).toLowerCase()]
        const ar = rank(av)
        const br = rank(bv)
        if (ar !== undefined && br !== undefined) return dir * (ar - br)
        // A MIXED pair (one vocabulary word, one not — e.g. a column mid-migration from
        // words to numbers) is deliberately NOT half-ranked: it drops straight into the
        // same missing-value/compare() path every other property uses, so a word vs a
        // number sorts by compare()'s string fallback rather than a made-up rank.
    }
    const aMissing = av === undefined || av === null || av === ''
    const bMissing = bv === undefined || bv === null || bv === ''
    if (aMissing && bMissing) return 0
    if (aMissing) return 1
    if (bMissing) return -1
    return dir * compare(av, bv)
}

// Build the set of property ids the user has marked hidden in BaseConfig.properties.
// Each entry contributes both its bare form and its canonical form so the user
// can write `order: { hidden: true }` or `note.order: { hidden: true }` and get
// the same result.
function hiddenIds(base: BaseConfig): Set<string> {
    const out = new Set<string>()
    if (!base.properties) return out
    for (const [key, meta] of Object.entries(base.properties)) {
        if (!meta?.hidden) continue
        out.add(key)
        out.add(canonicalId(key))
        // A formula-kind property resolves to a "formula.<bare>" column id (see
        // declaredColumns below), not "note.<bare>" — register that spelling too so
        // `hidden: true` on a declared formula property actually hides it.
        out.add(`formula.${key.startsWith('note.') ? key.slice(5) : key}`)
    }
    return out
}

/**
 * The `note.*` keys that stay a COLUMN even when a normalizer supplied them rather than the
 * file storing them — currently one, and only in tasks mode.
 *
 * `status` is the odd one out among the seven `normalizeStoredTaskRow` fills in. The other six
 * are bookkeeping (`statusChar` `resolved` `placed` `recurring`) or shape defaults nobody reads
 * as a value (`priority: "none"`, `tags: []`). `status` is a task's CORE FIELD, and a
 * hand-authored tasks base whose rows omit it — nobody has ticked anything yet, so nothing
 * wrote it — is one where every task is implicitly todo. Dropping the column there leaves the
 * TABLE with no status column, so its checkbox cell never renders and the board cannot be
 * ticked at all.
 *
 * Deliberately answered HERE rather than in the table. The four other row views read
 * `note.status` straight off the row (they render a whole `<TaskRow>`), so a table-only
 * fallback would put a task rule inside one view kind while the same question — "what are this
 * view's columns" — is answered for every kind in this one function.
 */
const TASK_CORE_COLUMNS: ReadonlySet<string> = new Set(['status'])
const NO_KEPT_COLUMNS: ReadonlySet<string> = new Set()

/** Which supplied keys this view still shows as columns. Mode-driven via `viewMode`, never by
 *  reading `view.mode`, so the legacy `calendarContent` spelling resolves the same way. */
function keptWhenDerived(view: ViewConfig): ReadonlySet<string> {
    return viewMode(view) === 'tasks' ? TASK_CORE_COLUMNS : NO_KEPT_COLUMNS
}

function deriveColumns(
    rows: Row[],
    hidden: Set<string>,
    kept: ReadonlySet<string> = NO_KEPT_COLUMNS,
): string[] {
    const cols = new Set<string>()
    // Seed file.name only when rows are distinct notes (notes source). Base-source rows
    // share a synthetic file.name (the base's own name), so it's meaningless as a column.
    if (rows.some(r => r.file?.name)) cols.add('file.name')
    // A key a NORMALIZER filled in is bookkeeping, not data, so it must not become a column.
    // `normalizeStoredTaskRow` adds seven (statusChar/resolved/placed/recurring plus the shape
    // defaults) to every row of a tasks-mode base, and this is the union of every row's keys —
    // so without this a three-column tasks base with no `order:` renders NINE, one of them a
    // `statusChar` column whose cells read a literal " " or "x". That is the DEFAULT shape: a
    // base declaring `order:` or `properties:` never reaches this function at all.
    //
    // Skipped PER ROW, from that row's own `Row.derived` list, not from a fixed name list —
    // same rule `storedNote` writes by. A base that genuinely STORES a `priority` column has it
    // absent from `derived`, so the column survives; the names are not reserved. `kept` is the
    // one exception, and it is about the COLUMN only — a kept key stays in `Row.derived`, so a
    // write still strips it and the file gains nothing it did not already hold.
    for (const r of rows) {
        const derived = r.derived
        for (const k of Object.keys(r.note)) {
            if (derived?.includes(k) && !kept.has(k)) continue
            cols.add(`note.${k}`)
        }
    }
    // Drop any column the base has flagged hidden. Match on both the raw column id
    // (`note.order`) and the bare frontmatter name (`order`) — users may have
    // written the hide under either form.
    return [...cols].filter(
        c => !hidden.has(c) && !hidden.has(c.replace(/^note\./, '')),
    )
}

// Columns for a base that DECLARES its own property set (`properties:` in list form):
// the declared names in declaration order (canonicalized to their note./file./formula.
// ids), instead of unioning whatever frontmatter the rows happen to carry. file.name is
// seeded first for note rows (same rule as deriveColumns) unless already declared;
// `hidden` still applies (under either the bare or canonical spelling).
//
// A declared `{type: formula}` property (#102) canonicalizes to a "formula.<bare>" id
// instead of "note.<bare>" — it has no frontmatter key, only a computed row.formula[bare]
// value (populated by computeFormulas below via declaredFormulas). This is what makes it
// read-only downstream: writableKey() (app/src/bases/kanbanMeta.ts) already treats any
// "formula."-prefixed id as non-writable.
function declaredColumns(
    declared: string[],
    rows: Row[],
    hidden: Set<string>,
    base: BaseConfig,
): string[] {
    const cols: string[] = []
    if (rows.some(r => r.file?.name)) cols.push('file.name')
    for (const name of declared) {
        const t = base.properties?.[name]?.type
        const bare = name.startsWith('note.') ? name.slice(5) : name
        const c = t?.kind === 'formula' ? `formula.${bare}` : canonicalId(name)
        if (!cols.includes(c)) cols.push(c)
    }
    return cols.filter(
        c => !hidden.has(c) && !hidden.has(c.replace(/^note\./, '')),
    )
}

function summarize(name: string, values: unknown[]): string {
    const nums = values.map(toNumber).filter(n => !Number.isNaN(n))
    const sum = nums.reduce((a, b) => a + b, 0)

    switch (name) {
        case 'Sum':
            return String(sum)
        case 'Average':
            return nums.length ? String(sum / nums.length) : ''
        case 'Min':
            return nums.length ? String(Math.min(...nums)) : ''
        case 'Max':
            return nums.length ? String(Math.max(...nums)) : ''
        case 'Count':
            return String(values.length)
        case 'Empty':
            return String(
                values.filter(v => v === null || v === undefined || v === '')
                    .length,
            )
        case 'Filled':
            return String(
                values.filter(v => v !== null && v !== undefined && v !== '')
                    .length,
            )
        case 'Unique':
            return String(new Set(values.map(v => String(v))).size)
        default:
            return ''
    }
}

export function runView(
    base: BaseConfig,
    allRows: Row[],
    viewIndex: number,
    hostThis?: Record<string, unknown>,
): ViewResult {
    const view = base.views[viewIndex] ?? base.views[0]

    // 1. Compute formulas for all rows (needed for filtering/sorting on formula.*).
    //    `hostThis` (the embedding note's frontmatter, when this base is being
    //    rendered inline in another note) flows into the eval context as `this.*`.
    //    A declared `{type: formula, expr}` property (#102) is merged in here under its
    //    bare name — SAME map shape, SAME evaluator call, as the base's own `formulas:`;
    //    an explicit `formulas:` entry of the same name wins over a declared one.
    const rows = allRows.map(r => ({ ...r, formula: { ...r.formula } }))
    const formulas = { ...declaredFormulas(base), ...base.formulas }
    computeFormulas(rows, formulas, hostThis)

    // 2. Filter (global AND view)
    const filter = combineFilters(base.filters, view.filters)
    let filtered = rows.filter(r =>
        passesFilter(filter, toContext(r, hostThis)),
    )

    // 3. Sort
    if (view.sort && view.sort.length) {
        filtered = [...filtered].sort((a, b) => {
            for (const s of view.sort!) {
                const c = compareForSort(
                    resolveProperty(s.property, a, hostThis),
                    resolveProperty(s.property, b, hostThis),
                    s,
                )
                if (c !== 0) return c
            }
            return 0
        })
    }

    // 4. Resolve columns.
    // Explicit `view.order` always wins (per-view opt-in beats global hide). Without one,
    // a base that DECLARES its own properties (list-form `properties:`) uses that declared
    // set; only the classic fallback derives columns from the rows' own frontmatter.
    const hidden = hiddenIds(base)
    const columns =
        view.order && view.order.length
            ? view.order
            : base.declaredProperties && base.declaredProperties.length
              ? declaredColumns(base.declaredProperties, filtered, hidden, base)
              : deriveColumns(filtered, hidden, keptWhenDerived(view))

    // 5. Group
    let groups: ResultGroup[]
    if (view.groupBy) {
        const dir = view.groupBy.direction === 'DESC' ? -1 : 1
        const map = new Map<string, Row[]>()
        const rawByKey = new Map<string, unknown>() // key -> the group's raw value, for type-aware sorting
        for (const r of filtered) {
            const raw = resolveProperty(view.groupBy.property, r, hostThis)
            const key = String(raw ?? '')
            if (!map.has(key)) {
                map.set(key, [])
                rawByKey.set(key, raw)
            }
            map.get(key)!.push(r)
        }
        const groupOf = (key: string): ResultGroup => ({
            key,
            rows: applyLimit(map.get(key) ?? [], view.limit),
        })
        // Default group order is by the group's RAW value (type-aware: numbers numerically,
        // dates chronologically), honoring groupBy.direction — NOT string-alphabetical.
        const byValue = (a: string, b: string) =>
            compare(rawByKey.get(a), rawByKey.get(b)) * dir

        if (view.groupOrder && view.groupOrder.length) {
            // Explicit group order via `groupOrder: [...]`, for ANY grouped view (generalized
            // from kanban). Declared keys come first in the given order; kanban keeps empty
            // declared groups as drop targets, other views show a declared group only when it
            // has rows. Data-only keys not in the list are appended, ordered by value.
            const declaredSet = new Set(view.groupOrder)
            const declared = view.groupOrder
                .filter(key => view.type === 'kanban' || map.has(key))
                .map(groupOf)
            const extras = [...map.keys()]
                .filter(key => !declaredSet.has(key))
                .sort(byValue)
                .map(groupOf)
            groups = [...declared, ...extras]
        } else {
            groups = [...map.keys()].sort(byValue).map(groupOf)
        }
    } else {
        groups = [{ key: '', rows: applyLimit(filtered, view.limit) }]
    }

    // 6. Summaries (over the post-filter, pre-limit set)
    const summaries: Record<string, string> = {}
    if (view.summaries) {
        for (const [prop, sumName] of Object.entries(view.summaries)) {
            summaries[canonicalId(prop)] = summarize(
                sumName,
                filtered.map(r => resolveProperty(prop, r, hostThis)),
            )
        }
    }

    return { view, columns, groups, summaries }
}

function applyLimit<T>(arr: T[], limit?: number): T[] {
    return typeof limit === 'number' && limit >= 0 ? arr.slice(0, limit) : arr
}
