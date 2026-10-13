import { test, expect } from 'bun:test'
import {
    appliedSchemas,
    loadSchemaSet,
    resolveNoteSchema,
    unknownFolderBindings,
} from '../../src/schema/namedSchemas'
import { validateDocument } from '../../src/schema/validate'
import { SETTINGS_SCHEMA } from '../../src/schema/settingsSchema'

const SETTINGS = {
    properties: { due: 'date', rating: { type: 'string', required: true } },
    schemas: {
        book: {
            author: { type: 'string', required: true },
            rating: { type: 'number', min: 0, max: 5 },
        },
        fiction: { genre: { type: { enum: ['sf', 'fantasy'] } } },
        review: { verdict: 'string' },
    },
    folderSchemas: {
        'Reading/Books/': 'book',
        './Reading/Books/Fiction': ['fiction', 'nope'],
    },
}

const set = loadSchemaSet(SETTINGS)

test('folder bindings normalise slashes and keep every name', () => {
    expect(set.folderSchemas).toEqual({
        'Reading/Books': ['book'],
        'Reading/Books/Fiction': ['fiction', 'nope'],
    })
})

test('a note gets every ancestor folder binding, shallowest first, then its own schema: names', () => {
    const applied = appliedSchemas(set, 'Reading/Books/Fiction/Dune.md', {
        schema: 'review',
    })
    expect(applied.map(a => [a.name, a.source, a.known])).toEqual([
        ['book', 'folder', true],
        ['fiction', 'folder', true],
        ['nope', 'folder', false],
        ['review', 'note', true],
    ])
})

test('a note outside every bound folder follows only its own schema: names', () => {
    expect(
        appliedSchemas(set, 'Reading/Booksish.md', { schema: ['book'] }).map(
            a => a.name,
        ),
    ).toEqual(['book'])
    expect(appliedSchemas(set, 'Inbox/x.md', {})).toEqual([])
})

test('a base note gets no named schema, even inside a bound folder', () => {
    expect(
        appliedSchemas(set, 'Reading/Books/All.md', { type: 'base' }),
    ).toEqual([])
})

test('the deeper schema wins a shared key; the vault registry loses its required flag', () => {
    const schema = resolveNoteSchema(set, 'Reading/Books/Dune.md', {})
    expect(schema.rating).toEqual({ type: 'number', min: 0, max: 5 })
    expect(schema.author.required).toBe(true)
    expect(schema.due).toEqual({ type: 'date' })
    const plain = resolveNoteSchema(set, 'Inbox/x.md', {})
    expect(plain.rating.required).toBeUndefined()
})

test('the schema: key itself completes and validates against declared names', () => {
    const schema = resolveNoteSchema(set, 'Inbox/x.md', { schema: 'bok' })
    const diags = validateDocument({ schema: 'bok' }, schema, {
        mode: 'frontmatter',
    })
    expect(diags).toHaveLength(1)
    expect(diags[0].severity).toBe('error')
    expect(diags[0].suggestions?.[0]).toBe('book')
})

test('a note in a bound folder is held to the schema: missing required key, wrong type', () => {
    const fm = { rating: 9, genre: 'romance' }
    const schema = resolveNoteSchema(set, 'Reading/Books/Fiction/Dune.md', fm)
    const diags = validateDocument(fm, schema, { mode: 'frontmatter' })
    const by = (k: string) => diags.find(d => d.path[0] === k)
    expect(by('author')?.message).toBe('missing required property: author')
    expect(by('rating')?.severity).toBe('warning') // above max
    expect(by('genre')?.severity).toBe('error')
})

test('settings lint flags a folder bound to an undeclared schema', () => {
    expect(unknownFolderBindings(set)).toEqual([
        { folder: 'Reading/Books/Fiction', name: 'nope' },
    ])
    const diags = validateDocument(SETTINGS, SETTINGS_SCHEMA, {
        mode: 'settings',
    }).filter(d => d.path[0] === 'folderSchemas')
    expect(diags).toEqual([
        {
            path: ['folderSchemas', './Reading/Books/Fiction'],
            severity: 'warning',
            message: 'unknown schema: nope',
            suggestions: ['book', 'review', 'fiction'],
        },
    ])
})

test('missing or malformed sections read as empty', () => {
    const empty = loadSchemaSet({ schemas: 'x', folderSchemas: [1] })
    expect(empty.schemas).toEqual({})
    expect(empty.folderSchemas).toEqual({})
    expect(Object.keys(loadSchemaSet(null).properties)).toContain('tags')
})

test("a note's own schema: wins a shared key over its folder's schema", () => {
    const local = loadSchemaSet({
        schemas: {
            book: { rating: 'number' },
            loose: { rating: 'string' },
        },
        folderSchemas: { Books: 'book' },
    })
    expect(resolveNoteSchema(local, 'Books/a.md', {}).rating.type).toBe(
        'number',
    )
    expect(
        resolveNoteSchema(local, 'Books/a.md', { schema: 'loose' }).rating.type,
    ).toBe('string')
})

test('a name both bound by the folder and listed by the note applies once, in the later position', () => {
    const local = loadSchemaSet({
        schemas: { book: {}, review: {} },
        folderSchemas: { Books: ['book', 'review'] },
    })
    expect(
        appliedSchemas(local, 'Books/a.md', { schema: 'book' }).map(a => [
            a.name,
            a.source,
        ]),
    ).toEqual([
        ['review', 'folder'],
        ['book', 'note'],
    ])
})
