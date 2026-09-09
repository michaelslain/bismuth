// Visual spec for <InkOverlay> — note ink, now stored IN THE NOTE. Each inked block carries a
// ```draw fence (core/src/drawing/drawBlocks.ts) whose base64 payload is the block's strokes,
// hidden and height-reserved by drawBlock.ts, painted by this overlay. There is no `.ink`
// sidecar any more, so there is no transport to seed: every fixture below is just markdown, and
// the ink in it is REAL encoded ink — `insertDrawBlock` runs `encodeStrokes` right here in the
// browser, and the overlay decodes it back through `scanDrawBlocks` with no help from the story.
//
// InkOverlay's `view: () => EditorView | undefined` prop has no standalone render path — every
// paint reads `view().contentDOM`'s live rect (`geom()`) and every seam reads CodeMirror's height
// map — so these stories mount it inside `_cmHarness.tsx`'s `CmHarness`, whose `children`
// render-prop hands back the live view as a sibling of the CM scroller inside a
// `position:relative` wrapper: the same wrapper/host/overlay layering `Editor.tsx` uses.
// `drawBlockExtension()` is layered in because without it a ```draw fence renders as raw source
// and reserves no height — the two halves of the feature only make sense together.
//
// WHY THE PLAYS SAMPLE PIXELS: a DOM element count says nothing about where ink is painted (a
// blank canvas has the same DOM as a full one), and the whole risk in this task is a coordinate
// system that is off by a block. So the plays below read the canvas's alpha channel and compare
// it against rects measured from the DOM.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { InkOverlay } from './InkOverlay'
import { CmHarness } from '../ui/_cmHarness'
import { drawBlockExtension, STANDALONE_PAD } from './drawBlock'
import { standaloneHeight } from './drawBlockGeometry'
import {
    insertDrawBlock,
    scanDrawBlocks,
} from '../../../core/src/drawing/drawBlocks'
import { INK_LOGICAL_W } from '../../../core/src/drawing/ink'
import type { Stroke } from '../../../core/src/drawing/model'

const meta = {
    title: 'Editor/InkOverlay',
    component: InkOverlay,
    // InkOverlay fills its editor wrapper edge-to-edge in the real app (no card chrome around it)
    // — same reasoning as Editor.stories.tsx's `fullscreen`.
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof InkOverlay>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}
const PATH = 'Ink Demo.md'

// Fixed px, not vh: the Storybook preview iframe is short with the Controls panel open (see
// Editor.stories.tsx / GraphView.stories.tsx's own notes on this).
const STORY_H = '700px'

/** Flatten `[x, y]` pairs into the packed `pts` format — flat `(x, y, pressureByte)` triples
 *  (`core/src/drawing/model.ts`'s `Stroke.pts`) — at a fixed mid pressure, since these are
 *  seeded fixture geometry rather than a real stylus capture. */
function line(points: Array<[number, number]>, pressure = 200): number[] {
    return points.flatMap(([x, y]) => [x, y, pressure])
}

const NOTE_TEXT = [
    '# Ink Demo',
    '',
    'Annotate this paragraph, circle a typo, or sketch a diagram right on the',
    'page. The strokes live in the note itself now, in a hidden draw fence.',
    '',
    'A second paragraph, so a stroke has a seam to be cut at.',
    '',
].join('\n')

// ── Attached ink ────────────────────────────────────────────────────────────────────────────
// An attached fence's widget is zero-height and sits immediately after the last line of the
// block it decorates, so its top IS that block's bottom — which is why this fixture's y values
// are NEGATIVE: the ink was drawn UP from the seam, over the paragraph. That is exactly what
// planCommit writes (inkCommit.test.ts, "rebases y against the owning block bottom").
const ANNOTATION: Stroke[] = [
    {
        t: 'pen',
        c: 'fg',
        w: 4,
        pts: line([
            [20, -14],
            [80, -8],
            [140, -16],
            [200, -8],
            [260, -16],
            [320, -8],
            [380, -14],
        ]),
    },
    {
        t: 'pen',
        c: 'fg',
        w: 3,
        pts: line([
            [430, -34],
            [470, -44],
            [510, -40],
            [520, -26],
            [500, -14],
            [455, -14],
            [430, -24],
            [430, -34],
        ]),
    },
]

// Fence inserted directly after line 4 — the last line of the paragraph, with NO blank line
// between, which is what makes scanDrawBlocks call it attached.
const ATTACHED_NOTE = insertDrawBlock(NOTE_TEXT, 4, ANNOTATION)
const ATTACHED_ANCHOR_LINE = 4

// ── Standalone ink ──────────────────────────────────────────────────────────────────────────
// A drawing with no text under it: the widget reserves the ink's own height so the caret can sit
// past it and text flows after — the "i cant place text after it" complaint, answered. The ink's
// top sits exactly STANDALONE_PAD below the widget top, which is the shape planCommit normalizes
// a fresh standalone fence to (inkCommit.test.ts pins that; what a browser adds is that the
// RESERVED height and the PAINTED ink actually agree, which is what this story's play measures).
const SKETCH_SPAN = 200
const SKETCH: Stroke[] = [
    {
        t: 'pen',
        c: 'fg',
        w: 4,
        pts: line([
            [40, STANDALONE_PAD],
            [120, STANDALONE_PAD + 96],
            [200, STANDALONE_PAD + 16],
            [280, STANDALONE_PAD + 116],
            [360, STANDALONE_PAD + 8],
        ]),
    },
    {
        t: 'pen',
        c: 'fg',
        w: 3,
        pts: line([
            [60, STANDALONE_PAD + 156],
            [400, STANDALONE_PAD + 156],
        ]),
    },
    {
        t: 'hl',
        c: '#f2b705',
        w: 16,
        pts: line(
            [
                [80, STANDALONE_PAD + SKETCH_SPAN],
                [320, STANDALONE_PAD + SKETCH_SPAN],
            ],
            255,
        ),
    },
]

// Inserted after line 2 — a BLANK line, which is what makes the fence standalone.
const STANDALONE_NOTE = insertDrawBlock(
    '# A page with a drawing\n\nText after the drawing, which needs somewhere to sit.\n',
    2,
    SKETCH,
)

// ── Canvas probes ───────────────────────────────────────────────────────────────────────────

/** Logical-x → canvas CSS-x: ink lives in the fixed 680px logical column, scaled by
 *  `contentDOM.width / 680` and offset by contentDOM's position inside the overlay host — the
 *  same mapping InkOverlay's own `geom()` performs, recomputed here from the live DOM so the
 *  bands stay correct whatever width the preview iframe happens to be. */
function band(
    view: EditorView,
    canvas: HTMLCanvasElement,
    x0: number,
    x1: number,
): readonly [number, number] {
    const cr = view.contentDOM.getBoundingClientRect()
    const kr = canvas.getBoundingClientRect()
    const s = cr.width / INK_LOGICAL_W
    const off = cr.left - kr.left
    return [off + x0 * s, off + x1 * s] as const
}

/** Rows of the committed-ink canvas that carry ink inside an x band, in canvas-relative CSS px.
 *  `null` when the band holds no ink at all. Reads the real alpha channel, which is the only
 *  thing that can tell "the drawing is in its box" from "the drawing is somewhere else". */
function inkExtent(
    canvas: HTMLCanvasElement,
    xBand: readonly [number, number],
): { top: number; bottom: number; rows: number } | null {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.clientWidth) return null
    const sx = canvas.width / canvas.clientWidth // device px per CSS px
    const px0 = Math.max(0, Math.round(xBand[0] * sx))
    const px1 = Math.min(canvas.width, Math.round(xBand[1] * sx))
    const w = px1 - px0
    if (w <= 0) return null
    const { data } = ctx.getImageData(px0, 0, w, canvas.height)
    let top = -1
    let bottom = -1
    let rows = 0
    for (let row = 0; row < canvas.height; row++) {
        let inked = false
        for (let col = 0; col < w; col++) {
            if (data[(row * w + col) * 4 + 3] > 16) {
                inked = true
                break
            }
        }
        if (!inked) continue
        rows++
        if (top < 0) top = row
        bottom = row
    }
    return top < 0 ? null : { top: top / sx, bottom: bottom / sx, rows }
}

/** Let `n` animation frames go by.
 *
 *  NEEDED, and the reason is worth stating: InkOverlay's repaint is rAF-coalesced, so the canvas
 *  read in the same macrotask as a transaction still shows the PREVIOUS frame. An assertion that
 *  something did NOT change therefore passes trivially on stale pixels — measured: with the
 *  per-block paint origin deliberately broken, the "ink did not jump" check below still passed
 *  because it ran before the repaint that blanked the canvas. Waiting on frames rather than a
 *  wall-clock sleep keeps it honest under playCheck, where the rAF clock is real. */
const frames = (n: number): Promise<void> =>
    new Promise(resolve => {
        let left = n
        const step = () =>
            left-- > 0 ? requestAnimationFrame(step) : resolve()
        step()
    })

/** Wait until the editor's LAYOUT has stopped moving before measuring anything.
 *
 *  Storybook loads the app's real web fonts asynchronously, and a CodeMirror line measured
 *  before they land is a different height afterwards — measured here, a paragraph line block
 *  went from 16.7 to 10 ink-logical units when the fonts arrived. Every number in these plays
 *  (seam positions, widget heights, where ink is painted) comes from line geometry, so a play
 *  that starts measuring too early compares two different layouts and reports an 11px "jump"
 *  that no code produced — that false signal cost a real debugging round here. It is the story's
 *  problem, not the overlay's: at pen-down InkOverlay records the seam table for the layout it
 *  can see, which is the only layout its stroke coordinates mean anything in. */
async function settleLayout(): Promise<void> {
    await document.fonts.ready
    await frames(10)
}

/** The live (draft) canvas is the second one; the first holds committed ink. */
const canvases = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('canvas'))

function liveView(root: HTMLElement): EditorView {
    const cmDom = root.querySelector<HTMLElement>('.cm-editor')
    expect(cmDom).not.toBeNull()
    const view = EditorView.findFromDOM(cmDom!)
    expect(view).not.toBeNull()
    return view!
}

// NOTE ON HEADLESS CONCURRENCY: these stories paint to canvas and are graded by bench/playCheck.ts
// alongside several others at once, each its own Chrome target. A backgrounded target normally
// runs NO requestAnimationFrame callbacks at all (`visibilityState: "hidden"`), which would leave
// every canvas blank and every pixel assertion below `null` — and in InkOverlay's case would also
// latch its own `rafPending` flag forever, blocking any later repaint too. The fix lives in
// `bench/chromeSession.ts`'s `newPage()`, which calls `Emulation.setFocusEmulationEnabled` on
// every concurrent target so `visibilityState` stays "visible" and the rAF clock keeps running.
// No story-level workaround is needed or wanted.

// ── Stories ─────────────────────────────────────────────────────────────────────────────────

/** Draw mode freshly toggled on over a note with no ink: an empty canvas plus the drawing
 *  Toolbar (InkOverlay.module.css flips the live canvas interactive and shows `.draw-toolbar`
 *  only while `active()`). */
export const Default: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness doc={NOTE_TEXT} extensions={[drawBlockExtension()]}>
                {view => (
                    <InkOverlay
                        view={view}
                        path={() => PATH}
                        active={() => true}
                        onExit={noop}
                    />
                )}
            </CmHarness>
        </div>
    ),
    play: async ({ canvasElement }) => {
        await settleLayout()
        const view = liveView(canvasElement)
        // The drawing dock is up (it renders only while `active()`), and its undo control is
        // wired to the DRAWING stack, not the editor's.
        expect(
            canvasElement.querySelector('[aria-label="Undo"]'),
        ).not.toBeNull()
        const [committed, live] = canvases(canvasElement)
        expect(live).toBeDefined()
        // An ink-free note paints nothing and writes nothing: entering draw mode must not, on
        // its own, put a fence in the user's document.
        expect(inkExtent(committed, band(view, committed, 0, 680))).toBeNull()
        expect(scanDrawBlocks(view.state.doc.toString())).toEqual([])
    },
}

/** A note carrying an ATTACHED draw fence: the annotation paints over the paragraph it belongs
 *  to, the fence itself is invisible, and the block reserves no extra height. Not in draw mode —
 *  this is the everyday case, a note with ink being read. */
export const AttachedInk: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness doc={ATTACHED_NOTE} extensions={[drawBlockExtension()]}>
                {view => (
                    <InkOverlay
                        view={view}
                        path={() => PATH}
                        active={() => false}
                        onExit={noop}
                    />
                )}
            </CmHarness>
        </div>
    ),
    play: async ({ canvasElement }) => {
        await settleLayout()
        const view = liveView(canvasElement)
        const [committed] = canvases(canvasElement)
        expect(committed).toBeDefined()
        // The fence is decoded and painted from the document, with nothing seeded into the
        // component — if the codec, the scan or the paint origin were broken this is `null`.
        await waitFor(
            () => {
                const ink = inkExtent(committed, band(view, committed, 0, 680))
                expect(ink).not.toBeNull()
                expect(ink!.rows).toBeGreaterThan(10)
            },
            { timeout: 5000 },
        )
        // The fence never shows its source: no raw base64, no ```draw, and no reserved height.
        expect(canvasElement.textContent).not.toContain('```draw')
        const block = canvasElement.querySelector<HTMLElement>('[data-draw-block]')
        expect(block).not.toBeNull()
        expect(block!.hasAttribute('data-draw-standalone')).toBe(false)
        expect(block!.getBoundingClientRect().height).toBe(0)
    },
}

/**
 * THE end-to-end proof for this feature: a STANDALONE drawing, from real encoded strokes, with
 * genuinely non-zero reserved height, painted inside the space it reserved.
 *
 * Three separate things have to agree for this to pass, and they live in three different
 * modules: `inkCodec` has to decode in a browser at all, `drawBlockGeometry.standaloneHeight`
 * has to reserve the ink's span plus padding, and this overlay's paint origin has to be the
 * widget's own top. Any one of them wrong and the numbers below diverge.
 */
export const StandaloneDrawing: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness
                doc={STANDALONE_NOTE}
                extensions={[drawBlockExtension()]}
            >
                {view => (
                    <InkOverlay
                        view={view}
                        path={() => PATH}
                        active={() => false}
                        onExit={noop}
                    />
                )}
            </CmHarness>
        </div>
    ),
    play: async ({ canvasElement }) => {
        await settleLayout()
        const view = liveView(canvasElement)
        const [committed] = canvases(canvasElement)

        // The strokes came back out of the fence, in the browser, through the real codec.
        const decoded = scanDrawBlocks(view.state.doc.toString())
        expect(decoded).toHaveLength(1)
        expect(decoded[0].attachedToLine).toBeNull()
        expect(decoded[0].strokes).toHaveLength(SKETCH.length)

        const widget = canvasElement.querySelector<HTMLElement>(
            '[data-draw-block][data-draw-standalone]',
        )
        expect(widget).not.toBeNull()

        const scale = () =>
            view.contentDOM.getBoundingClientRect().width / INK_LOGICAL_W
        const expectedH = () =>
            standaloneHeight(decoded[0].strokes, STANDALONE_PAD) * scale()

        // 1. NON-ZERO RESERVED HEIGHT — the headline. Every story before this one used an empty
        //    payload and could only ever reserve 0.
        await waitFor(
            () => {
                const h = widget!.getBoundingClientRect().height
                expect(h).toBeGreaterThan(100)
                expect(Math.abs(h - expectedH())).toBeLessThan(2)
            },
            { timeout: 5000 },
        )

        // 2. The ink is actually PAINTED, and painted INSIDE the box that was reserved for it.
        const widgetRect = widget!.getBoundingClientRect()
        const canvasRect = committed.getBoundingClientRect()
        const widgetTop = widgetRect.top - canvasRect.top
        const s = scale()
        await waitFor(
            () => {
                const ink = inkExtent(committed, band(view, committed, 0, 680))
                expect(ink).not.toBeNull()
                expect(ink!.rows).toBeGreaterThan(20)
                // Top edge: STANDALONE_PAD below the widget top, give or take half a stroke
                // width. A paint anchored at the document origin, or at the widget's BOTTOM,
                // misses this by the whole height of the drawing.
                expect(ink!.top).toBeGreaterThan(widgetTop - 1)
                expect(ink!.top).toBeLessThan(widgetTop + (STANDALONE_PAD + 6) * s)
                // Bottom edge: still inside the reserved box.
                expect(ink!.bottom).toBeLessThan(widgetTop + widgetRect.height + 1)
            },
            { timeout: 5000 },
        )

        // 3. Text really does flow after it: the paragraph below the drawing starts below the
        //    reserved height rather than under the ink.
        const after = Array.from(
            canvasElement.querySelectorAll<HTMLElement>('.cm-line'),
        ).find(el => el.textContent?.startsWith('Text after the drawing'))
        expect(after).toBeDefined()
        expect(after!.getBoundingClientRect().top).toBeGreaterThan(
            widgetRect.bottom - 1,
        )
    },
}

/** THE POINT OF STORING INK IN THE BLOCK: a fence moves with the text it decorates, so inserting
 *  lines above the annotated paragraph carries its ink down with it — with no anchor field, no
 *  remapping and no bookkeeping, because the fence's own position in the document is the anchor.
 *  Measured in pixels, against a line height read from the DOM rather than from the code under
 *  test. */
export const AttachedInkFollowsText: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness doc={ATTACHED_NOTE} extensions={[drawBlockExtension()]}>
                {view => (
                    <InkOverlay
                        view={view}
                        path={() => PATH}
                        active={() => false}
                        onExit={noop}
                    />
                )}
            </CmHarness>
        </div>
    ),
    play: async ({ canvasElement }) => {
        await settleLayout()
        const view = liveView(canvasElement)
        const [committed] = canvases(canvasElement)
        const ink = () => inkExtent(committed, band(view, committed, 0, 680))

        await waitFor(
            () => {
                expect(ink()).not.toBeNull()
            },
            { timeout: 5000 },
        )
        const before = ink()!.top

        // Line pitch measured from the DOM, not from CodeMirror's own numbers — the expected
        // shift has to come from somewhere independent of the code under test.
        const lines = canvasElement.querySelectorAll('.cm-line')
        expect(lines.length).toBeGreaterThan(1)
        const lineH =
            lines[1].getBoundingClientRect().top -
            lines[0].getBoundingClientRect().top
        expect(lineH).toBeGreaterThan(4)

        // Three lines inserted ABOVE everything — the exact edit the anchoring exists for.
        view.dispatch({ changes: { from: 0, insert: 'one\ntwo\nthree\n' } })

        await waitFor(
            () => {
                const now = ink()
                expect(now).not.toBeNull()
                expect(Math.abs(now!.top - before - 3 * lineH)).toBeLessThan(2)
            },
            { timeout: 5000 },
        )
        // …and the fence is still attached to the paragraph it started on, three lines lower.
        const [block] = scanDrawBlocks(view.state.doc.toString())
        expect(block.attachedToLine).toBe(ATTACHED_ANCHOR_LINE + 3)
    },
}

/** Drawing WRITES the note, and text undo must not be able to swallow it.
 *
 *  The play drives real pointer events over the paragraph, waits for the debounced commit, and
 *  then presses the editor's own undo. If the ink transaction had entered CodeMirror's history
 *  (the defect this guards), undo would delete the drawing and leave the typing; instead it
 *  removes the typing and leaves the drawing exactly where it was painted. */
export const DrawCommitsAFence: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness doc={NOTE_TEXT} extensions={[drawBlockExtension()]}>
                {view => (
                    <InkOverlay
                        view={view}
                        path={() => PATH}
                        active={() => true}
                        onExit={noop}
                    />
                )}
            </CmHarness>
        </div>
    ),
    play: async ({ canvasElement }) => {
        await settleLayout()
        const view = liveView(canvasElement)
        const [committed, live] = canvases(canvasElement)
        expect(live).toBeDefined()

        // A real user edit FIRST, so the editor's history has something in it that undo should
        // reach for once the ink commit has also landed.
        view.dispatch({
            changes: { from: 0, insert: 'TYPED-BY-THE-USER\n' },
            userEvent: 'input.type',
        })
        await waitFor(() => {
            expect(view.state.doc.toString()).toContain('TYPED-BY-THE-USER')
        })

        // Draw a squiggle across the paragraph that begins "Annotate this paragraph".
        const target = Array.from(
            canvasElement.querySelectorAll<HTMLElement>('.cm-line'),
        ).find(el => el.textContent?.startsWith('Annotate this paragraph'))
        expect(target).toBeDefined()
        const r = target!.getBoundingClientRect()
        const y = r.top + r.height / 2
        const send = (type: string, x: number) =>
            live.dispatchEvent(
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
        send('pointerdown', r.left + 20)
        for (let x = r.left + 40; x < r.left + 220; x += 20) send('pointermove', x)
        send('pointerup', r.left + 220)

        // The stroke paints immediately (it is uncommitted, in absolute capture coordinates)…
        const ink = () => inkExtent(committed, band(view, committed, 0, 680))
        await waitFor(
            () => {
                expect(ink()).not.toBeNull()
            },
            { timeout: 3000 },
        )
        const beforeCommit = ink()!.top

        // …and the debounced commit turns it into a fence attached to that paragraph.
        await waitFor(
            () => {
                const blocks = scanDrawBlocks(view.state.doc.toString())
                expect(blocks).toHaveLength(1)
                expect(blocks[0].strokes).toHaveLength(1)
                expect(blocks[0].attachedToLine).not.toBeNull()
            },
            { timeout: 4000 },
        )
        const lineOf = (n: number) => view.state.doc.line(n).text
        const committedBlock = scanDrawBlocks(view.state.doc.toString())[0]
        expect(lineOf(committedBlock.attachedToLine!)).toContain(
            'hidden draw fence',
        )

        // The ink does not JUMP when it stops being a pending stroke and starts being a fence:
        // the origin the commit stored against and the origin the paint reads back are the same
        // number. This is the one assertion that catches an off-by-a-block coordinate bug — so
        // it is a HARD assertion after the canvas has actually repainted, never a `waitFor`,
        // which would be satisfied by the pre-repaint frame it starts on.
        await frames(20)
        const afterCommit = ink()
        expect(afterCommit).not.toBeNull()
        expect(Math.abs(afterCommit!.top - beforeCommit)).toBeLessThan(3)

        // Now the invariant that matters most: the editor's undo takes back the TYPING, not the
        // drawing.
        undo(view)
        await waitFor(() => {
            expect(view.state.doc.toString()).not.toContain('TYPED-BY-THE-USER')
        })
        const survived = scanDrawBlocks(view.state.doc.toString())
        expect(survived).toHaveLength(1)
        expect(survived[0].strokes).toHaveLength(1)
        // …and it is still on screen, not merely still in the text.
        await frames(20)
        expect(ink()).not.toBeNull()
    },
}
