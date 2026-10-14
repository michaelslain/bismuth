// app/src/preview/pdfAnnotHighlights.test.ts
// Feeds pdfAnnotHighlights the annotation objects pdf.js 6.1.200 returns for
// core/test/drawing/fixtures/pdfkit-highlights.pdf (recorded once with pdfjs-dist under Bun:
// page.getAnnotations() on page 1, page.view [0,0,300,300], rotate 0).
import { readPdfHighlights } from '../../../core/src/drawing/pdfHighlights'
import { describe, expect, test } from 'bun:test'
import {
    hideHighlightPainting,
    loadHighlightDeps,
    highlightsFromAnnotations,
    type PdfAnnot,
    type PdfHighlightDeps,
    type PdfPageGeom,
} from './pdfAnnotHighlights'

const GEOM: PdfPageGeom = { view: [0, 0, 300, 300], rotate: 0 }

const RECORDED: PdfAnnot[] = [
    { subtype: 'Highlight', id: '8R', quadPoints: [50, 216, 170, 216, 50, 198, 170, 198], color: [255, 235, 59], opacity: 1 },
    { subtype: 'Highlight', id: '9R', quadPoints: [50, 216, 170, 216, 50, 198, 170, 198], color: [255, 235, 59], opacity: 1 },
    { subtype: 'Highlight', id: '10R', quadPoints: [50, 210.78030395507812, 167.48800659179688, 210.78030395507812, 50, 196.78030395507812, 167.48800659179688, 196.78030395507812], color: [255, 255, 0], opacity: 1 },
    { subtype: 'Highlight', id: '11R', quadPoints: [50, 210.78030395507812, 167.48800659179688, 210.78030395507812, 50, 196.78030395507812, 167.48800659179688, 196.78030395507812], color: [0, 255, 0], opacity: 1 },
    { subtype: 'Highlight', id: '12R', quadPoints: [50, 210.78030395507812, 167.48800659179688, 210.78030395507812, 50, 196.78030395507812, 167.48800659179688, 196.78030395507812], color: [0, 145, 255], opacity: 1 },
    { subtype: 'Highlight', id: '13R', quadPoints: [50, 210.78030395507812, 167.48800659179688, 210.78030395507812, 50, 196.78030395507812, 167.48800659179688, 196.78030395507812], color: [255, 55, 95], opacity: 1 },
    { subtype: 'Highlight', id: '14R', quadPoints: [50, 210.78030395507812, 167.48800659179688, 210.78030395507812, 50, 196.78030395507812, 167.48800659179688, 196.78030395507812], color: [219, 52, 242], opacity: 1 },
]

// Stand-ins that follow the header contract of core/src/drawing/pdfHighlights.ts. The real
// functions are exercised below whenever that module exists.
const fakeDeps: PdfHighlightDeps = {
    pdfHighlightId: (page, quads, color) =>
        `pdf-${page}-${color}-${Array.from(quads, q => Math.round(q * 2) / 2).join(',')}`,
    quadsToRects: quads => {
        const rects = []
        for (let i = 0; i + 7 < quads.length; i += 8) {
            const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]]
            const ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]]
            const x = Math.min(...xs)
            const y = Math.min(...ys)
            rects.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y })
        }
        return rects
    },
    rgbToHex: (rgb, scale) =>
        '#' +
        Array.from(rgb)
            .slice(0, 3)
            .map(v => Math.round(scale === 1 ? v * 255 : v).toString(16).padStart(2, '0'))
            .join(''),
}

describe('highlightsFromAnnotations', () => {
    test('every recorded /Highlight becomes one highlight with a hex colour and one rect', () => {
        const hs = highlightsFromAnnotations(RECORDED, 0, GEOM, fakeDeps)
        expect(hs).toHaveLength(RECORDED.length)
        expect(hs.map(h => h.c)).toEqual([
            '#ffeb3b',
            '#ffeb3b',
            '#ffff00',
            '#00ff00',
            '#0091ff',
            '#ff375f',
            '#db34f2',
        ])
        for (const h of hs) expect(h.rects).toHaveLength(1)
    })

    test('non-highlight annotations and quad-less highlights are skipped', () => {
        const hs = highlightsFromAnnotations(
            [
                { subtype: 'Ink', id: '1R' },
                { subtype: 'Link', id: '2R' },
                { subtype: 'Highlight', id: '3R', quadPoints: null, color: [255, 0, 0] },
                RECORDED[2],
            ],
            3,
            GEOM,
            fakeDeps,
        )
        expect(hs).toHaveLength(1)
        expect(hs[0].id).toContain('pdf-3-')
    })

    test('a highlight with no colour takes the default highlight yellow, as core does', () => {
        const [h] = highlightsFromAnnotations(
            [{ subtype: 'Highlight', quadPoints: RECORDED[0].quadPoints, color: null }],
            0,
            GEOM,
            fakeDeps,
        )
        expect(h.c).toBe('#ffe14d')
    })

    // The reader in core and this pdf.js-side conversion must agree on ids, colours and rects.
    test('with the real core functions: same seven highlights as readPdfHighlights', async () => {
        const { readFileSync } = await import('node:fs')
        const bytes = new Uint8Array(
            readFileSync(
                new URL(
                    '../../../core/test/drawing/fixtures/pdfkit-highlights.pdf',
                    import.meta.url,
                ),
            ),
        )
        const deps = await loadHighlightDeps()
        const mine = highlightsFromAnnotations(RECORDED, 0, GEOM, deps)
        const read = await readPdfHighlights(bytes)
        expect(mine).toHaveLength(7)
        // pdf.js hands quad points over as float32, pdf-lib reads the file's decimals: ids and
        // colours match exactly, rect numbers to well under a logical pixel.
        expect(mine.map(h => [h.id, h.c])).toEqual(read.pages[0].map(h => [h.id, h.c]))
        mine.forEach((h, i) => {
            h.rects.forEach((r, j) => {
                const o = read.pages[0][i].rects[j]
                for (const k of ['x', 'y', 'w', 'h'] as const) {
                    expect(Math.abs(r[k] - o[k])).toBeLessThan(0.001)
                }
            })
        })
    })
})

describe('hideHighlightPainting', () => {
    test('marks every highlight noView in the storage and nothing else', async () => {
        const set: [string, Record<string, unknown>][] = []
        const annots = await hideHighlightPainting(
            {
                getAnnotations: async () => [
                    ...RECORDED.slice(0, 2),
                    { subtype: 'Ink', id: '40R' },
                    { subtype: 'Stamp', id: '41R' },
                ],
            },
            { setValue: (k, v) => void set.push([k, v]) },
        )
        expect(annots).toHaveLength(4)
        expect(set).toEqual([
            ['8R', { noView: true }],
            ['9R', { noView: true }],
        ])
    })
})
