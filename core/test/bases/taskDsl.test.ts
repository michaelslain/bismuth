// Coverage ported from the deleted core/test/tasks-query.test.ts (the Tasks-DSL evaluator's
// corpus). Where the old suite asserted on FILTERED TASKS, these assert on the TRANSLATED
// BASES EXPRESSION instead — the evaluator is gone, translation is the only thing left to test.
// A handful of cases are kept as end-to-end equivalence checks (translate, then run the result
// through the real Bases filter engine) so a wrong translation still shows up as a red test.
import { test, expect } from 'bun:test'
import {
    translateTaskDsl,
    looksLikeTaskDsl,
    applyTaskSort,
} from '../../src/bases/taskDsl'
import { taskToRow } from '../../src/bases/taskRow'
import { passesFilter } from '../../src/bases/filters'
import { toContext, resolveProperty } from '../../src/bases/query'
import type { Task } from '../../src/tasks'

const TODAY = '2026-05-27' // a Wednesday
const w = (dsl: string) => translateTaskDsl(dsl, TODAY).where

test('status leaves', () => {
    expect(w('not done')).toBe('!note.resolved')
    expect(w('done')).toBe('note.resolved')
    expect(w('is cancelled')).toBe('note.status == "cancelled"')
    expect(w('is not cancelled')).toBe('note.status != "cancelled"')
})

test('recurring leaves', () => {
    expect(w('is recurring')).toBe('note.recurring')
    expect(w('is not recurring')).toBe('!note.recurring')
})

test('priority leaves', () => {
    expect(w('priority is high')).toBe('note.priority == "high"')
    expect(w('priority is not low')).toBe('note.priority != "low"')
})

test('date leaves resolve relative words against today', () => {
    expect(w('due before tomorrow')).toBe('note.due < "2026-05-28"')
    expect(w('scheduled after 2 days ago')).toBe('note.scheduled > "2026-05-25"')
    expect(w('due 2026-06-01')).toBe('note.due == "2026-06-01"')
})

test('an exact-days relative expression resolves too', () => {
    expect(w('due before in 7 days')).toBe('note.due < "2026-06-03"')
})

test('day-of-week words resolve to the coming occurrence', () => {
    // TODAY is Wed 2026-05-27 → the coming Friday is 2026-05-29, the coming Monday 2026-06-01.
    expect(w('due friday')).toBe('note.due == "2026-05-29"')
    expect(w('due next monday')).toBe('note.due == "2026-06-01"')
    expect(w('due before friday')).toBe('note.due < "2026-05-29"')
})

test('liveDates emits a relative Bases expression instead of a resolved literal', () => {
    const live = (dsl: string) => translateTaskDsl(dsl, TODAY, { liveDates: true }).where
    expect(live('due today')).toBe('note.due == today().format("YYYY-MM-DD")')
    expect(live('scheduled today')).toBe(
        'note.scheduled == today().format("YYYY-MM-DD")',
    )
    expect(live('due before tomorrow')).toBe(
        'note.due < (today() + "1d").format("YYYY-MM-DD")',
    )
    expect(live('scheduled after 2 days ago')).toBe(
        'note.scheduled > (today() - "2d").format("YYYY-MM-DD")',
    )
    expect(live('due before in 7 days')).toBe(
        'note.due < (today() + "7d").format("YYYY-MM-DD")',
    )
    // An already-absolute date has nothing to keep live — stays a literal, same as
    // non-live translation.
    expect(live('due 2026-06-01')).toBe('note.due == "2026-06-01"')
})

test('liveDates blocks the WHOLE translation on a weekday word, rather than degrading it', () => {
    const out = translateTaskDsl('not done\ndue friday', TODAY, { liveDates: true })
    expect(out.where).toBeUndefined()
    expect(out.sort).toBeUndefined()
    expect(out.blocked).toEqual(['due friday'])

    const nextWeek = translateTaskDsl('due next monday', TODAY, { liveDates: true })
    expect(nextWeek.blocked).toEqual(['due next monday'])
})

test('liveDates does not change the read-time (non-live) translation at all', () => {
    // Regression guard for the trap this option exists to avoid: an un-migrated
    // ```query block re-resolves fresh on every render, so the DEFAULT call (no opts)
    // must keep resolving to a literal, unchanged.
    expect(translateTaskDsl('due before tomorrow', TODAY).where).toBe(
        'note.due < "2026-05-28"',
    )
})

test('a date-field name plus a bare date word is a date filter, not the bare status leaf', () => {
    // "done today" is the done-DATE filter (note.done == today), distinct from the bare
    // status leaf "done" (note.resolved) even though both start with the word "done".
    expect(w('done today')).toBe('note.done == "2026-05-27"')
})

test('multiple lines are ANDed', () => {
    expect(w('not done\npriority is high')).toBe(
        '(!note.resolved) && (note.priority == "high")',
    )
})

test('in-line booleans keep their structure', () => {
    expect(w('not done AND (priority is high OR is recurring)')).toBe(
        '!note.resolved && (note.priority == "high" || note.recurring)',
    )
    expect(w('(priority is high) OR (due before today)')).toBe(
        '(note.priority == "high") || (note.due < "2026-05-27")',
    )
    expect(w('(priority is high) AND (due before today)')).toBe(
        '(note.priority == "high") && (note.due < "2026-05-27")',
    )
})

test('sort by is lifted out of the filter', () => {
    const out = translateTaskDsl('not done\nsort by due reverse', TODAY)
    expect(out.where).toBe('!note.resolved')
    expect(out.sort).toEqual([{ property: 'note.due', direction: 'DESC' }])
})

test('sort by priority then due, ascending by default, with no filter lines', () => {
    const out = translateTaskDsl('sort by priority\nsort by due', TODAY)
    expect(out.where).toBeUndefined()
    expect(out.sort).toEqual([
        { property: 'note.priority', direction: 'ASC' },
        { property: 'note.due', direction: 'ASC' },
    ])
})

// bismuth base migrate-queries used to refuse to write a `sort by priority` line as a
// modern `sort:` key, because the general Bases sort path couldn't rank priority by
// urgency. Now that query.ts's compareForSort does, that refusal is gone — the only
// thing left that could block it is right here, at translation: a clean (non-blocked,
// non-degraded) SortSpec is what lets the cli go on to write it instead of refusing.
test('sort by priority translates cleanly rather than degrading or blocking', () => {
    const out = translateTaskDsl('sort by priority', TODAY)
    expect(out.sort).toEqual([{ property: 'note.priority', direction: 'ASC' }])
    expect(out.blocked).toBeUndefined()
    expect(out.unrecognized).toBeUndefined()
})

// applyTaskSort is what the "can this test fail" trap is about: the existing sort
// tests above only assert on the translated SortSpec, which stays green even if every
// caller forgets to apply it — and priority in particular is a trap of its own, since
// the generic bases compare() sorts strings ALPHABETICALLY (high, highest, low, lowest,
// medium, none), not by urgency. Prove the actual row order.
test('applyTaskSort orders priority by urgency, not alphabetically', () => {
    const rows = [
        task({ priority: 'low', description: 'low' }),
        task({ priority: 'highest', description: 'highest' }),
        task({ priority: 'none', description: 'none' }),
        task({ priority: 'high', description: 'high' }),
        task({ priority: 'lowest', description: 'lowest' }),
        task({ priority: 'medium', description: 'medium' }),
    ].map(taskToRow)
    const sorted = applyTaskSort(
        rows,
        [{ property: 'note.priority', direction: 'ASC' }],
        (r, p) => resolveProperty(p, r),
    )
    expect(sorted.map(r => r.note.description)).toEqual([
        'highest',
        'high',
        'medium',
        'none',
        'low',
        'lowest',
    ])
})

test('applyTaskSort sorts undated tasks last regardless of direction', () => {
    const rows = [
        task({ due: '2026-06-01', description: 'dated' }),
        task({ description: 'undated' }),
    ].map(taskToRow)
    const asc = applyTaskSort(
        rows,
        [{ property: 'note.due', direction: 'ASC' }],
        (r, p) => resolveProperty(p, r),
    )
    expect(asc.map(r => r.note.description)).toEqual(['dated', 'undated'])
    const desc = applyTaskSort(
        rows,
        [{ property: 'note.due', direction: 'DESC' }],
        (r, p) => resolveProperty(p, r),
    )
    expect(desc.map(r => r.note.description)).toEqual(['dated', 'undated'])
})

test('recognized-but-unsupported instructions are silently ignored', () => {
    expect(w('not done\ngroup by filename\nlimit 5')).toBe('!note.resolved')
})

test('looksLikeTaskDsl separates DSL text from a bases expression', () => {
    expect(looksLikeTaskDsl('not done')).toBe(true)
    expect(looksLikeTaskDsl('priority is high')).toBe(true)
    expect(looksLikeTaskDsl('due before tomorrow')).toBe(true)
    expect(looksLikeTaskDsl('sort by due')).toBe(true)
    expect(looksLikeTaskDsl('note.resolved == false')).toBe(false)
    expect(looksLikeTaskDsl('!note.resolved')).toBe(false)
    expect(looksLikeTaskDsl('note.priority == "high"')).toBe(false)
})

// The discriminator anchored on the FIRST LINE ONLY, so a leading paren group or a
// leading `#` comment made it misread real DSL text as a bases expression — passesFilter
// then threw parsing it and every row silently failed to match (an empty list, not an
// error). It must walk every line the same way translateTaskDsl itself does.
test('looksLikeTaskDsl is line-aware: leading parens, comments, and multi-line bodies', () => {
    // A leading paren group is still DSL once the parens are peeled.
    expect(looksLikeTaskDsl('(priority is high) OR (due before today)')).toBe(true)
    // A leading `#` comment line is skipped, same as translateTaskDsl.
    expect(looksLikeTaskDsl('# hide finished tasks\nnot done')).toBe(true)
    // Multi-line bodies: the opener can be on any line, not just the first.
    expect(looksLikeTaskDsl('not done\nsort by due reverse')).toBe(true)
    expect(looksLikeTaskDsl('not done\npriority is high')).toBe(true)
    // A body that is only comments carries no DSL content — correctly not flagged,
    // same as a query with no filter lines translating to no effective constraint.
    expect(looksLikeTaskDsl('# just a comment\n# another comment')).toBe(false)
})

test('a real bases expression is never misread as DSL in the same shapes', () => {
    expect(looksLikeTaskDsl('(note.priority == "high") && note.due < today()')).toBe(
        false,
    )
    expect(looksLikeTaskDsl('# a comment\nnote.resolved == false')).toBe(false)
    expect(
        looksLikeTaskDsl('note.resolved == false\nnote.priority == "high"'),
    ).toBe(false)
})

test('translateTaskDsl reports the leaves it degraded to true, for CLI diagnostics', () => {
    expect(translateTaskDsl('not done', TODAY).unrecognized).toBeUndefined()
    expect(
        translateTaskDsl('not done AND banana', TODAY).unrecognized,
    ).toEqual(['banana'])
    expect(
        translateTaskDsl('banana OR happiness is high', TODAY).unrecognized,
    ).toEqual(['banana', 'happiness is high'])
})

// ── end-to-end equivalence checks: translate, then run the SAME rows through the real
// Bases filter engine, so a wrong translation shows up as a red test rather than a
// plausible-looking string. ─────────────────────────────────────────────────────────

function task(p: Partial<Task>): Task {
    return {
        path: 'f.md',
        line: 0,
        raw: '',
        indent: '',
        status: 'todo',
        statusChar: ' ',
        description: 'x',
        priority: 'none',
        tags: [],
        ...p,
    }
}

test('not done excludes cancelled tasks, done matches both done and cancelled', () => {
    const rows = [
        task({ status: 'todo', description: 'todo' }),
        task({ status: 'in-progress', description: 'wip' }),
        task({ status: 'cancelled', description: 'cancelled' }),
        task({ status: 'done', description: 'done' }),
    ].map(taskToRow)

    const notDone = translateTaskDsl('not done', TODAY).where!
    expect(
        rows
            .filter(r => passesFilter(notDone, toContext(r)))
            .map(r => r.note.description)
            .sort(),
    ).toEqual(['todo', 'wip'])

    const done = translateTaskDsl('done', TODAY).where!
    expect(
        rows
            .filter(r => passesFilter(done, toContext(r)))
            .map(r => r.note.description)
            .sort(),
    ).toEqual(['cancelled', 'done'])
})

// An unrecognised leaf translates to `true` (the old evaluator's own degrade-to-true
// behaviour — see the doc comment on translateBool in taskDsl.ts), never drops the
// whole line. A dropped line fails OPEN: a filter meant to hide resolved tasks would
// silently show them again. These are end-to-end, not string assertions, because the
// string form is exactly what hid the original regression.
test('an unrecognised leaf ANDed with a real one still filters, matching the old evaluator', () => {
    const rows = [
        task({ status: 'todo', description: 'todo' }),
        task({ status: 'done', description: 'done' }),
    ].map(taskToRow)
    const where = translateTaskDsl('not done AND banana', TODAY).where!
    expect(
        rows.filter(r => passesFilter(where, toContext(r))).map(r => r.note.description),
    ).toEqual(['todo'])
})

test('an unrecognised leaf ORed with a real one passes everything, matching the old evaluator', () => {
    const rows = [
        task({ status: 'todo', description: 'todo' }),
        task({ status: 'done', description: 'done' }),
    ].map(taskToRow)
    const where = translateTaskDsl('banana OR not done', TODAY).where!
    expect(
        rows
            .filter(r => passesFilter(where, toContext(r)))
            .map(r => r.note.description)
            .sort(),
    ).toEqual(['done', 'todo'])
})

test('a line that is only an unrecognised leaf contributes no effective constraint', () => {
    const rows = [
        task({ status: 'todo', description: 'todo' }),
        task({ status: 'done', description: 'done' }),
    ].map(taskToRow)
    const where = translateTaskDsl('banana', TODAY).where!
    expect(
        rows
            .filter(r => passesFilter(where, toContext(r)))
            .map(r => r.note.description)
            .sort(),
    ).toEqual(['done', 'todo'])
})

test('created/cancelled date leaves actually select rows, not just translate to a plausible string', () => {
    // taskToRow once dropped `created`/`cancelled` from note.*, so these two filters
    // translated to a correct-looking expression that matched nothing at runtime. A
    // string-equality test alone would not have caught that — this one runs the
    // translated expression through the real filter engine to prove it selects.
    const rows = [
        task({ created: '2026-05-01', description: 'old-created' }),
        task({ created: '2026-05-28', description: 'new-created' }),
        task({
            status: 'cancelled',
            cancelled: '2025-12-31',
            description: 'early-cancel',
        }),
        task({
            status: 'cancelled',
            cancelled: '2026-06-01',
            description: 'late-cancel',
        }),
    ].map(taskToRow)

    const createdBefore = translateTaskDsl('created before today', TODAY).where!
    expect(createdBefore).toBe(`note.created < "${TODAY}"`)
    expect(
        rows
            .filter(r => passesFilter(createdBefore, toContext(r)))
            .map(r => r.note.description),
    ).toEqual(['old-created'])

    const cancelledAfter = translateTaskDsl(
        'cancelled after 2026-01-01',
        TODAY,
    ).where!
    expect(cancelledAfter).toBe('note.cancelled > "2026-01-01"')
    expect(
        rows
            .filter(r => passesFilter(cancelledAfter, toContext(r)))
            .map(r => r.note.description),
    ).toEqual(['late-cancel'])
})

test("the user's real query translates to an equivalent bases filter", () => {
    const tasks = [
        task({
            status: 'todo',
            priority: 'high',
            due: '2026-05-26',
            description: 'overdue-high',
        }),
        task({
            status: 'todo',
            priority: 'medium',
            due: '2026-05-26',
            description: 'overdue-medium',
        }),
        task({
            status: 'done',
            priority: 'high',
            due: '2026-05-26',
            description: 'done-high',
        }),
        task({
            status: 'todo',
            recurrence: 'every day',
            priority: 'high',
            due: '2026-05-26',
            description: 'recurring-high',
        }),
    ]
    const q = [
        'not done',
        'is not recurring',
        '((due before today) OR (due today) OR ((due after today) AND (due before in 7 days)) OR (priority is high) OR (scheduled today) OR (scheduled before today))',
        '(priority is not medium) AND (priority is not low)',
        'sort by priority',
        'sort by due',
    ].join('\n')
    const { where, sort } = translateTaskDsl(q, TODAY)
    expect(where).toBeDefined()
    expect(sort).toEqual([
        { property: 'note.priority', direction: 'ASC' },
        { property: 'note.due', direction: 'ASC' },
    ])

    const rows = tasks.map(taskToRow)
    const passed = rows.filter(r => passesFilter(where!, toContext(r)))
    expect(passed.map(r => r.note.description)).toEqual(['overdue-high'])
})
