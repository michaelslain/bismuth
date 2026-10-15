// core/test/pdfHighlightIncremental.test.ts — highlight edits append a PDF incremental update:
// the original bytes stay a byte-identical prefix, for a classic xref table and an xref stream.
import { test, expect, describe } from 'bun:test'
import { readFileSync, writeFileSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './helpers'
import { deflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import {
    applyPdfHighlightEdits,
    applyPdfHighlightIncrement,
    readPdfHighlights,
} from '../src/drawing/pdfHighlights'
import { appendBinary } from '../src/files'
import { editPdfHighlights, type HighlightIO } from '../src/pdfHighlightStore'
import type { Highlight } from '../src/drawing/model'

const FIX = join(import.meta.dir, 'drawing/fixtures')
const fixture = (n: string) => new Uint8Array(readFileSync(join(FIX, n)))

async function made(useObjectStreams: boolean): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    doc.addPage([612, 792])
    return doc.save({ useObjectStreams })
}

/** A tiny PDF whose cross-reference stream is Flate + PNG "Up" predicted, as qpdf and OCRmyPDF
 *  write them (pdf-lib's own decoders ignore /Predictor). */
function predictedXrefPdf(): Uint8Array {
    const parts: string[] = ['%PDF-1.5\n']
    const off: number[] = []
    const obj = (body: string) => {
        off.push(parts.join('').length)
        parts.push(`${off.length} 0 obj\n${body}\nendobj\n`)
    }
    obj('<< /Type /Catalog /Pages 2 0 R >>')
    obj('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
    obj('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>')
    const xrefAt = parts.join('').length
    const rows = [[0, 0, 0, 255], ...off.map(o => [1, o >> 8, o & 255, 0]), [1, xrefAt >> 8, xrefAt & 255, 0]]
    const raw: number[] = []
    rows.forEach((r, i) => {
        raw.push(2)
        r.forEach((v, j) => raw.push((v - (i ? rows[i - 1][j] : 0) + 256) & 255))
    })
    const z = deflateSync(Buffer.from(raw))
    const head = `4 0 obj\n<< /Type /XRef /Size 5 /W [1 2 1] /Root 1 0 R /Filter /FlateDecode /DecodeParms << /Columns 4 /Predictor 12 >> /Length ${z.length} >>\nstream\n`
    const tail = `\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`
    const enc = (t: string) => Buffer.from(t, 'latin1')
    return new Uint8Array(Buffer.concat([enc(parts.join('')), enc(head), z, enc(tail)]))
}

const hl = (id: string, y: number): Highlight => ({
    id,
    c: 'hl',
    rects: [{ x: 100, y, w: 200, h: 18 }],
    text: id,
})
const add = (page: number, h: Highlight) => ({ add: [{ page, highlight: h }], remove: [] })

const count = async (b: Uint8Array) =>
    (await readPdfHighlights(b)).pages.flat().length
const ascii = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

async function pdfLibHighlights(b: Uint8Array): Promise<number> {
    const doc = await PDFDocument.load(b)
    let n = 0
    for (const p of doc.getPages()) {
        const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
        for (let i = 0; annots && i < annots.size(); i++) {
            const d = annots.lookupMaybe(i, PDFDict)
            if (d?.lookup(PDFName.of('Subtype')) === PDFName.of('Highlight')) n++
        }
    }
    return n
}

async function pdfJsHighlights(b: Uint8Array): Promise<number | null> {
    let pdfjs: any
    try {
        pdfjs = await import(
            '../../app/node_modules/pdfjs-dist/legacy/build/pdf.mjs'
        )
    } catch {
        return null // pdf.js is an app dependency; not resolvable here
    }
    const task = pdfjs.getDocument({ data: b.slice(), verbosity: 0 })
    const doc = await task.promise
    let n = 0
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        n += (await page.getAnnotations()).filter(
            (a: any) => a.subtype === 'Highlight',
        ).length
    }
    await task.destroy()
    return n
}

const cases: [string, () => Promise<Uint8Array>, 'table' | 'stream'][] = [
    ['classic xref table', () => made(false), 'table'],
    ['xref stream + object streams', () => made(true), 'stream'],
    ['predicted xref stream (qpdf style)', async () => predictedXrefPdf(), 'stream'],
    ['pdfkit fixture (annots already present)', async () => fixture('pdfkit-highlights.pdf'), 'table'],
]

describe.each(cases)('incremental highlight edits: %s', (_n, load, _style) => {
    test('add keeps the original as a prefix and reopens everywhere', async () => {
        const orig = await load()
        const before = await count(orig)
        const next = await applyPdfHighlightEdits(orig, add(0, hl('a', 300)))
        expect(next.length).toBeGreaterThan(orig.length)
        expect(next.subarray(0, orig.length)).toEqual(orig)
        const tail = ascii(next.subarray(orig.length))
        expect(tail).toMatch(/startxref\n\d+\n%%EOF\n$/)
        expect(tail).toContain('/Prev ')
        if (_style === 'stream') expect(tail).toContain('/Type /XRef')
        if (_style === 'table') expect(tail).toContain('trailer')
        expect(await count(next)).toBe(before + 1)
        expect(await pdfLibHighlights(next)).toBe(before + 1)
        const js = await pdfJsHighlights(next)
        if (js !== null) expect(js).toBe(before + 1)
    })

    test('increments chain, and remove leaves no /Highlight from ours', async () => {
        const orig = await load()
        const before = await count(orig)
        const one = await applyPdfHighlightEdits(orig, add(0, hl('a', 300)))
        const two = await applyPdfHighlightEdits(one, add(0, hl('b', 400)))
        expect(two.subarray(0, one.length)).toEqual(one)
        expect(await count(two)).toBe(before + 2)
        const ids = (await readPdfHighlights(two)).pages.flatMap((p, pi) =>
            p.map(h => ({ page: pi, id: h.id })),
        )
        const ours = ids.slice(before === 0 ? 0 : -2)
        const cleared = await applyPdfHighlightEdits(two, { add: [], remove: ours })
        expect(cleared.subarray(0, two.length)).toEqual(two)
        expect(await count(cleared)).toBe(before)
        expect(await pdfLibHighlights(cleared)).toBe(before)
        const js = await pdfJsHighlights(cleared)
        if (js !== null) expect(js).toBe(before)
    })

    test('a remove matching nothing, and a repeat add, return the input untouched', async () => {
        const orig = await load()
        const same = await applyPdfHighlightEdits(orig, {
            add: [],
            remove: [{ page: 0, id: 'pdf-nope' }],
        })
        expect(same).toBe(orig)
        const one = await applyPdfHighlightEdits(orig, add(0, hl('a', 300)))
        const again = await applyPdfHighlightEdits(one, add(0, hl('a', 300)))
        expect(again).toBe(one)
    })
})

describe('store writes', () => {
    test('a no-op remove leaves the file bytes and mtime alone', async () => {
        const dir = tempDir('hl-inc-')
        const file = join(dir, 'a.pdf')
        writeFileSync(file, await made(true))
        const old = new Date('2020-01-01T00:00:00Z')
        utimesSync(file, old, old)
        const bytes = readFileSync(file)
        const io: HighlightIO = {
            readBinary: async () => new Uint8Array(readFileSync(file)),
            writeBinary: async (_r, b) => writeFileSync(file, b),
            readText: async () => null,
            writeText: async () => {},
        }
        await editPdfHighlights(io, 'a.pdf', {
            add: [],
            remove: [{ page: 0, id: 'pdf-nope' }],
        })
        expect(statSync(file).mtimeMs).toBe(old.getTime())
        expect(readFileSync(file).equals(bytes)).toBe(true)
        await editPdfHighlights(io, 'a.pdf', add(0, hl('a', 300)))
        expect(statSync(file).mtimeMs).toBeGreaterThan(old.getTime())
    })

    test('an IO that can append gets only the increment, and a changed file is refused', async () => {
        const orig = await made(true)
        let file = orig
        const appended: { size: number; len: number }[] = []
        const io: HighlightIO = {
            readBinary: async () => file,
            writeBinary: async () => {
                throw new Error('whole-file write')
            },
            readText: async () => null,
            writeText: async () => {},
            appendBinary: async (_r, b, size) => {
                appended.push({ size, len: b.length })
                const next = new Uint8Array(file.length + b.length)
                next.set(file)
                next.set(b, file.length)
                file = next
            },
        }
        await editPdfHighlights(io, 'a.pdf', add(0, hl('a', 300)))
        expect(appended).toHaveLength(1)
        expect(appended[0].size).toBe(orig.length)
        expect(file.subarray(0, orig.length)).toEqual(orig)
        expect(await count(file)).toBe(1)
        await editPdfHighlights(io, 'a.pdf', { add: [], remove: [{ page: 0, id: 'pdf-nope' }] })
        expect(appended).toHaveLength(1)
    })

    test('files.appendBinary appends, and refuses a file of another size', async () => {
        const dir = tempDir('hl-app-')
        writeFileSync(join(dir, 'a.bin'), 'abc')
        await appendBinary(dir, 'a.bin', new TextEncoder().encode('de'), 3)
        expect(readFileSync(join(dir, 'a.bin'), 'utf8')).toBe('abcde')
        const e = await appendBinary(dir, 'a.bin', new Uint8Array([1]), 3).catch(x => x)
        expect(e.statusCode).toBe(409)
        expect(readFileSync(join(dir, 'a.bin'), 'utf8')).toBe('abcde')
    })

    test('encrypted pdfs still refuse', async () => {
        const e = await applyPdfHighlightEdits(fixture('encrypted.pdf'), add(0, hl('a', 300))).catch(x => x)
        expect(e.code).toBe('PDF_NOT_WRITABLE')
    })
})

/** A hybrid-reference file (PDF 1.5 7.5.8.4): the classic table omits or marks free the two page
 *  objects that live in an object stream, and /XRefStm locates them. */
function hybridPdf(variant: 'omit' | 'free'): Uint8Array {
    const enc = (s: string) => Buffer.from(s, 'latin1')
    const chunks: Buffer[] = []
    let pos = 0
    const w = (s: string | Buffer) => {
        const b = typeof s === 'string' ? enc(s) : s
        chunks.push(b)
        pos += b.length
    }
    w('%PDF-1.5\n')
    const o1 = pos
    w('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    const o2 = pos
    w('2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n')
    const bodies = [
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 310 410] >>',
    ]
    let hdr = ''
    let body = ''
    bodies.forEach((b, i) => {
        hdr += `${i + 3} ${body.length} `
        body += b + '\n'
    })
    const data = hdr + body
    const o5 = pos
    w(`5 0 obj\n<< /Type /ObjStm /N 2 /First ${hdr.length} /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`)
    const o6 = pos
    const rows = Buffer.from([2, 0, 5, 0, 2, 0, 5, 1, 1, (o5 >> 8) & 255, o5 & 255, 0, 1, (o6 >> 8) & 255, o6 & 255, 0])
    w(`6 0 obj\n<< /Type /XRef /Size 7 /Index [3 2 5 2] /W [1 2 1] /Length ${rows.length} >>\nstream\n`)
    w(rows)
    w('\nendstream\nendobj\n')
    const x = pos
    const p = (n: number) => String(n).padStart(10, '0')
    let t = `xref\n0 3\n0000000000 65535 f \n${p(o1)} 00000 n \n${p(o2)} 00000 n \n`
    if (variant === 'free') t += '3 2\n0000000000 00000 f \n0000000000 00000 f \n'
    t += `5 2\n${p(o5)} 00000 n \n${p(o6)} 00000 n \n`
    w(t + `trailer\n<< /Size 7 /Root 1 0 R /XRefStm ${o6} >>\nstartxref\n${x}\n%%EOF\n`)
    return new Uint8Array(Buffer.concat(chunks))
}

describe.each(['omit', 'free'] as const)('hybrid-reference file (%s)', variant => {
    test('a highlight lands on the requested page, never dropped', async () => {
        const out = await applyPdfHighlightEdits(hybridPdf(variant), add(1, hl('a', 100)))
        const doc = await PDFDocument.load(out)
        expect(doc.getPageCount()).toBe(2)
        const annots = (i: number) => {
            const a = doc.getPage(i).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
            return a ? a.size() : 0
        }
        expect(annots(0)).toBe(0)
        expect(annots(1)).toBe(1)
        expect(await count(out)).toBe(1)
    })

    test('the increment path never answers none', async () => {
        const inc = await applyPdfHighlightIncrement(hybridPdf(variant), add(1, hl('a', 100)))
        expect(inc.kind).not.toBe('none')
    })
})

describe('malformed /AcroForm', () => {
    async function malformed(): Promise<Uint8Array> {
        const doc = await PDFDocument.create()
        doc.addPage([612, 792])
        doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj(5))
        return doc.save({ useObjectStreams: false })
    }

    test('is never appended to', async () => {
        let kind: string
        try {
            kind = (await applyPdfHighlightIncrement(await malformed(), add(0, hl('a', 100)))).kind
        } catch {
            kind = 'throw'
        }
        expect(kind).not.toBe('append')
    })
})
