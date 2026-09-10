// Visual spec for drawBlock.ts — the ```draw embedded block that hides its fence and reserves
// either zero height (attached to the block above) or the ink's own bounding-box height
// (standalone). See the module comment at the top of drawBlock.ts for the two shapes.
//
// Mounted over the bare CmHarness (app/src/ui/_cmHarness.tsx) rather than the full Editor.tsx —
// drawBlockExtension() needs nothing from the note-editing stack (no vault facets, no autosave),
// only a document containing a ```draw fence.
//
// NOTE on the fixture payload: the first two stories below use an EMPTY fence payload — a freshly
// inserted, not-yet-drawn-on block. That was once forced (the codec called `Bun.deflateSync` and
// threw in a browser); it no longer is, since the codec moved to `fflate`. It stays because these
// two stories are about the WIDGET's two shapes, and a non-empty standalone block's reserved
// height is demonstrated end to end with real encoded ink next door, in
// InkOverlay.stories.tsx's `StandaloneDrawing` (466.81px reserved, 41058 painted pixels).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { EditorView } from '@codemirror/view'
import { CmHarness } from '../ui/_cmHarness'
import { drawBlockExtension } from './drawBlock'
import {
    insertDrawBlock,
    scanDrawBlocks,
} from '../../../core/src/drawing/drawBlocks'
import type { Stroke } from '../../../core/src/drawing/model'

const meta = {
    title: 'Editor/DrawBlock',
    parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const STORY_H = '400px'

// A fence's mode is its own info string: ```draw is attached, ```draw block is standalone
// (core/src/drawing/drawBlocks.ts's `standalone`). Blank lines around a fence decide nothing —
// that inference is exactly what let one Enter keypress flip a fence's mode and throw its ink
// 78px down the page.
const ATTACHED_NOTE = [
    'The mitochondria is the powerhouse of the cell.',
    '```draw',
    '',
    '```',
    '',
    'Text after it, flowing normally.',
].join('\n')

const STANDALONE_NOTE = [
    '# A page with a drawing',
    '',
    '```draw block',
    '',
    '```',
    '',
    'Text after the drawing.',
].join('\n')

/** A ```draw fence immediately preceded by a text block: attached mode. The widget replacing the
 *  fence reserves ZERO height — Task 5's overlay paints this block's ink over the paragraph
 *  above it, not into space of its own. */
export const Attached: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness doc={ATTACHED_NOTE} extensions={[drawBlockExtension()]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const block = canvasElement.querySelector<HTMLElement>(
            '[data-draw-block]',
        )
        expect(block).not.toBeNull()
        expect(block?.hasAttribute('data-draw-standalone')).toBe(false)
        expect(block?.getBoundingClientRect().height).toBe(0)
        // The raw fence text never appears — the whole block is replaced, and the block never
        // reveals its source (unlike ```query / ```graph — see drawBlock.ts's module comment).
        expect(canvasElement.textContent).not.toContain('```draw')
    },
}

/** A ```draw block fence: standalone mode, declared in the fence itself. The widget carries `data-draw-standalone` so it is styleable/sizeable independently of
 *  the attached case, and reserves the ink's own bounding-box height when there IS ink — zero
 *  here because this fixture's fence is empty (see the file-level NOTE on why). */
export const Standalone: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness doc={STANDALONE_NOTE} extensions={[drawBlockExtension()]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const block = canvasElement.querySelector<HTMLElement>(
            '[data-draw-block][data-draw-standalone]',
        )
        expect(block).not.toBeNull()
        expect(canvasElement.textContent).not.toContain('```draw')
    },
}

// ── Reorder: dragging a drawing block to a new place ────────────────────────────────────────
// The other half of "select it and move it around": moving the whole BLOCK among the note's
// paragraphs, rather than moving ink inside it (that half is InkOverlay.stories.tsx's
// `LassoMovesInk`). A standalone drawing IS the drag surface over its whole area — it carries
// `data-draw-drag` on the widget itself, and a hand cursor is the only thing that advertises it.
// An attached fence deliberately gets neither, since it is owned by the paragraph above it.

/** Let `n` animation frames go by — CodeMirror re-measures its height map across frames, so a
 *  rect read in the same macrotask as a transaction is the previous layout's. */
const frames = (n: number): Promise<void> =>
    new Promise(resolve => {
        let left = n
        const step = () => (left-- > 0 ? requestAnimationFrame(step) : resolve())
        step()
    })

/** Wait for the real web fonts before measuring anything: a CodeMirror line measured before
 *  they land is a different height afterwards, and every number below comes from line geometry.
 *  (The same guard InkOverlay.stories.tsx carries, and for the same reason — it cost a real
 *  debugging round there.) */
async function settleLayout(): Promise<void> {
    await document.fonts.ready
    await frames(10)
}

function liveView(root: HTMLElement): EditorView {
    const cmDom = root.querySelector<HTMLElement>('.cm-editor')
    expect(cmDom).not.toBeNull()
    const view = EditorView.findFromDOM(cmDom!)
    expect(view).not.toBeNull()
    return view!
}

const pointer = (
    el: EventTarget,
    type: string,
    x: number,
    y: number,
) =>
    el.dispatchEvent(
        new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: x,
            clientY: y,
            pointerId: 21,
            pointerType: 'mouse',
            isPrimary: true,
        }),
    )

// Real encoded ink, so the widget reserves genuine height and there is a grip tall enough to
// grab — an empty payload reserves zero and the drag has nothing to start on.
const REORDER_INK: Stroke[] = [
    {
        t: 'pen',
        c: 'fg',
        w: 4,
        pts: [
            40, 24, 200, 140, 96, 200, 240, 40, 200, 340, 120, 200, 420, 32,
            200,
        ],
    },
]

const REORDER_NOTE = insertDrawBlock(
    [
        'Alpha paragraph, above the drawing.',
        '',
        'Bravo paragraph, below the drawing.',
        '',
        'Charlie paragraph, last on the page.',
        '',
    ].join('\n'),
    2,
    REORDER_INK,
    true,
)

/**
 * Grab the standalone block anywhere on its face and drop it below the last paragraph.
 *
 * The assertions are positional rather than count-based on purpose: "one fence exists" is true
 * before and after a drag that did nothing at all. What has to be shown is that the fence's
 * LINE RANGE moved past Charlie, that the widget's rect moved with it, that the payload came
 * through the move byte-identical (a reorder is line surgery, never a re-encode), and that the
 * prose kept both its order and its blank-line separators.
 */
export const Reorder: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness doc={REORDER_NOTE} extensions={[drawBlockExtension()]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await settleLayout()
        const view = liveView(canvasElement)
        const widget = () =>
            canvasElement.querySelector<HTMLElement>(
                '[data-draw-block][data-draw-standalone]',
            )!
        await waitFor(
            () => {
                expect(widget().getBoundingClientRect().height).toBeGreaterThan(
                    50,
                )
            },
            { timeout: 5000 },
        )

        const lineEl = (prefix: string) =>
            Array.from(
                canvasElement.querySelectorAll<HTMLElement>('.cm-line'),
            ).find(el => el.textContent?.startsWith(prefix))!
        const lineNumberOf = (prefix: string) => {
            const text = view.state.doc.toString().split('\n')
            return text.findIndex(l => l.startsWith(prefix)) + 1
        }

        const before = scanDrawBlocks(view.state.doc.toString())[0]
        expect(before.standalone).toBe(true)
        // It starts between Alpha and Bravo.
        expect(before.fromLine).toBeGreaterThan(lineNumberOf('Alpha'))
        expect(before.fromLine).toBeLessThan(lineNumberOf('Bravo'))
        const widgetTopBefore = widget().getBoundingClientRect().top

        // An ATTACHED fence is not a drag surface: moving one on its own would hand its ink to a
        // different paragraph, which the ownership model forbids. So exactly one element in this
        // note carries `data-draw-drag`, and it is the standalone drawing itself — no grip child,
        // no 14px edge strip.
        const surfaces = canvasElement.querySelectorAll('[data-draw-drag]')
        expect(surfaces).toHaveLength(1)
        expect(surfaces[0]).toBe(widget())

        // It paints NOTHING, in every state — not at rest and not on hover. The user reported
        // this twice: "blocks are visible" (a grip at a permanent 25% opacity), and then again
        // once it only surfaced on hover, "i dont like this handle, i told u that it hsould be
        // seemless". So the assertion is not "invisible at rest" — that version passed while a
        // dotted strip still appeared under the pointer. It is that the drawing has no painted
        // drag marker at all, which no hover state can undo. The affordance is the CURSOR, and
        // it now covers the whole drawing rather than a strip nobody could find.
        const ws = getComputedStyle(widget())
        expect(ws.backgroundImage).toBe('none')
        expect(ws.backgroundColor).toBe('rgba(0, 0, 0, 0)')
        expect(ws.borderStyle).toBe('none')
        expect(ws.outlineStyle).toBe('none')
        expect(ws.cursor).toBe('grab')

        // Press the CENTRE of the drawing. The x is asserted to be well clear of the 14px left
        // edge the old grip occupied, so this drag can only succeed because the whole area is the
        // handle — a story pressing at `left + 5` would pass either way.
        const wRect = widget().getBoundingClientRect()
        const grabX = wRect.left + wRect.width / 2
        const grabY = wRect.top + wRect.height / 2
        expect(grabX - wRect.left).toBeGreaterThan(60)
        expect(wRect.bottom - grabY).toBeGreaterThan(20)

        const charlie = lineEl('Charlie paragraph').getBoundingClientRect()
        pointer(widget(), 'pointerdown', grabX, grabY)
        // The drop indicator is up as soon as the drag starts, so the user can see where it
        // will land rather than finding out afterwards.
        expect(
            document.querySelector('[data-draw-drop-indicator]'),
        ).not.toBeNull()
        pointer(window, 'pointermove', charlie.left + 20, charlie.top + 4)
        pointer(
            window,
            'pointermove',
            charlie.left + 20,
            charlie.bottom - 2,
        )
        pointer(window, 'pointerup', charlie.left + 20, charlie.bottom - 2)
        await frames(20)

        // …and it is taken down again on drop.
        expect(document.querySelector('[data-draw-drop-indicator]')).toBeNull()

        const after = scanDrawBlocks(view.state.doc.toString())
        expect(after).toHaveLength(1)
        expect(after[0].standalone).toBe(true)
        // 1. The fence really moved, past the last paragraph.
        expect(after[0].fromLine).toBeGreaterThan(lineNumberOf('Charlie'))
        // 2. The ink came through untouched.
        expect(after[0].strokes).toEqual(REORDER_INK)
        // 3. The widget moved on screen too, not just in the text.
        expect(widget().getBoundingClientRect().top).toBeGreaterThan(
            widgetTopBefore + 20,
        )
        // 4. The prose kept its order, and the note did not grow a doubled blank line where the
        //    drawing used to sit.
        const text = view.state.doc.toString()
        expect(text).not.toContain('\n\n\n')
        expect(
            text
                .split('\n')
                .filter(l => l.startsWith('Alpha') || l.startsWith('Bravo') || l.startsWith('Charlie')),
        ).toEqual([
            'Alpha paragraph, above the drawing.',
            'Bravo paragraph, below the drawing.',
            'Charlie paragraph, last on the page.',
        ])
    },
}

// ── Draw mode makes the drawing inert ───────────────────────────────────────────────────────
// The dangerous half of "drag it anywhere". In draw mode a pointer-down on a drawing is a PEN
// STROKE and must stay one; a mode check inverted here makes it impossible to draw on top of an
// existing drawing, which is worse than the discoverability problem the drag surface fixes.
//
// Draw mode is `EditorView.editable` being false — `Editor.tsx`'s `setDraw` reconfigures
// `EditorView.editable.of(!on)` in a Compartment, so a non-editable view IS a view in draw mode,
// and setting the same facet statically here is the identical signal `drawBlock.ts` reads.
//
// **Two editors side by side, not one.** A story that only showed the draw-mode half would pass
// against a build with no whole-area drag at all — "nothing happened" is indistinguishable from
// "the feature is missing". The left pane is the control: same note, same extensions, mode off.
// Every assertion below is a DIFFERENCE between the two, so one pane failing to drag and the
// other failing to stay still are both caught.

const HALVES = [
    { id: 'mode-off', extensions: [drawBlockExtension()] },
    {
        id: 'mode-on',
        extensions: [drawBlockExtension(), EditorView.editable.of(false)],
    },
] as const

export const DrawModeIsInert: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%', display: 'flex', gap: '1px' }}>
            {HALVES.map(half => (
                <div
                    data-testid={half.id}
                    style={{ flex: '1 1 0', height: '100%', 'min-width': '0' }}
                >
                    <CmHarness doc={REORDER_NOTE} extensions={[...half.extensions]} />
                </div>
            ))}
        </div>
    ),
    play: async ({ canvasElement }) => {
        await settleLayout()
        const half = (id: string) =>
            canvasElement.querySelector<HTMLElement>(`[data-testid="${id}"]`)!
        const widgetIn = (root: HTMLElement) =>
            root.querySelector<HTMLElement>(
                '[data-draw-block][data-draw-standalone]',
            )!

        const off = half('mode-off')
        const on = half('mode-on')
        await waitFor(
            () => {
                expect(widgetIn(off).getBoundingClientRect().height).toBeGreaterThan(50)
                expect(widgetIn(on).getBoundingClientRect().height).toBeGreaterThan(50)
            },
            { timeout: 5000 },
        )

        // 1. THE CURSOR. Identical markup, identical stylesheet, one facet apart — so the
        //    difference IS the mode gate. Outside draw mode the hand says "you can move this";
        //    inside it, the pointer must not promise something it will refuse to do.
        expect(getComputedStyle(widgetIn(off)).cursor).toBe('grab')
        expect(getComputedStyle(widgetIn(on)).cursor).not.toBe('grab')
        expect(getComputedStyle(widgetIn(on)).cursor).not.toBe('grabbing')

        // 2. THE GESTURE, pressed at the centre of each drawing and dragged to the same place.
        const press = (root: HTMLElement) => {
            const r = widgetIn(root).getBoundingClientRect()
            // `pointer` returns dispatchEvent's own result: false exactly when the listener
            // called preventDefault, i.e. when the press was consumed as a drag.
            return pointer(
                widgetIn(root),
                'pointerdown',
                r.left + r.width / 2,
                r.top + r.height / 2,
            )
        }
        const release = (root: HTMLElement) => {
            const charlie = Array.from(
                root.querySelectorAll<HTMLElement>('.cm-line'),
            )
                .find(el => el.textContent?.startsWith('Charlie'))!
                .getBoundingClientRect()
            pointer(window, 'pointermove', charlie.left + 20, charlie.bottom - 2)
            pointer(window, 'pointerup', charlie.left + 20, charlie.bottom - 2)
        }

        const textBefore = liveView(on).state.doc.toString()

        // Draw mode: the press passes straight through, unconsumed, with no indicator raised —
        // which is what leaves it available to the ink overlay as the start of a stroke.
        expect(press(on)).toBe(true)
        expect(document.querySelector('[data-draw-drop-indicator]')).toBeNull()
        release(on)
        await frames(20)
        expect(liveView(on).state.doc.toString()).toBe(textBefore)
        expect(scanDrawBlocks(liveView(on).state.doc.toString())[0].strokes).toEqual(
            REORDER_INK,
        )

        // Mode off: the same press on the same drawing is consumed and raises the indicator, and
        // the release lands the drawing past the last paragraph.
        const viewOff = liveView(off)
        const lineNumberOf = (prefix: string) =>
            viewOff.state.doc.toString().split('\n').findIndex(l => l.startsWith(prefix)) + 1
        expect(press(off)).toBe(false)
        expect(document.querySelector('[data-draw-drop-indicator]')).not.toBeNull()
        release(off)
        await frames(20)
        expect(document.querySelector('[data-draw-drop-indicator]')).toBeNull()
        const moved = scanDrawBlocks(viewOff.state.doc.toString())[0]
        expect(moved.fromLine).toBeGreaterThan(lineNumberOf('Charlie'))
        expect(moved.strokes).toEqual(REORDER_INK)
    },
}

/** What a whole-area drag surface could plausibly have broken, on a drawing that has one:
 *  selecting text by dragging from ABOVE the drawing to BELOW it, which now crosses a live drag
 *  surface on its way, and a plain click on the drawing moving nothing. Neither is about
 *  reordering, which is why they sit here rather than inside a drag story that would pass with
 *  the selection ignored.
 *
 *  **What this story deliberately does NOT claim**, having tried and failed to: that a click on
 *  the drawing leaves no caret inside the fence's hidden source. CodeMirror ignores a synthetic
 *  `mousedown` landing on a block-replace widget entirely — the selection stays exactly where it
 *  was, measured at `[0, 0]`, with `ignoreEvent()` returning true, returning false, and with
 *  `atomicRanges` deleted, all three identical. An assertion written over that measures nothing,
 *  which is how the first draft of it read as a pass. The guard is real (`ignoreEvent` +
 *  `atomicRanges`, neither touched by the drag surface, the latter pinned by
 *  drawBlock.test.ts's atomic-deletion suite); it is simply not observable from a story, so it
 *  is claimed nowhere rather than claimed falsely. */
export const SelectingTextAcrossTheDrawingStillWorks: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <CmHarness doc={REORDER_NOTE} extensions={[drawBlockExtension()]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await settleLayout()
        const view = liveView(canvasElement)
        const widget = () =>
            canvasElement.querySelector<HTMLElement>(
                '[data-draw-block][data-draw-standalone]',
            )!
        await waitFor(
            () => {
                expect(widget().getBoundingClientRect().height).toBeGreaterThan(50)
            },
            { timeout: 5000 },
        )
        const lineEl = (prefix: string) =>
            Array.from(canvasElement.querySelectorAll<HTMLElement>('.cm-line')).find(
                el => el.textContent?.startsWith(prefix),
            )!

        const mouse = (el: EventTarget, type: string, x: number, y: number) =>
            el.dispatchEvent(
                new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    buttons: type === 'mouseup' ? 0 : 1,
                    detail: 1,
                    clientX: x,
                    clientY: y,
                }),
            )

        // 1. A CLICK ON THE DRAWING MOVES NOTHING. Now that the whole face is the drag surface,
        //    every click on a drawing is also a zero-travel drag, and a zero-travel drag has to
        //    resolve back to the slot it started in rather than teleporting the drawing to
        //    wherever the slot list happens to begin.
        const fence = scanDrawBlocks(view.state.doc.toString())[0]
        const r = widget().getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        pointer(widget(), 'pointerdown', cx, cy)
        pointer(window, 'pointerup', cx, cy)
        await frames(10)
        expect(scanDrawBlocks(view.state.doc.toString())[0].fromLine).toBe(fence.fromLine)

        // 2. SELECTING TEXT ACROSS THE DRAWING. The gesture starts on a `.cm-line`, so the
        //    widget's own pointerdown listener never fires — but it travels over the drawing,
        //    which is now a drag surface, and CodeMirror drives the selection off mouse events
        //    the widget does not touch. Alpha is above the drawing, Bravo below it.
        const alpha = lineEl('Alpha paragraph').getBoundingClientRect()
        const bravo = lineEl('Bravo paragraph').getBoundingClientRect()
        mouse(lineEl('Alpha paragraph'), 'mousedown', alpha.left + 2, alpha.top + 2)
        mouse(document, 'mousemove', cx, cy)
        mouse(document, 'mousemove', bravo.right - 2, bravo.bottom - 2)
        mouse(document, 'mouseup', bravo.right - 2, bravo.bottom - 2)
        await frames(10)
        const sel = view.state.selection.main
        expect(sel.empty).toBe(false)
        const selected = view.state.doc.sliceString(sel.from, sel.to)
        expect(selected).toContain('Alpha paragraph')
        expect(selected).toContain('Bravo paragraph')
    },
}
