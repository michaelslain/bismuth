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
// An attached fence stores its ink against the TOP of the block it decorates, in UNSCALED
// PIXELS (inkCommit.ts's coordinate contract). So this fixture's y values are small POSITIVE
// pixel offsets: the annotated paragraph is two lines of roughly 19px, and the ink sits over
// them. x is still in the 680px logical column, which is why the wave spans 20..380.
//
// Getting this wrong is invisible in a count-based assertion, so `AttachedInk`'s play measures
// that the painted rows actually overlap the paragraph's own client rect.
const ANNOTATION: Stroke[] = [
    {
        t: 'pen',
        c: 'fg',
        w: 4,
        pts: line([
            [20, 12],
            [80, 18],
            [140, 10],
            [200, 18],
            [260, 10],
            [320, 18],
            [380, 12],
        ]),
    },
    {
        t: 'pen',
        c: 'fg',
        w: 3,
        pts: line([
            [430, 22],
            [470, 20],
            [510, 24],
            [520, 30],
            [500, 36],
            [455, 36],
            [430, 30],
            [430, 22],
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

// The `true` is what makes it standalone: insertDrawBlock writes ```draw block, and that marker
// is the whole story. Nothing about the blank line above it matters any more.
const STANDALONE_NOTE = insertDrawBlock(
    '# A page with a drawing\n\nText after the drawing, which needs somewhere to sit.\n',
    2,
    SKETCH,
    true,
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

/** The vertical CENTRE of the painted ink, which is the right thing to compare across a pane
 *  resize: the pen's rendered WIDTH scales with the reading column by design, so each EDGE moves
 *  by half a stroke width (measured: ~3px on the top edge) even when the stroke's centre line has
 *  not moved at all. That change is symmetric, so the centre cancels it exactly and leaves only
 *  real drift. The 0.50px that remains is this probe's own quantization — it reads whole device
 *  rows, at DPR 1 — not any residual movement. */
const inkMid = (e: { top: number; bottom: number }) => (e.top + e.bottom) / 2

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

        // AND the annotation is actually ON the paragraph it annotates. "Some pixels exist" is
        // satisfied by ink painted anywhere at all — including above the block, which is exactly
        // what a wrong anchor edge or a wrong stored unit produces.
        const lines = Array.from(
            canvasElement.querySelectorAll<HTMLElement>('.cm-line'),
        )
        const first = lines.find(el =>
            el.textContent?.startsWith('Annotate this paragraph'),
        )
        const last = lines.find(el =>
            el.textContent?.startsWith('page. The strokes'),
        )
        expect(first).toBeDefined()
        expect(last).toBeDefined()
        const canvasTop = committed.getBoundingClientRect().top
        const paraTop = first!.getBoundingClientRect().top - canvasTop
        const paraBottom = last!.getBoundingClientRect().bottom - canvasTop
        const painted = inkExtent(committed, band(view, committed, 0, 680))!
        expect(painted.top).toBeGreaterThan(paraTop - 4)
        expect(painted.bottom).toBeLessThan(paraBottom + 4)
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

/** THE USER'S ACTUAL WORDS: "if a drawing is drawn on text, it follows the text." Shifting the
 *  whole block down is only half of that. The other half is that the annotation must not slide
 *  when the block it annotates REFLOWS — and typing into an annotated paragraph is the most
 *  ordinary way to make it reflow.
 *
 *  This is why an attached fence anchors to the TOP of the block it decorates. Markdown grows
 *  downward, so the top is the edge that does not move when a paragraph gains a line; the bottom
 *  is the edge that moves by a full line pitch every time. */
export const AttachedInkSurvivesTyping: Story = {
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
        const before = inkMid(ink()!)

        // Type a line INTO the annotated paragraph — not above it. The paragraph gains a line,
        // its top is where it was, its bottom is one line lower, and the ink must not budge.
        const para = view.state.doc.line(ATTACHED_ANCHOR_LINE - 1)
        view.dispatch({
            changes: { from: para.to, insert: '\nand a freshly typed line.' },
            userEvent: 'input.type',
        })
        await frames(20)

        const after = ink()
        expect(after).not.toBeNull()
        expect(Math.abs(inkMid(after!) - before)).toBeLessThan(2)
    },
}

/** The second drift the same anchoring rule has to kill: NARROWING THE PANE moves annotation ink
 *  even though not one character changed.
 *
 *  Two independent causes, both fixed by the same pair of decisions. The block's bottom moves
 *  (a narrower column re-wraps the paragraph into more lines) — answered by anchoring to the top.
 *  And a y offset stored in the 680px logical space rescales with the pane while LINE HEIGHTS
 *  do not — answered by storing an attached fence's y in unscaled pixels. x stays scaled, so the
 *  annotation still spans the same words. */
export const AttachedInkSurvivesPaneWidth: Story = {
    render: () => (
        <div
            data-testid="ink-pane"
            style={{ height: STORY_H, width: '100%' }}
        >
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
        const before = inkMid(ink()!)
        const wideScale =
            view.contentDOM.getBoundingClientRect().width / INK_LOGICAL_W

        const pane = canvasElement.querySelector<HTMLElement>(
            '[data-testid="ink-pane"]',
        )
        expect(pane).not.toBeNull()
        pane!.style.width = '55%'
        await frames(30)

        // The pane really did narrow — otherwise the rest of this play proves nothing.
        const narrowScale =
            view.contentDOM.getBoundingClientRect().width / INK_LOGICAL_W
        expect(narrowScale).toBeLessThan(wideScale * 0.7)

        const after = ink()
        expect(after).not.toBeNull()
        expect(Math.abs(inkMid(after!) - before)).toBeLessThan(2)
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
        for (let x = r.left + 40; x < r.left + 220; x += 20) {
            send('pointermove', x)
        }
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

/** The debounce is the one place a stroke can be lost, and a NOTE SWITCH is how it happens: Solid
 *  runs the parent's cleanup first, so Editor.tsx has already destroyed the view by the time this
 *  overlay's own path-change cleanup could flush. Everything drawn in the last COMMIT_DELAY
 *  milliseconds went in the bin.
 *
 *  The fix is to flush EARLIER, on the very event that precedes every such navigation: while
 *  drawing, the overlay's host holds focus, so clicking the file tree, a tab, a wikilink or the
 *  palette moves focus off it first, synchronously, while the view is unquestionably alive.
 *
 *  This play proves the mechanism deterministically rather than by waiting: after pen-up there is
 *  no fence yet (the debounce is still pending), and two animation frames after focus leaves —
 *  about 33ms, an order of magnitude inside the 500ms debounce — there is one. */
export const FlushesWhenFocusLeaves: Story = {
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
        const host = committed.parentElement as HTMLElement
        expect(host).not.toBeNull()
        host.focus()

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
        for (let x = r.left + 40; x < r.left + 200; x += 20) {
            send('pointermove', x)
        }
        send('pointerup', r.left + 200)

        // Still uncommitted: the debounce has not run, so nothing has touched the note yet.
        expect(scanDrawBlocks(view.state.doc.toString())).toEqual([])

        // Focus moves out of the overlay, the way any navigation begins.
        view.contentDOM.focus()
        await frames(2)

        const blocks = scanDrawBlocks(view.state.doc.toString())
        expect(blocks).toHaveLength(1)
        expect(blocks[0].strokes).toHaveLength(1)
    },
}

/** Pressing Enter at the end of an annotated paragraph is the most ordinary edit there is, and
 *  it used to detach the annotation: the new blank line above the fence was the ONLY thing that
 *  decided the fence's mode, so one keystroke flipped it to standalone — the ink jumped 78px
 *  into a newly reserved 139px box, with every line below it shoved down.
 *
 *  That is why the mode is written into the fence itself (` ```draw ` vs ` ```draw block `) and
 *  no longer inferred from surrounding whitespace. Nothing a user types anywhere else in the
 *  note can reinterpret stored geometry under the other rule. */
export const AttachedInkSurvivesEnter: Story = {
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
        const before = inkMid(ink()!)

        // Enter at the end of the annotated paragraph — the exact keystroke that used to detach.
        const para = view.state.doc.line(ATTACHED_ANCHOR_LINE)
        view.dispatch({
            changes: { from: para.to, insert: '\n' },
            userEvent: 'input.type',
        })
        await frames(20)

        // Still attached, still exactly where it was, and still reserving no height.
        const [block] = scanDrawBlocks(view.state.doc.toString())
        expect(block.standalone).toBe(false)
        expect(block.attachedToLine).toBe(ATTACHED_ANCHOR_LINE)
        expect(
            canvasElement.querySelector('[data-draw-standalone]'),
        ).toBeNull()
        const after = ink()
        expect(after).not.toBeNull()
        expect(Math.abs(inkMid(after!) - before)).toBeLessThan(2)
    },
}

// A fence with a paragraph immediately after it, no blank line between. The seam table used to
// walk straight past an attached fence without closing the run it belonged to, so both
// paragraphs collapsed into ONE band owned by the SECOND one — a stroke drawn on paragraph A was
// committed into a fence hanging off paragraph B. It painted in the right place, which is why
// nothing caught it, and from then on editing B moved or destroyed A's annotation.
const RUN_SPILL_NOTE = insertDrawBlock(
    'Paragraph A, the annotated one.\nParagraph B, straight after the fence.\n',
    1,
    ANNOTATION,
)

/** Ink drawn on paragraph A must land in paragraph A's own fence. */
export const OwnershipStopsAtTheFence: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness
                doc={RUN_SPILL_NOTE}
                extensions={[drawBlockExtension()]}
            >
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
        const [, live] = canvases(canvasElement)

        // Two paragraphs, one fence, and nothing but the fence between them.
        expect(scanDrawBlocks(view.state.doc.toString())).toHaveLength(1)

        const target = Array.from(
            canvasElement.querySelectorAll<HTMLElement>('.cm-line'),
        ).find(el => el.textContent?.startsWith('Paragraph A'))
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
        for (let x = r.left + 40; x < r.left + 180; x += 20) {
            send('pointermove', x)
        }
        send('pointerup', r.left + 180)

        await waitFor(
            () => {
                const blocks = scanDrawBlocks(view.state.doc.toString())
                expect(blocks[0].strokes).toHaveLength(ANNOTATION.length + 1)
            },
            { timeout: 4000 },
        )
        // ONE fence, still paragraph A's. A second fence here means the stroke was committed
        // against paragraph B.
        const blocks = scanDrawBlocks(view.state.doc.toString())
        expect(blocks).toHaveLength(1)
        expect(blocks[0].attachedToLine).toBe(1)
        expect(
            view.state.doc.line(blocks[0].attachedToLine!).text,
        ).toContain('Paragraph A')
    },
}

// ── Lasso: select the ink, then move or resize it ───────────────────────────────────────────
// The user's second complaint, in their words: "or select it and move it around." These two
// stories are the browser half of it; app/src/drawing/lasso.test.ts and inkCommit.test.ts pin
// the arithmetic headlessly. What only a browser can show is that the PAINTED result and the
// STORED result agree — the conversion between them is different per fence mode (an attached
// fence stores pixels against its block's top, a standalone one logical units against its own
// widget), and getting it wrong paints correctly for one frame and then jumps on commit.

/** Dispatch one synthetic pointer event at a client position. */
function pointer(
    el: Element,
    type: string,
    x: number,
    y: number,
    id = 11,
): void {
    el.dispatchEvent(
        new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            pointerId: id,
            pointerType: 'pen',
            isPrimary: true,
            pressure: 0.6,
        }),
    )
}

/** Press, travel through every waypoint, release. */
function drag(el: Element, path: Array<[number, number]>): void {
    pointer(el, 'pointerdown', path[0][0], path[0][1])
    for (const [x, y] of path.slice(1)) pointer(el, 'pointermove', x, y)
    const last = path[path.length - 1]
    pointer(el, 'pointerup', last[0], last[1])
}

/** Throw a rectangular lasso around a client-space box, walking each edge so the polygon has
 *  real vertices rather than two points (which encloses nothing). */
function lassoBox(
    el: Element,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): void {
    const path: Array<[number, number]> = []
    const steps = 4
    const corners: Array<[number, number]> = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
    ]
    for (let c = 0; c + 1 < corners.length; c++) {
        const [ax, ay] = corners[c]
        const [bx, by] = corners[c + 1]
        for (let i = 0; i < steps; i++) {
            path.push([
                ax + ((bx - ax) * i) / steps,
                ay + ((by - ay) * i) / steps,
            ])
        }
    }
    path.push(corners[corners.length - 1])
    drag(el, path)
}

/** Turn the lasso tool on through the real toolbar, the way a user does. */
function pickLasso(root: HTMLElement): void {
    const btn = root.querySelector<HTMLElement>('[title="Lasso"]')
    expect(btn).not.toBeNull()
    btn!.click()
}

/** Every y a fence's strokes hold, in order — the STORED numbers, not the painted ones. */
const storedYs = (strokes: Stroke[]): number[] =>
    strokes.flatMap(s => s.pts.filter((_, i) => i % 3 === 1))

const LASSO_ANNOTATION: Stroke[] = [
    {
        t: 'pen',
        c: 'fg',
        w: 4,
        pts: line([
            [60, 8],
            [120, 4],
            [180, 10],
            [200, 18],
            [170, 26],
            [110, 28],
            [64, 20],
            [60, 8],
        ]),
    },
]

// Six lines, so the annotated block's band is tall enough that a real drag fits inside it and a
// bigger one has somewhere to be stopped. A two-line paragraph would clamp immediately and the
// move and the clamp would be indistinguishable.
const TALL_NOTE = [
    '# Lasso demo',
    '',
    'One of six lines in the annotated paragraph.',
    'Two of six lines in the annotated paragraph.',
    'Three of six lines in the annotated paragraph.',
    'Four of six lines in the annotated paragraph.',
    'Five of six lines in the annotated paragraph.',
    'Six of six lines in the annotated paragraph.',
    '',
    'A closing paragraph, which the ink must never reach.',
    '',
].join('\n')
const LASSO_NOTE = insertDrawBlock(TALL_NOTE, 8, LASSO_ANNOTATION)

/**
 * Lasso an annotation, drag it down the paragraph it belongs to, and drag it again far past the
 * bottom.
 *
 * The two numbers that matter, and neither is a count:
 *
 *  1. An attached fence stores its y in UNSCALED PIXELS, so a drag of N screen pixels must land
 *     as a stored delta of exactly N — whatever the pane's scale happens to be. A conversion
 *     that forgets to divide by `yScale` (or divides twice) still paints the drag correctly
 *     while it is in flight and only diverges once the fence is written, which is precisely the
 *     bug this catches.
 *  2. A stroke belongs to exactly one block, so a drag that would take the ink past its block's
 *     bottom stops there rather than depositing an annotation on the next paragraph.
 */
export const LassoMovesInk: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness doc={LASSO_NOTE} extensions={[drawBlockExtension()]}>
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
        const column = () => band(view, committed, 0, 680)
        const ink = () => inkExtent(committed, column())

        await waitFor(
            () => {
                expect(ink()).not.toBeNull()
            },
            { timeout: 5000 },
        )
        pickLasso(canvasElement)

        const cRect = () => committed.getBoundingClientRect()
        const enclose = () => {
            const e = ink()!
            const [b0, b1] = column()
            const r = cRect()
            return {
                x0: r.left + b0 + 2,
                x1: r.left + b1 - 2,
                y0: r.top + e.top - 8,
                y1: r.top + e.bottom + 8,
            }
        }

        const before = enclose()
        lassoBox(live, before.x0, before.y0, before.x1, before.y1)
        await frames(4)

        // The selection chrome is real: the LIVE canvas, empty until now, carries the marching
        // ants and their two handles.
        expect(inkExtent(live, column())).not.toBeNull()

        const storedBefore = storedYs(
            scanDrawBlocks(view.state.doc.toString())[0].strokes,
        )
        const paintedBefore = inkMid(ink()!)

        // Where to grab: INSIDE the ink, not inside the lasso rectangle. The selection box hugs
        // the strokes (logical x 60..200 in this fixture) while the lasso was thrown around the
        // whole reading column, so the rectangle's centre sits well to the right of the box and
        // a press there starts a NEW lasso instead of moving the selection. The x comes from the
        // fixture and the y from the painted extent, so neither is read off the code under test.
        const grabPoint = () => {
            const s = view.contentDOM.getBoundingClientRect()
            const e = ink()!
            const r = cRect()
            return {
                x: s.left + ((60 + 200) / 2) * (s.width / INK_LOGICAL_W),
                y: r.top + (e.top + e.bottom) / 2,
            }
        }

        // ── Act 1: a drag that fits inside the block ────────────────────────────────────────
        const DRAG_PX = 40
        const grab = grabPoint()
        drag(live, [
            [grab.x, grab.y],
            [grab.x, grab.y + DRAG_PX / 2],
            [grab.x, grab.y + DRAG_PX],
        ])
        await waitFor(
            () => {
                const now = scanDrawBlocks(view.state.doc.toString())[0]
                expect(storedYs(now.strokes)).not.toEqual(storedBefore)
            },
            { timeout: 4000 },
        )
        await frames(10)

        // Stored: exactly the screen distance dragged, because an attached fence's y IS screen
        // pixels. Not "about" — the conversion is exact, so the assertion is too.
        const moved = scanDrawBlocks(view.state.doc.toString())[0]
        expect(storedYs(moved.strokes)).toEqual(
            storedBefore.map(y => y + DRAG_PX),
        )
        expect(moved.standalone).toBe(false)
        expect(moved.attachedToLine).toBe(8)
        // Painted: the same distance again, so the commit did not move the ink out from under
        // the drag. Centre, not an edge — the pen's rendered width scales with the column.
        expect(Math.abs(inkMid(ink()!) - paintedBefore - DRAG_PX)).toBeLessThan(3)

        // ── Act 2: a drag that would leave the block ────────────────────────────────────────
        const cmLines = () =>
            Array.from(canvasElement.querySelectorAll<HTMLElement>('.cm-line'))
        const lastLine = cmLines().find(el =>
            el.textContent?.startsWith('Six of six'),
        )
        const closing = cmLines().find(el =>
            el.textContent?.startsWith('A closing paragraph'),
        )
        expect(lastLine).toBeDefined()
        expect(closing).toBeDefined()
        const blockBottom = lastLine!.getBoundingClientRect().bottom
        const closingTop = closing!.getBoundingClientRect().top

        // The selection survives its own commit, so act 2 grabs the box where act 1 left it.
        const again = grabPoint()
        drag(live, [
            [again.x, again.y],
            [again.x, again.y + 200],
            [again.x, again.y + 400],
        ])
        await frames(20)

        const finalInk = ink()!
        const finalBottom = cRect().top + finalInk.bottom
        // It travelled — a clamp that simply refused the drag would leave it where act 1 put it.
        expect(finalBottom).toBeGreaterThan(blockBottom - 40)
        // …and it stopped at its own block rather than landing on the paragraph below. The
        // slack is one stroke width: the clamp bounds the ink's POINTS, and a painted row
        // extends half a nib past the outermost point.
        expect(finalBottom).toBeLessThan(blockBottom + 8)
        expect(finalBottom).toBeLessThan(closingTop)
        // Still one fence, still that paragraph's.
        const after = scanDrawBlocks(view.state.doc.toString())
        expect(after).toHaveLength(1)
        expect(after[0].attachedToLine).toBe(8)
    },
}

/**
 * Resize a standalone drawing by its corner handle.
 *
 * Three things have to agree and they live in three modules: `scaleStrokes` has to scale the
 * stroke WIDTH with the geometry (a shrunk sketch drawn with a full-width pen is a different,
 * fatter drawing), `planStrokeEdit` has to keep the ink inside a box that just got shorter, and
 * `standaloneHeight` has to re-reserve the space so the text below moves up with it.
 *
 * The handles sit on the BOTTOM corners and scale about the ink's top edge. Markdown flows
 * downward, so a block's top is the edge that cannot move — the same reason an attached fence
 * anchors to its block's top and a standalone widget reserves its height downward.
 */
export const LassoResizesDrawing: Story = {
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
        const column = () => band(view, committed, 0, 680)
        const ink = () => inkExtent(committed, column())
        const widget = () =>
            canvasElement.querySelector<HTMLElement>(
                '[data-draw-block][data-draw-standalone]',
            )!

        await waitFor(
            () => {
                expect(ink()).not.toBeNull()
                expect(widget().getBoundingClientRect().height).toBeGreaterThan(
                    100,
                )
            },
            { timeout: 5000 },
        )
        pickLasso(canvasElement)

        const scale = () =>
            view.contentDOM.getBoundingClientRect().width / INK_LOGICAL_W
        const heightBefore = widget().getBoundingClientRect().height
        const strokesBefore = scanDrawBlocks(view.state.doc.toString())[0]
            .strokes
        const widthsBefore = strokesBefore.map(s => s.w)
        const ysBefore = storedYs(strokesBefore)
        const spanBefore = Math.max(...ysBefore) - Math.min(...ysBefore)

        // Lasso the whole drawing.
        const [b0, b1] = column()
        const cr = committed.getBoundingClientRect()
        const e = ink()!
        lassoBox(
            live,
            cr.left + b0 + 2,
            cr.top + e.top - 10,
            cr.left + b1 - 2,
            cr.top + e.bottom + 10,
        )
        await frames(4)
        expect(inkExtent(live, column())).not.toBeNull()

        // The handle's client position, derived from the FIXTURE's own numbers plus the widget's
        // measured top — never from the code under test. A standalone fence stores logical
        // units against its widget top, so client = widgetTop + storedY * scale.
        const s = scale()
        const content = view.contentDOM.getBoundingClientRect()
        const wTop = widget().getBoundingClientRect().top
        const allX = strokesBefore.flatMap(st =>
            st.pts.filter((_, i) => i % 3 === 0),
        )
        const minX = Math.min(...allX)
        const maxX = Math.max(...allX)
        const minY = Math.min(...ysBefore)
        const maxY = Math.max(...ysBefore)
        const origin = { x: content.left + minX * s, y: wTop + minY * s }
        const handle = { x: content.left + maxX * s, y: wTop + maxY * s }
        const target = {
            x: origin.x + (handle.x - origin.x) * 0.5,
            y: origin.y + (handle.y - origin.y) * 0.5,
        }

        drag(live, [
            [handle.x, handle.y],
            [
                (handle.x + target.x) / 2,
                (handle.y + target.y) / 2,
            ],
            [target.x, target.y],
        ])
        await waitFor(
            () => {
                const now = scanDrawBlocks(view.state.doc.toString())[0]
                expect(now.strokes[0].w).toBeLessThan(widthsBefore[0])
            },
            { timeout: 4000 },
        )
        await frames(20)

        const after = scanDrawBlocks(view.state.doc.toString())[0]
        // 1. Width scaled WITH the geometry, per stroke.
        after.strokes.forEach((st, i) => {
            expect(st.w).toBeCloseTo(widthsBefore[i] * 0.5, 1)
        })
        // 2. The geometry itself halved, about the top edge — which did not move.
        const ysAfter = storedYs(after.strokes)
        expect(Math.max(...ysAfter) - Math.min(...ysAfter)).toBeCloseTo(
            spanBefore * 0.5,
            0,
        )
        expect(Math.min(...ysAfter)).toBe(minY)
        // 3. The block gave its space back: the reserved height followed the ink down, so the
        //    paragraph after the drawing moved up rather than leaving a hole.
        const heightAfter = widget().getBoundingClientRect().height
        expect(heightAfter).toBeLessThan(heightBefore - 20)
        expect(
            Math.abs(
                heightAfter -
                    standaloneHeight(after.strokes, STANDALONE_PAD) * scale(),
            ),
        ).toBeLessThan(3)
        // 4. …and the ink is still painted INSIDE the box that shrank around it.
        const finalInk = ink()!
        const wRect = widget().getBoundingClientRect()
        expect(cr.top + finalInk.top).toBeGreaterThan(wRect.top - 2)
        expect(cr.top + finalInk.bottom).toBeLessThan(wRect.bottom + 2)
    },
}
