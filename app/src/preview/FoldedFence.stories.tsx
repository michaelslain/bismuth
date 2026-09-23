// Visual spec for <FoldedFence> — the one-row `--- … ---` shown in place of a folded
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
        const text = canvas.getByText('--- … ---')
        await expect(text).toBeInTheDocument()

        // The fence text renders at the note editor's own frontmatter font-size (--editor-font-size),
        // resolved on :root the same way the component's own module CSS resolves it.
        const expectedPx = resolvedFontSize('var(--editor-font-size)')
        await expect(getComputedStyle(text).fontSize).toBe(expectedPx)
    },
}
