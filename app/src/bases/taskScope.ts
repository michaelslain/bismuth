// Would the task "+ task" is about to create actually appear in the view that created it?
//
// `taskFile` names the one note a new task lands in, and that is the right call — a query over
// many notes has no natural answer to "where does a new one go", so the app names a destination
// explicitly and renders no button at all when none is named. What was missing is that nothing
// checked the destination against the query's SCOPE. Two ways to narrow a tasks query, and both
// can strand a new task:
//
//   - `from: [[SomeBase]]` — a taskFile outside that set writes fine and never appears. That
//     half needs the vault, so it is caught at authoring time by `bismuth base validate`.
//   - a `where:` filter — measured: a query for `note.priority == "high"` returns rows, and a
//     freshly created task is `priority: none` with an empty description, so it cannot match.
//     It is written to the destination file and is invisible on the view that created it.
//
// This module answers the second half, and answers it EXACTLY rather than approximately. The
// alternative — write, refetch, and see whether the row turned up — races the watcher: `PUT
// /file` is a read-table route and does not invalidate, so a refetch immediately after the
// write can legitimately not see it yet and would toast a lie. Evaluating the filters against
// the row that is ABOUT to exist needs no round trip and cannot go stale.
//
// It REPORTS; it does not prevent. The write happens either way and the user is told the truth
// about where it went. Seeding the new task to match the filter instead (inverting `priority is
// high` into `[high]`) works for a useful subset and silently fails outside it, which is worse
// than not trying — deliberately not done.
import { passesFilter, combineFilters } from '../../../core/src/bases/filters'
import { parseExpr } from '../../../core/src/bases/parser'
import { toContext } from '../../../core/src/bases/query'
import {
    normalizeStoredTaskRow,
    taskToRow,
} from '../../../core/src/bases/taskRow'
// core/src/taskParse.ts is the pure sibling of core/src/tasks.ts — no fileAccess/files.ts
// (node:fs/node:path) in its dependency chain. A value import of parseTaskLine straight from
// ./tasks broke `vite build` (Rollup traced tasks.ts's static `getFileAccess` import through
// to files.ts, which cannot bundle for the browser) even though `bun test app` and
// `bun run typecheck` both stayed green — see core/src/taskParse.ts's header and
// app/src/browserBundleGraph.test.ts, which guards this import staying pointed here.
import { parseTaskLine } from '../../../core/src/taskParse'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type {
    BaseConfig,
    FilterNode,
    Row,
    ViewConfig,
} from '../../../core/src/bases/types'

/** The row a `rowCreate` on an own-rows base is about to produce, as the VIEW will see it —
 *  normalized, because an un-normalized row is a shape no view ever renders and grading the
 *  filter against it would answer a question nobody asked. */
export function prospectiveStoredTaskRow(
    basePath: string,
    note: Record<string, unknown>,
    index: number,
): Row {
    return normalizeStoredTaskRow({
        file: syntheticBaseFile(basePath),
        note,
        formula: {},
        index,
    })
}

/** The row an appended `- [ ] <body>` line is about to produce, built by `taskToRow` — the
 *  same producer the vault scan uses, so the prospective row and the real one cannot drift.
 *  Null only when `body` does not make a task line at all, which the callers guard on. */
export function prospectiveLineTaskRow(
    destPath: string,
    body: string,
): Row | null {
    const task = parseTaskLine(`- [ ] ${body}`, destPath, 0)
    return task ? taskToRow(task) : null
}

/** Every filter this view applies to its rows: the base's, the view's own, and the source's
 *  `where:`. A `{kind: 'base'}` source composes ANOTHER base — its filters are that base's
 *  business and are not re-applied here, so reading `where` off it would apply a filter that
 *  does not exist. */
function activeFilters(config: BaseConfig, view: ViewConfig) {
    const spec = view.source ?? config.source
    const where = spec && spec.kind !== 'base' ? spec.where : undefined
    return combineFilters(
        combineFilters(config.filters, view.filters),
        where,
    )
}

/**
 * Would every leaf expression in `node` actually PARSE? Walks the same and/or/not shape
 * `passesFilter` walks, but answers a different question: not "does the row match" but "can
 * this filter even be evaluated at all". `passesFilter` collapses a parse error into `false`
 * — the same outcome as a genuine non-match — so it cannot be asked this on its own.
 */
function filterParses(node: FilterNode): boolean {
    if (typeof node === 'string') {
        try {
            parseExpr(node)
            return true
        } catch {
            return false
        }
    }
    if ('and' in node) return node.and.every(filterParses)
    if ('or' in node) return node.or.every(filterParses)
    if ('not' in node) return node.not.every(filterParses)
    return true
}

/**
 * Does any leaf of `node` mention `formula.*`? A cheap SUBSTRING check on the leaf's raw
 * source, not real reference analysis — see the comment on `newTaskVisible` for why that is
 * the deliberate, conservative choice here rather than a bug. Walks the same and/or/not shape
 * `filterParses`/`passesFilter` walk.
 */
function referencesFormula(node: FilterNode): boolean {
    if (typeof node === 'string') return /\bformula\./.test(node)
    if ('and' in node) return node.and.some(referencesFormula)
    if ('or' in node) return node.or.some(referencesFormula)
    if ('not' in node) return node.not.some(referencesFormula)
    return false
}

/**
 * Would a row like `row` survive this view's filters?
 *
 * TRUE when there is nothing to say — no filters, or a filter that accepts it. The caller
 * toasts only on false, so every uncertainty must resolve to true: `passesFilter` also
 * returns false for a filter it cannot PARSE, and toasting "your task will not appear" on
 * every base with a typo in it is a different problem with a different owner (`bismuth base
 * validate`). So an unparseable filter is treated as no filter.
 *
 * The same fail-toward-silence rule covers a `formula.*` reference, and for the same reason,
 * not by accident. Production computes formulas BEFORE filtering (`core/src/bases/query.ts`'s
 * `runView` calls `computeFormulas` first, exactly so a filter CAN reference `formula.*` —
 * `docs/bases/query-syntax.md` documents it as supported) but `row.formula` here is always
 * `{}`: neither prospective-row builder above computes any. The CAPABLE fix would export
 * `computeFormulas` from `query.ts` and run it here too — deliberately NOT done, because that
 * couples this module to a core internal and because evaluating a formula against a row that
 * does not really exist yet (no file on disk, no sibling rows to aggregate over) can itself
 * throw or produce a value that differs from what the real resolved row would get. That
 * trades a warning in a rare case for a new way to be wrong. So instead: a filter that
 * mentions `formula.` at all is treated as an uncertainty this module cannot safely resolve,
 * exactly like an unparseable one, and resolves to visible rather than risk a false toast.
 */
export function newTaskVisible(
    config: BaseConfig,
    view: ViewConfig,
    row: Row,
): boolean {
    const filter = activeFilters(config, view)
    if (!filter) return true
    if (!filterParses(filter)) return true
    if (referencesFormula(filter)) return true
    return passesFilter(filter, toContext(row))
}
