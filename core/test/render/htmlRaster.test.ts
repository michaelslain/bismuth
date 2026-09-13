import { describe, expect, test } from 'bun:test'
import { htmlToPdfHeadless, htmlToPngHeadless } from '../../src/render/htmlRaster'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { samplePdfPixels } from './pdfPixels'
import { shouldRunSlowTests } from '../slowGate'

const html = '<html><body><h1>Hello</h1><table><tr><td>a</td><td>b</td></tr></table></body></html>'

// Launches a real headless Chrome, so this is gated as a SLOW suite (see slowGate.ts): the
// pre-commit gate skips it for latency; pre-push and CI still run it in full.
const describeOrSkipSlow = shouldRunSlowTests(process.env) ? describe : describe.skip

describeOrSkipSlow('htmlRaster', () => {
    test('produces a real PDF', async () => {
        const bytes = await htmlToPdfHeadless(html)
        expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
        expect(bytes.length).toBeGreaterThan(1000)
    }, 60_000)

    test('produces a real PNG', async () => {
        const { bytes } = await htmlToPngHeadless(html)
        expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    }, 60_000)

    // A document PAST THE data: URL LENGTH LIMIT. loadHtml used to navigate to
    // `data:text/html;base64,<the whole document>`, which worked only while export documents were
    // small. Once they began embedding their own font faces — the prose and mono woff2 files plus
    // KaTeX's, ~2 MB before base64 inflates it by a third — Chrome silently refused to navigate:
    // no error, no navigation, and the load event simply never arrived, so every export died on
    // the 30s timeout with nothing pointing at the size. The existing cases above could not catch
    // it because their document is one line long.
    test('renders a document far larger than a data: URL can carry', async () => {
        // ~3 MB of real markup, comfortably past the limit that broke the data-URL path.
        const filler = '<p>' + 'x'.repeat(120) + '</p>\n'
        const big = `<html><body><h1>Big</h1>${filler.repeat(25_000)}</body></html>`
        expect(big.length).toBeGreaterThan(3_000_000)
        const bytes = await htmlToPdfHeadless(big)
        expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
        expect(bytes.length).toBeGreaterThan(1000)
    }, 120_000)

    // A printed page's MARGIN AREA is not covered by the root background, so a dark export came
    // out two-tone: Chrome's own color-scheme canvas showing as a near-black frame around a
    // slightly-lighter column of text. htmlTemplate fixes it with a background on the @page rule.
    //
    // THIS ASSERTS ON RENDERED PIXELS, NOT THE CONTENT STREAM, and that distinction is the whole
    // point. The first attempt at this fix was a position:fixed bleed layer; it put a full-sheet
    // fill rectangle on every page, a content-stream check went green, and the output was
    // completely unchanged because the fill is clipped to the page box. Only rasterising the PDF
    // and sampling a margin pixel caught it.
    test('the page margin is painted the same colour as the content area', async () => {
        const bg = '#15161A'
        const doc = `<html><head><style>
            :root { color-scheme: dark; }
            @page { size: 8.5in 11in; margin: 1in; background: ${bg}; }
            html, body { margin: 0; background: ${bg}; }
          </style></head><body>${'<p>xxxxxxxxxxxx</p>'.repeat(150)}</body></html>`
        const pdf = await htmlToPdfHeadless(doc)
        const path = join(tmpdir(), `raster-bg-${Date.now()}.pdf`)
        writeFileSync(path, pdf)
        try {
            // Chrome renders the PDF in its own viewer; sample the margin against the content.
            const px = await samplePdfPixels(path, [
                [600, 90], // page margin, above the text column
                [600, 400], // inside the text column
            ])
            expect(px[0]).toEqual(px[1])
        } finally {
            rmSync(path, { force: true })
        }
    }, 120_000)
})
