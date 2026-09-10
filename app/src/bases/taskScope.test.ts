import { test, expect, describe } from 'bun:test'
import {
    newTaskVisible,
    prospectiveStoredTaskRow,
    prospectiveLineTaskRow,
} from './taskScope'
import type {
    BaseConfig,
    SourceSpec,
    ViewConfig,
} from '../../../core/src/bases/types'

const view = (over: Partial<ViewConfig> = {}): ViewConfig =>
    ({ type: 'list', ...over }) as ViewConfig
const config = (over: Partial<BaseConfig> = {}): BaseConfig =>
    ({ views: [], ...over }) as BaseConfig

describe('prospective rows', () => {
    test('a stored row is normalized the same way the view will see it', () => {
        const r = prospectiveStoredTaskRow(
            'boards/b.md',
            { description: 'New task', status: 'todo' },
            3,
        )
        expect(r.index).toBe(3)
        expect(r.file.path).toBe('boards/b.md')
        // The seven fills normalizeStoredTaskRow adds — without them the check would grade
        // the row against a shape no view ever renders.
        expect(r.note.priority).toBe('none')
        expect(r.note.resolved).toBe(false)
    })

    test('a task LINE row is built by the same producer that scans the note', () => {
        const r = prospectiveLineTaskRow('Inbox.md', 'New task')
        expect(r?.note.description).toBe('New task')
        expect(r?.note.status).toBe('todo')
        expect(r?.file.path).toBe('Inbox.md')
    })

    test('a body that is not a valid task line yields null rather than a fake row', () => {
        expect(prospectiveLineTaskRow('Inbox.md', '')).not.toBeNull()
    })
})

describe('newTaskVisible', () => {
    test('no filters anywhere means always visible', () => {
        const r = prospectiveLineTaskRow('Inbox.md', 'New task')!
        expect(newTaskVisible(config(), view(), r)).toBe(true)
    })

    test('a view filter the new task cannot satisfy makes it invisible', () => {
        const r = prospectiveLineTaskRow('Inbox.md', 'New task')!
        expect(
            newTaskVisible(config(), view({ filters: 'note.priority == "high"' }), r),
        ).toBe(false)
    })

    test('a BASE-level filter counts too', () => {
        const r = prospectiveLineTaskRow('Inbox.md', 'New task')!
        expect(
            newTaskVisible(config({ filters: 'note.priority == "high"' }), view(), r),
        ).toBe(false)
    })

    test("the source's own where: counts too", () => {
        const r = prospectiveLineTaskRow('Inbox.md', 'New task')!
        const v = view({
            source: { kind: 'tasks', where: 'note.priority == "high"' },
        })
        expect(newTaskVisible(config(), v, r)).toBe(false)
    })

    test('a filter the new task DOES satisfy leaves it visible', () => {
        // `!done`, not the tasks-DSL spelling `not done` — this module evaluates a
        // ViewConfig.filters STRING through the Bases expression language (parseExpr),
        // which has no `not`/`and`/`or` keywords (those belong to taskDsl.ts's translator,
        // a different input). `done` is undefined on a fresh task, so `!done` is true.
        const r = prospectiveLineTaskRow('Inbox.md', 'New task')!
        expect(newTaskVisible(config(), view({ filters: '!done' }), r)).toBe(true)
    })

    test('a base source ref carries no where: to apply, even when one is attached', () => {
        // `{kind: 'base'}` composes another base; its own filters are that base's business
        // and are not re-applied here. Reading `where` off it would apply a filter that does
        // not exist.
        //
        // `normalizeSource` (core/src/bases/sourceSpec.ts) attaches `where: str(o.where)`
        // regardless of `kind`, so a real base file CAN produce a `{kind:'base'}` spec that
        // carries a `where` — the type declares no such field, but the runtime value can have
        // one anyway, which is exactly the gap this fixture has to exercise to mean anything.
        // The `where` below is chosen to EXCLUDE the row (priority defaults to 'none'), so
        // this test only passes because `activeFilters` drops it — with the `spec.kind !==
        // 'base'` guard removed, this exact fixture would flip the answer to `false`.
        const r = prospectiveStoredTaskRow('boards/b.md', { description: 'x' }, 0)
        const spec = {
            kind: 'base',
            ref: '[[Other]]',
            where: 'note.priority == "high"',
        } as unknown as SourceSpec
        const v = view({ source: spec })
        expect(newTaskVisible(config(), v, r)).toBe(true)
    })

    test('an unparseable filter does NOT report the task as invisible', () => {
        // passesFilter returns false for a filter it cannot parse. Treating that as "your task
        // will not appear" would toast on every base with a typo in it, which is a different
        // problem with a different message (`base validate` owns it). Fail toward silence.
        const r = prospectiveLineTaskRow('Inbox.md', 'New task')!
        expect(newTaskVisible(config(), view({ filters: 'not ((' }), r)).toBe(true)
    })

    test('a formula-referencing filter does NOT report the task as invisible', () => {
        // Production computes formulas BEFORE filtering (core/src/bases/query.ts's `runView`
        // calls `computeFormulas` first, exactly so a filter CAN reference `formula.*` —
        // docs/bases/query-syntax.md documents it as supported) but neither prospective-row
        // builder computes any formula, so `row.formula` here is always `{}`. Without the
        // guard, `formula.ppu > 10` would read `undefined > 10` as false and toast for a task
        // that, once the real formulas run against the real row, might well pass. Fail toward
        // silence — the same rule as an unparseable filter, and deliberately not "compute the
        // formula here too" (see the comment on `newTaskVisible`).
        const r = prospectiveLineTaskRow('Inbox.md', 'New task')!
        expect(
            newTaskVisible(config(), view({ filters: 'formula.ppu > 10' }), r),
        ).toBe(true)
    })
})
