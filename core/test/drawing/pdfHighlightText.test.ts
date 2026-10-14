import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pdfHighlightTexts } from '../../src/drawing/pdfHighlightText'
import { fitImage } from '../../src/drawing/pageInk'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { Highlight, HighlightRect } from '../../src/drawing/model'

const FIXTURE = join(import.meta.dir, 'fixtures', 'pdfkit-highlights.pdf')
const bytes = () => new Uint8Array(readFileSync(FIXTURE))

// The fixture's quads, read with pdf.js and mapped to logical rects through fitImage.
async function fixtureRects(): Promise<HighlightRect[][]> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: bytes(), verbosity: 0 })
    const doc = await task.promise
    const page = await doc.getPage(1)
    const vp = page.getViewport({ scale: 1 })
    const box = fitImage(vp.width, vp.height)
    const k = box.w / vp.width
    const [a, b, c, d, e, f] = vp.transform
    const pt = (x: number, y: number) => ({
        x: box.x + (a * x + c * y + e) * k,
        y: box.y + (b * x + d * y + f) * k,
    })
    const annots = (await page.getAnnotations()).filter(
        (an: { subtype: string }) => an.subtype === 'Highlight',
    )
    const out = annots.map((an: { quadPoints: ArrayLike<number> }) => {
        const q = Array.from(an.quadPoints)
        const ul = pt(q[0]!, q[1]!)
        const lr = pt(q[6]!, q[7]!)
        return [{ x: ul.x, y: ul.y, w: lr.x - ul.x, h: lr.y - ul.y }]
    })
    await task.destroy()
    return out
}

const hl = (rects: HighlightRect[], id = 'x'): Highlight => ({
    id,
    c: 'hl',
    rects,
})

describe('pdfHighlightTexts', () => {
    test('loads the pdf.js legacy build under bun with no worker', async () => {
        const mod = await import('pdfjs-dist/legacy/build/pdf.mjs')
        expect(typeof mod.getDocument).toBe('function')
    })

    test('text under the fixture quads matches what PDFKit selects', async () => {
        const rects = await fixtureRects()
        expect(rects.length).toBeGreaterThan(2)
        const texts = await pdfHighlightTexts(bytes(), [rects.map(r => hl(r))])
        // PDFKit page.selection(for: 50,195,120,25) and the quad 50..167.488 both give this.
        expect(texts[0]![0]).toBe('Hello highlighted w')
        expect(texts[0]![2]).toBe('Hello highlighted w')
        expect(texts[0]!.every(t => t === 'Hello highlighted w')).toBe(true)
    })

    test('a highlight over the whole line gives the whole line', async () => {
        const [r] = (await fixtureRects())[0]!
        const wide = { ...r!, x: 0, w: 816 }
        const texts = await pdfHighlightTexts(bytes(), [[hl([wide])]])
        expect(texts[0]![0]).toBe('Hello highlighted world')
    })

    test('a highlight over no text is null', async () => {
        const texts = await pdfHighlightTexts(bytes(), [
            [hl([{ x: 600, y: 900, w: 100, h: 20 }]), hl([])],
        ])
        expect(texts[0]).toEqual([null, null])
    })

    test('pages without highlights and pages past the end are null-safe', async () => {
        const texts = await pdfHighlightTexts(bytes(), [
            [],
            [hl([{ x: 0, y: 0, w: 816, h: 1056 }])],
        ])
        expect(texts).toEqual([[], [null]])
    })

    test('a load failure returns all null and does not throw', async () => {
        const texts = await pdfHighlightTexts(new Uint8Array([1, 2, 3]), [
            [hl([{ x: 0, y: 0, w: 5, h: 5 }])],
            [],
        ])
        expect(texts).toEqual([[null], []])
    })

    // Two lines of a 612x792 page: "alpha beta" at y=700 and "gamma delta" at y=680 (size 20).
    async function twoLines() {
        const pdf = await PDFDocument.create()
        const page = pdf.addPage([612, 792])
        const font = await pdf.embedFont(StandardFonts.Helvetica)
        page.drawText('alpha beta', { x: 100, y: 700, size: 20, font })
        page.drawText('gamma delta', { x: 100, y: 680, size: 20, font })
        return new Uint8Array(await pdf.save())
    }
    const toLogical = (x: number, y: number) => {
        const b = fitImage(612, 792)
        const k = b.w / 612
        return { x: b.x + x * k, y: b.y + (792 - y) * k }
    }

    test('a highlight over two lines is one string in reading order', async () => {
        const a = toLogical(100, 720)
        const z = toLogical(300, 676)
        const rects = [{ x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y }]
        const texts = await pdfHighlightTexts(await twoLines(), [[hl(rects)]])
        expect(texts[0]![0]).toBe('alpha beta gamma delta')
    })

    test('per-line rects pick only their line', async () => {
        const a = toLogical(100, 720)
        const z = toLogical(300, 697)
        const rects = [{ x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y }]
        const texts = await pdfHighlightTexts(await twoLines(), [[hl(rects)]])
        expect(texts[0]![0]).toBe('alpha beta')
    })
})
