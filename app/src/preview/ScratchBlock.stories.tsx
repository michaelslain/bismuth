// app/src/preview/ScratchBlock.stories.tsx
// Visual spec for <ScratchBlock> — one scratch note, alone on a patch of the note surface (the strip
// ground ScratchTextLayer places it on). Positioning, placement and persistence are the layer's job
// and are specified in ScratchTextLayer.stories.tsx; these stories pin the block's own look: text at
// rest reads as plain prose on paper, and only a focused (or hovered) block shows its move handle
// and delete X.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import ScratchBlock from './ScratchBlock'

const meta = {
    title: 'Preview/ScratchBlock',
    component: ScratchBlock,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ScratchBlock>

export default meta
type Story = StoryObj<typeof meta>

const BLOCK = {
    id: 'k3f9',
    page: 0,
    x: 846,
    y: 120,
    w: 280,
    text: '**why?** see [[Lecture 7]]\n\n- check eq (3)\n- compare with p. 12',
}

const noop = () => {}

function Patch(props: { autofocus: boolean }) {
    return (
        <div
            style={{
                position: 'relative',
                width: '260px',
                height: '220px',
                background: 'var(--editor)',
                'border-left': 'var(--rule-soft)',
            }}
        >
            <ScratchBlock
                block={BLOCK}
                rect={{ left: 20, top: 36, w: 210, scale: 1 }}
                autofocus={props.autofocus}
                interactive
                onText={noop}
                onLeave={noop}
                onDelete={noop}
                onDragMove={noop}
                onDragEnd={noop}
            />
        </div>
    )
}

const chromeOf = (root: HTMLElement) => ({
    block: root.querySelector<HTMLElement>('[data-scratch-block]')!,
    handle: root.querySelector<HTMLElement>('[aria-label="Move note"]')!,
    del: root.querySelector<HTMLElement>('[data-testid="scratch-delete"]')!,
})

/** At rest: rendered markdown on the note surface, no handle, no X. */
export const Default: Story = {
    render: () => <Patch autofocus={false} />,
    play: async ({ canvasElement }) => {
        const { block, handle, del } = chromeOf(canvasElement)
        await expect(block.dataset.scratchBlock).toBe('k3f9')
        await waitFor(() =>
            expect(block.querySelector('.cm-strong')).not.toBeNull(),
        )
        await expect(getComputedStyle(handle).opacity).toBe('0')
        await expect(getComputedStyle(del).opacity).toBe('0')
        const r = block.getBoundingClientRect()
        await expect(Math.round(r.width)).toBe(210)
    },
}

/** Focused: caret in the text, move handle along the top edge and the delete X visible. */
export const Focused: Story = {
    render: () => <Patch autofocus />,
    play: async ({ canvasElement }) => {
        const { block, handle, del } = chromeOf(canvasElement)
        await waitFor(() =>
            expect(block.contains(document.activeElement)).toBe(true),
        )
        await waitFor(() => expect(getComputedStyle(handle).opacity).toBe('1'))
        await expect(getComputedStyle(del).opacity).toBe('1')
        // The handle sits just above the block's top edge, spanning its width short of the X.
        const b = block.getBoundingClientRect()
        const h = handle.getBoundingClientRect()
        await expect(h.bottom).toBeLessThanOrEqual(b.top)
        await expect(h.bottom).toBeGreaterThan(b.top - 12)
        await expect(Math.abs(h.left - b.left)).toBeLessThan(1)
    },
}
