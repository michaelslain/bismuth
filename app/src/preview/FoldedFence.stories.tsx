// Visual spec for <FoldedFence> — the one-row `--- <preview> ---` shown in place of a folded
// CompanionFrontmatter. See CompanionFrontmatter.stories.tsx's `Folded` story for the folded
// strip end-to-end; this file only proves FoldedFence's own rendered text and sizing.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import FoldedFence from './FoldedFence'

const meta = {
    title: 'Preview/FoldedFence',
    component: FoldedFence,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof FoldedFence>

export default meta
type Story = StoryObj<typeof meta>

/** Resolves a CSS value (a var() reference or any other value) to its computed px form by
 *  painting it on a throwaway element, so the assertion compares like-for-like against
 *  `getComputedStyle` rather than a raw token string. */
function resolvedFontSize(cssValue: string): string {
    const probe = document.createElement('div')
    probe.style.fontSize = cssValue
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).fontSize
    probe.remove()
    return resolved
}

export const Default: Story = {
    render: () => <FoldedFence />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvasElement.textContent).toBe('---…---')
        const text = canvas.getByTestId('folded-summary')

        // The fence text renders at the note editor's own fence-row font-size (--code-font-size),
        // resolved on :root the same way the component's own module CSS resolves it.
        const expectedPx = resolvedFontSize('var(--code-font-size)')
        await expect(getComputedStyle(text).fontSize).toBe(expectedPx)
    },
}

/** A tagged image: the folded row previews its properties between the fences. */
export const WithSummary: Story = {
    render: () => <FoldedFence summary="tags: trip, 2026 // source: phone" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByTestId('folded-summary').textContent).toBe(
            'tags: trip, 2026 // source: phone',
        )
    },
}

/** A long preview is cut with an ellipsis on one row, and the closing fence still shows. */
export const LongSummary: Story = {
    render: () => (
        <div style={{ width: '320px' }}>
            <FoldedFence summary="tags: paper, machine-learning, transformers, attention // author: Ada Lovelace // year: 2024 // venue: somewhere far too long to fit" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const summary = canvas.getByTestId('folded-summary')
        const row = summary.parentElement as HTMLElement
        const fences = row.querySelectorAll('span')
        const closing = fences[fences.length - 1] as HTMLElement
        // one row tall, the preview overflows its box (so the ellipsis shows), and the closing
        // fence sits inside the row's right edge
        await expect(summary.scrollWidth).toBeGreaterThan(summary.clientWidth)
        await expect(getComputedStyle(summary).textOverflow).toBe('ellipsis')
        await expect(closing.getBoundingClientRect().right).toBeLessThanOrEqual(
            row.getBoundingClientRect().right + 1,
        )
        await expect(row.getBoundingClientRect().height).toBeLessThan(
            2 * parseFloat(getComputedStyle(row).lineHeight),
        )
    },
}
