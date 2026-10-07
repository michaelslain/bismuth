// Visual spec for <QuickActionRail> — the icon strip that hangs off a context menu's left edge.
// Rendered alone here at fixed coordinates; ContextMenu.stories.tsx shows it beside a real menu.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import QuickActionRail from './QuickActionRail'

const noop = () => {}

const meta = {
    title: 'UI/Popover/QuickActionRail',
    component: QuickActionRail,
    parameters: { layout: 'fullscreen' },
    args: {
        x: 240,
        y: 40,
        menuWidth: 180,
        onPick: noop,
        actions: [
            { icon: 'Smile', label: 'emoji library', onSelect: noop },
        ],
    },
} satisfies Meta<typeof QuickActionRail>

export default meta
type Story = StoryObj<typeof meta>

/** One action — the emoji library, the only caller today. Its right edge sits `x` minus a gap. */
export const SingleAction: Story = {
    play: async ({ canvasElement }) => {
        const rail = canvasElement.querySelector('[data-popover]') as HTMLElement
        const r = rail.getBoundingClientRect()
        // Hung off the LEFT of x=240, with a gap, not overlapping the menu's left edge.
        await expect(r.right).toBeLessThan(240)
        await expect(r.width).toBeGreaterThan(0)
    },
}

/** Several actions stack in one column. */
export const SeveralActions: Story = {
    args: {
        actions: [
            { icon: 'Smile', label: 'emoji library', onSelect: noop },
            { icon: 'Image', label: 'images', onSelect: noop },
            { icon: 'Link', label: 'link', onSelect: noop },
        ],
    },
}

/** No room on the left (x near the viewport edge): the rail flips to the menu's RIGHT edge. */
export const FlipsRightNearTheLeftEdge: Story = {
    args: { x: 20 },
    play: async ({ canvasElement }) => {
        const rail = canvasElement.querySelector('[data-popover]') as HTMLElement
        await expect(rail.getBoundingClientRect().left).toBeGreaterThanOrEqual(20)
    },
}
