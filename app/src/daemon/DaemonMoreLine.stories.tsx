// app/src/daemon/DaemonMoreLine.stories.tsx
// Visual spec for <DaemonMoreLine> — the faint `+9 more` / `2 resolved` line that ends a box
// holding rows back; clicking it opens the section.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import DaemonMoreLine from './DaemonMoreLine'

const meta = {
    title: 'Daemon/DaemonMoreLine',
    component: DaemonMoreLine,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonMoreLine>

export default meta
type Story = StoryObj<typeof meta>

export const More: Story = {
    args: { label: '+9 more', onOpen: fn() },
    play: async ({ canvasElement, args }) => {
        const line = within(canvasElement).getByTestId('daemon-more-line')
        await expect(line.textContent).toBe('+9 more')
        await expect(line.getAttribute('aria-expanded')).toBeNull()
        await userEvent.click(line)
        await expect(args.onOpen).toHaveBeenCalledTimes(1)
    },
}

export const Resolved: Story = {
    args: { label: '2 resolved', onOpen: fn() },
    play: async ({ canvasElement, args }) => {
        const line = within(canvasElement).getByTestId('daemon-more-line')
        await expect(line.textContent).toBe('2 resolved')
        await userEvent.click(line)
        await expect(args.onOpen).toHaveBeenCalledTimes(1)
    },
}
