// core/test/pdfHighlightRoutes.test.ts — POST /pdf/highlights and /pdf/highlights/migrate against a
// real server and against the in-process backend, with the REAL pdf operations
// (core/src/drawing/pdfHighlights.ts). Needs that module; runs after it merges.
import { test, expect, beforeAll, afterAll, describe } from 'bun:test'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from '../src/server'
import { createLocalBackend } from '../src/localBackend'
import { setFileAccess, type FileAccess } from '../src/fileAccess'
import { makeVault } from './helpers'
import {
    emptyDoc,
    parseDoc,
    serializeDoc,
    type Highlight,
} from '../src/drawing/model'

const TOKEN = 'pdf-highlight-routes-token'
const prevToken = process.env.BISMUTH_OWNER_TOKEN
beforeAll(() => {
    process.env.BISMUTH_OWNER_TOKEN = TOKEN
})
afterAll(() => {
    if (prevToken === undefined) delete process.env.BISMUTH_OWNER_TOKEN
    else process.env.BISMUTH_OWNER_TOKEN = prevToken
})

// These need Task 1's module; until it is in the tree they skip instead of failing the gate.
const hasPdfModule = existsSync(
    join(import.meta.dir, '../src/drawing/pdfHighlights.ts'),
)
const realTest = hasPdfModule ? test : test.skip

const FIX = join(import.meta.dir, 'drawing/fixtures')
const pdfkit = () =>
    new Uint8Array(readFileSync(join(FIX, 'pdfkit-highlights.pdf')))
const encrypted = () => new Uint8Array(readFileSync(join(FIX, 'encrypted.pdf')))

const hl = (id: string, y: number): Highlight => ({
    id,
    c: 'hl',
    rects: [{ x: 100, y, w: 200, h: 18 }],
    text: id,
})

async function realApi() {
    // @ts-ignore -- ../src/drawing/pdfHighlights lands with Task 1
    return (await import('../src/drawing/pdfHighlights')) as {
        readPdfHighlights(b: Uint8Array): Promise<{
            writable: boolean
            pages: Highlight[][]
        }>
    }
}
const count = async (bytes: Uint8Array) =>
    (await (await realApi()).readPdfHighlights(bytes)).pages.flat().length

function withServer<T>(
    files: Record<string, string>,
    run: (
        vault: string,
        post: (route: string, body: unknown) => Promise<Response>,
    ) => Promise<T>,
) {
    return async () => {
        const vault = makeVault(files)
        const server = createServer({ vault, port: 0 })
        const post = (route: string, body: unknown) =>
            fetch(`http://localhost:${server.port}${route}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Bismuth-Token': TOKEN,
                },
                body: JSON.stringify(body),
            })
        try {
            await run(vault, post)
        } finally {
            server.stop(true)
        }
    }
}

describe('POST /pdf/highlights', () => {
    realTest(
        'writes the pdf, and a second identical add does not duplicate',
        withServer({}, async (vault, post) => {
            writeFileSync(join(vault, 'a.pdf'), pdfkit())
            const before = await count(pdfkit())
            const edits = {
                add: [{ page: 0, highlight: hl('x', 300) }],
                remove: [],
            }
            const r = await post('/pdf/highlights', { path: 'a.pdf', edits })
            expect(r.status).toBe(200)
            expect(await r.json()).toEqual({ ok: true })
            const once = new Uint8Array(readFileSync(join(vault, 'a.pdf')))
            expect(await count(once)).toBe(before + 1)
            // no temp file left behind by the atomic write
            expect(readdirSync(vault).filter(n => n.endsWith('.tmp'))).toEqual([])

            await post('/pdf/highlights', { path: 'a.pdf', edits })
            const twice = new Uint8Array(readFileSync(join(vault, 'a.pdf')))
            expect(await count(twice)).toBe(before + 1)
        }),
    )

    realTest(
        'an encrypted pdf is 409 with the reason and stays byte-identical',
        withServer({}, async (vault, post) => {
            writeFileSync(join(vault, 'e.pdf'), encrypted())
            const r = await post('/pdf/highlights', {
                path: 'e.pdf',
                edits: {
                    add: [{ page: 0, highlight: hl('x', 300) }],
                    remove: [],
                },
            })
            expect(r.status).toBe(409)
            expect((await r.text()).length).toBeGreaterThan(0)
            expect(new Uint8Array(readFileSync(join(vault, 'e.pdf')))).toEqual(
                encrypted(),
            )
        }),
    )

    test(
        'a missing pdf is 404',
        withServer({}, async (_vault, post) => {
            const r = await post('/pdf/highlights', {
                path: 'nope.pdf',
                edits: { add: [], remove: [] },
            })
            expect(r.status).toBe(404)
        }),
    )
})

describe('POST /pdf/highlights/migrate', () => {
    const sidecar = () => {
        const doc = emptyDoc()
        doc.pages = [
            {
                strokes: [
                    {
                        id: 's',
                        tool: 'pen',
                        c: '#000',
                        w: 2,
                        pts: [1, 2, 3, 4],
                    } as any,
                ],
                highlights: [hl('h1', 300), hl('h2', 400)],
            },
        ]
        doc.bookmarks = [{ id: 'b', page: 0, label: 'top' }]
        return doc
    }

    realTest(
        'moves two highlights, keeps ink and bookmarks, second call moves none',
        withServer({}, async (vault, post) => {
            writeFileSync(join(vault, 'a.pdf'), pdfkit())
            writeFileSync(join(vault, 'a.pdf.draw'), serializeDoc(sidecar()))
            const before = await count(pdfkit())
            const r = await post('/pdf/highlights/migrate', { path: 'a.pdf' })
            expect(r.status).toBe(200)
            expect(await r.json()).toEqual({ moved: 2, writable: true })
            expect(
                await count(new Uint8Array(readFileSync(join(vault, 'a.pdf')))),
            ).toBe(before + 2)
            const after = parseDoc(
                readFileSync(join(vault, 'a.pdf.draw'), 'utf8'),
            )
            const expected = sidecar()
            for (const p of expected.pages) delete p.highlights
            expect(parseDoc(serializeDoc(after))).toEqual(
                parseDoc(serializeDoc(expected)),
            )
            const again = await post('/pdf/highlights/migrate', {
                path: 'a.pdf',
            })
            expect(await again.json()).toEqual({ moved: 0, writable: true })
        }),
    )

    realTest(
        'an encrypted pdf moves nothing and writes nothing',
        withServer({}, async (vault, post) => {
            const text = serializeDoc(sidecar())
            writeFileSync(join(vault, 'e.pdf'), encrypted())
            writeFileSync(join(vault, 'e.pdf.draw'), text)
            const r = await post('/pdf/highlights/migrate', { path: 'e.pdf' })
            expect(await r.json()).toEqual({ moved: 0, writable: false })
            expect(readFileSync(join(vault, 'e.pdf.draw'), 'utf8')).toBe(text)
            expect(new Uint8Array(readFileSync(join(vault, 'e.pdf')))).toEqual(
                encrypted(),
            )
        }),
    )
})

describe('in-process backend', () => {
    realTest('dispatches both routes through getFileAccess()', async () => {
        const bin = new Map<string, Uint8Array>([['a.pdf', pdfkit()]])
        const txt = new Map<string, string>([
            [
                'a.pdf.draw',
                serializeDoc(
                    (() => {
                        const d = emptyDoc()
                        d.pages = [{ strokes: [], highlights: [hl('h1', 300)] }]
                        return d
                    })(),
                ),
            ],
        ])
        const seen: string[] = []
        const fa: FileAccess = {
            listBases: async () => [],
            listMarkdown: async () => [],
            listTree: async () => [],
            readNote: async (_r, rel) => {
                if (!txt.has(rel)) throw new Error(`ENOENT ${rel}`)
                return txt.get(rel)!
            },
            writeNote: async (_r, rel, c) => {
                seen.push(rel)
                txt.set(rel, c)
            },
            readBinary: async (_r, rel) => {
                const v = bin.get(rel)
                if (!v) throw new Error(`ENOENT ${rel}`)
                return v
            },
            writeBinary: async (_r, rel, bytes) => {
                seen.push(rel)
                bin.set(rel, bytes)
            },
            statNote: async () => null,
            listDir: async () => [],
            realPath: async p => p,
        }
        setFileAccess(fa)
        try {
            const be = createLocalBackend({ vault: '/v' })
            const before = await count(pdfkit())
            const edit = await be.dispatch('POST', '/pdf/highlights', {
                path: 'a.pdf',
                edits: {
                    add: [{ page: 0, highlight: hl('x', 400) }],
                    remove: [],
                },
            })
            expect(edit).toEqual({ ok: true })
            expect(await count(bin.get('a.pdf')!)).toBe(before + 1)
            const moved = await be.dispatch('POST', '/pdf/highlights/migrate', {
                path: 'a.pdf',
            })
            expect(moved).toEqual({ moved: 1, writable: true })
            expect(seen).toEqual(['a.pdf', 'a.pdf', 'a.pdf.draw'])
        } finally {
            setFileAccess(undefined as unknown as FileAccess)
        }
    })
})
