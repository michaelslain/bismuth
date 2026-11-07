// core/test/pdfPages.test.ts — rewritePdfPages: order, ink, highlights and transcript follow their
// page; the pure remaps; POST /pdf/pages against a real server and the in-process backend.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { AppError } from '../src/error'
import { remapDrawingDoc, rewritePdfPages, pdfPageCount, type PageSource } from '../src/pdfPages'
import { applyPdfHighlightEdits, readPdfHighlights } from '../src/drawing/pdfHighlights'
import { emptyDoc, parseDoc, serializeDoc, type DrawingDoc } from '../src/drawing/model'
import { readTranscript } from '../src/transcript'
import { createServer } from '../src/server'
import { createLocalBackend } from '../src/localBackend'
import { readRunRecords } from '../src/runRegistry'
import { makeVault, tempDir } from './helpers'

process.env.BISMUTH_RUN_DIR = tempDir('bismuth-pdfpages-run-')

const PNG = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='),
    c => c.charCodeAt(0),
)
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

/** A pdf whose page i (1-based) is 100 + i points wide, so a page is recognised by its width. */
async function pdfBytes(n: number, base = 100): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    for (let i = 1; i <= n; i++) doc.addPage([base + i, 200])
    return doc.save()
}

const widths = async (path: string) =>
    (await PDFDocument.load(readFileSync(path))).getPages().map(p => Math.round(p.getWidth()))

const COMPANION = [
    '---',
    'tags: [paper]',
    'transcribed: on-device',
    'transcribedAt: 2026-11-01T00:00:00.000Z',
    '---',
    'my note',
    '',
    '<!-- bismuth:transcript:start -->',
    '### Page 1',
    '',
    'one',
    '',
    '### Page 2',
    '',
    'two with ==a mark==',
    '',
    '### Page 3',
    '',
    'three',
    '',
    '### Page 4',
    '',
    'four',
    '<!-- bismuth:transcript:end -->',
    '',
].join('\n')

function sidecar(): string {
    const doc: DrawingDoc = {
        ...emptyDoc(),
        paper: { bg: 'lines' },
        margin: { right: 0.3 },
        dark: true,
        pages: [1, 2, 3, 4].map(n => ({ strokes: [{ t: 'pen', c: '#000', w: 2, pts: [n, n, 255] }] })),
        bookmarks: [
            { id: 'b2', page: 1, label: 'two' },
            { id: 'b4', page: 3, label: 'four' },
        ],
    }
    return serializeDoc(doc)
}

async function vaultWith(pages = 4, extra: Record<string, string> = {}) {
    const vault = makeVault({ 'p.pdf.md': COMPANION, 'p.pdf.draw': sidecar(), ...extra })
    writeFileSync(join(vault, 'p.pdf'), await pdfBytes(pages))
    return vault
}

describe('remapDrawingDoc', () => {
    const doc = parseDoc(sidecar())
    test('kept pages move, dropped pages go, new pages are empty', () => {
        const next = remapDrawingDoc(doc, [2, null, 0])
        expect(next.pages.map(p => p.strokes[0]?.pts[0] ?? -1)).toEqual([3, -1, 1])
        expect(next.bookmarks).toEqual([])
        expect(next.margin).toEqual({ right: 0.3 })
        expect(next.dark).toBe(true)
        expect(next.paper).toEqual({ bg: 'lines' })
    })
    test('bookmarks follow their page; a page used twice keeps its bookmark on the first', () => {
        const next = remapDrawingDoc(doc, [3, 1, 1])
        expect(next.bookmarks).toEqual([
            { id: 'b2', page: 1, label: 'two' },
            { id: 'b4', page: 0, label: 'four' },
        ])
        expect(next.pages[2].strokes[0].pts[0]).toBe(2)
    })
})

describe('rewritePdfPages', () => {
    test('moves pages and everything attached follows', async () => {
        const vault = await vaultWith()
        const marked: string[][] = []
        const r = await rewritePdfPages(vault, 'p.pdf', [{ page: 3 }, { page: 1 }, { page: 2 }], {
            mark: p => marked.push(p),
        })
        expect(r).toEqual({ pages: 3 })
        expect(await widths(join(vault, 'p.pdf'))).toEqual([103, 101, 102])
        expect(marked).toEqual([['p.pdf', 'p.pdf.draw', 'p.pdf.md']])

        const doc = parseDoc(readFileSync(join(vault, 'p.pdf.draw'), 'utf8'))
        expect(doc.pages.map(p => p.strokes[0].pts[0])).toEqual([3, 1, 2])
        expect(doc.bookmarks).toEqual([{ id: 'b2', page: 2, label: 'two' }])
        expect(doc.margin).toEqual({ right: 0.3 })

        const md = readFileSync(join(vault, 'p.pdf.md'), 'utf8')
        expect(readTranscript(md)).toEqual([
            { page: 1, text: 'three' },
            { page: 2, text: 'one' },
            { page: 3, text: 'two with ==a mark==' },
        ])
        expect(md).toContain('transcribed: on-device')
        expect(md).toContain('transcribedAt: 2026-11-01T00:00:00.000Z')
        expect(md).toContain('tags: [paper]')
        expect(md).toContain('my note')
    })

    test('highlights stored in the pdf travel with their page', async () => {
        const vault = await vaultWith(3)
        const path = join(vault, 'p.pdf')
        const hl = { id: 'h', c: '#ffee00', rects: [{ x: 100, y: 100, w: 200, h: 20 }] }
        writeFileSync(path, await applyPdfHighlightEdits(readFileSync(path), { add: [{ page: 1, highlight: hl }], remove: [] }))
        const before = await readPdfHighlights(readFileSync(path))
        expect(before.pages.map(p => p.length)).toEqual([0, 1, 0])

        await rewritePdfPages(vault, 'p.pdf', [{ page: 3 }, { page: 2 }])
        const after = await readPdfHighlights(readFileSync(path))
        expect(after.pages.map(p => p.length)).toEqual([0, 1])
    })

    test('deleting a page drops its ink, bookmarks and transcript', async () => {
        const vault = await vaultWith()
        await rewritePdfPages(vault, 'p.pdf', [{ page: 1 }, { page: 3 }, { page: 4 }])
        expect(await widths(join(vault, 'p.pdf'))).toEqual([101, 103, 104])
        const doc = parseDoc(readFileSync(join(vault, 'p.pdf.draw'), 'utf8'))
        expect(doc.pages.map(p => p.strokes[0].pts[0])).toEqual([1, 3, 4])
        expect(doc.bookmarks).toEqual([{ id: 'b4', page: 2, label: 'four' }])
        expect(readTranscript(readFileSync(join(vault, 'p.pdf.md'), 'utf8')).map(p => p.text)).toEqual(['one', 'three', 'four'])
    })

    test('inserted images, blanks and other pdfs take their place and size from the page before', async () => {
        const vault = await vaultWith(2, { 'x/y.png': '' })
        writeFileSync(join(vault, 'x/y.png'), PNG)
        writeFileSync(join(vault, 'other.pdf'), await pdfBytes(3, 300))
        const order: PageSource[] = [
            { page: 1 },
            { file: 'x/y.png' },
            { blank: true },
            { data: b64(PNG), name: 'drop.png' },
            { file: 'other.pdf', page: 2 },
            { file: 'other.pdf' },
            { page: 2 },
        ]
        const r = await rewritePdfPages(vault, 'p.pdf', order)
        expect(r.pages).toBe(9)
        // the 1x1 images are as wide as the page before, and as tall (aspect 1)
        expect(await widths(join(vault, 'p.pdf'))).toEqual([101, 101, 101, 101, 302, 301, 302, 303, 102])
        const doc = parseDoc(readFileSync(join(vault, 'p.pdf.draw'), 'utf8'))
        expect(doc.pages).toHaveLength(9)
        expect(doc.pages.map(p => p.strokes.length)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 1])
        // the new pages have no text; the transcript is renumbered
        expect(readTranscript(readFileSync(join(vault, 'p.pdf.md'), 'utf8')).map(p => p.page)).toEqual([1, 9])
    })

    test('an image first takes its width from the first page', async () => {
        const vault = await vaultWith(2)
        await rewritePdfPages(vault, 'p.pdf', [{ data: b64(PNG), name: 'a.png' }, { page: 2 }])
        expect(await widths(join(vault, 'p.pdf'))).toEqual([102, 102])
    })

    // Only macOS can mint a HEIC (sips); elsewhere there is no fixture to add.
    const canMint = process.platform === 'darwin' && existsSync('/usr/bin/sips')
    test.skipIf(!canMint)('a HEIC photo is converted and added', async () => {
        const vault = await vaultWith(1)
        writeFileSync(join(vault, 'src.png'), PNG)
        const proc = Bun.spawn(['/usr/bin/sips', '-s', 'format', 'heic', join(vault, 'src.png'), '--out', join(vault, 'photo.heic')], {
            stdout: 'ignore',
            stderr: 'ignore',
        })
        expect(await proc.exited).toBe(0)
        expect(await rewritePdfPages(vault, 'p.pdf', [{ page: 1 }, { file: 'photo.heic' }])).toEqual({ pages: 2 })
        expect(await widths(join(vault, 'p.pdf'))).toEqual([101, 101])
    })

    test('no sidecar and no companion are written when there were none', async () => {
        const vault = makeVault({})
        writeFileSync(join(vault, 'q.pdf'), await pdfBytes(2))
        await rewritePdfPages(vault, 'q.pdf', [{ page: 2 }, { page: 1 }])
        expect(existsSync(join(vault, 'q.pdf.draw'))).toBe(false)
        expect(existsSync(join(vault, 'q.pdf.md'))).toBe(false)
        expect(await widths(join(vault, 'q.pdf'))).toEqual([102, 101])
    })

    test('an order that changes nothing writes nothing', async () => {
        const vault = await vaultWith(2)
        const marked: string[][] = []
        const before = readFileSync(join(vault, 'p.pdf'))
        expect(await rewritePdfPages(vault, 'p.pdf', [{ page: 1 }, { page: 2 }], { mark: p => marked.push(p) })).toEqual({ pages: 2 })
        expect(marked).toEqual([])
        expect(readFileSync(join(vault, 'p.pdf')).equals(before)).toBe(true)
    })

    const code = async (p: Promise<unknown>) => {
        try {
            await p
        } catch (e) {
            if (e instanceof AppError) return { status: e.statusCode, message: e.message }
            throw e
        }
        return null
    }

    test('refusals', async () => {
        const vault = await vaultWith(2)
        writeFileSync(join(vault, 'v.svg'), '<svg/>')
        writeFileSync(join(vault, 'w.png'), 'not an image')
        const before = readFileSync(join(vault, 'p.pdf'))
        expect(await code(rewritePdfPages(vault, 'p.pdf', []))).toEqual({ status: 400, message: 'a pdf needs at least one page' })
        expect((await code(rewritePdfPages(vault, 'p.pdf', [{ page: 3 }])))?.status).toBe(400)
        expect((await code(rewritePdfPages(vault, 'p.pdf', [{ page: 0 }])))?.status).toBe(400)
        expect((await code(rewritePdfPages(vault, 'p.pdf', [{ file: 'other.pdf' }])))?.status).toBe(404)
        expect((await code(rewritePdfPages(vault, 'p.pdf', [{ file: '../x.png' }])))?.status).toBe(400)
        expect(await code(rewritePdfPages(vault, 'p.pdf', [{ file: 'v.svg' }]))).toEqual({
            status: 415,
            message: 'only jpeg and png images can be added to a pdf',
        })
        expect((await code(rewritePdfPages(vault, 'p.pdf', [{ file: 'w.png' }])))?.status).toBe(415)
        expect((await code(rewritePdfPages(vault, 'nope.pdf', [{ page: 1 }])))?.status).toBe(404)
        expect(readFileSync(join(vault, 'p.pdf')).equals(before)).toBe(true)
    })

    test('an encrypted pdf answers 409 and nothing changes', async () => {
        const vault = makeVault({})
        const fixture = readFileSync(join(import.meta.dir, 'drawing/fixtures/encrypted.pdf'))
        writeFileSync(join(vault, 'e.pdf'), fixture)
        const e = await code(rewritePdfPages(vault, 'e.pdf', [{ page: 1 }, { blank: true }]))
        expect(e?.status).toBe(409)
        expect(e?.message).toBe('this pdf cannot be rewritten (encrypted)')
        expect(readFileSync(join(vault, 'e.pdf')).equals(fixture)).toBe(true)
    })

    test('an unreadable sidecar stops the rewrite before anything is written', async () => {
        const vault = await vaultWith(2, { 'p.pdf.draw': 'not a drawing' })
        const before = readFileSync(join(vault, 'p.pdf'))
        expect((await code(rewritePdfPages(vault, 'p.pdf', [{ page: 2 }])))?.status).toBe(409)
        expect(readFileSync(join(vault, 'p.pdf')).equals(before)).toBe(true)
    })

    test('pdfPageCount', async () => {
        const vault = await vaultWith(3)
        expect(await pdfPageCount(vault, 'p.pdf')).toEqual({ pages: 3 })
    })
})

describe('POST /pdf/pages', () => {
    async function withServer(
        files: Record<string, string>,
        fn: (call: (body: unknown, path?: string, restricted?: boolean) => Promise<Response>, vault: string) => Promise<void>,
    ) {
        const vault = makeVault(files)
        writeFileSync(join(vault, 'p.pdf'), await pdfBytes(3))
        const server = createServer({ vault, port: 0 })
        try {
            const token = readRunRecords().find(r => r.vault === vault)?.token ?? ''
            const call = (body: unknown, path = '/pdf/pages', restricted = false) =>
                fetch(`http://localhost:${server.port}${path}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...(token && !restricted ? { 'X-Bismuth-Token': token } : {}) },
                    body: JSON.stringify(body),
                })
            await fn(call, vault)
        } finally {
            server.stop(true)
        }
    }

    test('rewrites and answers the page count', async () => {
        await withServer({}, async (call, vault) => {
            const res = await call({ file: 'p.pdf', order: [{ page: 3 }, { page: 1 }] })
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({ pages: 2 })
            expect(await widths(join(vault, 'p.pdf'))).toEqual([103, 101])
        })
    })

    test('answers an AppError with its status', async () => {
        await withServer({}, async call => {
            const res = await call({ file: 'p.pdf', order: [{ page: 9 }] })
            expect(res.status).toBe(400)
            expect((await call({ file: 'p.pdf', order: [] })).status).toBe(400)
            expect((await call({ file: 'p.md', order: [{ page: 1 }] })).status).toBe(400)
        })
    })

    test('a hidden file in the order is forbidden to a restricted caller and fine for the owner', async () => {
        const files = { 'hidden.png': '', 'hidden.png.md': '---\nvisibility: hidden\n---\n', 'p.pdf.md': '---\nvisibility: hidden\n---\n' }
        await withServer(files, async (call, vault) => {
            writeFileSync(join(vault, 'hidden.png'), PNG)
            const before = readFileSync(join(vault, 'p.pdf'))
            const order = [{ page: 1 }, { file: 'hidden.png' }]
            // p.pdf itself is hidden here, so a restricted caller is refused on that alone
            expect((await call({ file: 'p.pdf', order }, '/pdf/pages', true)).status).toBe(403)
            expect((await call({ file: 'p.pdf', page: 1, text: 'x' }, '/transcript/page', true)).status).toBe(403)
            expect(readFileSync(join(vault, 'p.pdf')).equals(before)).toBe(true)
            expect((await call({ file: 'p.pdf', order })).status).toBe(200)
        })
        await withServer({ 'hidden.png': '', 'hidden.png.md': '---\nvisibility: hidden\n---\n' }, async (call, vault) => {
            writeFileSync(join(vault, 'hidden.png'), PNG)
            const before = readFileSync(join(vault, 'p.pdf'))
            const res = await call({ file: 'p.pdf', order: [{ page: 1 }, { file: 'hidden.png' }] }, '/pdf/pages', true)
            expect(res.status).toBe(403)
            expect(readFileSync(join(vault, 'p.pdf')).equals(before)).toBe(true)
        })
    })

    test('POST /transcript/page sets one page and keeps the rest', async () => {
        await withServer({ 'p.pdf.md': COMPANION }, async (call, vault) => {
            const res = await call({ file: 'p.pdf', page: 2, text: 'by hand ==kept==' }, '/transcript/page')
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({ ok: true })
            const pages = readTranscript(readFileSync(join(vault, 'p.pdf.md'), 'utf8'))
            expect(pages.map(p => p.text)).toEqual(['one', 'by hand ==kept==', 'three', 'four'])
            expect((await call({ file: 'p.pdf', page: 0, text: 'x' }, '/transcript/page')).status).toBe(400)
            expect((await call({ file: 'p.md', page: 1, text: 'x' }, '/transcript/page')).status).toBeGreaterThanOrEqual(400)
        })
    })
})

describe('in-process backend', () => {
    test('POST /pdf/pages and POST /transcript/page', async () => {
        const vault = await vaultWith(3)
        const be = createLocalBackend({ vault } as Parameters<typeof createLocalBackend>[0])
        expect(await be.dispatch('POST', '/pdf/pages', { file: 'p.pdf', order: [{ page: 2 }, { blank: true }] })).toEqual({ pages: 2 })
        expect(await widths(join(vault, 'p.pdf'))).toEqual([102, 102])
        expect(await be.dispatch('POST', '/transcript/page', { file: 'p.pdf', page: 1, text: 'hi' })).toEqual({ ok: true })
        expect(readTranscript(readFileSync(join(vault, 'p.pdf.md'), 'utf8'))[0]).toEqual({ page: 1, text: 'hi' })
    })
})
