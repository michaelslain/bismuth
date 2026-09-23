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
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { pdfCache } from './pdfDocCache'
import Text from '../ui/Text'
import { jsPDF } from 'jspdf'
import PdfPages from './PdfPages'
import type { OutlineNode, PdfPagesController, PdfPosition } from './annotationTypes'
import {
    anchorAt,
    positionAt,
    scrollTopForPosition,
    type PageBox,
    type PageSize,
} from './pageLayout'
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

        // Page frame (acceptance 1 + 3): the first page sits the SAME `--sp-6` gutter PdfPages
        // itself reads off the scroll element (not a hand-typed pixel guess — this stays correct
        // if the token's resolved value ever changes) from the container's left/top/right edges
        // at fit width, and the desk in that gutter is the `--surface-2` token, not the page's
        // own white raster.
        const pageEl = canvasElement.querySelector(
            '[data-pdf-page="0"]',
        ) as HTMLElement
        const scroller = pageEl.parentElement!.parentElement as HTMLElement
        const sr = scroller.getBoundingClientRect()
        const pr = pageEl.getBoundingClientRect()
        const pad = parseFloat(
            getComputedStyle(scroller).getPropertyValue('--sp-6'),
        )
        expect(Number.isFinite(pad)).toBe(true)
        await expect(Math.abs(pr.left - sr.left - pad)).toBeLessThanOrEqual(1)
        await expect(Math.abs(pr.top - sr.top - pad)).toBeLessThanOrEqual(1)
        // No margin in this story, so "page+scratch" is just the page itself.
        await expect(Math.abs(sr.right - pr.right - pad)).toBeLessThanOrEqual(1)

        const deskRgb = parseRgb(getComputedStyle(scroller).backgroundColor)
        const surface2 = hexToRgb(
            getComputedStyle(scroller).getPropertyValue('--surface-2').trim(),
        )
        for (let i = 0; i < 3; i++) {
            expect(Math.abs(deskRgb[i]! - surface2[i]!)).toBeLessThanOrEqual(1)
        }
    },
}

async function loadFailing(): Promise<ArrayBuffer> {
    throw new Error('not a real PDF')
}

/** Acceptance 4: `errorAction` renders under the "Couldn't load PDF" message, centred, and exactly
 *  once — `props.errorAction` is a getter, so every extra read (a presence `<Show when>`, a second
 *  insert) would mint another instance; `children()` inside PdfPages resolves it once. A `let`
 *  counter on the action itself is what catches a regression a mere "is it present" check would
 *  miss (the wave-2 merge rendered it three times). */
let errorActionMounts = 0
function ErrorActionMarker() {
    errorActionMounts++
    return (
        <button type="button" data-testid="pdfpages-error-action">
            open in default app
        </button>
    )
}

export const LoadFailsShowsErrorAction: Story = {
    render: () => {
        errorActionMounts = 0
        return (
            <div style={{ height: '400px' }}>
                <PdfPages
                    load={loadFailing}
                    zoom={1}
                    errorAction={<ErrorActionMarker />}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(
                    canvasElement.querySelector(
                        '[data-testid="pdfpages-error-action"]',
                    ),
                ).not.toBeNull()
            },
            { timeout: 5000 },
        )
        const action = canvasElement.querySelector(
            '[data-testid="pdfpages-error-action"]',
        ) as HTMLElement
        const errorBlock = canvasElement.querySelector(
            '[data-testid="ui-empty-block"]',
        ) as HTMLElement
        await expect(errorBlock.textContent).toContain("Couldn't load PDF")
        await expect(errorActionMounts).toBe(1)
        await expect(
            canvasElement.querySelectorAll('[data-testid="pdfpages-error-action"]')
                .length,
        ).toBe(1)
        // Laid out UNDER the message, centred on it — not inline beside the sentence (the action
        // used to sit inside EmptyState's `<p>`, and a stray second copy sat beside the block).
        const message = errorBlock.querySelector(
            '[data-testid="ui-empty"]',
        ) as HTMLElement
        const mr = message.getBoundingClientRect()
        const ar = action.getBoundingClientRect()
        await expect(message.contains(action)).toBe(false)
        await expect(ar.top).toBeGreaterThanOrEqual(mr.bottom)
        await expect(
            Math.abs((ar.left + ar.right) / 2 - (mr.left + mr.right) / 2),
        ).toBeLessThanOrEqual(1)
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

        // Acceptance 1 (scratch-notes decision 3): the strip is the note editor's own ground +
        // hairline (ScratchPaper.tsx), NOT a continuation of the PDF page's white — so it reads
        // as a different, note-styled surface at a glance rather than an extra-wide page.
        const marginRgb = parseRgb(getComputedStyle(marginEl).backgroundColor)
        const editorRgb = hexToRgb(
            getComputedStyle(document.documentElement)
                .getPropertyValue('--editor')
                .trim(),
        )
        for (let i = 0; i < 3; i++) {
            expect(
                Math.abs(marginRgb[i]! - editorRgb[i]!),
                `channel ${i}: margin ${marginRgb[i]} vs --editor ${editorRgb[i]}`,
            ).toBeLessThanOrEqual(1)
        }
        const marginBorderRgb = parseRgb(
            getComputedStyle(marginEl).borderLeftColor,
        )
        const borderSoftRgb = hexToRgb(
            getComputedStyle(document.documentElement)
                .getPropertyValue('--border-soft')
                .trim(),
        )
        for (let i = 0; i < 3; i++) {
            expect(
                Math.abs(marginBorderRgb[i]! - borderSoftRgb[i]!),
            ).toBeLessThanOrEqual(1)
        }
        // And the page itself is untouched by the strip's new ground — still its own white
        // (PDF_PAGE_PAPER), not swallowed by it.
        const canvas = firstCanvas(canvasElement)!
        const blankRgb = sampleCanvasPixel(canvas, 2, 2) // page's top-left corner: no text/shape there
        const paperRgb = hexToRgb(PDF_PAGE_PAPER)
        for (let i = 0; i < 3; i++) {
            expect(Math.abs(blankRgb[i]! - paperRgb[i]!)).toBeLessThanOrEqual(2)
        }

        // Page frame (acceptance 1): the page's own left/top edges, and the page+scratch UNIT's
        // right edge, all sit the resolved `--sp-6` gutter from the scroll container's edges —
        // the margin shrinks the page (acceptance 2, above), it doesn't eat the frame around it.
        const scroller = pageEl.parentElement!.parentElement as HTMLElement
        const sr = scroller.getBoundingClientRect()
        const pad = parseFloat(
            getComputedStyle(scroller).getPropertyValue('--sp-6'),
        )
        expect(Number.isFinite(pad)).toBe(true)
        await expect(Math.abs(page.left - sr.left - pad)).toBeLessThanOrEqual(1)
        await expect(Math.abs(page.top - sr.top - pad)).toBeLessThanOrEqual(1)
        await expect(
            Math.abs(sr.right - margin.right - pad),
        ).toBeLessThanOrEqual(1)
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
 *  both jumps, `onPageCount` reports 3, and this plain PDF's `onOutline` is `[]`.
 *
 *  Fix 3 finding 5: a jump lands `pad` px ABOVE the page's own top, so the page-frame gutter
 *  stays visible instead of being scrolled out of view — `lastBoxes[0]!.top` IS that `pad` (the
 *  first page's own top, since `layoutPages` starts the stack at `top: pad`), so the expected
 *  scrollTop is a page's `top` less the first page's. */
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
                expect(scrollEl!.scrollTop).toBeCloseTo(
                    lastBoxes[1]!.top - lastBoxes[0]!.top,
                    0,
                )
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
                expect(scrollEl!.scrollTop).toBeCloseTo(
                    lastBoxes[2]!.top - lastBoxes[0]!.top,
                    0,
                )
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

/** Task 1 acceptance: `cacheKey` makes a remount of the SAME document skip fetch + parse
 *  entirely. `loadCountingCacheRemount` is the load spy — it must fire exactly once across a
 *  full mount → unmount → remount cycle. */
let cacheRemountLoadCalls = 0
function loadCountingCacheRemount(): Promise<ArrayBuffer> {
    cacheRemountLoadCalls++
    return load()
}

export const CacheSurvivesRemount: Story = {
    render: () => {
        cacheRemountLoadCalls = 0
        const [mounted, setMounted] = createSignal(true)
        return (
            <div style={{ height: '640px' }}>
                <button
                    type="button"
                    data-testid="pdfpages-cache-unmount"
                    onClick={() => setMounted(false)}
                >
                    unmount
                </button>
                <button
                    type="button"
                    data-testid="pdfpages-cache-remount"
                    onClick={() => setMounted(true)}
                >
                    remount
                </button>
                <Show when={mounted()}>
                    <PdfPages
                        load={loadCountingCacheRemount}
                        zoom={1}
                        cacheKey="story:CacheSurvivesRemount"
                    />
                </Show>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const inkedPages = () =>
            (
                Array.from(
                    canvasElement.querySelectorAll('[data-pdf-page] canvas'),
                ) as HTMLCanvasElement[]
            ).some(c => inkedPct(c) > 0)

        await waitFor(
            () => {
                expect(
                    canvasElement.querySelectorAll('[data-pdf-page]').length,
                ).toBeGreaterThan(0)
                expect(inkedPages()).toBe(true)
            },
            { timeout: 5000 },
        )
        await expect(cacheRemountLoadCalls).toBe(1)

        ;(
            canvasElement.querySelector(
                '[data-testid="pdfpages-cache-unmount"]',
            ) as HTMLButtonElement
        ).click()
        await waitFor(
            () =>
                expect(
                    canvasElement.querySelectorAll('[data-pdf-page]').length,
                ).toBe(0),
            { timeout: 5000 },
        )

        ;(
            canvasElement.querySelector(
                '[data-testid="pdfpages-cache-remount"]',
            ) as HTMLButtonElement
        ).click()

        // The FIRST animation frame after remount: the cache-hit path is synchronous (no
        // `await` before 'ready'), so <Loading/> must never have appeared at all.
        await nextFrame()
        await expect(canvasElement.textContent).not.toContain('Loading')
        await expect(
            canvasElement.querySelectorAll('[data-pdf-page]').length,
        ).toBeGreaterThan(0)
        await expect(inkedPages()).toBe(true)

        // load() was never called again — the whole point of the cache.
        await expect(cacheRemountLoadCalls).toBe(1)
    },
}

/** A ≥ 6-page fixture — `Default`'s 3-page one can't exercise "restore to page 3". */
function buildSixPagePdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    for (let i = 0; i < 6; i++) {
        if (i > 0) pdf.addPage('letter')
        pdf.setFontSize(32)
        pdf.text(`Page ${i + 1}`, 72, 100)
        pdf.setFillColor(40 * i, 60, 200 - 20 * i)
        pdf.rect(72, 140, 300, 140, 'F')
    }
    return pdf.output('arraybuffer')
}
let sixPageBytes: ArrayBuffer | undefined
async function loadSixPages(): Promise<ArrayBuffer> {
    sixPageBytes ??= buildSixPagePdf()
    return sixPageBytes.slice(0)
}

let restoreBoxes: PageBox[] = []
let restoreCurrentPage = -1

/** Task 1 acceptance: `initialPosition` is applied once the document is ready and measured,
 *  through the same pending-jump path as `controller.scrollToPage` — landing at the EXACT
 *  `scrollTopForPosition`, not the clamped `scrollTopForPage` a normal jump would use. */
export const RestoresInitialPosition: Story = {
    render: () => {
        restoreBoxes = []
        restoreCurrentPage = -1
        return (
            <div style={{ height: '640px' }}>
                <PdfPages
                    load={loadSixPages}
                    zoom={1}
                    cacheKey="story:RestoresInitialPosition"
                    initialPosition={{ index: 3, yFraction: 0.5, xFraction: 0 }}
                    onLayout={l => {
                        restoreBoxes = l.boxes
                    }}
                    onCurrentPage={i => {
                        restoreCurrentPage = i
                    }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => expect(restoreBoxes.length).toBe(6),
            { timeout: 5000 },
        )
        const pageEl = canvasElement.querySelector(
            '[data-pdf-page="0"]',
        ) as HTMLElement
        const scroller = pageEl.parentElement!.parentElement as HTMLElement
        const pad = parseFloat(
            getComputedStyle(scroller).getPropertyValue('--sp-6'),
        )
        await expect(Number.isFinite(pad)).toBe(true)

        await waitFor(
            () => {
                const expected = scrollTopForPosition(restoreBoxes, 3, 0.5, pad)
                expect(
                    Math.abs(scroller.scrollTop - expected),
                ).toBeLessThanOrEqual(1)
                expect(restoreCurrentPage).toBe(3)
            },
            { timeout: 5000 },
        )
    },
}

let reportBoxes: PageBox[] = []
let reportedPositions: PdfPosition[] = []

/** Task 1 acceptance: `onPosition` fires on every scroll (including a scrollTop that lands in
 *  the gap between two pages, where `yFraction` legitimately exceeds 1) with EXACTLY
 *  `positionAt(...)` of the live scroll element — not a rounded/approximate readout. */
export const ReportsPosition: Story = {
    render: () => {
        reportBoxes = []
        reportedPositions = []
        return (
            <div style={{ height: '640px' }}>
                <PdfPages
                    load={load}
                    zoom={1}
                    cacheKey="story:ReportsPosition"
                    onLayout={l => {
                        reportBoxes = l.boxes
                    }}
                    onPosition={p => reportedPositions.push(p)}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        // Measured, not just laid out: onLayout also fires at width 0, before the ResizeObserver
        // reports, and no position is ever reported against that unmeasured layout.
        await waitFor(
            () => {
                expect(reportBoxes.length).toBe(3)
                expect(reportBoxes[0]!.w).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )
        const pageEl = canvasElement.querySelector(
            '[data-pdf-page="0"]',
        ) as HTMLElement
        const scroller = pageEl.parentElement!.parentElement as HTMLElement
        const pad = parseFloat(
            getComputedStyle(scroller).getPropertyValue('--sp-6'),
        )
        await expect(Number.isFinite(pad)).toBe(true)

        const scrollAndCheck = async (top: number) => {
            scroller.scrollTop = top
            scroller.dispatchEvent(new Event('scroll'))
            await waitFor(
                () => {
                    const last = reportedPositions.at(-1)
                    expect(last).toBeDefined()
                    const expected = positionAt(reportBoxes, scroller.scrollTop, pad)
                    // `last` is a full PdfPosition (adds `xFraction`, 0 here — no horizontal
                    // overflow in this fixture); `positionAt` only returns index/yFraction.
                    expect(last).toEqual({ ...expected, xFraction: 0 })
                },
                { timeout: 5000 },
            )
        }

        // Mid-page.
        await scrollAndCheck(50)
        // In the gap between page 0 and page 1: the reading line is `scrollTop + pad`, so aim it
        // at the middle of the measured gap — page 0 still owns it, with `yFraction` past 1.
        const gapStart = reportBoxes[0]!.top + reportBoxes[0]!.h
        const gap = reportBoxes[1]!.top - gapStart
        await scrollAndCheck(gapStart + gap / 2 - pad)
        await expect(reportedPositions.at(-1)!.index).toBe(0)
        await expect(reportedPositions.at(-1)!.yFraction).toBeGreaterThan(1)
    },
}

/** Shared by every reflow story below: waits for the loaded document's boxes, scrolls into page 3
 *  (a genuinely mid-viewport, mid-page anchor, not the trivial top-of-file case), and forces the
 *  scroll handler to run (a synthetic assignment doesn't fire a native `scroll` event) so `anchor`
 *  is actually captured before the reflow trigger — without this the reflow effect's `if (!anchor)
 *  return` guard would skip re-anchoring and the assertions below would pass VACUOUSLY (scrollTop
 *  never needed correcting because nothing had been read yet). */
async function scrollIntoPageThree(
    canvasElement: HTMLElement,
    boxesRef: () => PageBox[],
): Promise<HTMLElement> {
    const pageEl = canvasElement.querySelector(
        '[data-pdf-page="0"]',
    ) as HTMLElement
    const scroller = pageEl.parentElement!.parentElement as HTMLElement
    scroller.scrollTop = boxesRef()[3]!.top + 30
    scroller.dispatchEvent(new Event('scroll'))
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0), {
        timeout: 5000,
    })
    return scroller
}

let widthReflowBoxes: PageBox[] = []
let widthReflowPositions: PdfPosition[] = []

/** Task 1 acceptance: shrinking the pane's measured width — exactly what opening the bookmarks
 *  panel does to `<PdfPages>` in `PreviewView` — must not push the reader's place. The anchor
 *  (page + fraction under the viewport's MIDDLE) taken before the resize must equal the one read
 *  back against the NEW boxes, and the saved `onPosition` must match the corrected offset, not the
 *  drifted raw pixel one. */
export const ReflowKeepsPlaceOnWidthChange: Story = {
    render: () => {
        widthReflowBoxes = []
        widthReflowPositions = []
        const [width, setWidth] = createSignal(640)
        return (
            <div style={{ height: '640px', width: `${width()}px` }}>
                <button
                    type="button"
                    data-testid="reflow-width-narrow"
                    onClick={() => setWidth(400)}
                >
                    narrow
                </button>
                <button
                    type="button"
                    data-testid="reflow-width-wide"
                    onClick={() => setWidth(640)}
                >
                    wide
                </button>
                <div style={{ height: '600px' }}>
                    <PdfPages
                        load={loadSixPages}
                        zoom={1}
                        cacheKey="story:ReflowKeepsPlaceOnWidthChange"
                        onLayout={l => {
                            widthReflowBoxes = l.boxes
                        }}
                        onPosition={p => widthReflowPositions.push(p)}
                    />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(widthReflowBoxes.length).toBe(6)
                expect(widthReflowBoxes[0]!.w).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )
        const scroller = await scrollIntoPageThree(
            canvasElement,
            () => widthReflowBoxes,
        )
        const pad = parseFloat(
            getComputedStyle(scroller).getPropertyValue('--sp-6'),
        )

        const check = async (testid: string) => {
            const boxesBefore = widthReflowBoxes
            const before = anchorAt(
                boxesBefore,
                scroller.scrollTop,
                scroller.clientHeight,
            )
            ;(
                canvasElement.querySelector(
                    `[data-testid="${testid}"]`,
                ) as HTMLButtonElement
            ).click()
            await waitFor(
                () => expect(widthReflowBoxes[0]!.w).not.toBeCloseTo(boxesBefore[0]!.w, 1),
                { timeout: 5000 },
            )
            await waitFor(
                () => {
                    const after = anchorAt(
                        widthReflowBoxes,
                        scroller.scrollTop,
                        scroller.clientHeight,
                    )
                    expect(after.index).toBe(before.index)
                    expect(after.yFraction).toBeCloseTo(before.yFraction, 2)
                    const expected = positionAt(widthReflowBoxes, scroller.scrollTop, pad)
                    const last = widthReflowPositions.at(-1)!
                    expect(last.index).toBe(expected.index)
                    expect(last.yFraction).toBeCloseTo(expected.yFraction, 5)
                },
                { timeout: 5000 },
            )
        }
        await check('reflow-width-narrow')
        await check('reflow-width-wide')
    },
}

let heightReflowBoxes: PageBox[] = []
let heightReflowPositions: PdfPosition[] = []

/** Fix 2: the ResizeObserver writes `containerW`/`containerH` in ONE batch. `layout()` (and so the
 *  reflow effect) tracks WIDTH only, never height — a pure height-only resize never reflows at all,
 *  by design (page boxes don't depend on viewport height). The bug this guards is a resize that
 *  changes BOTH at once, exactly what dragging a window corner (or a pane split that isn't purely
 *  horizontal) does: unbatched writes would let the reflow effect (triggered by the width write)
 *  run while `containerH()` still held the OLD height, throwing the mid-viewport anchor off by
 *  roughly half the height delta. So this story resizes width AND height together in one wrapper
 *  update — one ResizeObserver entry, both dimensions new — and waits on `scroller.clientHeight`
 *  changing (not just a box width change) since that's the dimension the bug is actually about. */
export const ReflowKeepsPlaceOnHeightChange: Story = {
    render: () => {
        heightReflowBoxes = []
        heightReflowPositions = []
        const [width, setWidth] = createSignal(640)
        const [height, setHeight] = createSignal(640)
        return (
            <div style={{ height: `${height()}px`, width: `${width()}px` }}>
                <button
                    type="button"
                    data-testid="reflow-height-small"
                    onClick={() => {
                        setWidth(400)
                        setHeight(400)
                    }}
                >
                    small
                </button>
                <button
                    type="button"
                    data-testid="reflow-height-large"
                    onClick={() => {
                        setWidth(640)
                        setHeight(640)
                    }}
                >
                    large
                </button>
                <div style={{ height: `${height() - 40}px` }}>
                    <PdfPages
                        load={loadSixPages}
                        zoom={1}
                        cacheKey="story:ReflowKeepsPlaceOnHeightChange"
                        onLayout={l => {
                            heightReflowBoxes = l.boxes
                        }}
                        onPosition={p => heightReflowPositions.push(p)}
                    />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(heightReflowBoxes.length).toBe(6)
                expect(heightReflowBoxes[0]!.w).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )
        const scroller = await scrollIntoPageThree(
            canvasElement,
            () => heightReflowBoxes,
        )
        const pad = parseFloat(
            getComputedStyle(scroller).getPropertyValue('--sp-6'),
        )

        const check = async (testid: string) => {
            const boxesBefore = heightReflowBoxes
            const heightBefore = scroller.clientHeight
            const before = anchorAt(
                boxesBefore,
                scroller.scrollTop,
                heightBefore,
            )
            ;(
                canvasElement.querySelector(
                    `[data-testid="${testid}"]`,
                ) as HTMLButtonElement
            ).click()
            await waitFor(
                () => expect(scroller.clientHeight).not.toBe(heightBefore),
                { timeout: 5000 },
            )
            await waitFor(
                () => {
                    const after = anchorAt(
                        heightReflowBoxes,
                        scroller.scrollTop,
                        scroller.clientHeight,
                    )
                    expect(after.index).toBe(before.index)
                    expect(after.yFraction).toBeCloseTo(before.yFraction, 2)
                    const expected = positionAt(heightReflowBoxes, scroller.scrollTop, pad)
                    const last = heightReflowPositions.at(-1)!
                    expect(last.index).toBe(expected.index)
                    expect(last.yFraction).toBeCloseTo(expected.yFraction, 5)
                },
                { timeout: 5000 },
            )
        }
        await check('reflow-height-small')
        await check('reflow-height-large')
    },
}

let marginReflowBoxes: PageBox[] = []
let marginReflowPositions: PdfPosition[] = []

/** Task 1 acceptance: the scratch-margin toggle (`toggleMargin` in `PreviewView`) shrinks/grows
 *  every page inside the same band, the same reflow shape as a width change. */
export const ReflowKeepsPlaceOnMarginToggle: Story = {
    render: () => {
        marginReflowBoxes = []
        marginReflowPositions = []
        const [ratio, setRatio] = createSignal(0)
        return (
            <div style={{ height: '640px', width: '640px' }}>
                <button
                    type="button"
                    data-testid="reflow-margin-on"
                    onClick={() => setRatio(DEFAULT_MARGIN_RATIO)}
                >
                    margin on
                </button>
                <button
                    type="button"
                    data-testid="reflow-margin-off"
                    onClick={() => setRatio(0)}
                >
                    margin off
                </button>
                <div style={{ height: '600px' }}>
                    <PdfPages
                        load={loadSixPages}
                        zoom={1}
                        marginRatio={ratio()}
                        cacheKey="story:ReflowKeepsPlaceOnMarginToggle"
                        onLayout={l => {
                            marginReflowBoxes = l.boxes
                        }}
                        onPosition={p => marginReflowPositions.push(p)}
                    />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(marginReflowBoxes.length).toBe(6)
                expect(marginReflowBoxes[0]!.w).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )
        const scroller = await scrollIntoPageThree(
            canvasElement,
            () => marginReflowBoxes,
        )
        const pad = parseFloat(
            getComputedStyle(scroller).getPropertyValue('--sp-6'),
        )

        const check = async (testid: string) => {
            const boxesBefore = marginReflowBoxes
            const before = anchorAt(
                boxesBefore,
                scroller.scrollTop,
                scroller.clientHeight,
            )
            ;(
                canvasElement.querySelector(
                    `[data-testid="${testid}"]`,
                ) as HTMLButtonElement
            ).click()
            await waitFor(
                () => expect(marginReflowBoxes[0]!.w).not.toBeCloseTo(boxesBefore[0]!.w, 1),
                { timeout: 5000 },
            )
            await waitFor(
                () => {
                    const after = anchorAt(
                        marginReflowBoxes,
                        scroller.scrollTop,
                        scroller.clientHeight,
                    )
                    expect(after.index).toBe(before.index)
                    expect(after.yFraction).toBeCloseTo(before.yFraction, 2)
                    const expected = positionAt(marginReflowBoxes, scroller.scrollTop, pad)
                    const last = marginReflowPositions.at(-1)!
                    expect(last.index).toBe(expected.index)
                    expect(last.yFraction).toBeCloseTo(expected.yFraction, 5)
                },
                { timeout: 5000 },
            )
        }
        await check('reflow-margin-on')
        await check('reflow-margin-off')
    },
}

let zoomReflowBoxes: PageBox[] = []
let zoomReflowPositions: PdfPosition[] = []

/** Task 1 acceptance: zooming (Ctrl/Cmd+wheel's `zoomBy`) scales every page box the same way a
 *  width/margin change does. */
export const ReflowKeepsPlaceOnZoom: Story = {
    render: () => {
        zoomReflowBoxes = []
        zoomReflowPositions = []
        const [zoom, setZoom] = createSignal(1)
        return (
            <div style={{ height: '640px', width: '640px' }}>
                <button
                    type="button"
                    data-testid="reflow-zoom-up"
                    onClick={() => setZoom(1.5)}
                >
                    zoom 1.5x
                </button>
                <button
                    type="button"
                    data-testid="reflow-zoom-reset"
                    onClick={() => setZoom(1)}
                >
                    zoom 1x
                </button>
                <div style={{ height: '600px' }}>
                    <PdfPages
                        load={loadSixPages}
                        zoom={zoom()}
                        cacheKey="story:ReflowKeepsPlaceOnZoom"
                        onLayout={l => {
                            zoomReflowBoxes = l.boxes
                        }}
                        onPosition={p => zoomReflowPositions.push(p)}
                    />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(zoomReflowBoxes.length).toBe(6)
                expect(zoomReflowBoxes[0]!.w).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )
        const scroller = await scrollIntoPageThree(
            canvasElement,
            () => zoomReflowBoxes,
        )
        const pad = parseFloat(
            getComputedStyle(scroller).getPropertyValue('--sp-6'),
        )

        const check = async (testid: string) => {
            const boxesBefore = zoomReflowBoxes
            const before = anchorAt(
                boxesBefore,
                scroller.scrollTop,
                scroller.clientHeight,
            )
            ;(
                canvasElement.querySelector(
                    `[data-testid="${testid}"]`,
                ) as HTMLButtonElement
            ).click()
            await waitFor(
                () => expect(zoomReflowBoxes[0]!.w).not.toBeCloseTo(boxesBefore[0]!.w, 1),
                { timeout: 5000 },
            )
            await waitFor(
                () => {
                    const after = anchorAt(
                        zoomReflowBoxes,
                        scroller.scrollTop,
                        scroller.clientHeight,
                    )
                    expect(after.index).toBe(before.index)
                    expect(after.yFraction).toBeCloseTo(before.yFraction, 2)
                    const expected = positionAt(zoomReflowBoxes, scroller.scrollTop, pad)
                    const last = zoomReflowPositions.at(-1)!
                    expect(last.index).toBe(expected.index)
                    expect(last.yFraction).toBeCloseTo(expected.yFraction, 5)
                },
                { timeout: 5000 },
            )
        }
        await check('reflow-zoom-up')
        await check('reflow-zoom-reset')
    },
}

let topReflowBoxes: PageBox[] = []

/** Task 1 acceptance, the special case in the plan's Design section: an anchor taken AT THE TOP
 *  (`scrollTop === 0`) stays at 0 across a reflow — a reader at the start of the file is not
 *  pushed down when page 1 grows, even though `positionAt`'s own `yFraction` for scrollTop 0 is
 *  not necessarily 0 (page 0's top is `pad`, not the viewport's). */
export const ReflowAtTopStaysAtTop: Story = {
    render: () => {
        topReflowBoxes = []
        const [width, setWidth] = createSignal(640)
        // Width alone leaves page 0's `top` structurally at `pad` regardless of the anchoring
        // logic, so a disabled reflow effect would still pass that check — zoom is what actually
        // exercises it, since zooming changes page HEIGHTS above the middle of the viewport too.
        const [zoom, setZoom] = createSignal(1)
        return (
            <div style={{ height: '640px', width: `${width()}px` }}>
                <button
                    type="button"
                    data-testid="reflow-top-narrow"
                    onClick={() => setWidth(400)}
                >
                    narrow
                </button>
                <button
                    type="button"
                    data-testid="reflow-top-wide"
                    onClick={() => setWidth(640)}
                >
                    wide
                </button>
                <button
                    type="button"
                    data-testid="reflow-top-zoom"
                    onClick={() => setZoom(1.5)}
                >
                    zoom 1.5x
                </button>
                <div style={{ height: '600px' }}>
                    <PdfPages
                        load={loadSixPages}
                        zoom={zoom()}
                        cacheKey="story:ReflowAtTopStaysAtTop"
                        onLayout={l => {
                            topReflowBoxes = l.boxes
                        }}
                    />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(topReflowBoxes.length).toBe(6)
                expect(topReflowBoxes[0]!.w).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )
        const pageEl = canvasElement.querySelector(
            '[data-pdf-page="0"]',
        ) as HTMLElement
        const scroller = pageEl.parentElement!.parentElement as HTMLElement
        expect(scroller.scrollTop).toBe(0)
        // Force the scroll handler to capture {atTop: true} at the current (zero) offset — a
        // literal assignment of the same value fires no native `scroll` event.
        scroller.dispatchEvent(new Event('scroll'))

        const check = async (testid: string) => {
            const wBefore = topReflowBoxes[0]!.w
            ;(
                canvasElement.querySelector(
                    `[data-testid="${testid}"]`,
                ) as HTMLButtonElement
            ).click()
            await waitFor(
                () => expect(topReflowBoxes[0]!.w).not.toBeCloseTo(wBefore, 1),
                { timeout: 5000 },
            )
            expect(scroller.scrollTop).toBe(0)
        }
        await check('reflow-top-narrow')
        await check('reflow-top-wide')
        await check('reflow-top-zoom')
    },
}

let unmountSetMounted: ((v: boolean) => void) | undefined
let unmountBoxes: PageBox[] = []
let unmountReports: PdfPosition[] = []

/** Fix 1: tearing a scrolled PdfPages down must never report. A scroll write queues an async
 *  `scroll` event; unmounted before it lands, Chrome delivers it to the DETACHED element, whose
 *  offset has reset to 0 — reported, that was `{ index: 0, yFraction: 0 }`, which PreviewView saved
 *  over the real position a moment before the next mount restored from it. */
export const UnmountNeverReports: Story = {
    render: () => {
        unmountBoxes = []
        unmountReports = []
        const [mounted, setMounted] = createSignal(true)
        unmountSetMounted = setMounted
        return (
            <div style={{ height: '640px' }}>
                <Show when={mounted()}>
                    <PdfPages
                        load={loadSixPages}
                        zoom={1}
                        cacheKey="story:UnmountNeverReports"
                        onLayout={l => {
                            unmountBoxes = l.boxes
                        }}
                        onPosition={p => unmountReports.push(p)}
                    />
                </Show>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(unmountBoxes.length).toBe(6), {
            timeout: 8000,
        })
        const scroller = canvasElement.querySelector('[data-pdf-page="0"]')!
            .parentElement!.parentElement as HTMLElement
        await waitFor(
            () => {
                scroller.scrollTop = unmountBoxes[3]!.top + 40
                scroller.dispatchEvent(new Event('scroll'))
                expect(unmountReports.at(-1)?.index).toBe(3)
            },
            { timeout: 5000 },
        )
        await nextFrame()
        await nextFrame()
        const before = unmountReports.length

        // Queue a real scroll event, then unmount before it is delivered.
        scroller.scrollTop += 50
        unmountSetMounted!(false)
        await waitFor(() =>
            expect(canvasElement.querySelector('[data-pdf-page]')).toBeNull(),
        )
        await nextFrame()
        await nextFrame()
        await new Promise(r => setTimeout(r, 100))

        await expect(unmountReports.slice(before)).toEqual([])

        // Leave the story showing the document again (a cache hit), not an empty root.
        unmountSetMounted!(true)
        await waitFor(
            () => expect(canvasElement.querySelector('[data-pdf-page]')).not.toBeNull(),
            { timeout: 5000 },
        )
    },
}

/** A same-size, full-bleed coloured fixture — two of these differ ONLY in pixels, so a canvas
 *  whose box never changed size is the only thing that can tell them apart. */
function buildColourPdf(pages: number, rgb: [number, number, number]): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    for (let i = 0; i < pages; i++) {
        if (i > 0) pdf.addPage('letter')
        pdf.setFillColor(rgb[0], rgb[1], rgb[2])
        pdf.rect(0, 0, 612, 792, 'F')
    }
    return pdf.output('arraybuffer')
}
let redBytes: ArrayBuffer | undefined
let blueBytes: ArrayBuffer | undefined
const loadRed = async () => (redBytes ??= buildColourPdf(4, [220, 30, 30])).slice(0)
const loadBlue = async () => (blueBytes ??= buildColourPdf(3, [30, 30, 220])).slice(0)

let switchTo: ((k: 'a' | 'b') => void) | undefined
let switchBoxes: PageBox[] = []
let switchCounts: number[] = []
let switchReports: { key: 'a' | 'b'; pos: PdfPosition }[] = []

/** Fix 1 (final review): a still-mounted PdfPages switching between two CACHED documents stays
 *  'ready'. B must show B's pixels (not A's raster left on a same-size canvas), re-report B's
 *  page count, start at the top, and not report that reset as a position. */
export const CachedSwitchShowsNewDocument: Story = {
    render: () => {
        switchBoxes = []
        switchCounts = []
        switchReports = []
        const [which, setWhich] = createSignal<'a' | 'b'>('a')
        switchTo = setWhich
        return (
            <div style={{ height: '640px' }}>
                <PdfPages
                    load={which() === 'a' ? loadRed : loadBlue}
                    zoom={1}
                    cacheKey={`story:CachedSwitchShowsNewDocument:${which()}`}
                    onLayout={l => {
                        switchBoxes = l.boxes
                    }}
                    onPageCount={n => switchCounts.push(n)}
                    onPosition={pos => switchReports.push({ key: which(), pos })}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const scrollerOf = () =>
            canvasElement.querySelector('[data-pdf-page="0"]')?.parentElement
                ?.parentElement as HTMLElement | undefined
        /** Centre pixel of page 0's visible canvas, or undefined before it has a bitmap. */
        const page0Rgb = () => {
            const c = canvasElement.querySelector(
                '[data-pdf-page="0"] canvas',
            ) as HTMLCanvasElement | null
            if (!c || c.width < 2 || c.height < 2) return undefined
            const d = c
                .getContext('2d')!
                .getImageData(c.width >> 1, c.height >> 1, 1, 1).data
            return [d[0]!, d[1]!, d[2]!]
        }
        const isRed = (p?: number[]) => !!p && p[0]! > 150 && p[2]! < 100
        const isBlue = (p?: number[]) => !!p && p[2]! > 150 && p[0]! < 100

        // Pre-warm both keys: A (red, 4 pages) → B (blue, 3 pages) → back to A, a cache hit.
        await waitFor(() => expect(isRed(page0Rgb())).toBe(true), { timeout: 8000 })
        switchTo!('b')
        await waitFor(() => expect(isBlue(page0Rgb())).toBe(true), { timeout: 8000 })
        switchTo!('a')
        await waitFor(() => expect(isRed(page0Rgb())).toBe(true), { timeout: 8000 })

        // Scroll A down a little (page 0 stays visible), then switch to cached B.
        const scrollerA = scrollerOf()!
        await waitFor(
            () => {
                scrollerA.scrollTop = 300
                scrollerA.dispatchEvent(new Event('scroll'))
                expect(switchReports.at(-1)?.key).toBe('a')
            },
            { timeout: 5000 },
        )
        await nextFrame()
        await nextFrame()
        const countsBefore = switchCounts.length
        const reportsBefore = switchReports.length

        switchTo!('b')
        await waitFor(() => expect(isBlue(page0Rgb())).toBe(true), { timeout: 5000 })
        await expect(switchBoxes.length).toBe(3)
        await expect(switchCounts.slice(countsBefore)).toEqual([3])
        await expect(scrollerOf()!.scrollTop).toBe(0)
        await nextFrame()
        await nextFrame()
        await expect(switchReports.slice(reportsBefore)).toEqual([])
    },
}

let pendingLoadResolve: (() => void) | undefined
let pendingLoadSetMounted: ((v: boolean) => void) | undefined
const PENDING_LOAD_KEY = 'story:UnmountDuringLoadNeverCaches'

/** Fix 3 (final review): unmounting while `load()` is still fetching must abandon that load — it
 *  must never go on to `put` a retained cache entry that nothing will ever release. */
export const UnmountDuringLoadNeverCaches: Story = {
    render: () => {
        const [mounted, setMounted] = createSignal(true)
        pendingLoadSetMounted = setMounted
        const slowLoad = () =>
            new Promise<ArrayBuffer>(resolve => {
                pendingLoadResolve = () => void loadSixPages().then(resolve)
            })
        return (
            <div style={{ height: '640px' }}>
                {/* Rendered alone (no play), the load is held forever — say so, rather than
                    leaving a root that shows nothing but a delayed spinner. */}
                <Text>load() is held until play() releases it</Text>
                <Show when={mounted()}>
                    <PdfPages load={slowLoad} zoom={1} cacheKey={PENDING_LOAD_KEY} />
                </Show>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(pendingLoadResolve).toBeDefined())
        await expect(canvasElement.textContent).toContain('Loading')
        pendingLoadSetMounted!(false)
        pendingLoadResolve!()
        // Give the abandoned boot() every chance to parse and cache the document.
        await new Promise(r => setTimeout(r, 1500))
        const hit = pdfCache.acquire(PENDING_LOAD_KEY)
        hit?.release()
        await expect(hit).toBeUndefined()

        // Leave the story showing a loaded document, not an empty root.
        pendingLoadResolve = undefined
        pendingLoadSetMounted!(true)
        await waitFor(() => expect(pendingLoadResolve).toBeDefined())
        pendingLoadResolve!()
        await waitFor(
            () => expect(canvasElement.querySelector('[data-pdf-page]')).not.toBeNull(),
            { timeout: 8000 },
        )
    },
}

/** One noisy full-page raster per page — every pixel independently randomised, so a real render
 *  reads as "no two sampled points share a colour" and an unpainted canvas reads as one uniform
 *  colour (or fully transparent). A vector fill (one big rect, or even four quadrant rects) doesn't
 *  do this: sampled points inside the SAME fill are pixel-identical once painted, which is
 *  indistinguishable from "not yet painted" — the false positive this fixture avoids. It also
 *  makes each page genuinely expensive to decode+rasterize (image-heavy scans are exactly the real
 *  PDFs the reported jank is about), unlike a handful of vector ops pdf.js draws in under a
 *  millisecond. A DISTINCT image per page (not one shared image referenced 30 times) matters too —
 *  pdf.js can cache a decode behind a shared XObject reference, which would silently make every
 *  page after the first free and hide exactly the cost this fixture exists to reproduce. */
function buildNoiseImage(w: number, h: number, seed: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    // Deterministic per-page noise (a seeded LCG, never Math.random): `verify --baseline` compares
    // shots by HASH, so a randomised raster would report this story as changed on every run.
    let s = (seed * 2654435761) >>> 0
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) >>> 24)
    const img = ctx.createImageData(w, h)
    for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = rnd()
        img.data[i + 1] = rnd()
        img.data[i + 2] = rnd()
        img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.85)
}

/** ≥24-page fixture — bench/pdfScroll.ts's target: enough pages that a continuous or fast-fling
 *  scroll travels well past the initial viewport + overscan window, which is exactly the condition
 *  that exposes a blank page entering the scrollport before its raster lands. */
function buildManyPagesPdf(count = 30): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    for (let i = 0; i < count; i++) {
        if (i > 0) pdf.addPage('letter')
        pdf.addImage(buildNoiseImage(1400, 1848, i + 1), 'JPEG', 0, 0, 612, 792)
        pdf.setFontSize(32)
        pdf.setTextColor(0, 0, 0)
        pdf.text(`Page ${i + 1}`, 72, 100)
    }
    return pdf.output('arraybuffer')
}
let manyPagesBytes: ArrayBuffer | undefined
async function loadManyPages(): Promise<ArrayBuffer> {
    manyPagesBytes ??= buildManyPagesPdf()
    return manyPagesBytes.slice(0)
}

export const ManyPages: Story = {
    render: () => (
        // Narrower than the `Default` fixture's fullscreen width ON PURPOSE — a fit-width letter
        // page under a wide, short viewport renders much TALLER than the viewport (page height =
        // width * 1.294), which makes even a single page of overscan cover several viewport
        // heights of lookahead and never reproduces the reported jank. A narrower pane closer to a
        // real reading pane's proportions keeps page height close to viewport height, which is the
        // condition bench/pdfScroll.ts's numbers are actually about.
        <div style={{ height: '1100px', width: '380px' }}>
            <PdfPages load={loadManyPages} zoom={1} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(
            () =>
                expect(
                    canvasElement.querySelectorAll('[data-pdf-page]').length,
                ).toBe(30),
            { timeout: 8000 },
        )
        await waitFor(
            () => {
                const c = firstCanvas(canvasElement)
                expect(c && inkedPct(c)).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )
    },
}

/** Guards lever 1 (task-5-brief.md): the distance-based overscan in `PdfPages.tsx`'s
 *  `overscanPages` memo, which replaced the old fixed `OVERSCAN = 1`. Reverting that memo to
 *  return the fixed constant passes every OTHER story in the file — this is the one story that
 *  exists to fail when that happens.
 *
 *  Same 380px-wide, 1100px-tall pane as `ManyPages` (see its render comment for why the narrow
 *  width matters: it keeps a fit-width letter page close to viewport height rather than several
 *  viewport-heights tall). A page here renders ~492px tall against the 1100px viewport, so the
 *  distance-based window reaches roughly a viewport's worth of pages past each visible edge —
 *  MEASURED with a live CDP probe against this exact fixture and these exact dimensions, at
 *  `scrollTop: 0`: the real overscan mounts 6 page canvases (3 visible + 3 below, clamped to 0
 *  pages above the already-topmost edge), where the old fixed `OVERSCAN = 1` mounts only 4. The
 *  threshold below is that measured 6, not a guess. */
export const OverscanCoversAViewport: Story = {
    render: () => (
        <div style={{ height: '1100px', width: '380px' }}>
            <PdfPages load={loadManyPages} zoom={1} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(
            () =>
                expect(
                    canvasElement.querySelectorAll('[data-pdf-page]').length,
                ).toBe(30),
            { timeout: 8000 },
        )
        await waitFor(
            () => {
                const mounted = canvasElement.querySelectorAll(
                    '[data-pdf-page] canvas',
                ).length
                expect(mounted).toBeGreaterThanOrEqual(6)
            },
            { timeout: 5000 },
        )
    },
}

let selectionBoxes: PageBox[] = []
let selectionScrollEl: HTMLElement | undefined

/** Guards lever 4 (deferring the text layer off the scroll's critical path, task-5-brief.md step
 *  2): jumping straight to a page far from the top — the same shape a fast scroll leaves behind —
 *  must still end with that page's text selectable once the scroll settles. A regression that
 *  drops the text layer for scroll performance, rather than merely delaying it, fails this with a
 *  selection that never becomes the page's own text.
 *
 *  WHY THE READINESS GATE IS THE MEASURED BOX, NOT THE BOX COUNT. `onLayout` fires as soon as
 *  `status()` is 'ready' and the scroll div exists — which is BEFORE that div's ResizeObserver has
 *  reported a width. `layoutPages` documents and handles that tick (containerW 0 -> every page
 *  `w`/`h` 0), so the callback legitimately hands out six boxes whose `top` values are all within a
 *  few px of each other. Two earlier versions of this story waited on `boxes.length` alone, set
 *  `scrollTop` to one of those ~0 tops, never moved the viewport, and then waited out their whole
 *  budget for a text layer on a page that had never entered `visiblePageRange` — measured, and the
 *  reason this waits on a box with a real height and a scroller that can actually scroll. Once that
 *  gate is real the rest converges in well under 100ms (measured), which is what keeps the story
 *  inside playCheck's flat 10s per-story watchdog. */
export const TextSelectionSurvivesScroll: Story = {
    render: () => {
        selectionBoxes = []
        selectionScrollEl = undefined
        return (
            <div style={{ height: '640px' }}>
                <PdfPages
                    load={loadSixPages}
                    zoom={1}
                    onLayout={l => {
                        selectionBoxes = l.boxes
                        selectionScrollEl = l.scrollEl
                    }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const target = 3
        // A MEASURED layout: six boxes AND a real height on the one this story scrolls to AND a
        // scroller that has something to scroll. See the note above — the count alone is satisfied
        // by the unmeasured first emission.
        await waitFor(
            () => {
                expect(selectionBoxes.length).toBe(6)
                expect(selectionBoxes[target]!.h).toBeGreaterThan(0)
                const el = selectionScrollEl
                expect(el).toBeTruthy()
                expect(el!.scrollHeight).toBeGreaterThan(el!.clientHeight)
            },
            { timeout: 4000 },
        )
        const scroller = selectionScrollEl!
        scroller.scrollTop = selectionBoxes[target]!.top
        scroller.dispatchEvent(new Event('scroll'))

        // The scroll has actually been consumed BY THE COMPONENT, not merely applied to the DOM:
        // PdfPages coalesces scroll work into one rAF, and only that flush's `setScrollTop` moves
        // `visiblePageRange` far enough to mount the target page at all. A mounted canvas under
        // `[data-pdf-page="3"]` is that pipeline's own settled signal — no sleep, no fixed delay.
        await waitFor(
            () => {
                expect(scroller.scrollTop).toBeGreaterThan(0)
                expect(
                    canvasElement.querySelector(
                        `[data-pdf-page="${target}"] canvas`,
                    ),
                ).not.toBeNull()
            },
            { timeout: 2000 },
        )

        // The real guard: select over pdf.js's OWN text layer for that page and require the page's
        // own glyphs back. Asserting the exact string (not merely "non-empty", and not a child
        // count) is what an idle callback that never fires — or one whose layer is built empty —
        // cannot satisfy: page index 3 of `buildSixPagePdf` draws the text "Page 4".
        await waitFor(
            () => {
                const layer = canvasElement.querySelector(
                    `[data-pdf-page="${target}"] [data-testid="pdf-text-layer"]`,
                ) as HTMLElement | null
                expect(layer).not.toBeNull()
                const range = document.createRange()
                range.selectNodeContents(layer!)
                const sel = window.getSelection()!
                sel.removeAllRanges()
                sel.addRange(range)
                expect(sel.toString().trim()).toBe(`Page ${target + 1}`)
            },
            { timeout: 2500 },
        )
    },
}
