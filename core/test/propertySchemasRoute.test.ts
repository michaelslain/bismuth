// GET /property-schemas on both backends (HTTP core and the in-process mobile backend), and
// GET /settings keeping the schema maps out of the settings feed.
import { test, expect, afterEach } from 'bun:test'
import { createServer } from '../src/server'
import { createLocalBackend } from '../src/localBackend'
import { setFileAccess, type FileAccess } from '../src/fileAccess'
import { serializeSettingsFromText } from '../src/settingsSerialize'
import { makeVault } from './helpers'

const SETTINGS = [
    'properties:',
    '  due: date',
    'schemas:',
    '  book:',
    '    author:',
    '      type: string',
    '      required: true',
    'folderSchemas:',
    '  Books/: book',
    '',
].join('\n')

const EXPECTED = {
    schemas: { book: { author: { type: 'string', required: true } } },
    folderSchemas: { Books: ['book'] },
}

afterEach(() => setFileAccess(undefined as unknown as FileAccess))

test('HTTP core serves the registry, the named schemas and the folder bindings', async () => {
    const server = createServer({
        vault: makeVault({ '.settings': SETTINGS, 'Books/a.md': '# a\n' }),
        port: 0,
    })
    try {
        const res = await fetch(
            `http://localhost:${server.port}/property-schemas`,
        )
        expect(res.status).toBe(200)
        const set = await res.json()
        expect(set).toMatchObject(EXPECTED)
        expect(set.properties.due).toEqual({ type: 'date' })
        expect(set.properties.tags).toBeDefined() // built-ins under the registry
    } finally {
        server.stop(true)
    }
})

test('HTTP core serves only the built-ins for a vault with no .settings', async () => {
    const server = createServer({ vault: makeVault({ 'a.md': '' }), port: 0 })
    try {
        const set = await (
            await fetch(`http://localhost:${server.port}/property-schemas`)
        ).json()
        expect(set.schemas).toEqual({})
        expect(set.folderSchemas).toEqual({})
        expect(Object.keys(set.properties).sort()).toEqual([
            'aliases',
            'cssclasses',
            'icon',
            'tags',
        ])
    } finally {
        server.stop(true)
    }
})

function settingsOnly(raw: string | null): FileAccess {
    const missing = async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    return {
        listBases: async () => [],
        listMarkdown: async () => [],
        listTree: async () => [],
        readNote: async (_root, rel) =>
            rel === '.settings' && raw !== null ? raw : missing(),
        writeNote: async () => {},
        readBinary: async () => new Uint8Array(),
        writeBinary: async () => {},
        statNote: async (_root, rel) =>
            rel === '.settings' && raw !== null
                ? { size: raw.length, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0 }
                : null,
        listDir: async () => [],
        realPath: async p => p,
    }
}

test('the in-process (mobile) backend serves the same set', async () => {
    setFileAccess(settingsOnly(SETTINGS))
    const set = (await createLocalBackend({ vault: '/v' }).dispatch(
        'GET',
        '/property-schemas',
    )) as Record<string, unknown>
    expect(set).toMatchObject(EXPECTED)
})

test('the in-process backend reads an unparseable .settings as empty', async () => {
    setFileAccess(settingsOnly('schemas: [unclosed\n  : :'))
    const set = (await createLocalBackend({ vault: '/v' }).dispatch(
        'GET',
        '/property-schemas',
    )) as { schemas: unknown; folderSchemas: unknown }
    expect(set.schemas).toEqual({})
    expect(set.folderSchemas).toEqual({})
})

test('GET /settings leaves the registry and both schema maps out of the feed', () => {
    const feed = serializeSettingsFromText(SETTINGS, [])
    expect(feed).not.toHaveProperty('properties')
    expect(feed).not.toHaveProperty('schemas')
    expect(feed).not.toHaveProperty('folderSchemas')
})
