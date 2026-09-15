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
import type { OutlineNode, PdfPagesController } from './annotationTypes'
import type { PageBox, PageSize } from './pageLayout'
import { DEFAULT_MARGIN_RATIO } from '../../../core/src/drawing/pageMargin'
import { PDF_PAGE_PAPER } from '../../../core/src/theme/tokens'

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

/** The first page's canvas — the row survives a re-layout, so this is the element to watch. */
function firstCanvas(root: HTMLElement): HTMLCanvasElement | null {
    return root.querySelector('[data-pdf-page="0"] canvas')
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()))

/** Parses a `getComputedStyle(...).backgroundColor` string (`rgb(...)`/`rgba(...)`) into channels,
 *  falling back to white for anything unparseable. */
function parseRgb(color: string): [number, number, number] {
    const m = color.match(/rgba?\(([^)]+)\)/)
    if (!m) return [255, 255, 255]
    const parts = m[1]!.split(',').map(s => parseFloat(s.trim()))
    return [parts[0] ?? 255, parts[1] ?? 255, parts[2] ?? 255]
}

/** Parses a `#RRGGBB` literal (a tokens.ts constant, not a computed style) into channels. */
function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.replace('#', ''), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Samples one canvas pixel's RGB (ignoring alpha) — used to compare the margin's fill against an
 *  actual blank corner of the rendered PDF page, not an assumed literal. */
function sampleCanvasPixel(
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
): [number, number, number] {
    const ctx = canvas.getContext('2d')!
    const d = ctx.getImageData(x, y, 1, 1).data
    return [d[0] ?? 255, d[1] ?? 255, d[2] ?? 255]
}

/** Margin paper at the default ratio: every page gets a `data-pdf-margin` sibling area just past
 *  its right edge, sized `w * DEFAULT_MARGIN_RATIO`, the pages themselves still paint, and the
 *  margin reads as a continuation of the page rather than a mismatched surface (acceptance 1+2 of
 *  the page-surface polish task: the margin samples as the same white as the page itself, and the
 *  default ratio holds page-width / (page+margin width) = 1/1.4). */
export const WithMargin: Story = {
    render: () => {
        lastBoxes = []
        return (
            <div style={{ height: '640px' }}>
                <PdfPages
                    load={load}
                    zoom={1}
                    marginRatio={DEFAULT_MARGIN_RATIO}
                    onLayout={onLayout}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () =>
                expect(
                    canvasElement.querySelectorAll('[data-pdf-margin]').length,
                ).toBe(3),
            { timeout: 5000 },
        )
        const box = lastBoxes[0]!
        await expect(box.marginW).toBeCloseTo(box.w * DEFAULT_MARGIN_RATIO, 3)
        const pageEl = canvasElement.querySelector(
            '[data-pdf-page="0"]',
        ) as HTMLElement
        const marginEl = canvasElement.querySelector(
            '[data-pdf-margin="0"]',
        ) as HTMLElement
        const page = pageEl.getBoundingClientRect()
        const margin = marginEl.getBoundingClientRect()
        await expect(margin.width).toBeCloseTo(
            page.width * DEFAULT_MARGIN_RATIO,
            0,
        )
        await expect(margin.height).toBeCloseTo(page.height, 0)
        await expect(margin.left).toBeCloseTo(page.right, 0)

        // Acceptance 2: with the default margin, page width / (page + margin width) = 1/1.4,
        // within 1px.
        const totalWidth = page.width + margin.width
        await expect(
            Math.abs(page.width - totalWidth / 1.4),
        ).toBeLessThanOrEqual(1)

        await waitFor(
            () => {
                const c = firstCanvas(canvasElement)
                expect(c && inkedPct(c)).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )

        // Acceptance 1: the margin's fill matches a sampled blank area of the rendered PDF page —
        // both read as the same white, within 2 per channel — so the margin reads as a
        // continuation of the page rather than a mismatched surface.
        const marginRgb = parseRgb(getComputedStyle(marginEl).backgroundColor)
        const canvas = firstCanvas(canvasElement)!
        const blankRgb = sampleCanvasPixel(canvas, 2, 2) // page's top-left corner: no text/shape there
        for (let i = 0; i < 3; i++) {
            expect(
                Math.abs(marginRgb[i]! - blankRgb[i]!),
                `channel ${i}: margin ${marginRgb[i]} vs page ${blankRgb[i]}`,
            ).toBeLessThanOrEqual(2)
        }
        // And both are actually the PDF page's own white (PDF_PAGE_PAPER), not merely equal to
        // each other by coincidence.
        const paperRgb = hexToRgb(PDF_PAGE_PAPER)
        for (const rgb of [marginRgb, blankRgb]) {
            for (let i = 0; i < 3; i++) {
                expect(Math.abs(rgb[i]! - paperRgb[i]!)).toBeLessThanOrEqual(2)
            }
        }
    },
}

/** NO BLANK FLASH: turning the margin on and zooming both resize every page. The page's row —
 *  and so its canvas — must survive (the SAME element), keep its old raster painted in the very
 *  same tick the new layout lands and on the next painted frame, and then pick up the new
 *  resolution once pdf.js re-renders. Recreating the row (the old keyed `<For>`) hands back a
 *  fresh 300x150 transparent canvas here, which scores 0 on `inkedPct`. */
export const ReflowKeepsRaster: Story = {
    render: () => {
        lastBoxes = []
        const [ratio, setRatio] = createSignal(0)
        const [zoom, setZoom] = createSignal(1)
        return (
            <div style={{ height: '640px', width: '600px' }}>
                <button
                    type="button"
                    data-testid="pdfpages-margin-on"
                    onClick={() => setRatio(0.5)}
                >
                    margin
                </button>
                <button
                    type="button"
                    data-testid="pdfpages-zoom-half"
                    onClick={() => setZoom(0.5)}
                >
                    zoom 0.5x
                </button>
                <div style={{ height: '600px' }}>
                    <PdfPages
                        load={load}
                        zoom={zoom()}
                        marginRatio={ratio()}
                        onLayout={onLayout}
                    />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const dpr = window.devicePixelRatio || 1
        await waitFor(
            () => {
                const c = firstCanvas(canvasElement)
                expect(c && inkedPct(c)).toBeGreaterThan(0)
                expect(c!.width).toBe(Math.round(lastBoxes[0]!.w * dpr))
            },
            { timeout: 5000 },
        )

        const step = async (
            testid: string,
            expectW: (prev: number) => number,
        ) => {
            const before = firstCanvas(canvasElement)!
            const prevW = lastBoxes[0]!.w
            ;(
                canvasElement.querySelector(
                    `[data-testid="${testid}"]`,
                ) as HTMLButtonElement
            ).click()
            // Same tick: the layout has already moved on…
            await expect(lastBoxes[0]!.w).toBeCloseTo(expectW(prevW), 1)
            // …but the page is the same element, still painted.
            const now = firstCanvas(canvasElement)
            await expect(now).toBe(before)
            await expect(inkedPct(now!)).toBeGreaterThan(0)
            await nextFrame()
            await expect(firstCanvas(canvasElement)).toBe(before)
            await expect(inkedPct(before)).toBeGreaterThan(0)
            // …and the re-render at the new size lands, painted.
            await waitFor(
                () => {
                    expect(before.width).toBe(Math.round(lastBoxes[0]!.w * dpr))
                    expect(inkedPct(before)).toBeGreaterThan(0)
                },
                { timeout: 5000 },
            )
        }
        await step('pdfpages-margin-on', w => w / 1.5)
        await step('pdfpages-zoom-half', w => w / 2)
    },
}

let controller: PdfPagesController | undefined
let currentPages: number[] = []
let pageCount = -1
let lastOutline: OutlineNode[] | undefined
let scrollEl: HTMLElement | undefined

/** The navigation seams: the controller is handed over as soon as the scroll element exists and
 *  asked to jump to page 2 right away — BEFORE the first measurement, which must be held and
 *  applied, not dropped at scrollTop 0. The button then jumps to page 3. `onCurrentPage` follows
 *  both jumps, `onPageCount` reports 3, and this plain PDF's `onOutline` is `[]`. */
export const ScrollToPage: Story = {
    render: () => {
        lastBoxes = []
        controller = undefined
        currentPages = []
        pageCount = -1
        lastOutline = undefined
        scrollEl = undefined
        return (
            <div style={{ height: '640px', width: '640px' }}>
                <button
                    type="button"
                    data-testid="pdfpages-jump-3"
                    onClick={() => controller?.scrollToPage(2)}
                >
                    page 3
                </button>
                <div style={{ height: '600px' }}>
                    <PdfPages
                        load={load}
                        zoom={1}
                        onLayout={l => {
                            lastBoxes = l.boxes
                            scrollEl = l.scrollEl
                        }}
                        controller={c => {
                            controller = c
                            c.scrollToPage(1)
                        }}
                        onCurrentPage={i => currentPages.push(i)}
                        onPageCount={n => (pageCount = n)}
                        onOutline={o => (lastOutline = o)}
                    />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(lastBoxes.length).toBe(3)
                expect(lastBoxes[0]!.h).toBeGreaterThan(0)
                expect(scrollEl!.scrollTop).toBeCloseTo(lastBoxes[1]!.top, 0)
                expect(currentPages.at(-1)).toBe(1)
            },
            { timeout: 5000 },
        )
        await expect(pageCount).toBe(3)

        ;(
            canvasElement.querySelector(
                '[data-testid="pdfpages-jump-3"]',
            ) as HTMLButtonElement
        ).click()
        await waitFor(
            () => {
                expect(scrollEl!.scrollTop).toBeCloseTo(lastBoxes[2]!.top, 0)
                expect(currentPages.at(-1)).toBe(2)
            },
            { timeout: 5000 },
        )
        // fires on change only — no repeats of the same index back to back
        await expect(
            currentPages.every((p, i) => i === 0 || p !== currentPages[i - 1]),
        ).toBe(true)
        await waitFor(() => expect(lastOutline).toEqual([]), { timeout: 5000 })
    },
}

/** The same three pages with a real embedded outline (jspdf's outline plugin writes page-ref
 *  destinations, the shape real PDFs use), nested one level: `onOutline` must resolve every node
 *  to its actual 0-based page index. */
function buildOutlinedPdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    ;['Part one', 'Part two', 'Section three'].forEach((label, i) => {
        if (i > 0) pdf.addPage('letter')
        pdf.setFontSize(32)
        pdf.text(label, 72, 100)
    })
    const part = pdf.outline.add(null, 'Part one', { pageNumber: 1 })
    pdf.outline.add(part, 'Section three', { pageNumber: 3 })
    pdf.outline.add(null, 'Part two', { pageNumber: 2 })
    return pdf.output('arraybuffer')
}
let outlinedBytes: ArrayBuffer | undefined
async function loadOutlined(): Promise<ArrayBuffer> {
    outlinedBytes ??= buildOutlinedPdf()
    return outlinedBytes.slice(0)
}

export const OutlineResolves: Story = {
    render: () => {
        lastOutline = undefined
        return (
            <div style={{ height: '640px' }}>
                <PdfPages
                    load={loadOutlined}
                    zoom={1}
                    onOutline={o => (lastOutline = o)}
                />
            </div>
        )
    },
    play: async () => {
        await waitFor(
            () =>
                expect(lastOutline).toEqual([
                    {
                        title: 'Part one',
                        page: 0,
                        children: [
                            { title: 'Section three', page: 2, children: [] },
                        ],
                    },
                    { title: 'Part two', page: 1, children: [] },
                ]),
            { timeout: 5000 },
        )
    },
}
