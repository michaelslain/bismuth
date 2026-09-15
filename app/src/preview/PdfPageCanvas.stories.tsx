// app/src/preview/PdfPageCanvas.stories.tsx
// Behavioural spec for <PdfPageCanvas> — one rendered PDF page (raster canvas + pdf.js text
// layer), extracted from PdfPages.tsx. Mounted DIRECTLY here (not via <PdfPages>) so the `box`
// prop driving its re-render effect can be a hand-built signal that isolates exactly the
// regression chunk-1 review found: `props.box` is <Index>'s item signal, and PdfPages' real
// layout memo hands back a BRAND NEW box object on every recompute even when a page's own
// width/height haven't changed (only e.g. an earlier page's height shifting this one's `top`) —
// `on([w, h])` with no equality check re-ran `run()` on every one of those, cancelling the
// in-flight render and rebuilding the text layer (which would wipe a live text selection) even
// though the header comment claims a top-only move "keeps its raster as-is". A plain
// `createSignal` reproduces that exact shape without needing <PdfPages>' own layout machinery.
//
// REAL pdf.js, REAL page: loaded through the same pdfjsSetup.ts PdfPages itself uses, off a real
// one-page PDF built in-browser with jspdf (matching every other story in this directory) —
// faking pdf.js's render/TextLayer surface would either be wrong or duplicate real behaviour
// badly. The only test-side instrumentation is wrapping the real page's OWN `render` method to
// count calls; nothing in PdfPageCanvas.tsx changes for this.
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { jsPDF } from 'jspdf'
import PdfPageCanvas from './PdfPageCanvas'
import type { PageBox } from './pageLayout'

const meta = {
    title: 'Preview/PdfPageCanvas',
    component: PdfPageCanvas,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PdfPageCanvas>

export default meta
type Story = StoryObj<typeof meta>

function buildOnePagePdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    pdf.setFontSize(32)
    pdf.text('One page', 72, 100)
    return pdf.output('arraybuffer')
}

type Ready = {
    pdfjs: typeof import('pdfjs-dist')
    page: import('pdfjs-dist').PDFPageProxy
}

let renderCalls = 0

/** A real pdf.js page (via the app's own pdfjsSetup.ts — exactly what PdfPages uses), with its
 *  OWN `render` wrapped to count calls. This is the only way to observe how many times
 *  PdfPageCanvas's effect actually re-ran without changing PdfPageCanvas.tsx itself. */
async function realPageCountingRenders(): Promise<Ready> {
    const { pdfjs } = await import('./pdfjsSetup')
    const doc = await pdfjs.getDocument({ data: buildOnePagePdf() }).promise
    const page = await doc.getPage(1)
    const originalRender = page.render.bind(page)
    page.render = params => {
        renderCalls++
        return originalRender(params)
    }
    return { pdfjs, page }
}

const START: PageBox = { top: 0, left: 0, w: 300, h: 400, marginW: 0 }

/** A layout recompute that only MOVES the page (a fresh box object, same w/h) must not
 *  re-rasterize it — the invariant the header comment claims. A genuine size change still must.
 *  Counting `page.render` calls proves this numerically instead of eyeballing a screenshot. */
export const TopOnlyMoveKeepsRaster: Story = {
    render: () => {
        renderCalls = 0
        const [box, setBox] = createSignal<PageBox>(START)
        const [ready, setReady] = createSignal<Ready>()
        void realPageCountingRenders().then(setReady)
        return (
            <div style={{ position: 'relative', width: '300px', height: '400px' }}>
                <Show when={ready()}>
                    <PdfPageCanvas
                        index={0}
                        box={box()}
                        getPage={() => ready()!.page}
                        pdfjs={() => ready()!.pdfjs}
                    />
                </Show>
                <button
                    type="button"
                    data-testid="move-only"
                    onClick={() => setBox(b => ({ ...b, top: b.top + 50 }))}
                >
                    move
                </button>
                <button
                    type="button"
                    data-testid="resize"
                    onClick={() => setBox(b => ({ ...b, w: b.w + 40 }))}
                >
                    resize
                </button>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(renderCalls).toBe(1), { timeout: 5000 })

        const moveButton = canvasElement.querySelector(
            '[data-testid="move-only"]',
        ) as HTMLButtonElement
        moveButton.click()
        // A real chance for a wrongly-scheduled re-render to happen before asserting it didn't —
        // `run()` itself awaits pdf.js's render task, so a false positive here would still show
        // up well within this window.
        await new Promise(r => setTimeout(r, 300))
        expect(renderCalls).toBe(1)

        // A genuine width change still triggers a real re-render — the fix must not overcorrect
        // into never re-rendering at all.
        const resizeButton = canvasElement.querySelector(
            '[data-testid="resize"]',
        ) as HTMLButtonElement
        resizeButton.click()
        await waitFor(() => expect(renderCalls).toBe(2), { timeout: 5000 })
    },
}
