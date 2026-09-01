// Visual spec for <DrawingPage> — the full `.draw` editor surface (Toolbar + zoomable page
// stage over <DrawingCanvas>), routed by PaneContent for any path ending `.draw`. Unlike
// DrawingCanvas.stories.tsx (which drives the canvas directly with a hand-built doc),
// DrawingPage reads its doc the REAL way — `api.read(path)` → `parseDoc()` — so these stories
// exercise the fetch-then-render path through the fakeTransport seam (SheetView/InkOverlay's
// pattern), not a doc handed straight in as a prop.
//
// CANVAS CAVEAT (see the component header + `docs/…` "Storybook is the visual surface" rule): a
// DOM element count proves a <canvas> mounted, never that it painted anything. `Populated`'s
// `play` samples real pixel COLOR across the canvas and reports the inked fraction — the only
// way to tell "a stroke rendered" from "the canvas is blank" from outside the render call. Alpha
// alone can't do this: render2d.ts's `fillRect(0,0,w,h)` paints an OPAQUE paper background first,
// so every pixel's alpha is 255 whether or not any stroke exists — a first draft of this file
// measured alpha and got a flat 100% "inked" on a truly blank page. Distance from the background
// COLOR (sampled from the canvas's own corner, never a hardcoded token) is what actually
// distinguishes ink from paper.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { DrawingPage } from './DrawingPage'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import type { DrawingDoc } from '../../../core/src/drawing/model'
import './Drawing.css'

const meta = {
    title: 'Drawing/DrawingPage',
    component: DrawingPage,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DrawingPage>

export default meta
type Story = StoryObj<typeof meta>

const EMPTY_PATH = 'sketches/blank.draw'
const POPULATED_PATH = 'sketches/annotated.draw'

/** A truly flat page — `paper: { bg: "blank" }` (no grid/dot texture, unlike `emptyDoc()`'s own
 *  default of `"grid"`) and no strokes, so every pixel is provably the same paper-fill color and
 *  the inked-fraction assertion below has no ambiguity to account for. */
function blankDoc(): DrawingDoc {
    return { v: 1, kind: 'drawing', paper: { bg: 'blank' }, pages: [{ strokes: [] }] }
}

/** A pen swoop + a highlighter bar over blank paper (no grid texture, for the same reason as
 *  `blankDoc()` — isolates "did a stroke paint" from "does the paper texture paint"), serialized
 *  the way the real sidecar is (`serializeDoc`/`api.saveDrawing` write this exact JSON shape). */
function populatedDoc(): DrawingDoc {
    return {
        v: 1,
        kind: 'drawing',
        paper: { bg: 'blank' },
        pages: [
            {
                strokes: [
                    {
                        t: 'pen',
                        c: 'fg',
                        w: 5,
                        pts: [
                            120, 200, 180, 220, 140, 200, 340, 120, 220, 460,
                            180, 210, 560, 300, 190, 500, 400, 170,
                        ],
                    },
                    {
                        t: 'hl',
                        c: '#f2b705',
                        w: 22,
                        pts: [140, 460, 255, 420, 460, 255],
                    },
                ],
            },
        ],
    }
}

/** Fraction of sampled pixels on `canvas` whose color differs meaningfully from the canvas's OWN
 *  corner pixel (assumed paper, never a stroke) — sampled on a grid rather than reading every
 *  pixel (cheap enough to run in a `play`). NOT alpha: render2d.ts fills the whole canvas opaque
 *  before drawing anything, so alpha is 255 everywhere regardless of ink — only color distance
 *  can tell paper from a stroke. Mirrors InkOverlay.stories.tsx's pixel-sampling approach; this is
 *  a different case (fraction over the whole page, not "topmost inked row in a band"), so it
 *  earns its own small helper rather than reusing that one. */
function inkedFraction(canvas: HTMLCanvasElement, step = 6): number {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.height) return 0
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const at = (x: number, y: number) => (y * canvas.width + x) * 4
    const bgI = at(0, 0)
    const [br, bg, bb] = [data[bgI], data[bgI + 1], data[bgI + 2]]
    let sampled = 0
    let inked = 0
    for (let y = 0; y < canvas.height; y += step) {
        for (let x = 0; x < canvas.width; x += step) {
            sampled++
            const i = at(x, y)
            const dr = data[i] - br
            const dg = data[i + 1] - bg
            const db = data[i + 2] - bb
            // ~30/channel euclidean distance — well above anti-aliasing noise, well below a
            // deliberate stroke color's contrast against the paper fill.
            if (dr * dr + dg * dg + db * db > 900) inked++
        }
    }
    return sampled === 0 ? 0 : inked / sampled
}

/** A flat, strokeless page: the inked fraction must read exactly (or effectively) zero — every
 *  sampled pixel matches the corner reference. This is the control the `Populated` story's
 *  non-zero reading is judged against; without it, a renderer that painted EVERYTHING the same
 *  wrong color would also read as "0% different from itself" and look identical to a real blank
 *  page in this metric. */
export const Blank: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { [EMPTY_PATH]: JSON.stringify(blankDoc()) } }),
        )
        return <DrawingPage path={EMPTY_PATH} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByText('ADD PAGE')).toBeInTheDocument()
        const drawCanvas = canvasElement.querySelector<HTMLCanvasElement>(
            '.draw-canvas:not(.draw-live)',
        )
        expect(drawCanvas).not.toBeNull()
        expect(inkedFraction(drawCanvas!)).toBe(0)
    },
}

/** A real sidecar with two committed strokes, read back through `api.read()` the same way the
 *  app opens an existing `.draw` file. `play` proves ink actually landed on the canvas by
 *  sampling pixel COLOR, not by counting DOM nodes (a blank canvas has the identical DOM) and
 *  not by reading alpha (identical — opaque — on both a blank and a stroked page). */
export const Populated: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [POPULATED_PATH]: JSON.stringify(populatedDoc()),
                },
            }),
        )
        return <DrawingPage path={POPULATED_PATH} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByText('ADD PAGE')).toBeInTheDocument()
        const drawCanvas = canvasElement.querySelector<HTMLCanvasElement>(
            '.draw-canvas:not(.draw-live)',
        )
        expect(drawCanvas).not.toBeNull()
        let fraction = 0
        await waitFor(
            () => {
                fraction = inkedFraction(drawCanvas!)
                // A pen swoop + a wide highlighter bar cover a small but unmistakable share of an
                // 816x1056 page — comfortably above sampling/anti-aliasing noise (Blank's exact 0
                // above; measured here at ~0.0048 on a 6px sampling grid).
                expect(fraction).toBeGreaterThan(0.002)
            },
            { timeout: 5000 },
        )
    },
}
