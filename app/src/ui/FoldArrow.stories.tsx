// Visual spec for <FoldArrow> — the one fold triangle: a note's heading and list folds, the same
// folds inside a chat message, and a chat message's own fold all draw it. Points down while open,
// right while folded. It takes its colour from the host.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import FoldArrow from './FoldArrow'

const meta = {
    title: 'UI/FoldArrow',
    component: FoldArrow,
    parameters: { layout: 'padded' },
    args: { collapsed: false },
} satisfies Meta<typeof FoldArrow>

export default meta
type Story = StoryObj<typeof meta>

const host = { color: 'var(--text-muted)', display: 'inline-flex' }

/** Open: points down (a quarter turn from its drawn right-pointing shape). */
export const Open: Story = {
    render: () => (
        <span style={host}>
            <FoldArrow collapsed={false} />
        </span>
    ),
    play: async ({ canvasElement }) => {
        const glyph = canvasElement.querySelector('[data-fold-glyph]')!
        await expect(glyph).not.toHaveAttribute('data-collapsed')
        const box = glyph.getBoundingClientRect()
        await expect(box.width).toBe(8)
        await expect(box.height).toBe(8)
    },
}

/** Folded: points right. */
export const Collapsed: Story = {
    render: () => (
        <span style={host}>
            <FoldArrow collapsed />
        </span>
    ),
    play: async ({ canvasElement }) => {
        const glyph = canvasElement.querySelector('[data-fold-glyph]')!
        await expect(glyph).toHaveAttribute('data-collapsed')
        // no turn: the identity matrix (or none)
        await expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(
            getComputedStyle(glyph).transform,
        )
    },
}
