// Visual spec for <FlowToggle>: the display panel's `move by` row, scroll or flip.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import FlowToggle from './FlowToggle'
import type { ReadFlow } from './ReadModeSwitch'

const meta = {
    title: 'Bases/FlowToggle',
    component: FlowToggle,
} satisfies Meta<typeof FlowToggle>

export default meta
type Story = StoryObj<typeof meta>

/** Scroll or flip; a click picks one. */
export const Default: Story = {
    render: () => {
        const [flow, setFlow] = createSignal<ReadFlow>('scroll')
        return <FlowToggle flow={flow()} onFlow={setFlow} />
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByRole('button', { name: 'scroll' })).toHaveAttribute('aria-pressed', 'true')
        await userEvent.click(c.getByRole('button', { name: 'flip' }))
        await expect(c.getByRole('button', { name: 'flip' })).toHaveAttribute('aria-pressed', 'true')
    },
}
