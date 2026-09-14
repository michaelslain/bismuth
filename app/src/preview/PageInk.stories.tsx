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
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { jsPDF } from 'jspdf'
import PageInk, { type PageInkPage } from './PageInk'
import PdfPages from './PdfPages'
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

        // Draw mode docks the toolbar inside the visible scroll area.
        const bar = canvasElement.querySelector('.draw-toolbar') as HTMLElement
        expect(bar).not.toBeNull()
        const scroller = canvasElement.querySelector(
            '[data-testid="page-ink"]',
        )!.parentElement!.parentElement!.parentElement as HTMLElement
        const sr = scroller.getBoundingClientRect()
        const br = bar.getBoundingClientRect()
        await expect(br.bottom).toBeLessThanOrEqual(sr.bottom)
        await expect(br.top).toBeGreaterThanOrEqual(sr.top)
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
