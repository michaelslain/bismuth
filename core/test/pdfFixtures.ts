// A pdf made of pages of the given widths (200 points tall), and the widths read back: a page is
// recognised by its width. Lives in core/test so suites outside core can reach pdf-lib.
import { readFileSync } from 'node:fs'
import { PDFDocument, rgb } from 'pdf-lib'

export async function pdfOfWidths(widths: number[]): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    for (const w of widths) doc.addPage([w, 200])
    return doc.save()
}

export async function widthsOf(path: string): Promise<number[]> {
    return (await PDFDocument.load(readFileSync(path))).getPages().map(p => Math.round(p.getWidth()))
}

/** A page in `pdfOfBars`: `id` picks the bars only it has; `extra` adds one more short bar, as a line
 *  written on the page later; `shift` moves everything by that many points, as a page photographed
 *  again sits a little differently in its frame. */
export type BarPage = { id: number; extra?: boolean; shift?: number }

/** A pdf whose pages are drawn bars, so the pages look different to a merge, not just measure
 *  different: two pages with one id render the same. */
export async function pdfOfBars(pages: BarPage[]): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    for (const p of pages) {
        const page = doc.addPage([400, 560])
        const s = p.shift ?? 0
        // short bars scattered by id, so two ids differ wherever they are framed
        for (let k = 0; k < 14; k++) {
            const y = 60 + ((p.id * 7 + k * 13) % 28) * 16
            const x = 30 + ((p.id * 53 + k * 29) % 9) * 30
            page.drawRectangle({ x: x + s, y: y - s, width: 40 + ((p.id * 31 + k * 17) % 50), height: 8, color: rgb(0.1, 0.1, 0.1) })
        }
        if (p.extra) page.drawRectangle({ x: 200 + s, y: 24 - s, width: 150, height: 10, color: rgb(0.1, 0.1, 0.1) })
    }
    return doc.save()
}

export async function pageCountOf(path: string): Promise<number> {
    return (await PDFDocument.load(readFileSync(path))).getPageCount()
}
