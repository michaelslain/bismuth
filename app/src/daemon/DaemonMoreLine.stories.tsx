// app/src/daemon/DaemonMoreLine.stories.tsx
// Visual spec for <DaemonMoreLine> — the `label // show|hide` toggle under a row-limited daemon
// section.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import DaemonMoreLine from './DaemonMoreLine'

const meta = {
    title: 'Daemon/DaemonMoreLine',
    component: DaemonMoreLine,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonMoreLine>

export default meta
type Story = StoryObj<typeof meta>

/** Collapsed: `+7 more // show`. */
export const Collapsed: Story = {
    args: { label: '+7 more', open: false, onToggle: () => {} },
    play: async ({ canvasElement }) => {
        const line = within(canvasElement).getByTestId('daemon-more-line')
        await expect(line.textContent).toBe('+7 more // show')
        await expect(line.getAttribute('aria-expanded')).toBe('false')
    },
}

/** Open: the caller swaps its label, the toggle reads `hide`. */
export const Open: Story = {
    args: { label: 'all 12', open: true, onToggle: () => {} },
    play: async ({ canvasElement }) => {
        const line = within(canvasElement).getByTestId('daemon-more-line')
        await expect(line.textContent).toBe('all 12 // hide')
        await expect(line.getAttribute('aria-expanded')).toBe('true')
    },
}

/** Clicking flips it — the caller owns the state. */
export const Toggles: Story = {
    args: { label: '+7 more', open: false, onToggle: () => {} },
    render: () => {
        const [open, setOpen] = createSignal(false)
        return (
            <DaemonMoreLine
                label={open() ? 'all 12' : '+7 more'}
                open={open()}
                onToggle={() => setOpen(v => !v)}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const line = within(canvasElement).getByTestId('daemon-more-line')
        await userEvent.click(line)
        await expect(line.textContent).toBe('all 12 // hide')
        await userEvent.click(line)
        await expect(line.textContent).toBe('+7 more // show')
    },
}
