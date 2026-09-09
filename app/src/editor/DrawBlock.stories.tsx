// Visual spec for drawBlock.ts — the ```draw embedded block that hides its fence and reserves
// either zero height (attached to the block above) or the ink's own bounding-box height
// (standalone). See the module comment at the top of drawBlock.ts for the two shapes.
//
// Mounted over the bare CmHarness (app/src/ui/_cmHarness.tsx) rather than the full Editor.tsx —
// drawBlockExtension() needs nothing from the note-editing stack (no vault facets, no autosave),
// only a document containing a ```draw fence.
//
// NOTE on the fixture payload: core/src/drawing/inkCodec.ts's encodeStrokes/decodeStrokes call
// `Bun.deflateSync`/`Bun.inflateSync` unconditionally — APIs that exist under `bun test` but NOT
// in a browser (Storybook's Vite-bundled preview included). Calling encodeStrokes here throws
// `ReferenceError: Bun is not defined` at story-render time. Both stories below therefore use an
// EMPTY fence payload (a freshly-inserted, not-yet-drawn-on block, same shape as
// core/src/drawing/drawBlocks.ts's `insertDrawBlock` produces) rather than real encoded ink. This
// is a real defect in the (already-merged, out of this task's scope) codec — reported, not fixed
// here — and it means a non-empty standalone block's reserved height cannot be demonstrated
// in-browser today; that geometry is covered instead by the headless
// drawBlockGeometry.test.ts (which runs under `bun test`, where `Bun` exists).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { CmHarness } from '../ui/_cmHarness'
import { drawBlockExtension } from './drawBlock'

const meta = {
    title: 'Editor/DrawBlock',
    parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const STORY_H = '400px'

// No blank line between the paragraph and the fence — core/src/drawing/drawBlocks.ts's
// `attachedToLine` is null (standalone) whenever the fence is preceded by a blank line, so
// "attached" fixtures must butt directly up against the text they decorate.
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
    '```draw',
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

/** A ```draw fence with nothing but blank space (or the start of the doc) above it: standalone
 *  mode. The widget carries `data-draw-standalone` so it is styleable/sizeable independently of
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
