// app/src/ui/_pdfStoryFixtures.ts
// Shared PDF fixture helpers for stories that need a real pdf.js-renderable document (not a
// rasterized screenshot standing in for one) — extracted from PdfPages.stories.tsx's
// `buildThreePagePdf`/`inkedPct` so ExportView.stories.tsx can build the same kind of fixture
// without depending on that story file. PdfPages.stories.tsx keeps its own copies (out of this
// task's scope — see Task 3's report).
import { jsPDF } from 'jspdf'

/** Builds a real US-Letter PDF entirely in the browser: one page per entry, each with distinct
 *  vector text + a filled shape, so pdf.js has both real glyphs (for the text layer) and real ink
 *  (for the canvas raster) to render. */
export function buildLetterPdf(
    pages: { label: string; color: [number, number, number] }[],
): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    pages.forEach((page, i) => {
        if (i > 0) pdf.addPage('letter')
        pdf.setFontSize(32)
        pdf.text(page.label, 72, 100)
        pdf.setFillColor(page.color[0], page.color[1], page.color[2])
        pdf.rect(72, 140, 300, 140, 'F')
    })
    return pdf.output('arraybuffer')
}

/** Fraction of sampled pixels that differ from white (the PDF page background) — text glyphs and
 *  a filled rect both count as ink; an unrendered/blank canvas scores 0. ALPHA MATTERS: a canvas
 *  pdf.js never painted is transparent black (0,0,0,0), not white, so a pixel only counts when it
 *  is also actually painted (`alpha > 0`). */
export function inkedPct(canvas: HTMLCanvasElement): number {
    if (canvas.width === 0 || canvas.height === 0) return 0
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let painted = 0
    let sampled = 0
    for (let i = 0; i < data.length; i += 16) {
        sampled++
        const alpha = data[i + 3]
        if (
            alpha !== undefined &&
            alpha > 0 &&
            (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255)
        ) {
            painted++
        }
    }
    return sampled ? painted / sampled : 0
}
