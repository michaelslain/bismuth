import { describe, expect, test } from 'bun:test'
import {
    metaColumns,
    metaSource,
    hasValue,
    metaVisible,
    writableKey,
    storedTitleColumn,
    matchedStoredRowId,
} from './kanbanMeta'
import type { Schema } from '../../../core/src/schema/types'

describe('metaColumns', () => {
    test('drops only the title column', () => {
        expect(
            metaColumns(
                ['file.name', 'file.tags', 'description', 'worktree'],
                'file.name',
            ),
        ).toEqual(['file.tags', 'description', 'worktree'])
    })

    test('description flows through as a normal meta property, in either spelling (#103 — no special-cased slot)', () => {
        expect(
            metaColumns(
                ['file.name', 'note.description', 'note.priority'],
                'file.name',
            ),
        ).toEqual(['note.description', 'note.priority'])
        expect(metaColumns(['file.name', 'description'], 'file.name')).toEqual([
            'description',
        ])
    })

    test('no order → no meta', () => {
        expect(metaColumns(undefined, 'file.name')).toEqual([])
    })
})

describe('hasValue', () => {
    test('null/undefined/empty/whitespace strings are empty', () => {
        for (const v of [null, undefined, '', '   '])
            expect(hasValue(v)).toBe(false)
    })

    test('false is empty (renderValue draws it as nothing), true is a value', () => {
        expect(hasValue(false)).toBe(false)
        expect(hasValue(true)).toBe(true)
    })

    test('arrays are empty unless some element has a value', () => {
        expect(hasValue([])).toBe(false)
        expect(hasValue(['', null])).toBe(false)
        expect(hasValue(['', 'x'])).toBe(true)
    })

    test('0 and dates count as values', () => {
        expect(hasValue(0)).toBe(true)
        expect(hasValue(new Date(0))).toBe(true)
    })
})

describe('metaSource', () => {
    const columns = ['file.name', 'note.status', 'note.effort']

    test('explicit view order always wins', () => {
        expect(
            metaSource(
                ['note.effort'],
                ['status', 'effort'],
                columns,
                'status',
            ),
        ).toEqual(['note.effort'])
    })

    test('declared properties fall back to the engine-resolved columns', () => {
        expect(metaSource(undefined, ['status', 'effort'], columns)).toEqual(
            columns,
        )
        expect(metaSource([], ['status', 'effort'], columns)).toEqual(columns)
    })

    test('declared fallback drops the groupBy property (the column already conveys it)', () => {
        expect(
            metaSource(undefined, ['status', 'effort'], columns, 'status'),
        ).toEqual(['file.name', 'note.effort'])
        // Any spelling combination of groupBy vs column id lines up.
        expect(
            metaSource(undefined, ['status', 'effort'], columns, 'note.status'),
        ).toEqual(['file.name', 'note.effort'])
    })

    test('no order + no declaration → no meta (row-frontmatter union must not leak onto cards)', () => {
        expect(
            metaSource(undefined, undefined, columns, 'status'),
        ).toBeUndefined()
        expect(metaSource(undefined, [], columns, 'status')).toBeUndefined()
    })
})

describe('metaVisible', () => {
    const boolSchema: Schema = { done: { type: 'boolean' } }

    test('a declared boolean property is visible even when false — the chip is its only toggle', () => {
        expect(metaVisible('done', false, boolSchema)).toBe(true)
        expect(metaVisible('note.done', false, boolSchema)).toBe(true)
    })

    test('a declared boolean stays visible when true too (toggling false→true→false never hides the row)', () => {
        expect(metaVisible('done', true, boolSchema)).toBe(true)
    })

    test('an undeclared property whose runtime value is boolean is still visible when false', () => {
        expect(metaVisible('archived', false, {})).toBe(true)
    })

    test('a genuinely empty non-boolean property stays hidden (no regression from the boolean carve-out)', () => {
        expect(metaVisible('priority', null, {})).toBe(false)
        expect(metaVisible('priority', '', {})).toBe(false)
        expect(metaVisible('tags', [], {})).toBe(false)
    })

    test('a non-empty non-boolean property is visible, same as hasValue', () => {
        expect(metaVisible('priority', 'high', {})).toBe(true)
        expect(metaVisible('count', 0, {})).toBe(true)
    })
})

describe('storedTitleColumn', () => {
    test('picks the first writable order id', () => {
        expect(storedTitleColumn(['description', 'status'])).toBe(
            'description',
        )
        expect(storedTitleColumn(['note.description', 'status'])).toBe(
            'note.description',
        )
    })

    test('skips non-writable ids (file./formula./this.) before a writable one', () => {
        expect(storedTitleColumn(['file.name', 'description'])).toBe(
            'description',
        )
    })

    test('falls back to "title" when nothing in order is writable', () => {
        expect(storedTitleColumn([])).toBe('title')
        expect(storedTitleColumn(['file.name', 'formula.total'])).toBe(
            'title',
        )
    })
})

describe('matchedStoredRowId', () => {
    test('finds the new row (not in priorIds) carrying the matching value', () => {
        const rows = [
            { id: 'b.md#0', value: 'Todo' },
            { id: 'b.md#1', value: 'Todo' },
        ]
        expect(
            matchedStoredRowId(rows, new Set(['b.md#0']), 'Todo'),
        ).toBe('b.md#1')
    })

    test('a new row present under a filters: block that drops other rows still resolves — index is never consulted', () => {
        // The whole bug: the server appended past index 4 (filtered rows not shown here at
        // all), yet the real new row is still findable by "new + matching value" alone.
        const rows = [{ id: 'b.md#7', value: 'Doing' }]
        expect(
            matchedStoredRowId(rows, new Set(), 'Doing'),
        ).toBe('b.md#7')
    })

    test('undefined when nothing new yet', () => {
        const rows = [{ id: 'b.md#0', value: 'Todo' }]
        expect(matchedStoredRowId(rows, new Set(['b.md#0']), 'Todo')).toBeUndefined()
    })

    test('undefined when a new row exists but carries a different value (not this add)', () => {
        const rows = [{ id: 'b.md#1', value: 'Doing' }]
        expect(matchedStoredRowId(rows, new Set(), 'Todo')).toBeUndefined()
    })
})

describe('writableKey', () => {
    test('strips the note. namespace', () => {
        expect(writableKey('note.status')).toBe('status')
    })
    test('bare property names pass through unchanged', () => {
        expect(writableKey('priority')).toBe('priority')
    })
    test('file./formula./this. are not writable', () => {
        expect(writableKey('file.name')).toBeNull()
        expect(writableKey('formula.total')).toBeNull()
        expect(writableKey('this.foo')).toBeNull()
    })
})
