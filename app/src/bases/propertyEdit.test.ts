import { describe, expect, test } from 'bun:test'
import {
    distinctStrings,
    propertyEditKind,
    multiselectCommitValue,
    multiselectValues,
    selectChoices,
    selectOptionsWithCurrent,
    tagsOptions,
    propertyDraft,
    draftCommitValue,
    readonlyText,
} from './propertyEdit'
import type { Schema } from '../../../core/src/schema/types'
import type { BasePropertyType } from '../../../core/src/bases/types'

describe('distinctStrings', () => {
    test('dedupes, drops empties/objects, sorts', () => {
        expect(
            distinctStrings([
                'b',
                'a',
                'b',
                '',
                null,
                undefined,
                { x: 1 },
                ['y'],
            ]),
        ).toEqual(['a', 'b'])
    })
    test('empty input yields empty list', () => {
        expect(distinctStrings([])).toEqual([])
    })
})

describe('propertyEditKind', () => {
    const noSchema: Schema = {}

    test('registry boolean/number/date/datetime win over the value', () => {
        const schema: Schema = {
            done: { type: 'boolean' },
            price: { type: 'number' },
            due: { type: 'date' },
            start: { type: 'datetime' },
        }
        expect(
            propertyEditKind('done', 'not actually a bool', schema, []),
        ).toEqual({ kind: 'boolean' })
        expect(propertyEditKind('price', '9', schema, [])).toEqual({
            kind: 'number',
        })
        expect(propertyEditKind('due', 'whatever', schema, [])).toEqual({
            kind: 'date',
        })
        expect(propertyEditKind('start', 'whatever', schema, [])).toEqual({
            kind: 'date',
            time: true,
        })
    })

    test('registry enum -> select with its declared values', () => {
        const schema: Schema = {
            status: {
                type: { kind: 'enum', values: ['todo', 'doing', 'done'] },
            },
        }
        expect(propertyEditKind('status', 'todo', schema, [])).toEqual({
            kind: 'select',
            options: ['todo', 'doing', 'done'],
        })
    })

    test('registry list -> tags', () => {
        const schema: Schema = {
            labels: { type: { kind: 'list', item: 'string' } },
        }
        expect(propertyEditKind('labels', ['a'], schema, [])).toEqual({
            tag: false,
            kind: 'tags',
            options: ['a'],
        })
    })

    test('note.-namespaced id resolves the bare registry key', () => {
        const schema: Schema = { rating: { type: 'number' } }
        expect(propertyEditKind('note.rating', 4, schema, [])).toEqual({
            kind: 'number',
        })
    })

    test("falls back to the value's own runtime type when undeclared", () => {
        expect(propertyEditKind('flag', true, noSchema, [])).toEqual({
            kind: 'boolean',
        })
        expect(propertyEditKind('count', 3, noSchema, [])).toEqual({
            kind: 'number',
        })
        expect(propertyEditKind('tags', ['a', 'b'], noSchema, [])).toEqual({
            tag: true,
            kind: 'tags',
            options: ['a', 'b'],
        })
    })

    test('ISO date-like / datetime-like strings are detected by shape', () => {
        expect(propertyEditKind('due', '2024-01-01', noSchema, [])).toEqual({
            kind: 'date',
        })
        expect(
            propertyEditKind('start', '2024-01-01T09:30', noSchema, []),
        ).toEqual({ kind: 'date', time: true })
        expect(
            propertyEditKind('start', '2024-01-01 09:30', noSchema, []),
        ).toEqual({ kind: 'date', time: true })
    })

    test('select-from-known-values fallback: 2-8 distinct sibling values -> select', () => {
        const siblings = ['backlog', 'in progress', 'done', 'backlog', 'done']
        expect(
            propertyEditKind('priority', 'backlog', noSchema, siblings),
        ).toEqual({
            kind: 'select',
            options: ['backlog', 'done', 'in progress'],
        })
    })

    test('too few (all-unique) or too many distinct sibling values -> plain text', () => {
        expect(
            propertyEditKind('note.summary', 'hello', noSchema, ['hello']),
        ).toEqual({ kind: 'text' })
        const many = Array.from({ length: 9 }, (_, i) => `v${i}`)
        expect(propertyEditKind('summary', 'v0', noSchema, many)).toEqual({
            kind: 'text',
        })
    })

    test('null/undefined value with no siblings -> plain text', () => {
        expect(propertyEditKind('summary', null, noSchema, [])).toEqual({
            kind: 'text',
        })
    })

    test('undeclared array value with array siblings -> tags, options union the board', () => {
        // A table/kanban column across several rows: each row's raw value is itself an
        // array. propertyEditKind must flatten every sibling array (not treat each array
        // as one opaque option) so the picker lists every tag the column actually holds.
        expect(
            propertyEditKind('tags', ['a'], noSchema, [
                ['a', 'b'],
                ['c'],
            ]),
        ).toEqual({ kind: 'tags', options: ['a', 'b', 'c'], tag: true })
    })

    test('a string cell with only-array siblings never becomes a select', () => {
        // Regression for the tags-dropdown fix: a caller may now pass a column's raw
        // sibling values unfiltered by row shape. Array siblings must never leak into the
        // "select from known values" text-column heuristic — only scalar strings should.
        expect(
            propertyEditKind('title', 'Hello', noSchema, [
                ['a', 'b'],
                ['c', 'd'],
            ]),
        ).toEqual({ kind: 'text' })
    })
})

describe('propertyEditKind — declared type (#100)', () => {
    const noSchema: Schema = {}

    test('declared text/boolean/date/datetime map straight onto their editor kinds', () => {
        expect(
            propertyEditKind('title', 'x', noSchema, [], { kind: 'text' }),
        ).toEqual({ kind: 'text' })
        expect(
            propertyEditKind('done', 'x', noSchema, [], { kind: 'boolean' }),
        ).toEqual({ kind: 'boolean' })
        expect(
            propertyEditKind('due', 'x', noSchema, [], { kind: 'date' }),
        ).toEqual({ kind: 'date' })
        expect(
            propertyEditKind('start', 'x', noSchema, [], { kind: 'datetime' }),
        ).toEqual({ kind: 'date', time: true })
    })

    test('declared markdown -> markdown editor kind', () => {
        expect(
            propertyEditKind('notes', 'x', noSchema, [], { kind: 'markdown' }),
        ).toEqual({ kind: 'markdown' })
    })

    test('declared number carries its format + unit through to the editor kind', () => {
        const t: BasePropertyType = {
            kind: 'number',
            number: 'currency',
            unit: 'USD',
        }
        expect(propertyEditKind('price', 5, noSchema, [], t)).toEqual({
            kind: 'number',
            format: 'currency',
            unit: 'USD',
        })
        expect(
            propertyEditKind('weight', 5, noSchema, [], {
                kind: 'number',
                number: 'unit',
                unit: 'kg',
            }),
        ).toEqual({
            kind: 'number',
            format: 'unit',
            unit: 'kg',
        })
        expect(
            propertyEditKind('done', 5, noSchema, [], { kind: 'number' }),
        ).toEqual({ kind: 'number', format: undefined, unit: undefined })
    })

    test('declared type wins over a conflicting vault-registry entry or runtime value', () => {
        const schema: Schema = { title: { type: 'boolean' } } // registry disagrees with the base's own declaration
        expect(
            propertyEditKind('title', true, schema, [], { kind: 'text' }),
        ).toEqual({ kind: 'text' })
    })

    test('declared select/multiselect map onto their dedicated editor kinds (#101), carrying the declared options through', () => {
        expect(
            propertyEditKind('stage', 'todo', noSchema, [], {
                kind: 'select',
                options: ['todo', 'doing'],
            }),
        ).toEqual({
            kind: 'select',
            options: ['todo', 'doing'],
        })
        expect(
            propertyEditKind('labels', ['a', 'b'], noSchema, [], {
                kind: 'multiselect',
                options: ['a', 'b', 'c'],
            }),
        ).toEqual({
            kind: 'multiselect',
            options: ['a', 'b', 'c'],
        })
    })

    test('declared select/multiselect with no options carry an empty list through (not a crash)', () => {
        expect(
            propertyEditKind('stage', 'todo', noSchema, [], { kind: 'select' }),
        ).toEqual({ kind: 'select', options: [] })
        expect(
            propertyEditKind('labels', [], noSchema, [], {
                kind: 'multiselect',
            }),
        ).toEqual({ kind: 'multiselect', options: [] })
    })

    test('declared list/link/formula have no dedicated editor yet — fall through to the heuristic', () => {
        expect(
            propertyEditKind('items', ['a'], noSchema, [], { kind: 'list' }),
        ).toEqual({ kind: 'tags', options: ['a'], tag: false })
        expect(
            propertyEditKind('ref', 'x', noSchema, [], { kind: 'link' }),
        ).toEqual({ kind: 'text' })
        expect(
            propertyEditKind('total', 5, noSchema, [], {
                kind: 'formula',
                expr: 'a+b',
            }),
        ).toEqual({ kind: 'number' })
    })

    test('no declared type (undefined) is the exact untyped fallback path — untouched', () => {
        expect(propertyEditKind('flag', true, noSchema, [], undefined)).toEqual(
            { kind: 'boolean' },
        )
        expect(propertyEditKind('flag', true, noSchema, [])).toEqual({
            kind: 'boolean',
        })
    })
})

describe('propertyEditKind — description default (#103)', () => {
    const noSchema: Schema = {}

    test('an undeclared `description` property defaults to markdown (least-surprising migration default)', () => {
        expect(
            propertyEditKind('description', 'some *text*', noSchema, []),
        ).toEqual({ kind: 'markdown' })
        expect(
            propertyEditKind('note.description', 'some *text*', noSchema, []),
        ).toEqual({ kind: 'markdown' })
    })

    test('an explicit base-declared type on `description` still wins over the markdown default', () => {
        expect(
            propertyEditKind('description', 'x', noSchema, [], {
                kind: 'text',
            }),
        ).toEqual({ kind: 'text' })
    })

    test('a vault-wide registry entry for `description` still wins over the markdown default', () => {
        const schema: Schema = { description: { type: 'boolean' } }
        expect(propertyEditKind('description', true, schema, [])).toEqual({
            kind: 'boolean',
        })
    })
})

describe('tagsOptions', () => {
    test('flattens sibling arrays, unions with the row\'s own values, first-seen order', () => {
        expect(tagsOptions(['b', 'c'], [['a', 'b'], 'c'])).toEqual([
            'a',
            'b',
            'c',
        ])
    })
    test('drops empties/null/objects, dedupes', () => {
        expect(
            tagsOptions(['a'], [['a', '', null, undefined, { x: 1 }]]),
        ).toEqual(['a'])
    })
    test('no siblings, no value -> empty', () => {
        expect(tagsOptions(null, [])).toEqual([])
    })
})

describe('multiselectValues (#101)', () => {
    test('an array of scalars stringifies each element', () => {
        expect(multiselectValues(['bug', 'urgent'])).toEqual(['bug', 'urgent'])
    })
    test('null/undefined/empty-string is no selection', () => {
        expect(multiselectValues(null)).toEqual([])
        expect(multiselectValues(undefined)).toEqual([])
        expect(multiselectValues('')).toEqual([])
    })
    test('a bare scalar (hand-edited single value, not a list) becomes a one-element array', () => {
        expect(multiselectValues('bug')).toEqual(['bug'])
    })
})

describe('multiselectCommitValue (#101)', () => {
    test('a non-empty selection commits as the array itself', () => {
        expect(multiselectCommitValue(['bug', 'urgent'])).toEqual([
            'bug',
            'urgent',
        ])
    })
    test('an emptied selection commits null (delete the key), not []', () => {
        expect(multiselectCommitValue([])).toBeNull()
    })
})

describe('selectOptionsWithCurrent (#101)', () => {
    test('current value already in options -> options unchanged', () => {
        expect(
            selectOptionsWithCurrent(['low', 'medium', 'high'], 'medium'),
        ).toEqual(['low', 'medium', 'high'])
    })
    test('current value outside options (legacy/hand-edited) is prepended so it stays selected', () => {
        expect(
            selectOptionsWithCurrent(['low', 'medium', 'high'], 'critical'),
        ).toEqual(['critical', 'low', 'medium', 'high'])
    })
    test("no current value ('') leaves options untouched", () => {
        expect(selectOptionsWithCurrent(['low', 'medium', 'high'], '')).toEqual(
            ['low', 'medium', 'high'],
        )
    })
})

describe('list properties — only what the field can round-trip is editable', () => {
    const kind = (id: string, value: unknown) =>
        propertyEditKind(id, value, {}, [])
    test('a list of strings is one comma-separated field; a tag column gets the tag look', () => {
        expect(kind('tags', ['alpha', 'two words'])).toMatchObject({ kind: 'tags', tag: true })
        expect(kind('note.tag', ['alpha'])).toMatchObject({ kind: 'tags', tag: true })
        expect(kind('authors', ['Jane Doe'])).toMatchObject({ kind: 'tags', tag: false })
    })
    test('a list the comma field would split, or one holding numbers or links, is read-only', () => {
        expect(kind('authors', ['Smith, John'])).toEqual({ kind: 'readonly' })
        expect(kind('tags', ['a,b'])).toEqual({ kind: 'readonly' })
        expect(kind('scores', [1, 2])).toEqual({ kind: 'readonly' })
        expect(kind('related', [{ path: 'Some Note.md', display: 'Some Note' }])).toEqual({
            kind: 'readonly',
        })
    })
    test('a declared multiselect holding a comma-containing value is read-only', () => {
        expect(
            propertyEditKind('who', ['Smith, John'], {}, [], {
                kind: 'multiselect',
                options: ['Smith, John'],
            }),
        ).toEqual({ kind: 'readonly' })
    })
})

describe('propertyDraft', () => {
    test('null is empty, text passes through', () => {
        expect(propertyDraft({ kind: 'text' }, null)).toBe('')
        expect(propertyDraft({ kind: 'text' }, 'hi')).toBe('hi')
    })
    test('percent shows in edit space (x100), unparseable keeps the raw text', () => {
        expect(propertyDraft({ kind: 'number', format: 'percent' }, 0.42)).toBe('42')
        expect(propertyDraft({ kind: 'number' }, 'abc')).toBe('abc')
    })
})

describe('draftCommitValue', () => {
    test('empty draft commits null', () => {
        expect(draftCommitValue({ kind: 'text' }, '  ')).toBeNull()
        expect(draftCommitValue({ kind: 'number' }, '')).toBeNull()
    })
    test('text is trimmed', () => {
        expect(draftCommitValue({ kind: 'text' }, ' a ')).toBe('a')
    })
    test('percent converts back to the stored fraction', () => {
        expect(draftCommitValue({ kind: 'number', format: 'percent' }, '42')).toBeCloseTo(0.42)
    })
    test('unparseable number keeps the raw string', () => {
        expect(draftCommitValue({ kind: 'number' }, 'twelve')).toBe('twelve')
    })
})

describe('readonlyText', () => {
    test('null is empty, list joins, link uses display then path', () => {
        expect(readonlyText(null)).toBe('')
        expect(readonlyText([1, 2, 3])).toBe('1, 2, 3')
        expect(readonlyText({ path: 'a.md', display: 'A' })).toBe('A')
        expect(readonlyText({ path: 'a.md' })).toBe('a.md')
    })
    test('an object with neither field is JSON', () => {
        expect(readonlyText({ x: 1 })).toBe('{"x":1}')
    })
})

describe('selectChoices', () => {
    test('a clear entry leads, then the options', () => {
        expect(selectChoices(['a', 'b'], 'a')).toEqual([
            { value: '', label: '(clear)' },
            { value: 'a', label: 'a' },
            { value: 'b', label: 'b' },
        ])
    })
    test('a current value outside the options is kept, first after clear', () => {
        expect(selectChoices(['a'], 'z').map(o => o.value)).toEqual(['', 'z', 'a'])
    })
})
