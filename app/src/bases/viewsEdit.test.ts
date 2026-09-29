import { describe, expect, test } from 'bun:test'
import {
    addView,
    changeViewType,
    duplicateView,
    materializeViews,
    moveView,
    readViews,
    removeView,
    renameView,
    restoreView,
    toggleViewMode,
    type RawView,
} from './viewsEdit'

const table = (name = 'Table'): RawView => ({ type: 'table', name })

describe('addView', () => {
    test('names a fresh view after the capitalized kind', () => {
        const next = addView([table()], 'kanban')
        expect(next).toHaveLength(2)
        expect(next[1]).toEqual({ type: 'kanban', name: 'Kanban' })
    })

    test('de-duplicates against an existing name — "Table 2"', () => {
        const next = addView([table()], 'table')
        expect(next[1].name).toBe('Table 2')
    })

    test('keeps counting past a collision — "Table 3"', () => {
        const next = addView([table(), table('Table 2')], 'table')
        expect(next[2].name).toBe('Table 3')
    })

    test('does not mutate the input array', () => {
        const views = [table()]
        addView(views, 'kanban')
        expect(views).toHaveLength(1)
    })
})

describe('duplicateView', () => {
    test('inserts a deep-cloned copy right after the source, renamed', () => {
        const views: RawView[] = [
            { type: 'kanban', name: 'Board', groupBy: { property: 'status' } },
        ]
        const next = duplicateView(views, 0)
        expect(next).toHaveLength(2)
        expect(next[1]).toEqual({
            type: 'kanban',
            name: 'Board 2',
            groupBy: { property: 'status' },
        })
        // Deep clone: mutating the clone's nested object must not touch the source's.
        ;(next[1].groupBy as { property: string }).property = 'other'
        expect((views[0].groupBy as { property: string }).property).toBe(
            'status',
        )
    })

    test('out-of-range index is a no-op', () => {
        const views = [table()]
        expect(duplicateView(views, 5)).toBe(views)
    })
})

describe('removeView', () => {
    test('removes the view at the given index', () => {
        const next = removeView([table('A'), table('B')], 0)
        expect(next).toEqual([table('B')])
    })

    test('never drops below one view', () => {
        const views = [table()]
        expect(removeView(views, 0)).toBe(views)
    })

    test('out-of-range index is a no-op', () => {
        const views = [table('A'), table('B')]
        expect(removeView(views, 5)).toBe(views)
    })
})

describe('restoreView', () => {
    test('re-inserts at the old index, keeping later edits', () => {
        const cur = [table('A'), table('C')]
        expect(restoreView(cur, table('B'), 1).map(v => v.name)).toEqual([
            'A',
            'B',
            'C',
        ])
    })

    test('clamps a stale index to the end', () => {
        const cur = [table('A')]
        expect(restoreView(cur, table('Z'), 9).map(v => v.name)).toEqual([
            'A',
            'Z',
        ])
    })

    test('does not mutate the input array', () => {
        const cur = [table('A')]
        restoreView(cur, table('B'), 0)
        expect(cur).toHaveLength(1)
    })
})

describe('renameView', () => {
    test('sets the trimmed name', () => {
        const next = renameView([table()], 0, '  My Board  ')
        expect(next[0].name).toBe('My Board')
    })

    test('blank name is a no-op', () => {
        const views = [table()]
        expect(renameView(views, 0, '   ')).toBe(views)
    })
})

describe('moveView', () => {
    test('swaps with the right neighbor', () => {
        const next = moveView([table('A'), table('B'), table('C')], 0, 1)
        expect(next.map(v => v.name)).toEqual(['B', 'A', 'C'])
    })

    test('swaps with the left neighbor', () => {
        const next = moveView([table('A'), table('B'), table('C')], 2, -1)
        expect(next.map(v => v.name)).toEqual(['A', 'C', 'B'])
    })

    test('no-op past the left edge', () => {
        const views = [table('A'), table('B')]
        expect(moveView(views, 0, -1)).toBe(views)
    })

    test('no-op past the right edge', () => {
        const views = [table('A'), table('B')]
        expect(moveView(views, 1, 1)).toBe(views)
    })
})

describe('changeViewType', () => {
    test('changes only the type, leaving other fields', () => {
        const next = changeViewType(
            [{ type: 'table', name: 'Table', columnWidths: { a: 100 } }],
            0,
            'cards',
        )
        expect(next[0]).toEqual({
            type: 'cards',
            name: 'Table',
            columnWidths: { a: 100 },
        })
    })
})

describe('toggleViewMode', () => {
    test('normal (unset) -> tasks', () => {
        const next = toggleViewMode([table()], 0)
        expect(next[0].mode).toBe('tasks')
    })

    test('tasks -> normal', () => {
        const next = toggleViewMode(
            [{ type: 'table', name: 'T', mode: 'tasks' }],
            0,
        )
        expect(next[0].mode).toBe('normal')
    })

    test('legacy calendarContent: tasks reads as tasks, flips to normal, and is dropped', () => {
        const next = toggleViewMode(
            [{ type: 'calendar', name: 'Cal', calendarContent: 'tasks' }],
            0,
        )
        expect(next[0].mode).toBe('normal')
        expect(next[0].calendarContent).toBeUndefined()
    })

    test('legacy calendarContent: events reads as normal, flips to tasks, and is dropped', () => {
        const next = toggleViewMode(
            [{ type: 'calendar', name: 'Cal', calendarContent: 'events' }],
            0,
        )
        expect(next[0].mode).toBe('tasks')
        expect(next[0].calendarContent).toBeUndefined()
    })
})

describe('materializeViews', () => {
    test('an explicit views: array is left untouched, no removed keys', () => {
        const raw = { views: [table('Mine')] }
        const result = materializeViews(raw)
        expect(result.views).toBe(raw.views)
        expect(result.removedKeys).toEqual([])
    })

    test('view: shorthand + flat field keys fold into views[0], and both are marked removed', () => {
        const raw = {
            type: 'base',
            view: 'calendar',
            dateField: 'due',
            googleCalendarSync: true,
            mode: 'tasks',
        }
        const result = materializeViews(raw)
        expect(result.views).toEqual([
            {
                type: 'calendar',
                name: 'Calendar',
                dateField: 'due',
                googleCalendarSync: true,
                mode: 'tasks',
            },
        ])
        expect(result.removedKeys.sort()).toEqual(
            ['view', 'dateField', 'googleCalendarSync', 'mode'].sort(),
        )
    })

    test('no view: and no flat keys still synthesizes a bare table view', () => {
        const result = materializeViews({ type: 'base' })
        expect(result.views).toEqual([{ type: 'table', name: 'Table' }])
        expect(result.removedKeys).toEqual([])
    })

    test('base-level keys (filters/source/properties) are never migrated', () => {
        const raw = {
            view: 'table',
            filters: { and: [] },
            source: 'notes',
            properties: {},
        }
        const result = materializeViews(raw)
        expect(result.views).toEqual([{ type: 'table', name: 'Table' }])
        expect(result.removedKeys).toEqual(['view'])
    })
})

describe('readViews (file text)', () => {
    test('materializes a `view: <kind>` shorthand base with flat top-level keys from raw file text', () => {
        const text = `---\ntype: base\nview: kanban\ngroupBy: status\ncolumns: [todo, done]\n---\n\nbody text\n`
        const result = readViews(text)
        expect(result.views).toEqual([
            {
                type: 'kanban',
                name: 'Kanban',
                groupBy: 'status',
                columns: ['todo', 'done'],
            },
        ])
        expect(result.removedKeys.sort()).toEqual(
            ['view', 'groupBy', 'columns'].sort(),
        )
    })

    test('a base already carrying views: is passed through with no removed keys', () => {
        const text = `---\ntype: base\nviews:\n  - type: table\n    name: Table\n  - type: kanban\n    name: Board\n---\n`
        const result = readViews(text)
        expect(result.views).toEqual([
            { type: 'table', name: 'Table' },
            { type: 'kanban', name: 'Board' },
        ])
        expect(result.removedKeys).toEqual([])
    })

    test('no frontmatter at all synthesizes a bare table view', () => {
        expect(readViews('just some text').views).toEqual([
            { type: 'table', name: 'Table' },
        ])
    })

    test('malformed YAML frontmatter is tolerated as empty', () => {
        const text = `---\nview: [unterminated\n---\n`
        expect(readViews(text).views).toEqual([
            { type: 'table', name: 'Table' },
        ])
    })
})
