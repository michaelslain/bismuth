// app/src/preview/PageInk.stories.tsx
// Visual spec for <PageInk> — ink drawn IN PLACE over an image or PDF preview, stored in the
// file's `<file>.draw` sidecar.
//
// DATA SEAMS, NOT /asset: the fake transport's base is `fake://storybook`, so nothing here points
// at a vault URL. The image is a PNG generated in-story (a real `data:image/png` URL), the PDF is
// a real 2-page jspdf document fed through PdfPages' `load()`, and the sidecar is seeded through
// `fakeTransport({ files })` — the same map `api.read` reads and `api.saveDrawing` (PUT /file)
// writes back into, which is what lets the drawing story read its own save.
//
// WHY THE PLAYS SAMPLE PIXELS: a blank canvas has the same DOM as an inked one, and the risk in
// this component is a coordinate mapping that is off by the page box. So every play reads the
// committed canvas's alpha channel and compares where the ink actually is against
// `logicalToScreen` — the same function the contract is written in.
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { jsPDF } from 'jspdf'
import PageInk, { type PageInkPage } from './PageInk'
import PdfPages from './PdfPages'
import createAnnotationStore from './createAnnotationStore'
import type { PageBox, PageSize } from './pageLayout'
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import {
    emptyDoc,
    parseDoc,
    serializeDoc,
    type DrawingDoc,
    type Stroke,
} from '../../../core/src/drawing/model'
import {
    fitImage,
    logicalToScreen,
    screenToLogical,
    type LogicalBox,
    type ScreenRect,
} from '../../../core/src/drawing/pageInk'
import { themeColors } from '../../../core/src/drawing/theme'
import ScratchPaper from './ScratchPaper'
import { settings, setSettings } from '../settings'

const meta = {
    title: 'Preview/PageInk',
    component: PageInk,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PageInk>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────

const IMG_W = 200
const IMG_H = 150

/** A real PNG, drawn on a canvas and encoded in the browser: a two-tone field with a border, so
 *  the screenshot shows which way up the picture is under the ink. */
let pngUrl: string | undefined
function photoPng(): string {
    if (pngUrl) return pngUrl
    const c = document.createElement('canvas')
    c.width = IMG_W
    c.height = IMG_H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#3a6ea5'
    ctx.fillRect(0, 0, IMG_W, IMG_H)
    ctx.fillStyle = '#d9a441'
    ctx.fillRect(0, IMG_H / 2, IMG_W, IMG_H / 2)
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 4
    ctx.strokeRect(2, 2, IMG_W - 4, IMG_H - 4)
    pngUrl = c.toDataURL('image/png')
    return pngUrl
}

function line(points: Array<[number, number]>, pressure = 200): number[] {
    return points.flatMap(([x, y]) => [x, y, pressure])
}
const pen = (points: Array<[number, number]>): Stroke => ({
    t: 'pen',
    c: 'fg',
    w: 8,
    pts: line(points),
})

/** Fraction of pixels carrying ink (alpha above a faint threshold). 0 on a blank canvas. */
function inkedPct(canvas: HTMLCanvasElement): number {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.height) return 0
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let inked = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 16) inked++
    return inked / (data.length / 4)
}

/** The centre of the inked pixels inside a band, in canvas-relative CSS px, along one axis:
 *  `axis: 'y'` scans rows within the x band `band`, `axis: 'x'` scans columns within the y band.
 *  A CENTRE, not an edge — a stroke's rendered width spreads both edges equally, so the centre
 *  is where the stroke's own points are. `null` when the band holds no ink. */
function inkCentre(
    canvas: HTMLCanvasElement,
    axis: 'x' | 'y',
    band: readonly [number, number],
): number | null {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.clientWidth) return null
    const s = canvas.width / canvas.clientWidth // device px per CSS px
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const b0 = Math.max(0, Math.round(band[0] * s))
    const b1 = Math.round(band[1] * s)
    const along = axis === 'y' ? canvas.height : canvas.width
    const across = axis === 'y' ? canvas.width : canvas.height
    let first = -1
    let last = -1
    for (let a = 0; a < along; a++) {
        let hit = false
        for (let c = b0; c < Math.min(b1, across); c++) {
            const x = axis === 'y' ? c : a
            const y = axis === 'y' ? a : c
            if (data[(y * canvas.width + x) * 4 + 3] > 16) {
                hit = true
                break
            }
        }
        if (!hit) continue
        if (first < 0) first = a
        last = a
    }
    return first < 0 ? null : (first + last) / 2 / s
}

/** Average luminance (0 black … 255 white) of every inked pixel (alpha above the faint threshold
 *  `inkedPct` uses). Proves the stroke is actually VISIBLE against a light page, not merely
 *  present — a light-on-white stroke still carries alpha and passes `inkedPct`, but reads as
 *  invisible to a person (fix 1: default `fg` ink must resolve dark against a white PDF page). */
function inkLuminance(canvas: HTMLCanvasElement): number {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.height) return 255
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let sum = 0
    let n = 0
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] <= 16) continue
        sum += 0.299 * data[i - 3] + 0.587 * data[i - 2] + 0.114 * data[i - 1]
        n++
    }
    return n ? sum / n : 255
}

const committedCanvas = (root: HTMLElement, page: number) =>
    root.querySelector<HTMLCanvasElement>(
        `[data-testid="ink-page-${page}"] [data-testid="ink-canvas-committed"]`,
    )

/** Fraction of pixels carrying ink (as `inkedPct`), restricted to a horizontal band given in
 *  CSS px relative to the canvas element's own client rect. Used to prove ink specifically
 *  IN THE MARGIN (x beyond the page's own rendered width) rather than just present somewhere. */
function inkedPctInXBand(
    canvas: HTMLCanvasElement,
    xBand: readonly [number, number],
): number {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.clientWidth) return 0
    const s = canvas.width / canvas.clientWidth // device px per CSS px
    const x0 = Math.max(0, Math.round(xBand[0] * s))
    const x1 = Math.min(canvas.width, Math.round(xBand[1] * s))
    if (x1 <= x0) return 0
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let inked = 0
    let total = 0
    for (let y = 0; y < canvas.height; y++) {
        for (let x = x0; x < x1; x++) {
            total++
            if (data[(y * canvas.width + x) * 4 + 3] > 16) inked++
        }
    }
    return total ? inked / total : 0
}

// ── Image, legacy sidecar ─────────────────────────────────────────────────────────────────────

const IMAGE_SIDECAR = 'assets/photo.png.draw'
/** Exactly what the retired ANNOTATE seeder wrote for a 200x150 image: the picture embedded as
 *  `images[0]` at `fitImage(200, 150)` = { x: 0, y: 222, w: 816, h: 612 }. */
const LEGACY_BOX: LogicalBox = fitImage(IMG_W, IMG_H)
/** Horizontal stroke through the picture's middle row, and a vertical one to its right. */
const H_Y = LEGACY_BOX.y + LEGACY_BOX.h / 2
const V_X = 680
function legacyImageDoc(): DrawingDoc {
    const d = emptyDoc()
    d.paper.bg = 'blank'
    d.pages = [
        {
            images: [{ src: photoPng(), ...LEGACY_BOX }],
            strokes: [
                pen([
                    [120, H_Y],
                    [560, H_Y],
                ]),
                pen([
                    [V_X, LEGACY_BOX.y + 120],
                    [V_X, LEGACY_BOX.y + 480],
                ]),
            ],
        },
    ]
    return d
}

/** Where the picture renders inside the story frame (host coordinates). Same 4:3 aspect as the
 *  PNG, so the whole rect is picture. */
const IMG_RECT: ScreenRect = { left: 40, top: 30, w: 400, h: 300 }

const ImageFrame = (props: { active: boolean; sidecar: string }) => (
    <div
        style={{ position: 'relative', width: '640px', height: '520px' }}
        data-testid="image-frame"
    >
        <img
            src={photoPng()}
            alt="fixture"
            style={{
                position: 'absolute',
                left: `${IMG_RECT.left}px`,
                top: `${IMG_RECT.top}px`,
                width: `${IMG_RECT.w}px`,
                height: `${IMG_RECT.h}px`,
            }}
        />
        <PageInk
            sidecarPath={props.sidecar}
            binaryPath={props.sidecar.replace(/\.draw$/, '')}
            pages={() => [{ rendered: IMG_RECT, nat: { w: IMG_W, h: IMG_H } }]}
            active={() => props.active}
            onExit={noop}
        />
    </div>
)

/** A sidecar written by the old ANNOTATE surface renders on the live image, in paint-only mode,
 *  with each stroke exactly where the stored `images[0]` box puts it. */
export const LegacyImageSidecar: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { [IMAGE_SIDECAR]: serializeDoc(legacyImageDoc()) },
            }),
        )
        return <ImageFrame active={false} sidecar={IMAGE_SIDECAR} />
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                const c = committedCanvas(canvasElement, 0)
                expect(c).not.toBeNull()
                expect(inkedPct(c!)).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )
        const c = committedCanvas(canvasElement, 0)!
        const frame = canvasElement.querySelector(
            '[data-testid="image-frame"]',
        ) as HTMLElement
        const fr = frame.getBoundingClientRect()
        const cr = c.getBoundingClientRect()
        const offX = cr.left - fr.left
        const offY = cr.top - fr.top

        // The horizontal stroke's centre row, read in an x band away from the vertical stroke.
        const bandX = logicalToScreen({ x: 300, y: H_Y }, IMG_RECT, LEGACY_BOX).x
        const rowY = inkCentre(c, 'y', [bandX - offX - 6, bandX - offX + 6])
        const wantY = logicalToScreen({ x: 300, y: H_Y }, IMG_RECT, LEGACY_BOX).y
        expect(rowY).not.toBeNull()
        await expect(Math.abs(rowY! + offY - wantY)).toBeLessThanOrEqual(2)

        // The vertical stroke's centre column, read in a y band inside its span and well clear
        // of the horizontal stroke's row (a band crossing that row centres on both strokes).
        const midY = LEGACY_BOX.y + 180
        const bandY = logicalToScreen({ x: V_X, y: midY }, IMG_RECT, LEGACY_BOX).y
        const colX = inkCentre(c, 'x', [bandY - offY - 6, bandY - offY + 6])
        const wantX = logicalToScreen({ x: V_X, y: midY }, IMG_RECT, LEGACY_BOX).x
        expect(colX).not.toBeNull()
        await expect(Math.abs(colX! + offX - wantX)).toBeLessThanOrEqual(2)

        // Paint-only: no toolbar, and nothing was written back.
        await expect(canvasElement.querySelector('.draw-toolbar')).toBeNull()
        await expect(await api.read(IMAGE_SIDECAR)).toBe(
            serializeDoc(legacyImageDoc()),
        )
    },
}

// ── PDF, two pages ────────────────────────────────────────────────────────────────────────────

function buildTwoPagePdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    pdf.setFontSize(32)
    pdf.text('Page one', 72, 100)
    pdf.addPage('letter')
    pdf.text('Page two', 72, 100)
    return pdf.output('arraybuffer')
}
let pdfBytes: ArrayBuffer | undefined
async function loadPdf(): Promise<ArrayBuffer> {
    pdfBytes ??= buildTwoPagePdf()
    return pdfBytes.slice(0)
}

const PDF_SIDECAR = 'docs/two.pdf.draw'
const PDF_STROKE_Y = 600
/** A sidecar in the NEW shape (strokes only, no embedded page images), with ink on page 2 only. */
function pdfDoc(): DrawingDoc {
    const d = emptyDoc()
    d.paper.bg = 'blank'
    d.pages = [
        { strokes: [] },
        {
            strokes: [
                pen([
                    [150, PDF_STROKE_Y],
                    [650, PDF_STROKE_Y],
                ]),
            ],
        },
    ]
    return d
}

let pdfLayout: { boxes: PageBox[]; sizes: PageSize[] } | undefined

/** Page 2's ink lands on page 2 — and page 1, which has a canvas because draw mode is on, stays
 *  blank. An off-by-one page mapping paints page 2's strokes on page 1 and fails here. */
export const PdfInkOnSecondPageOnly: Story = {
    render: () => {
        pdfLayout = undefined
        setTransport(
            fakeTransport({ files: { [PDF_SIDECAR]: serializeDoc(pdfDoc()) } }),
        )
        const [pages, setPages] = createSignal<PageInkPage[]>([])
        const ink = (
            <PageInk
                sidecarPath={PDF_SIDECAR}
                binaryPath={PDF_SIDECAR.replace(/\.draw$/, '')}
                pages={pages}
                active={() => true}
                onExit={noop}
            />
        )
        return (
            <div style={{ height: '700px', width: '600px' }}>
                <PdfPages
                    load={loadPdf}
                    zoom={0.4}
                    overlay={ink}
                    onLayout={l => {
                        pdfLayout = l
                        setPages(
                            l.boxes.map((b, i) => ({
                                rendered: { left: b.left, top: b.top, w: b.w, h: b.h },
                                nat: l.sizes[i]!,
                            })),
                        )
                    }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                expect(pdfLayout?.boxes.length).toBe(2)
                const p1 = committedCanvas(canvasElement, 0)
                const p2 = committedCanvas(canvasElement, 1)
                expect(p1).not.toBeNull()
                expect(p2).not.toBeNull()
                expect(inkedPct(p2!)).toBeGreaterThan(0)
            },
            { timeout: 8000 },
        )
        await expect(inkedPct(committedCanvas(canvasElement, 0)!)).toBe(0)
        // Default `fg` ink on a PDF page (which renders white) must be DARK, not the dark
        // theme's light ink InkOverlay/DrawingPage use over the app's own dark chrome (fix 1).
        await expect(
            inkLuminance(committedCanvas(canvasElement, 1)!),
        ).toBeLessThan(128)
        // One ink layer, not two (the getter-prop double mount).
        await expect(
            canvasElement.querySelectorAll('[data-testid="page-ink"]').length,
        ).toBe(1)

        // The stroke sits where the contract says on page 2.
        const c = committedCanvas(canvasElement, 1)!
        const box2 = pdfLayout!.boxes[1]!
        const size2 = pdfLayout!.sizes[1]!
        const rendered: ScreenRect = { left: 0, top: 0, w: box2.w, h: box2.h }
        const lbox = fitImage(size2.w, size2.h)
        const at = logicalToScreen({ x: 400, y: PDF_STROKE_Y }, rendered, lbox)
        const rowY = inkCentre(c, 'y', [at.x - 4, at.x + 4])
        expect(rowY).not.toBeNull()
        await expect(Math.abs(rowY! - at.y)).toBeLessThanOrEqual(2)

        // Draw mode docks the toolbar inside the visible scroll area, and — acceptance 5 — it
        // never overhangs the page's own left edge (the toolbar centres on the PAGE's rendered
        // band, not the wider scroll-content width the page-frame gutter adds around it).
        const bar = canvasElement.querySelector('.draw-toolbar') as HTMLElement
        expect(bar).not.toBeNull()
        const scroller = canvasElement.querySelector(
            '[data-testid="page-ink"]',
        )!.parentElement!.parentElement!.parentElement as HTMLElement
        const sr = scroller.getBoundingClientRect()
        const br = bar.getBoundingClientRect()
        await expect(br.bottom).toBeLessThanOrEqual(sr.bottom)
        await expect(br.top).toBeGreaterThanOrEqual(sr.top)
        await expect(br.left).toBeGreaterThanOrEqual(sr.left)
        await expect(br.right).toBeLessThanOrEqual(sr.right)
        const pageRect = (
            canvasElement.querySelector('[data-pdf-page="0"]') as HTMLElement
        ).getBoundingClientRect()
        await expect(br.left).toBeGreaterThanOrEqual(pageRect.left - 1)
    },
}

/** Fix 3 finding 2 — at zoom > 1 the union of every page's rendered band is wider than the host
 *  (PdfPages' scroll content does not grow to fit its own overflowing, absolutely-positioned
 *  pages), so `dockBand` must clamp to the host's own box. Unclamped, the sticky `.draw-toolbar`'s
 *  `left: 50%` centred on the wider band and drifted the toolbar off the host's right edge. */
export const PdfInkToolbarAtZoom2: Story = {
    render: () => {
        pdfLayout = undefined
        setTransport(
            fakeTransport({ files: { [PDF_SIDECAR]: serializeDoc(pdfDoc()) } }),
        )
        const [pages, setPages] = createSignal<PageInkPage[]>([])
        const ink = (
            <PageInk
                sidecarPath={PDF_SIDECAR}
                binaryPath={PDF_SIDECAR.replace(/\.draw$/, '')}
                pages={pages}
                active={() => true}
                onExit={noop}
            />
        )
        return (
            <div style={{ height: '700px', width: '600px' }}>
                <PdfPages
                    load={loadPdf}
                    zoom={2}
                    overlay={ink}
                    onLayout={l => {
                        pdfLayout = l
                        setPages(
                            l.boxes.map((b, i) => ({
                                rendered: { left: b.left, top: b.top, w: b.w, h: b.h },
                                nat: l.sizes[i]!,
                            })),
                        )
                    }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        // Not just `boxes.length === 2` — that is already true the instant `sizes()` resolves,
        // BEFORE the ResizeObserver's first real measurement, when `containerW` (and so every
        // box's `w`/`h`) is still 0. Wait for the real, laid-out width.
        await waitFor(() => {
            expect(pdfLayout?.boxes.length).toBe(2)
            expect(pdfLayout?.boxes[0]!.w).toBeGreaterThan(100)
        })
        const scroller = canvasElement.querySelector(
            '[data-testid="page-ink"]',
        )!.parentElement!.parentElement!.parentElement as HTMLElement
        await waitFor(() =>
            expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth),
        )
        const bar = canvasElement.querySelector('.draw-toolbar') as HTMLElement
        await waitFor(() =>
            expect(bar?.getBoundingClientRect().width).toBeGreaterThan(50),
        )
        // Nothing scrolled it — the toolbar must be visible at the natural scroll position, not
        // only reachable by scrolling right.
        expect(scroller.scrollLeft).toBe(0)
        const sr = scroller.getBoundingClientRect()
        const br = bar.getBoundingClientRect()
        await expect(br.left).toBeGreaterThanOrEqual(sr.left)
        await expect(br.right).toBeLessThanOrEqual(sr.right)
        await expect(br.top).toBeGreaterThanOrEqual(sr.top)
        await expect(br.bottom).toBeLessThanOrEqual(sr.bottom)
    },
}

// ── PDF, drawable margin ─────────────────────────────────────────────────────────────────────

const MARGIN_SIDECAR = 'docs/margin.pdf.draw'
/** Host px of drawable margin given to page 1 only — page 2 gets none, so an off-by-one margin
 *  leak onto the wrong page's canvas is visible too. */
const MARGIN_W = 200

/** A stroke drawn entirely INSIDE the margin (right of the page's own rendered width) commits,
 *  paints at the margin's actual on-screen position, and never touches page 2 (no margin there).
 *  Probed with pixel bands, not a DOM count — a canvas widened for a margin that never actually
 *  receives paint would still pass any element-count assertion. */
export const PdfMarginInk: Story = {
    render: () => {
        pdfLayout = undefined
        setTransport(fakeTransport({ files: {} }))
        const [pages, setPages] = createSignal<PageInkPage[]>([])
        // Page 1's margin is hand-placed (`marginW` below, page 2 gets none), so PdfPages' own
        // `marginRatio` paper cannot draw it — this is the real ScratchPaper, given the same
        // position/lift/clip PdfPages' `.pdf-margin` class supplies, painted UNDER the ink
        // (earlier in DOM order inside the overlay). Without it the margin ink sat on the dark
        // desk, which is not a look the app ever shows.
        const ink = (
            <>
                <Show when={pages()[0]}>
                    {p => (
                        <ScratchPaper
                            index={0}
                            style={{
                                position: 'absolute',
                                left: `${p().rendered.left + p().rendered.w}px`,
                                top: `${p().rendered.top}px`,
                                width: `${MARGIN_W}px`,
                                height: `${p().rendered.h}px`,
                                'box-sizing': 'border-box',
                                'box-shadow': 'var(--lift)',
                                'clip-path': 'inset(0 -8px -8px 0)',
                            }}
                        />
                    )}
                </Show>
                <PageInk
                    sidecarPath={MARGIN_SIDECAR}
                    binaryPath={MARGIN_SIDECAR.replace(/\.draw$/, '')}
                    pages={pages}
                    active={() => true}
                    onExit={noop}
                />
            </>
        )
        return (
            <div style={{ height: '700px', width: '900px' }}>
                <PdfPages
                    load={loadPdf}
                    zoom={0.4}
                    overlay={ink}
                    onLayout={l => {
                        pdfLayout = l
                        setPages(
                            l.boxes.map((b, i) => ({
                                rendered: {
                                    left: b.left,
                                    top: b.top,
                                    w: b.w,
                                    h: b.h,
                                },
                                nat: l.sizes[i]!,
                                marginW: i === 0 ? MARGIN_W : 0,
                            })),
                        )
                    }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        let live: HTMLCanvasElement | null = null
        await waitFor(
            () => {
                expect(pdfLayout?.boxes.length).toBe(2)
                live = canvasElement.querySelector<HTMLCanvasElement>(
                    '[data-testid="ink-page-0"] [data-testid="ink-canvas-live"]',
                )
                expect(live).not.toBeNull()
            },
            { timeout: 8000 },
        )

        const box0 = pdfLayout!.boxes[0]!
        const el = live!
        const r = el.getBoundingClientRect()

        // The margin is the note-styled ScratchPaper (scratch-notes decision 3): `--editor`,
        // starting at page 1's right edge, as tall as the page and exactly MARGIN_W wide — so the
        // ink below is judged on the look the app really has.
        const page0 = (
            canvasElement.querySelector('[data-pdf-page="0"]') as HTMLElement
        ).getBoundingClientRect()
        const paper = canvasElement.querySelector(
            '[data-pdf-margin="0"]',
        ) as HTMLElement
        expect(paper).not.toBeNull()
        const pr = paper.getBoundingClientRect()
        await expect(Math.abs(pr.left - page0.right)).toBeLessThanOrEqual(1)
        await expect(Math.abs(pr.width - MARGIN_W)).toBeLessThanOrEqual(1)
        await expect(Math.abs(pr.top - page0.top)).toBeLessThanOrEqual(1)
        await expect(Math.abs(pr.height - page0.height)).toBeLessThanOrEqual(1)
        // Entirely within the margin band (x beyond the page's own rendered width, well clear
        // of both edges).
        const y = r.top + 40
        const x0 = r.left + box0.w + 30
        const x1 = r.left + box0.w + MARGIN_W - 30
        const send = (type: string, x: number) =>
            el.dispatchEvent(
                new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    pointerId: 1,
                    pointerType: 'pen',
                    isPrimary: true,
                    pressure: 0.6,
                }),
            )
        send('pointerdown', x0)
        for (let x = x0 + 10; x <= x1; x += 10) send('pointermove', x)
        send('pointerup', x1)

        const committed = committedCanvas(canvasElement, 0)!
        const marginBand: [number, number] = [box0.w, box0.w + MARGIN_W]
        const pageBand: [number, number] = [0, box0.w]
        await waitFor(
            () => {
                expect(
                    inkedPctInXBand(committed, marginBand),
                ).toBeGreaterThan(0)
            },
            { timeout: 4000 },
        )
        // Nothing landed on the page's own area — the stroke never crossed the boundary.
        await expect(inkedPctInXBand(committed, pageBand)).toBe(0)

        // The canvas backing store spans page + margin, at the SAME device-px density as the
        // page itself (prepare()'s `k` comes from `rendered.w` alone) — verified by checking the
        // backing store is at least page+margin wide, scaled by the device ratio.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        await expect(committed.width).toBeGreaterThanOrEqual(
            Math.round((box0.w + MARGIN_W) * dpr) - 2,
        )

        // Page 2 has no margin and the stroke never reached it: no ink there at all.
        const p2 = committedCanvas(canvasElement, 1)
        expect(p2).not.toBeNull()
        await expect(inkedPct(p2!)).toBe(0)

        // THE ACTUAL REGRESSION THIS STORY EXISTS TO CATCH (chunk-1 review): every pixel check
        // above is self-consistent in SCREEN space and would still pass if `toLogical`/
        // `prepare` used the margin-widened SLOT width as their scale denominator instead of the
        // page's own `rendered.w` — the stroke would still paint under the pointer, in the
        // margin band, on a backing store wide enough. Only the SAVED, LOGICAL coordinates catch
        // that: they must land outside the page's own logical box.
        const size0 = pdfLayout!.sizes[0]!
        const lbox0 = fitImage(size0.w, size0.h)
        // The debounced save (600ms, createAnnotationStore.ts) hasn't necessarily landed yet —
        // wait for the sidecar to actually hold a stroke before parsing it.
        let afterMarginStroke: DrawingDoc | undefined
        await waitFor(
            async () => {
                const text = await api.read(MARGIN_SIDECAR)
                expect(text.trim()).not.toBe('')
                const parsed = parseDoc(text)
                expect(parsed.pages[0]?.strokes.length ?? 0).toBeGreaterThan(0)
                afterMarginStroke = parsed
            },
            { timeout: 4000 },
        )
        const marginStroke = afterMarginStroke!.pages[0]!.strokes.at(-1)!
        const marginXs = marginStroke.pts.filter((_, idx) => idx % 3 === 0)
        expect(marginXs.length).toBeGreaterThan(0)
        for (const mx of marginXs) {
            await expect(mx).toBeGreaterThan(lbox0.x + lbox0.w)
        }

        // Stronger still: an ON-PAGE stroke (not in the margin) drawn at the same page-relative
        // point must land at the SAME logical coordinates whether or not ITS page has a margin.
        // Page 0 has one (200px); page 1 (from the same `pages()` above) has none — same
        // relative point on each isolates exactly what a margin is allowed to change (nothing,
        // for page content) from what it isn't (the page's own scale).
        const dx0 = 40
        const dx1 = 140
        const dy = 300
        const drawOnPage = (canvas: HTMLCanvasElement) => {
            const rect = canvas.getBoundingClientRect()
            const sendAt = (type: string, x: number) =>
                canvas.dispatchEvent(
                    new PointerEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        clientX: rect.left + x,
                        clientY: rect.top + dy,
                        pointerId: 2,
                        pointerType: 'pen',
                        isPrimary: true,
                        pressure: 0.6,
                    }),
                )
            sendAt('pointerdown', dx0)
            for (let x = dx0 + 10; x <= dx1; x += 10) sendAt('pointermove', x)
            sendAt('pointerup', dx1)
        }
        const live1 = canvasElement.querySelector<HTMLCanvasElement>(
            '[data-testid="ink-page-1"] [data-testid="ink-canvas-live"]',
        )
        expect(live1).not.toBeNull()
        drawOnPage(el) // page 0's live canvas, still bound from the margin stroke above
        drawOnPage(live1!)

        await waitFor(
            async () => {
                const doc = parseDoc(await api.read(MARGIN_SIDECAR))
                expect(doc.pages[0]!.strokes.length).toBe(2)
                expect(doc.pages[1]!.strokes.length).toBe(1)
            },
            { timeout: 4000 },
        )
        const finalDoc = parseDoc(await api.read(MARGIN_SIDECAR))
        const onPageStroke0 = finalDoc.pages[0]!.strokes[1]!
        const onPageStroke1 = finalDoc.pages[1]!.strokes[0]!
        const xs0 = onPageStroke0.pts.filter((_, i) => i % 3 === 0)
        const ys0 = onPageStroke0.pts.filter((_, i) => i % 3 === 1)
        const xs1 = onPageStroke1.pts.filter((_, i) => i % 3 === 0)
        const ys1 = onPageStroke1.pts.filter((_, i) => i % 3 === 1)
        expect(xs0.length).toBe(xs1.length)
        for (let i = 0; i < xs0.length; i++) {
            await expect(Math.abs(xs0[i]! - xs1[i]!)).toBeLessThanOrEqual(1)
            await expect(Math.abs(ys0[i]! - ys1[i]!)).toBeLessThanOrEqual(1)
        }

        // Acceptance 5: draw mode's toolbar stays inside the scroll viewport and never overhangs
        // page 0's own left edge — the margin band to its right is fair game (the toolbar may
        // range across page + scratch), the page's own left edge is not.
        const bar = canvasElement.querySelector('.draw-toolbar') as HTMLElement
        expect(bar).not.toBeNull()
        const scroller = canvasElement.querySelector(
            '[data-testid="page-ink"]',
        )!.parentElement!.parentElement!.parentElement as HTMLElement
        const sr = scroller.getBoundingClientRect()
        const br = bar.getBoundingClientRect()
        const pageRect = (
            canvasElement.querySelector('[data-pdf-page="0"]') as HTMLElement
        ).getBoundingClientRect()
        await expect(br.left).toBeGreaterThanOrEqual(sr.left)
        await expect(br.right).toBeLessThanOrEqual(sr.right)
        await expect(br.left).toBeGreaterThanOrEqual(pageRect.left - 1)
    },
}

// ── PDF, note ink on the strip ──────────────────────────────────────────────────────────────

/** The colour counterpart to `inkedPctInXBand`: mean luminance of the INKED pixels (as
 *  `inkLuminance`) restricted to a horizontal band, CSS px relative to the canvas's own client
 *  rect. `255` (blank-canvas white) when the band holds no ink, matching `inkLuminance`'s own
 *  fallback. */
function inkLuminanceInXBand(
    canvas: HTMLCanvasElement,
    xBand: readonly [number, number],
): number {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.clientWidth) return 255
    const s = canvas.width / canvas.clientWidth
    const x0 = Math.max(0, Math.round(xBand[0] * s))
    const x1 = Math.min(canvas.width, Math.round(xBand[1] * s))
    if (x1 <= x0) return 255
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let sum = 0
    let n = 0
    for (let y = 0; y < canvas.height; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * canvas.width + x) * 4
            if (data[i + 3]! <= 16) continue
            sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
            n++
        }
    }
    return n ? sum / n : 255
}

function hexLuminance(hex: string): number {
    const n = parseInt(hex.replace('#', ''), 16)
    const r = (n >> 16) & 255
    const g = (n >> 8) & 255
    const b = n & 255
    return 0.299 * r + 0.587 * g + 0.114 * b
}

const NOTE_INK_SIDECAR = 'docs/note-ink.pdf.draw'
const NOTE_INK_MARGIN_W = 200

/** Decision 3: the strip is a note-styled surface, so `fg` ink drawn there resolves like note ink
 *  (InkOverlay's dark bucket — light ink) while `fg` ink on the page itself keeps the light bucket
 *  (dark ink), same as before. A stroke entirely on the page samples DARK; the same colour stroke
 *  entirely on the strip samples LIGHT — this would fail (both bands reading close to the page's
 *  dark ink) if the strip still painted with the light bucket. */
export const MarginInkUsesNoteInk: Story = {
    render: () => {
        pdfLayout = undefined
        setTransport(fakeTransport({ files: {} }))
        const [pages, setPages] = createSignal<PageInkPage[]>([])
        const ink = (
            <>
                <Show when={pages()[0]}>
                    {p => (
                        <ScratchPaper
                            index={0}
                            style={{
                                position: 'absolute',
                                left: `${p().rendered.left + p().rendered.w}px`,
                                top: `${p().rendered.top}px`,
                                width: `${NOTE_INK_MARGIN_W}px`,
                                height: `${p().rendered.h}px`,
                                'box-sizing': 'border-box',
                            }}
                        />
                    )}
                </Show>
                <PageInk
                    sidecarPath={NOTE_INK_SIDECAR}
                    binaryPath={NOTE_INK_SIDECAR.replace(/\.draw$/, '')}
                    pages={pages}
                    active={() => true}
                    onExit={noop}
                />
            </>
        )
        return (
            <div style={{ height: '700px', width: '900px' }}>
                <PdfPages
                    load={loadPdf}
                    zoom={0.4}
                    overlay={ink}
                    onLayout={l => {
                        pdfLayout = l
                        setPages([
                            {
                                rendered: {
                                    left: l.boxes[0]!.left,
                                    top: l.boxes[0]!.top,
                                    w: l.boxes[0]!.w,
                                    h: l.boxes[0]!.h,
                                },
                                nat: l.sizes[0]!,
                                marginW: NOTE_INK_MARGIN_W,
                            },
                        ])
                    }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        let live: HTMLCanvasElement | null = null
        await waitFor(
            () => {
                expect(pdfLayout?.boxes.length).toBe(2)
                live = canvasElement.querySelector<HTMLCanvasElement>(
                    '[data-testid="ink-page-0"] [data-testid="ink-canvas-live"]',
                )
                expect(live).not.toBeNull()
            },
            { timeout: 8000 },
        )
        const box0 = pdfLayout!.boxes[0]!
        const el = live!
        const r = el.getBoundingClientRect()

        // ONE stroke that crosses the page/strip boundary (box0.w) — not two separate strokes —
        // so a single-bucket-per-stroke implementation (colour chosen once, e.g. by the first
        // point) cannot pass this: it would paint the whole stroke in one colour, and the two
        // bands below would read the same shade instead of each matching its own bucket.
        const y = r.top + 60
        const x0 = r.left + box0.w - 80
        const x1 = r.left + box0.w + 80
        const send = (type: string, x: number) =>
            el.dispatchEvent(
                new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    pointerId: 1,
                    pointerType: 'pen',
                    isPrimary: true,
                    pressure: 0.6,
                }),
            )
        send('pointerdown', x0)
        for (let x = x0 + 10; x <= x1; x += 10) send('pointermove', x)
        send('pointerup', x1)

        const committed = committedCanvas(canvasElement, 0)!
        // Bands sit clear of the boundary itself (10px of margin on each side) so antialiasing at
        // the clip split doesn't contaminate either read.
        const pageBand: [number, number] = [box0.w - 70, box0.w - 10]
        const marginBand: [number, number] = [box0.w + 10, box0.w + 70]
        await waitFor(
            () => {
                expect(inkedPctInXBand(committed, pageBand)).toBeGreaterThan(0)
                expect(
                    inkedPctInXBand(committed, marginBand),
                ).toBeGreaterThan(0)
            },
            { timeout: 4000 },
        )

        const pageLum = inkLuminanceInXBand(committed, pageBand)
        const marginLum = inkLuminanceInXBand(committed, marginBand)
        const pageExpected = hexLuminance(themeColors('light').fg)
        const marginExpected = hexLuminance(themeColors('dark').fg)
        // Each band matches its OWN bucket's ink colour closely…
        await expect(Math.abs(pageLum - pageExpected)).toBeLessThanOrEqual(4)
        await expect(Math.abs(marginLum - marginExpected)).toBeLessThanOrEqual(
            4,
        )
        // …and the two are clearly different shades, not the same ink read twice.
        await expect(marginLum - pageLum).toBeGreaterThan(40)
    },
}

// ── Drawing: a new sidecar, saved in logical coordinates, undoable ────────────────────────────

const NEW_SIDECAR = 'assets/fresh.png.draw'

/** Draw a stroke with real pointer events on an image with NO sidecar yet: the save lands in the
 *  fake transport as a strokes-only DrawingDoc whose points are `screenToLogical` of the pointer,
 *  and Mod+Z on the focused host takes it back out. */
export const DrawSavesLogicalStroke: Story = {
    render: () => {
        setTransport(fakeTransport({ files: {} }))
        return <ImageFrame active={true} sidecar={NEW_SIDECAR} />
    },
    play: async ({ canvasElement }) => {
        let live: HTMLCanvasElement | null = null
        await waitFor(
            () => {
                live = canvasElement.querySelector<HTMLCanvasElement>(
                    '[data-testid="ink-page-0"] [data-testid="ink-canvas-live"]',
                )
                expect(live).not.toBeNull()
                expect(canvasElement.querySelector('.draw-toolbar')).not.toBeNull()
            },
            { timeout: 5000 },
        )
        const el = live!
        const r = el.getBoundingClientRect()
        const y = r.top + 120
        const x0 = r.left + 60
        const x1 = r.left + 300
        const send = (type: string, x: number) =>
            el.dispatchEvent(
                new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    pointerId: 1,
                    pointerType: 'pen',
                    isPrimary: true,
                    pressure: 0.6,
                }),
            )
        send('pointerdown', x0)
        for (let x = x0 + 20; x <= x1; x += 20) send('pointermove', x)
        send('pointerup', x1)

        const rect: ScreenRect = { left: r.left, top: r.top, w: r.width, h: r.height }
        const box = fitImage(IMG_W, IMG_H)
        const want0 = screenToLogical({ x: x0, y }, rect, box)
        const want1 = screenToLogical({ x: x1, y }, rect, box)

        let saved: DrawingDoc | undefined
        await waitFor(
            async () => {
                const text = await api.read(NEW_SIDECAR)
                expect(text.trim()).not.toBe('')
                saved = parseDoc(text)
                expect(saved.pages[0]!.strokes).toHaveLength(1)
            },
            { timeout: 4000 },
        )
        const page = saved!.pages[0]!
        await expect(page.images).toBeUndefined()
        await expect(saved!.paper.bg).toBe('blank')
        const pts = page.strokes[0]!.pts
        const xs = pts.filter((_, i) => i % 3 === 0)
        const ys = pts.filter((_, i) => i % 3 === 1)
        // Every point on the pointer's row (saved rounding is 1 logical unit).
        for (const py of ys) await expect(Math.abs(py - want0.y)).toBeLessThanOrEqual(1.5)
        await expect(Math.abs(Math.min(...xs) - want0.x)).toBeLessThanOrEqual(3)
        await expect(Math.abs(Math.max(...xs) - want1.x)).toBeLessThanOrEqual(3)

        // Undo on the focused host removes it, and the removal is saved too.
        const host = canvasElement.querySelector(
            '[data-testid="page-ink"]',
        ) as HTMLElement
        host.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'z',
                metaKey: true,
                bubbles: true,
                cancelable: true,
            }),
        )
        await waitFor(
            async () => {
                const after = parseDoc(await api.read(NEW_SIDECAR))
                expect(after.pages[0]!.strokes).toHaveLength(0)
            },
            { timeout: 4000 },
        )
        await expect(inkedPct(committedCanvas(canvasElement, 0)!)).toBe(0)
    },
}

// ── Drawing through an externally-owned store ───────────────────────────────────────────────

const STORE_SIDECAR = 'assets/store.png.draw'

/** PreviewView's wave-2 wiring hands PageInk a store it already created (so ink, highlights and
 *  bookmarks share one writer) instead of letting PageInk make its own — this proves that path
 *  end to end with a REAL `createAnnotationStore`, not PageInk's fallback. */
const ExternalStoreFrame = () => {
    const store = createAnnotationStore(
        () => STORE_SIDECAR,
        () => STORE_SIDECAR.replace(/\.draw$/, ''),
    )
    return (
        <div
            style={{ position: 'relative', width: '640px', height: '520px' }}
            data-testid="image-frame"
        >
            <img
                src={photoPng()}
                alt="fixture"
                style={{
                    position: 'absolute',
                    left: `${IMG_RECT.left}px`,
                    top: `${IMG_RECT.top}px`,
                    width: `${IMG_RECT.w}px`,
                    height: `${IMG_RECT.h}px`,
                }}
            />
            <PageInk
                sidecarPath={STORE_SIDECAR}
                binaryPath={STORE_SIDECAR.replace(/\.draw$/, '')}
                pages={() => [{ rendered: IMG_RECT, nat: { w: IMG_W, h: IMG_H } }]}
                active={() => true}
                onExit={noop}
                store={store}
            />
        </div>
    )
}

export const DrawThroughExternalStore: Story = {
    render: () => {
        setTransport(fakeTransport({ files: {} }))
        return <ExternalStoreFrame />
    },
    play: async ({ canvasElement }) => {
        let live: HTMLCanvasElement | null = null
        await waitFor(
            () => {
                live = canvasElement.querySelector<HTMLCanvasElement>(
                    '[data-testid="ink-page-0"] [data-testid="ink-canvas-live"]',
                )
                expect(live).not.toBeNull()
            },
            { timeout: 5000 },
        )
        const el = live!
        const r = el.getBoundingClientRect()
        const y = r.top + 100
        const x0 = r.left + 50
        const x1 = r.left + 250
        const send = (type: string, x: number) =>
            el.dispatchEvent(
                new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    pointerId: 1,
                    pointerType: 'pen',
                    isPrimary: true,
                    pressure: 0.6,
                }),
            )
        send('pointerdown', x0)
        for (let x = x0 + 20; x <= x1; x += 20) send('pointermove', x)
        send('pointerup', x1)

        // The debounced save (600ms, inside createAnnotationStore) reaches the fake transport's
        // PUT /file, so a plain api.read of the sidecar sees the committed stroke.
        await waitFor(
            async () => {
                const text = await api.read(STORE_SIDECAR)
                expect(text.trim()).not.toBe('')
                const saved = parseDoc(text)
                expect(saved.pages[0]!.strokes).toHaveLength(1)
            },
            { timeout: 4000 },
        )
    },
}

// ── Task 10: onHostKey reads the catalog, not literals ─────────────────────────────────────
// Same contract as InkOverlay.stories.tsx's RebindingInkKeysMovesThem: `exit-draw-mode` /
// `ink-undo` / `ink-redo` must be read from `settings.keybindings` on every keydown here too, so
// a rebind moves the shortcut rather than only the editor's copy of it.

const REBIND_SIDECAR = 'assets/rebind.png.draw'
let pageInkExits = 0

const RebindFrame = () => (
    <div
        style={{ position: 'relative', width: '640px', height: '520px' }}
        data-testid="rebind-frame"
    >
        <img
            src={photoPng()}
            alt="fixture"
            style={{
                position: 'absolute',
                left: `${IMG_RECT.left}px`,
                top: `${IMG_RECT.top}px`,
                width: `${IMG_RECT.w}px`,
                height: `${IMG_RECT.h}px`,
            }}
        />
        <PageInk
            sidecarPath={REBIND_SIDECAR}
            binaryPath={REBIND_SIDECAR.replace(/\.draw$/, '')}
            pages={() => [{ rendered: IMG_RECT, nat: { w: IMG_W, h: IMG_H } }]}
            active={() => true}
            onExit={() => {
                pageInkExits++
            }}
        />
    </div>
)

/** Task 10: rebinding `ink-undo`/`ink-redo`/`exit-draw-mode` moves all three shortcuts on
 *  PageInk's own host — the shipped default stops firing and the new combo takes over, proven
 *  against a real painted stroke and a real onExit call rather than a call count that a
 *  hardcoded handler happening to match the defaults could also pass. */
export const RebindingInkKeysMovesThem: Story = {
    render: () => {
        setTransport(fakeTransport({ files: {} }))
        pageInkExits = 0
        return <RebindFrame />
    },
    play: async ({ canvasElement }) => {
        let live: HTMLCanvasElement | null = null
        await waitFor(
            () => {
                live = canvasElement.querySelector<HTMLCanvasElement>(
                    '[data-testid="ink-page-0"] [data-testid="ink-canvas-live"]',
                )
                expect(live).not.toBeNull()
            },
            { timeout: 5000 },
        )
        const host = canvasElement.querySelector(
            '[data-testid="page-ink"]',
        ) as HTMLElement
        expect(host).not.toBeNull()

        const restoreUndo = settings.keybindings['ink-undo']
        const restoreRedo = settings.keybindings['ink-redo']
        const restoreExit = settings.keybindings['exit-draw-mode']
        try {
            setSettings('keybindings', 'ink-undo', 'Mod+Shift+U')
            setSettings('keybindings', 'ink-redo', 'Mod+Shift+R')
            setSettings('keybindings', 'exit-draw-mode', 'Mod+Shift+X')

            const el = live!
            const r = el.getBoundingClientRect()
            const y = r.top + 100
            const x0 = r.left + 50
            const x1 = r.left + 250
            const send = (type: string, x: number) =>
                el.dispatchEvent(
                    new PointerEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        clientX: x,
                        clientY: y,
                        pointerId: 1,
                        pointerType: 'pen',
                        isPrimary: true,
                        pressure: 0.6,
                    }),
                )
            send('pointerdown', x0)
            for (let x = x0 + 20; x <= x1; x += 20) send('pointermove', x)
            send('pointerup', x1)

            await waitFor(
                () => {
                    const c = committedCanvas(canvasElement, 0)
                    expect(c).not.toBeNull()
                    expect(inkedPct(c!)).toBeGreaterThan(0)
                },
                { timeout: 4000 },
            )
            const inked = () => inkedPct(committedCanvas(canvasElement, 0)!) > 0

            // The OLD default Mod+Z no longer undoes — ink-undo moved to Mod+Shift+U.
            host.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'z',
                    code: 'KeyZ',
                    metaKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )
            await new Promise(res => setTimeout(res, 150))
            expect(inked()).toBe(true)

            // The NEW combo does — a real shifted U reports an uppercase `key`.
            host.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'U',
                    code: 'KeyU',
                    metaKey: true,
                    shiftKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )
            await waitFor(() => expect(inked()).toBe(false), { timeout: 4000 })

            // ink-redo, the same proof: the OLD default Mod+Shift+Z does nothing…
            host.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Z',
                    code: 'KeyZ',
                    metaKey: true,
                    shiftKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )
            await new Promise(res => setTimeout(res, 150))
            expect(inked()).toBe(false)
            // …the NEW combo (Mod+Shift+R) restores the stroke.
            host.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'R',
                    code: 'KeyR',
                    metaKey: true,
                    shiftKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )
            await waitFor(() => expect(inked()).toBe(true), { timeout: 4000 })

            // exit-draw-mode: the OLD default Escape no longer calls onExit…
            host.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    bubbles: true,
                    cancelable: true,
                }),
            )
            await new Promise(res => setTimeout(res, 50))
            expect(pageInkExits).toBe(0)
            // …the NEW combo (Mod+Shift+X) does.
            host.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'X',
                    code: 'KeyX',
                    metaKey: true,
                    shiftKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )
            expect(pageInkExits).toBe(1)
        } finally {
            setSettings('keybindings', 'ink-undo', restoreUndo)
            setSettings('keybindings', 'ink-redo', restoreRedo)
            setSettings('keybindings', 'exit-draw-mode', restoreExit)
        }
    },
}
