// Visual spec for drawBlock.ts — the ```draw embedded block that hides its fence and reserves
// either zero height (attached to the block above) or the ink's own bounding-box height
// (standalone). See the module comment at the top of drawBlock.ts for the two shapes.
//
// Mounted over the bare CmHarness (app/src/ui/_cmHarness.tsx) rather than the full Editor.tsx —
// drawBlockExtension() needs nothing from the note-editing stack (no vault facets, no autosave),
// only a document containing a ```draw fence.
//
// NOTE on the fixture payload: both stories below use an EMPTY fence payload — a freshly
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
// `LassoMovesInk`). A standalone drawing carries a `data-draw-drag` grip on its left edge; an
// attached fence deliberately has none, since it is owned by the paragraph above it.

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
 * Grab the standalone block's grip and drop it below the last paragraph.
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

        // An ATTACHED fence has no grip: moving one on its own would hand its ink to a
        // different paragraph, which the ownership model forbids. Exactly one grip here.
        const grips = canvasElement.querySelectorAll('[data-draw-drag]')
        expect(grips).toHaveLength(1)
        const grip = grips[0] as HTMLElement
        const gRect = grip.getBoundingClientRect()

        const charlie = lineEl('Charlie paragraph').getBoundingClientRect()
        pointer(grip, 'pointerdown', gRect.left + 5, gRect.top + 5)
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
