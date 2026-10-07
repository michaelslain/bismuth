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
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { DrawingPage } from './DrawingPage'
import { setTransport, type Transport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { TextButton } from '../ui/TextButton'
import type { DrawingDoc } from '../../../core/src/drawing/model'
import canvasStyles from './DrawingCanvas.module.css'

const meta = {
    title: 'Drawing/DrawingPage',
    component: DrawingPage,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DrawingPage>

export default meta
type Story = StoryObj<typeof meta>

const EMPTY_PATH = 'sketches/blank.draw'
const POPULATED_PATH = 'sketches/annotated.draw'
const OTHER_PATH = 'sketches/other.draw'

/** A truly flat page — `paper: { bg: "blank" }` (no grid/dot texture, unlike `emptyDoc()`'s own
 *  default of `"grid"`) and no strokes, so every pixel is provably the same paper-fill color and
 *  the inked-fraction assertion below has no ambiguity to account for. */
function blankDoc(): DrawingDoc {
    return {
        v: 1,
        kind: 'drawing',
        paper: { bg: 'blank' },
        pages: [{ strokes: [] }],
    }
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
            fakeTransport({
                files: { [EMPTY_PATH]: JSON.stringify(blankDoc()) },
            }),
        )
        return <DrawingPage path={EMPTY_PATH} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByText('add page')).toBeInTheDocument()
        const drawCanvas = canvasElement.querySelector<HTMLCanvasElement>(
            `.${canvasStyles['draw-canvas']}:not(.${canvasStyles['draw-live']})`,
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
        await expect(await canvas.findByText('add page')).toBeInTheDocument()
        const drawCanvas = canvasElement.querySelector<HTMLCanvasElement>(
            `.${canvasStyles['draw-canvas']}:not(.${canvasStyles['draw-live']})`,
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

// --- Read failures must never reach the file ---------------------------------------------
// DrawingPage used to turn ANY read failure into an empty doc, and the next autosave wrote that
// empty doc over the real file. These stories wrap the in-memory transport so every write the page
// makes is RECORDED, then assert on the recording — an error banner alone would not prove the
// data-loss fix, only that nothing was written does.

/** Every `PUT /file` the page made, in order — what `api.saveDrawing` sends. */
let writes: { path: string; contents: string }[] = []

/** The in-memory transport, with writes recorded and reads of `failingPath` made to misbehave:
 *  `fail` throws (a locked file, a permissions blip), `body` answers with that text instead, and
 *  `failTimes` limits how many reads misbehave before the real file shows through (a transient
 *  error that a retry gets past). */
function recordingTransport(
    files: Record<string, string>,
    bad?: { path: string; fail?: string; body?: string; failTimes?: number },
): Transport {
    writes = []
    const base = fakeTransport({ files })
    let badReads = 0
    return {
        ...base,
        getText: async (path: string) => {
            if (
                bad &&
                path.includes(encodeURIComponent(bad.path)) &&
                badReads < (bad.failTimes ?? Infinity)
            ) {
                badReads++
                if (bad.fail !== undefined) throw new Error(bad.fail)
                return bad.body ?? ''
            }
            return base.getText(path)
        },
        put: async (path: string, body: unknown) => {
            if (path === '/file') writes.push(body as (typeof writes)[number])
            return base.put(path, body)
        },
    }
}

/** Longer than DrawingEditor's 600ms autosave debounce, so a write that WOULD have been scheduled
 *  has fired by the time the story reads `writes`. Waiting is the only way to assert an absence. */
const PAST_AUTOSAVE_MS = 1000
const settle = () =>
    new Promise(resolve => setTimeout(resolve, PAST_AUTOSAVE_MS))

/** The read throws. The page must say so — not render a blank drawing that looks new — and, with
 *  no editor mounted, nothing can ever save over the real file. */
export const ReadFailed: Story = {
    render: () => {
        setTransport(
            recordingTransport(
                { [POPULATED_PATH]: JSON.stringify(populatedDoc()) },
                { path: POPULATED_PATH, fail: 'EACCES: file is locked' },
            ),
        )
        return <DrawingPage path={POPULATED_PATH} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const alert = await canvas.findByRole('alert')
        await expect(alert).toHaveTextContent("couldn't open this drawing")
        await expect(alert).toHaveTextContent('EACCES: file is locked')
        // Not an editor: no page stage to draw on, so no stroke or add-page can be committed.
        await expect(canvas.queryByText('add page')).toBeNull()
        expect(canvasElement.querySelector('canvas')).toBeNull()
        await settle()
        // The data-loss assertion: NOTHING was written over the file.
        expect(writes).toEqual([])
    },
}

/** The file exists but is not a drawing the parser accepts (a corrupted byte). Same contract: it is
 *  someone's file, not an empty one, so refuse to open it and never write. */
export const ReadCorrupt: Story = {
    render: () => {
        setTransport(
            recordingTransport(
                { [POPULATED_PATH]: JSON.stringify(populatedDoc()) },
                {
                    path: POPULATED_PATH,
                    body: '{"v":1,"kind":"drawing","pages":[{"strokes":[',
                },
            ),
        )
        return <DrawingPage path={POPULATED_PATH} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByRole('alert')).toBeInTheDocument()
        await expect(canvas.queryByText('add page')).toBeNull()
        await settle()
        expect(writes).toEqual([])
    },
}

/** A transient failure: the first read throws, the user presses retry, the second succeeds. The
 *  drawing that opens is the REAL one, and the first save carries its original strokes forward —
 *  so a blip no longer ends with an empty file on disk. */
export const ReadFailedThenRetry: Story = {
    render: () => {
        setTransport(
            recordingTransport(
                { [POPULATED_PATH]: JSON.stringify(populatedDoc()) },
                {
                    path: POPULATED_PATH,
                    fail: 'EAGAIN: try again',
                    failTimes: 1,
                },
            ),
        )
        return <DrawingPage path={POPULATED_PATH} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByRole('alert')).toBeInTheDocument()
        expect(writes).toEqual([])
        await userEvent.click(
            await canvas.findByRole('button', { name: /retry/ }),
        )
        const addPage = await canvas.findByText('add page')
        expect(canvas.queryByRole('alert')).toBeNull()
        await userEvent.click(addPage)
        await waitFor(() => expect(writes.length).toBe(1), { timeout: 5000 })
        const saved = JSON.parse(writes[0].contents) as DrawingDoc
        expect(writes[0].path).toBe(POPULATED_PATH)
        expect(saved.pages.length).toBe(2)
        // The original page's two strokes survived — the file was not replaced by an empty doc.
        expect(saved.pages[0].strokes.length).toBe(2)
    },
}

/** The ordinary new-drawing path, which the fix must not regress: the file does not exist yet, GET
 *  /file answers an empty body, and that is a legitimate blank drawing that opens, edits and saves
 *  normally. */
export const NewDrawing: Story = {
    render: () => {
        setTransport(recordingTransport({}))
        return <DrawingPage path="sketches/new.draw" />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const addPage = await canvas.findByText('add page')
        expect(canvas.queryByRole('alert')).toBeNull()
        await userEvent.click(addPage)
        await waitFor(() => expect(writes.length).toBe(1), { timeout: 5000 })
        const saved = JSON.parse(writes[0].contents) as DrawingDoc
        expect(writes[0].path).toBe('sketches/new.draw')
        expect(saved.kind).toBe('drawing')
        expect(saved.pages.length).toBe(2)
    },
}

/** The pane navigates from drawing A to drawing B (PaneContent reuses <DrawingPage> for any
 *  `.draw`) while A's 600ms autosave debounce is still in flight. The write must land on A — the
 *  file the edited doc was READ from — never on B. B's own read fails here, which is the worst case:
 *  no editor ever mounts for B, so the load-error guard cannot protect it, and only the write's own
 *  target decides whether B survives. */
export const NavigateWithPendingSave: Story = {
    render: () => {
        setTransport(
            recordingTransport(
                {
                    [POPULATED_PATH]: JSON.stringify(populatedDoc()),
                    [OTHER_PATH]: JSON.stringify(populatedDoc()),
                },
                { path: OTHER_PATH, fail: 'EIO: read failed' },
            ),
        )
        const [path, setPath] = createSignal(POPULATED_PATH)
        return (
            <>
                <TextButton onClick={() => setPath(OTHER_PATH)}>
                    open other
                </TextButton>
                <DrawingPage path={path()} />
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByText('add page'))
        // Navigate immediately: the debounce (600ms) has not fired yet.
        expect(writes).toEqual([])
        await userEvent.click(canvas.getByText('open other'))
        await expect(await canvas.findByRole('alert')).toHaveTextContent(
            OTHER_PATH,
        )
        await settle()
        // B was never written, in whole or in part.
        expect(writes.filter(w => w.path === OTHER_PATH)).toEqual([])
        // A's edit was not lost either: it landed on A.
        expect(writes.map(w => w.path)).toEqual([POPULATED_PATH])
    },
}
