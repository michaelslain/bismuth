// The page-render golden the design asked for: render a fixture note carrying BOTH an attached
// annotation and a standalone drawing, then assert non-trivial ink coverage AND correct ink
// position relative to a known text baseline.
//
// This is the test whose absence let `bismuth export` ship drawings as walls of base64. Its
// predecessor (core/test/render/htmlRaster.test.ts) asserts PNG/PDF magic bytes and a length
// over 1000 — both of which a document that renders every drawing as a grey code block passes
// with room to spare. Bytes came out; nothing was looked at.
//
// It lives in cli/ rather than core/ for a mechanical reason: it drives the WHOLE export path
// (app/src/export/exporters.ts over the CLI's own headless deps), and cli/tsconfig.json is the
// one workspace already set up for that bridge — core's program carries no DOM lib and cannot
// type-check the app exporter it would have to import.
//
// It renders PNG, not PDF, because a PNG is a raster this process can read back pixel by pixel;
// the PDF path shares every step before the final CDP call. Registered as a SLOW suite
// (core/test/slowGate.ts) exactly like htmlRaster.test.ts, since it launches a real Chrome.
import { describe, expect, test } from 'bun:test'
import { shouldRunSlowTests } from '../../core/test/slowGate'
import {
    bands,
    extent,
    readPage,
    total,
    type Page,
} from '../../core/test/render/pageInk'
import { encodeStrokes } from '../../core/src/drawing/inkCodec'
import { parseDoc, type Stroke } from '../../core/src/drawing/model'
import { renderDocToPng } from '../../core/src/drawing/export'
import {
    htmlToPdfHeadless,
    htmlToPngHeadless,
    htmlToPdfPagesHeadless,
} from '../../core/src/render/htmlRaster'
import { renderExport } from '../../app/src/export/exporters'
import type { ExportDeps } from '../../app/src/export/types'

// A saturated ink colour, so ink is separable from the near-neutral paper and text of the
// "paper" theme (#E9E6E0 on #2E2C29) by CHROMA alone. Every assertion below rests on telling
// the two apart; a 'fg' stroke would be the same colour as the words it is drawn on.
const INK = '#e6007a'

function squiggle(x0: number, x1: number, y: number, amp: number): Stroke {
    const pts: number[] = []
    for (let i = 0; i <= 40; i++) {
        const t = i / 40
        pts.push(
            Math.round(x0 + (x1 - x0) * t),
            Math.round(y + amp * Math.sin(t * Math.PI * 3)),
            200,
        )
    }
    return { t: 'pen', c: INK, w: 3, pts }
}

const straight = (x0: number, y0: number, x1: number, y1: number): Stroke => ({
    t: 'pen',
    c: INK,
    w: 5,
    straight: true,
    pts: [x0, y0, 220, x1, y1, 220],
})

// The annotation: a squiggle across the paragraph's ONE line. Attached y is unscaled pixels
// below the block's top and the exported line box is 22px tall, so y 6..16 lands on the glyphs.
const ANNOTATION = [squiggle(30, 560, 11, 5)]
// The drawing: a big X, stored the way writeBand normalizes one — its top exactly
// STANDALONE_PAD (24) below the widget top.
const SKETCH = [straight(90, 24, 560, 260), straight(560, 24, 90, 260)]

// Order matters to the assertions: the standalone drawing sits BETWEEN the h1 and the annotated
// paragraph, and the h2 below opens a 22px gap. That leaves the annotated paragraph the only
// text in its own band, bounded above and below by text-free space — which is what makes "the
// annotation drifted one line" a FAILURE rather than a landing on some other paragraph.
const NOTE = [
    '# Ink golden',
    '',
    '```draw block',
    encodeStrokes(SKETCH),
    '```',
    '',
    'The mitochondria is the powerhouse of the cell.',
    '```draw',
    encodeStrokes(ANNOTATION),
    '```',
    '',
    '## After',
    '',
    // Long enough to WRAP at both widths, deliberately. This trailing paragraph is the test's
    // ruler: a wrapped paragraph's widest line reaches both edges of the reading column, so its
    // extent tracks the column at any width. A single short sentence would not — its ink would be
    // its own natural width and identical in both renders. The page FOOTER used to serve as the
    // ruler incidentally (one flex row justified space-between, touching both edges exactly) and
    // has since been removed from exports, which is what left this test without a probe.
    // ONE source line, deliberately: the renderer runs with breaks:true, so separate lines here
    // would become hard <br> breaks at their own natural widths instead of a paragraph that wraps.
    'Tail paragraph so the note does not end on the annotation, written as a single long line so that it actually wraps at the full reading column as well as at the deliberately narrow one, which is what makes its widest line reach both edges of whichever column it is set in.',
    '',
].join('\n')

const deps: ExportDeps = {
    read: async () => NOTE,
    resolveRows: async () => [],
    htmlToPdf: htmlToPdfHeadless,
    htmlToPdfPages: htmlToPdfPagesHeadless,
    htmlToPng: htmlToPngHeadless,
    katexCss: async () => '',
    drawingToPng: async (docText, theme, box) => {
        const bytes = await renderDocToPng(parseDoc(docText), theme, box)
        return {
            bytes,
            dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
        }
    },
}

// Launches a real headless Chrome, so this is gated as a SLOW suite (see core/test/slowGate.ts):
// the pre-commit gate skips it for latency; pre-push and CI run it in full.
const describeOrSkipSlow = shouldRunSlowTests(process.env)
    ? describe
    : describe.skip

/** The annotation band, the glyph band of the paragraph it annotates, and the ink's horizontal
 *  span across that paragraph — everything the position assertions compare. The paragraph is
 *  found STRUCTURALLY (the first prose line below the standalone drawing), never from where the
 *  ink happened to land, so a misplaced annotation cannot drag the reference along with it. */
function locate(page: Page) {
    const inkBands = bands(page.inkRows, 6)
    const [sketch, annotation] = inkBands
    const paragraph = bands(page.textRows, 4).find(b => b.from > sketch.to)
    if (!paragraph)
        throw new Error('no prose found below the standalone drawing')
    return {
        inkBands,
        sketch,
        annotation,
        paragraph,
        words: extent(page, page.text, paragraph),
        ink: extent(page, page.ink, paragraph),
        /** Where the annotation's centre sits relative to the TOP of the words it annotates.
         *  This is the number the coordinate contract is about, and it must not move when the
         *  reading column changes width. */
        offset:
            Math.round((annotation.from + annotation.to) / 2) - paragraph.from,
        /** The reading column's own width, MEASURED off the page rather than recomputed from the
         *  export stylesheet. The probe is the note's LAST text band — a deliberately long
         *  trailing paragraph that wraps at every width, so `extent`'s min-x0/max-x1 across its
         *  rows lands on both column edges.
         *
         *  This used to read the page FOOTER, which sat last and spanned the column exactly. That
         *  footer has been removed from exports (it always read "1 / 1" regardless of the real
         *  page count), and its removal is what made this measurement meaningless — it silently
         *  returned the same number for both renders and the failure pointed at the code under
         *  test rather than at its instrument. */
        column: (() => {
            const text = bands(page.textRows, 4)
            const tail = extent(page, page.text, text[text.length - 1])
            return tail.x1 - tail.x0
        })(),
    }
}

describeOrSkipSlow('note page render, with ink', () => {
    let page: Page
    /** The same exported document at a deliberately narrow reading column. The PNG path's own
     *  column (712px) sits within 5% of the 680px logical column, so it can barely tell a
     *  correctly asymmetric placement from a wholly uniform one; the PDF's is 576px and a
     *  browser window can be anything. Rendering the SAME document at ~372px is what makes the
     *  asymmetry measurable here rather than only in the PDF nobody asserts on. */
    let narrow: Page

    test('renders the note to a PNG page', async () => {
        const res = await renderExport('Golden.md', 'png', deps, 'light')
        expect(Array.from(res.bytes.slice(0, 4))).toEqual([
            0x89, 0x50, 0x4e, 0x47,
        ])
        page = await readPage(res.bytes)

        const doc = new TextDecoder().decode(
            (await renderExport('Golden.md', 'html', deps, 'light')).bytes,
        )
        const shot = await htmlToPngHeadless(
            doc.replace(
                '</head>',
                '<style>body{max-width:420px}</style></head>',
            ),
        )
        narrow = await readPage(shot.bytes)
    }, 120_000)

    test('the page carries non-trivial ink, not a base64 code block', () => {
        // The whole defect this closes: before it, a note's drawings exported as text. A page of
        // code-block base64 has ZERO chromatic pixels, so any positive threshold catches it —
        // this one is set well above stray antialiasing.
        expect(total(page.ink)).toBeGreaterThan(5000)
    })

    test('the drawing and the annotation are two separate marks on the page', () => {
        expect(bands(page.inkRows, 6)).toHaveLength(2)
    })

    test('the standalone drawing sits in a band of its own, reserving its height', () => {
        const { sketch } = locate(page)
        // No text anywhere in the drawing's rows: it reserved space in the flow rather than
        // painting over the prose. (An attached fence rendered standalone by mistake — or a
        // standalone one that reserved nothing — would put words here.)
        expect(extent(page, page.text, sketch).count).toBe(0)
        // …and there IS prose above it, so the drawing did not simply swallow the document.
        const above = bands(page.textRows, 4).filter(b => b.to < sketch.from)
        expect(above.length).toBeGreaterThan(0)
    })

    test('the annotation sits ON the words of the paragraph it annotates', () => {
        const here = locate(page)

        // Vertical: the annotation's centre must fall INSIDE that paragraph's own glyph rows.
        // The paragraph band is ~13 CSS px tall and a line is 22, so ink that drifted by even
        // one line — the exact failure a bottom anchor or a scaled y produces — lands outside.
        expect(here.offset).toBeGreaterThanOrEqual(0)
        expect(here.offset).toBeLessThanOrEqual(
            here.paragraph.to - here.paragraph.from,
        )

        // Horizontal: on its WORDS, not merely on its line. The annotation must cover most of
        // the span the glyphs occupy — which only holds if x was scaled by the export column's
        // own width rather than left in the 680px logical column or guessed at.
        const { words, ink } = here
        expect(ink.count).toBeGreaterThan(1500)
        const overlap = Math.min(ink.x1, words.x1) - Math.max(ink.x0, words.x0)
        expect(overlap / (words.x1 - words.x0)).toBeGreaterThan(0.6)
    })

    test('a narrower column scales the annotation across, and NOT down', () => {
        const wide = locate(page)
        const thin = locate(narrow)

        // The annotation still lands on its words at the new width — the same containment as
        // above, re-asserted where a uniform scale would actually show.
        expect(thin.annotation.from).toBeGreaterThanOrEqual(
            thin.paragraph.from - 6,
        )
        expect(thin.annotation.to).toBeLessThanOrEqual(thin.paragraph.to + 6)

        // x IS scaled by the column: the annotation spans the same FRACTION of a column half
        // the size, so its absolute width shrinks with it. Left in the 680px logical column it
        // would not move at all and would run off the end of its own paragraph. (The words
        // themselves are NOT the reference here — a narrower column REFLOWS the sentence, so
        // the line's text width tracks the column rather than the sentence.)
        const columns = thin.column / wide.column
        const inks = (thin.ink.x1 - thin.ink.x0) / (wide.ink.x1 - wide.ink.x0)
        expect(columns).toBeLessThan(0.8) // the narrow render really is narrower
        expect(Math.abs(inks - columns)).toBeLessThan(0.08)

        // y is NOT: the annotation sits the same number of pixels below its words' top edge at
        // both widths. Scaling y with the column — the bug the whole coordinate contract exists
        // to prevent — moves this by (1 - columns) of the offset, growing with distance down a
        // block until an annotation lands a line or more above its words.
        expect(Math.abs(thin.offset - wide.offset)).toBeLessThanOrEqual(4)
    })
})
