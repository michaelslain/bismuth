// app/src/preview/PdfPages.stories.tsx
// Visual spec for <PdfPages> — the pdf.js page-stack renderer that replaced PreviewView's
// `<iframe>` PDF embed. `load()` is a DATA SEAM specifically so a story never touches `/asset`
// (the fake transport's base is `fake://storybook`, which an `<iframe src>`/`<img src>` could
// never load) — instead a REAL 3-page PDF is generated in-browser with jspdf (already a
// dependency; see export/htmlToPdf.ts for the app's other jsPDF user) and handed over as bytes.
//
// WHY THE PLAY SAMPLES CANVAS PIXELS, NOT JUST THE DOM: a blank `<canvas>` has exactly the same
// DOM shape as a fully-painted one (same tag, same width/height attributes) — the same trap
// documented in editor/InkOverlay.stories.tsx. So `inkedPct` below reads the canvas's actual
// pixel data and reports the fraction that differs from the PDF's white page background; a
// "canvas count > 0" assertion alone would pass even if pdf.js never rendered anything.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { jsPDF } from 'jspdf'
import PdfPages from './PdfPages'
import type { PageBox, PageSize } from './pageLayout'

const meta = {
    title: 'Preview/PdfPages',
    component: PdfPages,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PdfPages>

export default meta
type Story = StoryObj<typeof meta>

/** Builds a real 3-page US-Letter PDF entirely in the browser: distinct vector text + a filled
 *  shape per page, so pdf.js has both real glyphs (for the text layer) and real ink (for the
 *  canvas raster) to render — not a rasterized screenshot standing in for a PDF. */
function buildThreePagePdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    const pages: { label: string; color: [number, number, number] }[] = [
        { label: 'Page one', color: [200, 60, 60] },
        { label: 'Page two', color: [60, 140, 60] },
        { label: 'Page three', color: [60, 60, 200] },
    ]
    pages.forEach((page, i) => {
        if (i > 0) pdf.addPage('letter')
        pdf.setFontSize(32)
        pdf.text(page.label, 72, 100)
        pdf.setFillColor(page.color[0], page.color[1], page.color[2])
        pdf.rect(72, 140, 300, 140, 'F')
    })
    return pdf.output('arraybuffer')
}

// Built once per story-file load, not per story render — jspdf output is deterministic and
// generating it is pure overhead to repeat. `getDocument()` detaches the ArrayBuffer it's
// handed, so `load()` below always returns a fresh COPY of these bytes rather than the same
// (potentially already-detached) buffer.
let pdfBytes: ArrayBuffer | undefined
async function load(): Promise<ArrayBuffer> {
    pdfBytes ??= buildThreePagePdf()
    return pdfBytes.slice(0)
}

/** Fraction of sampled pixels that differ from white (the PDF page background) — text glyphs
 *  and the filled rect both count as ink; an unrendered/blank canvas scores 0. Samples every
 *  4th pixel (16 bytes) rather than every pixel — plenty for a fraction estimate on a full-page
 *  canvas, far cheaper to read.
 *
 *  ALPHA MATTERS: a canvas pdf.js never painted is transparent BLACK (0,0,0,0), not white — its
 *  RGB differs from white just as much as real ink does, so a check that only compares RGB scores
 *  a blank canvas as ~100% inked (chunk-1 review finding). A pixel only counts when it is also
 *  actually painted (`alpha > 0`). */
function inkedPct(canvas: HTMLCanvasElement): number {
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

/** Rest state: all 3 pages laid out, at least one page's canvas actually painted with real
 *  pixels (not just present in the DOM). */
export const Default: Story = {
    render: () => (
        <div style={{ height: '640px' }}>
            <PdfPages load={load} zoom={1} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(
            () =>
                expect(
                    canvasElement.querySelectorAll('[data-pdf-page]').length,
                ).toBe(3),
            { timeout: 5000 },
        )
        await waitFor(
            () => {
                const canvases = Array.from(
                    canvasElement.querySelectorAll('canvas'),
                ) as HTMLCanvasElement[]
                expect(canvases.length).toBeGreaterThan(0)
                const anyInked = canvases.some(c => inkedPct(c) > 0)
                expect(anyInked).toBe(true)
            },
            { timeout: 5000 },
        )
    },
}

/** Boxes from the most recent `onLayout` call — module-level (not component state) so `play()`
 *  can read them directly, the same `let` + reset-per-story pattern PreviewView.stories.tsx uses
 *  for its `opened` callback log. */
let lastBoxes: PageBox[] = []
const onLayout = (l: { boxes: PageBox[]; sizes: PageSize[] }) => {
    lastBoxes = l.boxes
}

/** `zoom` is the whole point of PdfPages' contract with PreviewView's ViewBar −/+/FIT controls
 *  and Ctrl/Cmd+wheel — this exercises it directly: going from zoom 1 to zoom 2 must double the
 *  first page's box width, proving `layoutPages`' fit-width math is actually wired through the
 *  `zoom` prop (not just internal state pdf.js happens to remember). Reads the boxes via
 *  `onLayout`, the same callback Task 5 uses to position its own per-page ink canvases. */
/** A trivial marker component that counts its own creations — proves PdfPages resolves
 *  `overlay` exactly once (fix 2). `props.overlay` compiles to a GETTER for an inline JSX value
 *  (`overlay={<X/>}`), and reading a getter prop twice — once for `<Show when>`, once for the
 *  insert — used to create TWO instances of X, each mounting and running its own effects (this
 *  is exactly how PreviewView hands PageInk to PdfPages, so an inline element here reproduces
 *  the real call shape rather than hiding the bug behind a stable variable). */
let overlayMounts = 0
function OverlayMarker() {
    overlayMounts++
    return <div data-testid="overlay-marker">ink</div>
}

export const OverlayMountsOnce: Story = {
    render: () => {
        overlayMounts = 0
        return (
            <div style={{ height: '640px' }}>
                <PdfPages load={load} zoom={1} overlay={<OverlayMarker />} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(
                    canvasElement.querySelectorAll(
                        '[data-testid="overlay-marker"]',
                    ).length,
                ).toBe(1)
            },
            { timeout: 5000 },
        )
        await expect(overlayMounts).toBe(1)
    },
}

export const ZoomDoublesPageWidth: Story = {
    render: () => {
        lastBoxes = []
        const [zoom, setZoom] = createSignal(1)
        return (
            // Fixed, narrow width (not the fullscreen default) so the zoomed-in page — which is
            // SUPPOSED to render wider than its own scroll container, that's the point of zoom
            // — still fits under bench/invariants.ts's 1280px viewport check rather than
            // tripping its generic "overflows-viewport-x" rule. `.pdf-scroll` provides its own
            // horizontal scrollbar for the overflow either way; this only changes how big that
            // overflow reads against the story's OUTER frame, not PdfPages' real behavior.
            <div style={{ height: '640px', width: '480px' }}>
                <button
                    type="button"
                    data-testid="pdfpages-zoom-2x"
                    onClick={() => setZoom(2)}
                >
                    zoom 2x
                </button>
                <div style={{ height: '600px' }}>
                    <PdfPages load={load} zoom={zoom()} onLayout={onLayout} />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(lastBoxes.length).toBe(3)
                expect(lastBoxes[0]!.w).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )
        const widthAtZoom1 = lastBoxes[0]!.w

        const button = canvasElement.querySelector(
            '[data-testid="pdfpages-zoom-2x"]',
        ) as HTMLButtonElement
        button.click()

        await waitFor(
            () => {
                expect(lastBoxes[0]!.w).toBeCloseTo(widthAtZoom1 * 2, 1)
            },
            { timeout: 5000 },
        )
    },
}
