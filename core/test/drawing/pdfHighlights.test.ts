import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFName, PDFArray, PDFRef, PDFNumber } from 'pdf-lib'
import {
    applyPdfHighlightEdits,
    hexToRgb01,
    pageNatSize,
    pdfHighlightId,
    quadsToRects,
    readPdfHighlights,
    rectsToQuads,
    rgbToHex,
    type PdfPageGeom,
} from '../../src/drawing/pdfHighlights'
import { PDF_HIGHLIGHT_YELLOW } from '../../src/theme/tokens'

const fx = (n: string) =>
    new Uint8Array(readFileSync(join(import.meta.dir, 'fixtures', n)))

const rects = [
    { x: 100, y: 200, w: 300, h: 20 },
    { x: 120, y: 230, w: 150, h: 20 },
]

describe('geometry', () => {
    for (const rotate of [0, 90, 180, 270]) {
        test(`round-trips at rotate ${rotate} with an offset CropBox`, () => {
            const g: PdfPageGeom = { view: [36, 36, 576, 756], rotate }
            const back = quadsToRects(rectsToQuads(rects, g), g)
            expect(back.length).toBe(2)
            for (let i = 0; i < 2; i++) {
                for (const k of ['x', 'y', 'w', 'h'] as const) {
                    expect(Math.abs(back[i][k] - rects[i][k])).toBeLessThan(0.01)
                }
            }
        })
    }

    test('pageNatSize swaps for 90/270', () => {
        const view: PdfPageGeom['view'] = [36, 36, 576, 756]
        expect(pageNatSize({ view, rotate: 0 })).toEqual({ w: 540, h: 720 })
        expect(pageNatSize({ view, rotate: 90 })).toEqual({ w: 720, h: 540 })
        expect(pageNatSize({ view, rotate: 180 })).toEqual({ w: 540, h: 720 })
        expect(pageNatSize({ view, rotate: 270 })).toEqual({ w: 720, h: 540 })
    })

    test('rectsToQuads emits Z order, y up, on an unrotated page', () => {
        const g: PdfPageGeom = { view: [0, 0, 816, 1056], rotate: 0 }
        const q = rectsToQuads([{ x: 100, y: 200, w: 300, h: 20 }], g)
        // UL, UR, LL, LR with y = 1056 - logical y
        expect(q.map(v => Math.round(v * 100) / 100)).toEqual([
            100, 856, 400, 856, 100, 836, 400, 836,
        ])
    })
})

describe('ids and colours', () => {
    const q = [10.3, 50.3, 90.3, 50.3, 10.3, 40.3, 90.3, 40.3]
    test('stable within 0.1pt, equal across colours, differing by page and geometry', () => {
        const q2 = q.map(v => v + 0.1)
        expect(pdfHighlightId(0, q, '#ffe14d')).toBe(pdfHighlightId(0, q2, '#FFE14D'))
        expect(pdfHighlightId(0, q, '#ffe14d')).toBe(pdfHighlightId(0, q, '#00ff00'))
        expect(pdfHighlightId(0, q, '#ffe14d')).not.toBe(pdfHighlightId(1, q, '#ffe14d'))
        expect(pdfHighlightId(0, q, '#ffe14d')).not.toBe(
            pdfHighlightId(0, q.map(v => v + 5), '#ffe14d'),
        )
        expect(pdfHighlightId(0, q, '#ffe14d')).toStartWith('pdf-')
    })
    test('rectsToQuads output is already rounded and its id matches the written annotation', async () => {
        const g: PdfPageGeom = { view: [0, 0, 612, 792], rotate: 0 }
        const rs = [{ x: 100.1234567, y: 300.7654321, w: 200.3333333, h: 18.1111111 }]
        const quads = rectsToQuads(rs, g)
        for (const v of quads) expect(v).toBe(Math.round(v * 1000) / 1000)
        const out = await applyPdfHighlightEdits(await blank(), {
            add: [{ page: 0, highlight: { id: 'x', c: 'hl', rects: rs } }],
            remove: [],
        })
        const r = await readPdfHighlights(out)
        expect(r.pages[0][0].id).toBe(pdfHighlightId(0, quads, 'hl'))
    })
    test('hex and rgb helpers', () => {
        expect(rgbToHex(hexToRgb01('#ff8000'), 1)).toBe('#ff8000')
        expect(rgbToHex([255, 128, 0], 255)).toBe('#ff8000')
    })
})

describe('reading', () => {
    test('pdfkit fixture: PDFKit colours all read, ids stable', async () => {
        const a = await readPdfHighlights(fx('pdfkit-highlights.pdf'))
        const b = await readPdfHighlights(fx('pdfkit-highlights.pdf'))
        expect(a.writable).toBe(true)
        expect(a.pages.length).toBe(1)
        // the fixture carries 2 earlier yellow (#ffeb3b, identical geometry => one id) + 5 PDFKit
        expect(a.pages[0].length).toBe(7)
        const cs = a.pages[0].map(h => h.c)
        for (const c of ['#ffff00', '#00ff00', '#0091ff', '#ff375f', '#db34f2']) {
            expect(cs).toContain(c)
        }
        expect(new Set(cs).size).toBe(6)
        expect(a.pages[0].map(h => h.id)).toEqual(b.pages[0].map(h => h.id))
        // PDFKit quad: x 50..167.488, y 196.78..210.78 on a 300x300 page => scale 2.72, box y 120
        const g = a.pages[0].find(h => h.c === '#00ff00')!.rects[0]
        const nearly = (v: number, e: number) => expect(Math.abs(v - e)).toBeLessThan(0.1)
        nearly(g.x, 50 * 2.72)
        nearly(g.w, 117.488 * 2.72)
        nearly(g.y, 120 + (300 - 210.7803) * 2.72)
        nearly(g.h, 14 * 2.72)
    })

    test('encrypted, signed, garbage', async () => {
        const e = await readPdfHighlights(fx('encrypted.pdf'))
        expect(e).toEqual({ writable: false, reason: 'encrypted', pages: [] })
        const g = await readPdfHighlights(new Uint8Array([1, 2, 3, 4]))
        expect(g).toEqual({ writable: false, reason: 'unreadable', pages: [] })
        const s = await signed()
        const r = await readPdfHighlights(s)
        expect(r.writable).toBe(false)
        if (!r.writable) expect(r.reason).toBe('signed')
        for (const bytes of [fx('encrypted.pdf'), new Uint8Array([1, 2]), s]) {
            await expect(
                applyPdfHighlightEdits(bytes, { add: [], remove: [] }),
            ).rejects.toMatchObject({ code: 'PDF_NOT_WRITABLE' })
        }
    })
})

async function withCatalog(set: (doc: PDFDocument) => void): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    set(doc)
    return doc.save()
}

async function expectSigned(bytes: Uint8Array) {
    const r = await readPdfHighlights(bytes)
    expect(r.writable).toBe(false)
    if (!r.writable) expect(r.reason).toBe('signed')
}

describe('signature detection', () => {
    test('a /FT /Sig field with no SigFlags', async () => {
        const f = (d: PDFDocument) => {
            const field = d.context.register(
                d.context.obj({ FT: 'Sig', T: 'sig', V: d.context.obj({ Type: 'Sig' }) }),
            )
            d.catalog.set(PDFName.of('AcroForm'), d.context.obj({ Fields: [field] }))
        }
        await expectSigned(await withCatalog(f))
    })
    test('SigFlags 2 with a signature field', async () => {
        const f = (d: PDFDocument) => {
            const field = d.context.register(d.context.obj({ FT: 'Sig', T: 'sig' }))
            d.catalog.set(PDFName.of('AcroForm'), d.context.obj({ SigFlags: 2, Fields: [field] }))
        }
        await expectSigned(await withCatalog(f))
    })
    test('/Perms /DocMDP', async () => {
        const f = (d: PDFDocument) => {
            d.catalog.set(PDFName.of('Perms'), d.context.obj({ DocMDP: d.context.obj({}) }))
        }
        await expectSigned(await withCatalog(f))
    })
    test('a signature field nested in Kids, /FT inherited from the parent', async () => {
        const f = (d: PDFDocument) => {
            const kid = d.context.register(d.context.obj({ T: 'kid' }))
            const mid = d.context.register(d.context.obj({ FT: 'Sig', Kids: [kid] }))
            const root = d.context.register(d.context.obj({ T: 'root', Kids: [mid] }))
            d.catalog.set(PDFName.of('AcroForm'), d.context.obj({ Fields: [root] }))
        }
        await expectSigned(await withCatalog(f))
    })
    test('a plain text field stays writable', async () => {
        const f = (d: PDFDocument) => {
            const field = d.context.register(d.context.obj({ FT: 'Tx', T: 't' }))
            d.catalog.set(PDFName.of('AcroForm'), d.context.obj({ Fields: [field] }))
        }
        const r = await readPdfHighlights(await withCatalog(f))
        expect(r.writable).toBe(true)
    })
})

async function signed(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    doc.catalog.set(
        PDFName.of('AcroForm'),
        doc.context.obj({ SigFlags: 3, Fields: [] }),
    )
    return doc.save()
}

async function blank(opts: { rotate?: number; crop?: boolean } = {}) {
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    if (opts.rotate) p.setRotation({ type: 'degrees' as never, angle: opts.rotate })
    if (opts.crop) p.setCropBox(36, 36, 540, 720)
    return doc.save()
}

const add = (h: { id: string; c: string; rects: typeof rects }, page = 0) => ({
    add: [{ page, highlight: h }],
    remove: [],
})

describe('writing', () => {
    const mine = { id: 'x', c: 'hl', rects: [{ x: 100, y: 300, w: 200, h: 18 }] }

    test('round-trips and writes a standard annotation, keeping foreign ones', async () => {
        const src = fx('pdfkit-highlights.pdf')
        const out = await applyPdfHighlightEdits(src, add(mine))
        const r = await readPdfHighlights(out)
        expect(r.pages[0].length).toBe(8)
        const got = r.pages[0].find(h => h.c === PDF_HIGHLIGHT_YELLOW.toLowerCase() && h.rects[0].w > 190 && h.rects[0].w < 210)!
        expect(got).toBeDefined()
        for (const k of ['x', 'y', 'w', 'h'] as const) {
            expect(Math.abs(got.rects[0][k] - mine.rects[0][k])).toBeLessThan(0.05)
        }
        const before = (await readPdfHighlights(src)).pages[0].map(h => h.id)
        for (const id of before) expect(r.pages[0].map(h => h.id)).toContain(id)

        const doc = await PDFDocument.load(out)
        const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray)
        let found = false
        for (let i = 0; i < annots.size(); i++) {
            const d = annots.lookup(i, PDFDict)
            const nm = d.get(PDFName.of('NM'))
            if (!nm || !String(nm).includes(got.id)) continue
            found = true
            expect(d.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Highlight'))
            expect(String(d.get(PDFName.of('T')))).toBe('(Bismuth)')
            expect((d.lookup(PDFName.of('F')) as PDFNumber).asNumber()).toBe(4)
            expect(d.has(PDFName.of('C'))).toBe(true)
            expect(d.has(PDFName.of('CA'))).toBe(true)
            const qp = d.lookup(PDFName.of('QuadPoints'), PDFArray)
            const n = [...Array(8).keys()].map(j => (qp.lookup(j) as PDFNumber).asNumber())
            expect(n[1]).toBe(n[3])
            expect(n[0]).toBeLessThan(n[2])
            expect(n[1]).toBeGreaterThan(n[5])
            const ap = d.lookup(PDFName.of('AP'), PDFDict)
            const stream = ap.lookup(PDFName.of('N')) as unknown as { dict: PDFDict }
            const gs = stream.dict
                .lookup(PDFName.of('Resources'), PDFDict)
                .lookup(PDFName.of('ExtGState'), PDFDict)
                .lookup(PDFName.of('GS0'), PDFDict)
            expect(gs.get(PDFName.of('BM'))).toBe(PDFName.of('Multiply'))
        }
        expect(found).toBe(true)
    })

    for (const rotate of [0, 90, 270]) {
        test(`round-trips on a cropped page rotated ${rotate}`, async () => {
            const out = await applyPdfHighlightEdits(await blank({ rotate, crop: true }), add(mine))
            const r = await readPdfHighlights(out)
            expect(r.pages[0].length).toBe(1)
            const g = r.pages[0][0].rects[0]
            for (const k of ['x', 'y', 'w', 'h'] as const) {
                expect(Math.abs(g[k] - mine.rects[0][k])).toBeLessThan(0.05)
            }
        })
    }

    test('MediaBox and Rotate inherited from the Pages root', async () => {
        const doc = await PDFDocument.create()
        doc.addPage()
        const leaf = doc.getPage(0).node
        leaf.delete(PDFName.of('MediaBox'))
        const root = doc.catalog.lookup(PDFName.of('Pages'), PDFDict)
        root.set(PDFName.of('MediaBox'), doc.context.obj([0, 0, 400, 600]))
        root.set(PDFName.of('Rotate'), PDFNumber.of(90))
        const base = await doc.save()
        const out = await applyPdfHighlightEdits(base, add(mine))
        const r = await readPdfHighlights(out)
        expect(r.pages[0].length).toBe(1)
        const g = r.pages[0][0].rects[0]
        for (const k of ['x', 'y', 'w', 'h'] as const) {
            expect(Math.abs(g[k] - mine.rects[0][k])).toBeLessThan(0.05)
        }
        // pdf.js geometry: view [0,0,400,600], rotate 90 => 600x400 page; quads stay on it
        const d2 = await PDFDocument.load(out)
        const annots = d2.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray)
        const qp = annots.lookup(0, PDFDict).lookup(PDFName.of('QuadPoints'), PDFArray)
        for (let j = 0; j < 8; j += 2) {
            const x = (qp.lookup(j) as PDFNumber).asNumber()
            const y = (qp.lookup(j + 1) as PDFNumber).asNumber()
            expect(x).toBeGreaterThanOrEqual(0)
            expect(x).toBeLessThanOrEqual(400)
            expect(y).toBeGreaterThanOrEqual(0)
            expect(y).toBeLessThanOrEqual(600)
        }
    })

    test('add skips an existing id; remove deletes only that one; unknown is a no-op', async () => {
        const once = await applyPdfHighlightEdits(await blank(), add(mine))
        const twice = await applyPdfHighlightEdits(once, add(mine))
        const a = await readPdfHighlights(twice)
        expect(a.pages[0].length).toBe(1)

        const other = { id: 'y', c: '#00ff00', rects: [{ x: 100, y: 500, w: 100, h: 18 }] }
        const two = await applyPdfHighlightEdits(twice, add(other))
        const t = await readPdfHighlights(two)
        expect(t.pages[0].length).toBe(2)
        const green = t.pages[0].find(h => h.c === '#00ff00')!
        const gone = await applyPdfHighlightEdits(two, {
            add: [],
            remove: [{ page: 0, id: green.id }],
        })
        const g = await readPdfHighlights(gone)
        expect(g.pages[0].map(h => h.id)).toEqual(t.pages[0].filter(h => h !== green).map(h => h.id))

        const noop = await applyPdfHighlightEdits(gone, {
            add: [],
            remove: [{ page: 0, id: 'pdf-nope' }],
        })
        expect((await readPdfHighlights(noop)).pages[0].map(h => h.id)).toEqual(g.pages[0].map(h => h.id))
    })

    test('remove deletes the popup too', async () => {
        const base = await applyPdfHighlightEdits(await blank(), add(mine))
        const doc = await PDFDocument.load(base)
        const page = doc.getPage(0)
        const annots = page.node.lookup(PDFName.of('Annots'), PDFArray)
        const hl = annots.lookup(0, PDFDict)
        const pop = doc.context.register(
            doc.context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [0, 0, 10, 10] }),
        )
        hl.set(PDFName.of('Popup'), pop)
        annots.push(pop)
        const withPopup = await doc.save()
        const id = (await readPdfHighlights(withPopup)).pages[0][0].id
        const out = await applyPdfHighlightEdits(withPopup, { add: [], remove: [{ page: 0, id }] })
        const d2 = await PDFDocument.load(out)
        const a2 = d2.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
        expect(a2?.size() ?? 0).toBe(0)
        expect(annots.get(1)).toBeInstanceOf(PDFRef)
    })

    test('edits computed against read A keep a foreign highlight added since', async () => {
        const a = await applyPdfHighlightEdits(await blank(), add(mine))
        const readA = await readPdfHighlights(a)
        const foreign = { id: 'f', c: '#ff00ff', rects: [{ x: 50, y: 600, w: 120, h: 18 }] }
        const b = await applyPdfHighlightEdits(a, add(foreign))
        const out = await applyPdfHighlightEdits(b, {
            add: [],
            remove: [{ page: 0, id: readA.pages[0][0].id }],
        })
        const r = await readPdfHighlights(out)
        expect(r.pages[0].map(h => h.c)).toEqual(['#ff00ff'])
    })
})
