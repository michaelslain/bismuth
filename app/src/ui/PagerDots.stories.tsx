// Visual spec for <PagerDots> — the round page-dot strip (8px circles, accent-filled current dot
// carrying aria-current="step"). Extracted from VaultIntro's .vi-dot so the intro pager and any
// future paged surface share one component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import PagerDots from './PagerDots'

const meta = {
    title: 'UI/PagerDots',
    component: PagerDots,
    parameters: { layout: 'centered' },
    args: { count: 7, index: 0, onSelect: () => {} },
} satisfies Meta<typeof PagerDots>

export default meta
type Story = StoryObj<typeof meta>

const current = (root: HTMLElement) =>
    root.querySelectorAll('[aria-current="step"]')

export const Default: Story = {
    play: async ({ canvasElement }) => {
        const dots = within(canvasElement).getAllByRole('button')
        await expect(dots.length).toBe(7)
        await expect(current(canvasElement).length).toBe(1)
        await expect(dots[0].getAttribute('aria-current')).toBe('step')
    },
}

export const Middle: Story = {
    args: { index: 3 },
    play: async ({ canvasElement }) => {
        const dots = within(canvasElement).getAllByRole('button')
        await expect(dots[3].getAttribute('aria-current')).toBe('step')
    },
}

export const Last: Story = {
    args: { index: 6 },
    play: async ({ canvasElement }) => {
        const dots = within(canvasElement).getAllByRole('button')
        await expect(dots[6].getAttribute('aria-current')).toBe('step')
    },
}

/** Local signal, so clicking a dot moves the current mark. */
export const Interactive: Story = {
    render: args => {
        const [i, setI] = createSignal(0)
        return (
            <PagerDots
                count={args.count}
                index={i()}
                onSelect={setI}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByLabelText('Go to slide 5'))
        await expect(
            canvas.getByLabelText('Go to slide 5').getAttribute('aria-current'),
        ).toBe('step')
        await expect(current(canvasElement).length).toBe(1)
    },
}
