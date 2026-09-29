// Visual spec for <GcalConnectPrompt> — the disconnected fallback of the Google Calendar sync
// section: the explanatory hint and the connect button.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import GcalConnectPrompt from './GcalConnectPrompt'

const meta = {
    title: 'Calendar/GcalConnectPrompt',
    component: GcalConnectPrompt,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof GcalConnectPrompt>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    args: { onConnect: () => {} },
}

/** Clicking the button calls onConnect once (shown by the counter below). */
export const Interactive: Story = {
    args: Default.args,
    render: () => {
        const [n, setN] = createSignal(0)
        return (
            <>
                <GcalConnectPrompt onConnect={() => setN(v => v + 1)} />
                <output data-connect-count>{n()}</output>
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(
            c.getByRole('button', { name: /connect google calendar/i }),
        )
        await expect(
            canvasElement.querySelector('[data-connect-count]')?.textContent,
        ).toBe('1')
    },
}
