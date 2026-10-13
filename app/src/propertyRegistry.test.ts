// app/src/propertyRegistry.test.ts
import { test, expect } from 'bun:test'
import {
    noteSchemaFor,
    noteSchemaForText,
    propertyRegistry,
    registryShouldRefresh,
    rowSchema,
    setPropertySchemas,
} from './propertyRegistry'
import type { Row } from '../../core/src/bases/types'
import { loadSchemaSet } from '../../core/src/schema/namedSchemas'

test('propertyRegistry accessor exists and returns an object before hydration', () => {
    // Before any fetch resolves, the accessor returns the built-in properties, never
    // undefined — so callers (autocomplete/lint) can deref safely on first paint.
    expect(typeof propertyRegistry).toBe('function')
    expect(Object.keys(propertyRegistry()).sort()).toEqual([
        'aliases',
        'cssclasses',
        'icon',
        'tags',
    ])
})

test('noteSchemaFor folds a folder-bound schema into the note it covers', () => {
    setPropertySchemas(
        loadSchemaSet({
            schemas: { book: { author: { type: 'string', required: true } } },
            folderSchemas: { Books: 'book' },
        }),
    )
    expect(noteSchemaFor('Books/Dune.md', {}).author?.required).toBe(true)
    expect(noteSchemaFor('Inbox/x.md', {}).author).toBeUndefined()
    expect(
        noteSchemaForText('Inbox/x.md', '---\nschema: book\n---\n').author,
    ).toBeDefined()
    setPropertySchemas(loadSchemaSet(null))
})

test('a live edit to the real vault settings file triggers a refresh', () => {
    expect(registryShouldRefresh(['.settings'])).toBe(true)
})

test('the legacy and interim settings paths still trigger a refresh', () => {
    expect(registryShouldRefresh(['settings.yaml'])).toBe(true)
    expect(registryShouldRefresh(['.settings/settings.yaml'])).toBe(true)
})

test('unknown paths means "extent unknown" and refreshes to be safe', () => {
    expect(registryShouldRefresh([])).toBe(true)
})

test('an ordinary note edit does not refresh the registry', () => {
    expect(registryShouldRefresh(['essay.md'])).toBe(false)
})

/** A Bases row at `path`; `index` set means a row stored inside a base file. */
function row(path: string, note: Record<string, unknown>, index?: number): Row {
    const name = path.split('/').pop() ?? path
    return {
        file: {
            name,
            basename: name,
            path,
            folder: path.split('/').slice(0, -1).join('/'),
            ext: path.split('.').pop() ?? '',
            size: 0,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note,
        formula: {},
        ...(index === undefined ? {} : { index }),
    }
}

test('rowSchema gives a note row its own schema and a base-file row only the vault registry', () => {
    setPropertySchemas(
        loadSchemaSet({
            properties: { due: 'date' },
            schemas: {
                book: { rating: 'number' },
                review: { verdict: 'string' },
            },
            folderSchemas: { Books: 'book' },
        }),
    )
    // A note in a bound folder, and a note naming a schema itself.
    expect(rowSchema(row('Books/Dune.md', {})).rating?.type).toBe('number')
    expect(
        rowSchema(row('Inbox/x.md', { schema: 'review' })).verdict?.type,
    ).toBe('string')
    // A row inside a `.base.jsonl` in that folder is not a note: no folder schema.
    const jsonl = rowSchema(row('Books/List.base.jsonl', {}, 0))
    expect(jsonl.rating).toBeUndefined()
    expect(jsonl.due?.type).toBe('date')
    // A row inside a `type: base` md file carries an index: no folder schema either.
    expect(rowSchema(row('Books/List.md', {}, 2)).rating).toBeUndefined()
    setPropertySchemas(loadSchemaSet(null))
})
