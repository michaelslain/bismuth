// A pdf made of pages of the given widths (200 points tall), and the widths read back: a page is
// recognised by its width. Lives in core/test so suites outside core can reach pdf-lib.
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'

export async function pdfOfWidths(widths: number[]): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    for (const w of widths) doc.addPage([w, 200])
    return doc.save()
}

export async function widthsOf(path: string): Promise<number[]> {
    return (await PDFDocument.load(readFileSync(path))).getPages().map(p => Math.round(p.getWidth()))
}
