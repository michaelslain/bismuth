// Visual spec for <InkOverlay> — the draw-anywhere note-ink layer (app/src/editor/): a
// transparent freehand-stroke layer painted over the CodeMirror editor viewport, in a fixed
// 680px logical coordinate space (core/src/drawing/ink.ts's INK_LOGICAL_W) so pane-width changes
// rescale ink proportionally instead of anchoring to CM line positions.
//
// InkOverlay's required `view: () => EditorView | undefined` prop has no standalone render path —
// every paint reads `view().contentDOM`'s live bounding rect for its geometry (`geom()`), and the
// pointer handlers read `view().contentDOM` too (`toLogical()`), so it renders nothing without a
// real, mounted CM view to sit on top of. This story mounts it inside `_cmHarness.tsx`'s
// `CmHarness`, the reusable minimal CodeMirror 6 `EditorView` harness built for exactly this
// shape of component: a `children` render-prop handed the live view accessor, rendered as a
// sibling of the CM scroller inside a `position:relative` wrapper — the same wrapper/host/overlay
// layering `Editor.tsx` uses for `InkOverlay` in the real app. This file does NOT modify
// InkOverlay.tsx or _cmHarness.tsx — every story below exercises the real, unmodified component
// over a real, unmodified harness.
//
// Full prop list (read from InkOverlay.tsx): `view: () => EditorView | undefined`; `path: () =>
// string | null` (the open note's vault-relative path — drives the `.ink/<path>.ink` sidecar
// load/save, `core/src/drawing/ink.ts`'s `inkPathFor`); `active: () => boolean` (draw mode on/off
// — InkOverlay.css gates the live canvas's `pointer-events` and the Toolbar's visibility on this,
// and `mounted = () => active() || hasInk()` means the whole overlay renders NOTHING when both are
// false — an ink-free note outside draw mode pays for nothing beyond the async load probe);
// `onExit: () => void` (fired on Escape while active, scoped to this pane via focus).
//
// Strokes CAN be seeded: there is no `strokes` prop — InkOverlay loads its own ink on mount via
// `api.read(inkPathFor(path))` against the real `.ink/<note>.ink` sidecar format
// (core/src/drawing/ink.ts's `InkDoc`/`serializeInkDoc`). That's real IO through `api`, so the
// same `setTransport(fakeTransport({ files: {...} }))` seam SheetView.stories.tsx and
// Backlinks.stories.tsx use for a scoped fixture seeds it here too — write the serialized
// `InkDoc` at `inkPathFor(path)` before mounting and InkOverlay reads it back for real.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { EditorView } from '@codemirror/view'
import { InkOverlay } from './InkOverlay'
import { CmHarness } from '../ui/_cmHarness'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import {
    serializeInkDoc,
    inkPathFor,
    INK_LOGICAL_W,
    type InkDoc,
    type InkStroke,
} from '../../../core/src/drawing/ink'
import type { Stroke } from '../../../core/src/drawing/model'

const meta = {
    title: 'Editor/InkOverlay',
    component: InkOverlay,
    // InkOverlay fills its editor wrapper edge-to-edge in the real app (no card chrome around it) —
    // same reasoning as Editor.stories.tsx's `fullscreen`.
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof InkOverlay>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}
const PATH = 'Ink Demo.md'

// Fixed px, not vh: the Storybook preview iframe is short with the Controls panel open (see
// Editor.stories.tsx / GraphView.stories.tsx's own notes on this).
const STORY_H = '700px'

const NOTE_TEXT = [
    '# Ink Demo',
    '',
    'This note has draw-anywhere ink layered on top of the editor. Toggle draw',
    'mode to sketch directly over the text below.',
    '',
    'Annotate this paragraph, circle a typo, or sketch a diagram right on the',
    'page: the ink persists to a hidden .ink/<note>.ink sidecar next to the',
    'note itself.',
    '',
].join('\n')

/** Flatten `[x, y]` pairs into InkOverlay's packed `pts` format — flat `(x, y, pressureByte)`
 *  triples (`core/src/drawing/model.ts`'s `Stroke.pts`) — at a fixed mid pressure, since these
 *  are seeded fixture geometry, not a real stylus capture. */
function line(points: Array<[number, number]>, pressure = 200): number[] {
    return points.flatMap(([x, y]) => [x, y, pressure])
}

/** A small doodle in ink's logical content space (x in the note's 680px reading column, y in
 *  content px) sitting over NOTE_TEXT's second paragraph: a wavy underline, a circled "typo",
 *  and a highlighter swipe over the heading — plausible annotation marks, not a captured
 *  stroke. `c: "fg"` resolves to the theme's ink color (`theme.ts`'s `makeColorResolver`); the
 *  highlighter uses a literal hex, matching how a real stroke persists color (Toolbar.tsx's
 *  comment: never a bare swatch id in the saved doc). */
function demoStrokes(): Stroke[] {
    return [
        {
            t: 'pen',
            c: 'fg',
            w: 4,
            pts: line([
                [20, 148],
                [60, 154],
                [100, 146],
                [140, 154],
                [180, 146],
                [220, 154],
                [260, 146],
                [300, 154],
                [340, 148],
            ]),
        },
        {
            t: 'pen',
            c: 'fg',
            w: 3,
            pts: line([
                [252, 168],
                [268, 158],
                [288, 160],
                [296, 172],
                [286, 184],
                [264, 184],
                [252, 174],
                [252, 168],
            ]),
        },
        {
            t: 'hl',
            c: '#f2b705',
            w: 18,
            pts: line(
                [
                    [16, 18],
                    [120, 18],
                ],
                255,
            ),
        },
    ]
}

/** Draw mode freshly toggled on: an empty canvas plus the drawing Toolbar (InkOverlay.css flips
 *  the live canvas interactive and shows `.draw-toolbar` only while `active()`), no ink yet. Uses
 *  the globally-installed fakeTransport (`.storybook/preview.ts`) as-is — an unseeded
 *  `.ink/*.ink` GET resolves to `""` (fakeTransport's default for a missing file), which
 *  InkOverlay's load effect already treats as "start empty" (`if (text.trim()) {...}`). */
export const Default: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness doc={NOTE_TEXT}>
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
}

/** Existing strokes, loaded the real way: a `.ink/<path>.ink` sidecar seeded on a scoped
 *  fakeTransport (same pattern as SheetView.stories.tsx's `.sheet` fixtures), read back by
 *  InkOverlay's own `api.read(inkPathFor(path))` load effect on mount — there is no strokes
 *  prop to poke directly. Still `active`, so the committed strokes render on the base canvas
 *  alongside the Toolbar, showing the overlay mid-annotation rather than freshly reset. */
export const DrawnInk: Story = {
    render: () => {
        const doc: InkDoc = { v: 1, kind: 'ink', strokes: demoStrokes() }
        setTransport(
            fakeTransport({
                files: { [inkPathFor(PATH)]: serializeInkDoc(doc) },
            }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <CmHarness doc={NOTE_TEXT}>
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
        )
    },
}

// ── Line anchoring ──────────────────────────────────────────────────────────────────────────
// THE POINT OF THE ANCHOR FEATURE: ink is anchored to the line it was drawn beside, so inserting
// text ABOVE moves it down. An unanchored (pre-anchor) stroke in the same document must NOT move
// — that is the no-migration guarantee, and a story is the only place both halves are visible at
// once. The `play` below proves it by SAMPLING CANVAS PIXELS: a DOM element count would say
// nothing whatsoever about where ink is painted (a blank canvas has the same DOM as a full one).

/** Where the anchored fixture stroke is pinned: the `from` of NOTE_TEXT's line index 5 ("Annotate
 *  this paragraph…") — partway down, so the insertion above it is a real remap and not a
 *  degenerate insert-at-zero. Computed from the text rather than hardcoded so editing NOTE_TEXT
 *  cannot silently move the anchor onto the wrong line. */
const ANCHOR_LINE = 5
const ANCHOR_POS = NOTE_TEXT.split('\n')
    .slice(0, ANCHOR_LINE)
    .reduce((n, l) => n + l.length + 1, 0)

/** Two strokes, side by side in x so each can be measured in its own vertical band of the canvas
 *  without the other's pixels leaking in.
 *
 *  LEFT (x 40–240) is anchored with `y: 0`, meaning "drawn when this line's top was 0" — so its
 *  paint shift is exactly that line's current top and its stored geometry (y 4–16) reads as an
 *  offset FROM the line. It therefore renders right on line 5, which is what an anchor means.
 *  RIGHT (x 400–600) carries no `a` at all: it is a pre-anchor stroke, byte-identical to what
 *  every existing `.ink` sidecar holds, and must paint at its literal y forever. */
function anchorFixture(): InkStroke[] {
    const wave = (x0: number, y0: number): number[] =>
        line([
            [x0, y0 + 10],
            [x0 + 50, y0 + 2],
            [x0 + 100, y0 + 12],
            [x0 + 150, y0 + 2],
            [x0 + 200, y0 + 10],
        ])
    return [
        {
            t: 'pen',
            c: 'fg',
            w: 4,
            pts: wave(40, 4),
            a: { p: ANCHOR_POS, y: 0 },
        },
        { t: 'pen', c: 'fg', w: 4, pts: wave(400, 56) },
    ]
}

/** The topmost inked row of the committed-ink canvas inside an x band, in CSS px — `null` when
 *  the band holds no ink at all. Reads the alpha channel of real pixels, which is the only thing
 *  that can distinguish "the stroke moved" from "the stroke is still where it was". */
function topOfBand(
    canvas: HTMLCanvasElement,
    band: readonly [number, number],
): number | null {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.clientWidth) return null
    const sx = canvas.width / canvas.clientWidth // device px per CSS px
    const px0 = Math.max(0, Math.round(band[0] * sx))
    const px1 = Math.min(canvas.width, Math.round(band[1] * sx))
    const w = px1 - px0
    if (w <= 0) return null
    const { data } = ctx.getImageData(px0, 0, w, canvas.height)
    for (let row = 0; row < canvas.height; row++) {
        for (let col = 0; col < w; col++) {
            if (data[(row * w + col) * 4 + 3] > 16) return row / sx
        }
    }
    return null
}

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

// NOTE ON HEADLESS CONCURRENCY: this story paints to canvas and is graded by bench/playCheck.ts
// alongside 5 other stories at once, each its own Chrome target. A backgrounded target normally
// runs NO requestAnimationFrame callbacks at all (`visibilityState: "hidden"`), which would leave
// this canvas blank and every pixel assertion below `null` — and in InkOverlay's case would also
// latch its own `rafPending` flag forever, blocking any later repaint too. There used to be a
// per-story `requestAnimationFrame` patch here working around exactly that. It is gone because the
// real fix now lives where every canvas story needs it, not just this one:
// `bench/chromeSession.ts`'s `newPage()` calls `Emulation.setFocusEmulationEnabled({enabled:
// true})` on every concurrent target, which keeps `visibilityState` "visible" and the rAF clock
// running (~60fps, measured) in all of them — so this story now renders real, unmodified paints
// under playCheck's normal concurrency with no cooperation required from the story itself.

export const AnchorFollowsInsertedLines: Story = {
    render: () => {
        const doc: InkDoc = { v: 1, kind: 'ink', strokes: anchorFixture() }
        setTransport(
            fakeTransport({
                files: { [inkPathFor(PATH)]: serializeInkDoc(doc) },
            }),
        )
        return (
            // Not in draw mode: this is the everyday case the anchor exists for — a note that
            // already carries ink, being TYPED in. `mounted()` is still true because hasInk() is.
            <div style={{ height: STORY_H, width: '100%' }}>
                <CmHarness doc={NOTE_TEXT}>
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
        )
    },
    play: async ({ canvasElement }) => {
        const cmDom = canvasElement.querySelector<HTMLElement>('.cm-editor')
        expect(cmDom).not.toBeNull()
        const view = EditorView.findFromDOM(cmDom!)
        expect(view).not.toBeNull()
        const canvas = canvasElement.querySelector<HTMLCanvasElement>('canvas')
        expect(canvas).not.toBeNull()
        const v = view!
        const c = canvas!

        const left = () => topOfBand(c, band(v, c, 0, 320))
        const right = () => topOfBand(c, band(v, c, 360, 680))

        // The sidecar loads asynchronously and paints on the next rAF — wait for BOTH strokes to
        // actually exist as pixels before measuring anything.
        await waitFor(
            () => {
                expect(left()).not.toBeNull()
                expect(right()).not.toBeNull()
            },
            { timeout: 5000 },
        )
        const beforeAnchored = left()!
        const beforeUnanchored = right()!

        // Line pitch measured from the DOM, not from CodeMirror's own numbers — the expected
        // shift has to come from somewhere independent of the code under test.
        const lines = cmDom!.querySelectorAll('.cm-line')
        expect(lines.length).toBeGreaterThan(1)
        const lineH =
            lines[1].getBoundingClientRect().top -
            lines[0].getBoundingClientRect().top
        expect(lineH).toBeGreaterThan(4)

        // Three lines inserted ABOVE everything — the exact edit the user described.
        v.dispatch({ changes: { from: 0, insert: 'one\ntwo\nthree\n' } })

        // The anchored stroke follows its line down by exactly three line heights.
        await waitFor(
            () => {
                const now = left()
                expect(now).not.toBeNull()
                expect(
                    Math.abs(now! - beforeAnchored - 3 * lineH),
                ).toBeLessThan(2)
            },
            { timeout: 5000 },
        )

        // …and the unanchored stroke has not moved by so much as a pixel. This half is the
        // no-migration guarantee: every `.ink` file written before anchors existed still behaves
        // exactly as it did.
        const afterUnanchored = right()
        expect(afterUnanchored).not.toBeNull()
        expect(Math.abs(afterUnanchored! - beforeUnanchored)).toBeLessThan(1)
    },
}
