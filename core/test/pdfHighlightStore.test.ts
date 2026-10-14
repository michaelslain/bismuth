// core/test/pdfHighlightStore.test.ts — the read-modify-write around a PDF's highlights, with the
// PDF operations injected (the real ones are exercised in pdfHighlightRoutes.test.ts).
import { test, expect, describe } from 'bun:test'
import {
    editPdfHighlights,
    migrateSidecarHighlights,
    type HighlightIO,
    type PdfHighlightDeps,
    type PdfHighlightEdits,
} from '../src/pdfHighlightStore'
import { AppError } from '../src/error'
import { fitImage } from '../src/drawing/pageInk'
import {
    emptyDoc,
    parseDoc,
    serializeDoc,
    type DrawingDoc,
    type Highlight,
} from '../src/drawing/model'

function memIO(initial: Record<string, string | Uint8Array>) {
    const files = new Map(Object.entries(initial))
    const writes: string[] = []
    const io: HighlightIO = {
        readBinary: async rel => {
            const v = files.get(rel)
            return v instanceof Uint8Array ? v : null
        },
        writeBinary: async (rel, bytes) => {
            writes.push(rel)
            files.set(rel, bytes)
        },
        readText: async rel => {
            const v = files.get(rel)
            return typeof v === 'string' ? v : null
        },
        writeText: async (rel, text) => {
            writes.push(rel)
            files.set(rel, text)
        },
    }
    return { io, files, writes }
}

const PDF = new Uint8Array([1, 2, 3])
const hl = (
    id: string,
    rects = [{ x: 10, y: 20, w: 100, h: 12 }],
): Highlight => ({
    id,
    c: 'hl',
    rects,
    text: id,
})

function fakeDeps(over: Partial<PdfHighlightDeps> = {}) {
    const applied: PdfHighlightEdits[] = []
    const deps: PdfHighlightDeps = {
        read: async () => ({ writable: true, pages: [[], []] }),
        apply: async (bytes, edits) => {
            applied.push(edits)
            return new Uint8Array([...bytes, 9])
        },
        natSize: async () => ({ w: 612, h: 792 }),
        ...over,
    }
    return { deps, applied }
}

describe('editPdfHighlights', () => {
    test('one read-modify-write of the pdf', async () => {
        const { io, files, writes } = memIO({ 'a.pdf': PDF })
        const { deps, applied } = fakeDeps()
        const edits = { add: [{ page: 0, highlight: hl('x') }], remove: [] }
        expect(await editPdfHighlights(io, 'a.pdf', edits, deps)).toEqual({
            ok: true,
        })
        expect(applied).toEqual([edits])
        expect(writes).toEqual(['a.pdf'])
        expect(files.get('a.pdf')).toEqual(new Uint8Array([1, 2, 3, 9]))
    })

    test('empty edits write nothing', async () => {
        const { io, writes } = memIO({ 'a.pdf': PDF })
        const { deps, applied } = fakeDeps()
        await editPdfHighlights(io, 'a.pdf', { add: [], remove: [] }, deps)
        expect(applied).toEqual([])
        expect(writes).toEqual([])
    })

    test('a missing pdf is a 404', async () => {
        const { io } = memIO({})
        const e = await editPdfHighlights(
            io,
            'a.pdf',
            { add: [], remove: [] },
            fakeDeps().deps,
        ).catch(x => x)
        expect(e).toBeInstanceOf(AppError)
        expect(e.statusCode).toBe(404)
    })

    test('a non-pdf path is refused', async () => {
        const { io } = memIO({ 'a.png': PDF })
        const e = await editPdfHighlights(
            io,
            'a.png',
            { add: [], remove: [] },
            fakeDeps().deps,
        ).catch(x => x)
        expect(e.statusCode).toBe(400)
    })

    test('PDF_NOT_WRITABLE surfaces as 409 and nothing is written', async () => {
        const { io, writes } = memIO({ 'a.pdf': PDF })
        const { deps } = fakeDeps({
            apply: async () => {
                throw new AppError('PDF_NOT_WRITABLE', 'encrypted')
            },
        })
        const e = await editPdfHighlights(
            io,
            'a.pdf',
            { add: [{ page: 0, highlight: hl('x') }], remove: [] },
            deps,
        ).catch(x => x)
        expect(e.code).toBe('PDF_NOT_WRITABLE')
        expect(e.statusCode).toBe(409)
        expect(e.message).toBe('encrypted')
        expect(writes).toEqual([])
    })
})

describe('migrateSidecarHighlights', () => {
    const sidecarDoc = (): DrawingDoc => {
        const doc = emptyDoc()
        doc.pages = [
            {
                strokes: [
                    {
                        id: 's1',
                        tool: 'pen',
                        c: '#000000',
                        w: 2,
                        pts: [1, 2, 3, 4],
                    } as any,
                ],
                highlights: [hl('h1')],
            },
            { strokes: [], highlights: [hl('h2')] },
        ]
        doc.bookmarks = [{ id: 'b1', page: 1, label: 'here' }]
        return doc
    }

    test('moves both highlights, keeps ink and bookmarks, then moves nothing', async () => {
        const doc = sidecarDoc()
        const { io, files, writes } = memIO({
            'a.pdf': PDF,
            'a.pdf.draw': serializeDoc(doc),
        })
        const { deps, applied } = fakeDeps()
        expect(await migrateSidecarHighlights(io, 'a.pdf', deps)).toEqual({
            moved: 2,
            writable: true,
        })
        expect(applied[0].add.map(a => [a.page, a.highlight.id])).toEqual([
            [0, 'h1'],
            [1, 'h2'],
        ])
        // the pdf is written before the sidecar
        expect(writes).toEqual(['a.pdf', 'a.pdf.draw'])
        const after = parseDoc(files.get('a.pdf.draw') as string)
        const expected = sidecarDoc()
        for (const p of expected.pages) delete p.highlights
        expect(parseDoc(serializeDoc(after))).toEqual(
            parseDoc(serializeDoc(expected)),
        )
        expect(after.bookmarks).toEqual(doc.bookmarks)
        expect(after.pages[0].strokes).toEqual(doc.pages[0].strokes)

        writes.length = 0
        expect(await migrateSidecarHighlights(io, 'a.pdf', deps)).toEqual({
            moved: 0,
            writable: true,
        })
        expect(writes).toEqual([])
    })

    test('a pdf that cannot be rewritten moves nothing and writes nothing', async () => {
        const text = serializeDoc(sidecarDoc())
        const { io, files, writes } = memIO({
            'a.pdf': PDF,
            'a.pdf.draw': text,
        })
        const { deps, applied } = fakeDeps({
            read: async () => ({
                writable: false,
                reason: 'encrypted',
                pages: [],
            }),
        })
        expect(await migrateSidecarHighlights(io, 'a.pdf', deps)).toEqual({
            moved: 0,
            writable: false,
        })
        expect(applied).toEqual([])
        expect(writes).toEqual([])
        expect(files.get('a.pdf.draw')).toBe(text)
    })

    test('no sidecar, or a sidecar without highlights, writes nothing', async () => {
        const none = memIO({ 'a.pdf': PDF })
        expect(
            await migrateSidecarHighlights(none.io, 'a.pdf', fakeDeps().deps),
        ).toEqual({ moved: 0, writable: true })
        const doc = sidecarDoc()
        for (const p of doc.pages) delete p.highlights
        const inkOnly = memIO({ 'a.pdf': PDF, 'a.pdf.draw': serializeDoc(doc) })
        await migrateSidecarHighlights(inkOnly.io, 'a.pdf', fakeDeps().deps)
        expect(inkOnly.writes).toEqual([])
        expect(none.writes).toEqual([])
    })

    test('an unparseable sidecar is left alone', async () => {
        const { io, writes } = memIO({ 'a.pdf': PDF, 'a.pdf.draw': 'garbage' })
        expect(
            await migrateSidecarHighlights(io, 'a.pdf', fakeDeps().deps),
        ).toEqual({ moved: 0, writable: true })
        expect(writes).toEqual([])
    })

    test('a legacy images[0] box is converted to the fit box', async () => {
        const nat = { w: 612, h: 792 }
        const fit = fitImage(nat.w, nat.h)
        const doc = emptyDoc()
        doc.pages = [
            {
                strokes: [],
                images: [
                    {
                        id: 'im',
                        src: 'a.pdf',
                        x: 100,
                        y: 100,
                        w: 300,
                        h: 400,
                    } as any,
                ],
                highlights: [hl('h1', [{ x: 100, y: 100, w: 30, h: 20 }])],
            },
        ]
        const { io } = memIO({ 'a.pdf': PDF, 'a.pdf.draw': serializeDoc(doc) })
        const { deps, applied } = fakeDeps({ natSize: async () => nat })
        await migrateSidecarHighlights(io, 'a.pdf', deps)
        const r = applied[0].add[0].highlight.rects[0]
        expect(r.x).toBeCloseTo(fit.x, 6)
        expect(r.y).toBeCloseTo(fit.y, 6)
        expect(r.w).toBeCloseTo(0.1 * fit.w, 6)
        expect(r.h).toBeCloseTo(0.05 * fit.h, 6)
    })

    test('without a legacy box the rects pass through unchanged', async () => {
        const rects = [{ x: 33, y: 44, w: 55, h: 6 }]
        const doc = emptyDoc()
        doc.pages = [{ strokes: [], highlights: [hl('h1', rects)] }]
        const { io } = memIO({ 'a.pdf': PDF, 'a.pdf.draw': serializeDoc(doc) })
        const { deps, applied } = fakeDeps()
        await migrateSidecarHighlights(io, 'a.pdf', deps)
        expect(applied[0].add[0].highlight.rects).toEqual(rects)
    })
})
