// Visual spec for <CategoryPicker> — the event form's category chips. Holds real state so the
// play proves toggling adds and removes names, and `none` clears.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import CategoryPicker from './CategoryPicker'
import { seedCalendarState } from '../../ui/_calendarFixtures'

const meta = {
    title: 'Calendar/CategoryPicker',
    component: CategoryPicker,
} satisfies Meta<typeof CategoryPicker>

export default meta
type Story = StoryObj<typeof meta>

function Host(props: { initial: string[] }) {
    const [sel, setSel] = createSignal(props.initial)
    return (
        <>
            <CategoryPicker selected={sel()} onChange={setSel} />
            <output data-testid="picked">{sel().join(',')}</output>
        </>
    )
}

export const None: Story = {
    render: () => {
        seedCalendarState({ events: [] })
        return <Host initial={[]} />
    },
}

export const Interactive: Story = {
    render: () => {
        seedCalendarState({ events: [] })
        return <Host initial={[]} />
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const out = c.getByTestId('picked')
        await userEvent.click(c.getByRole('button', { name: /Work/ }))
        await userEvent.click(c.getByRole('button', { name: /Focus/ }))
        expect(out.textContent).toBe('Work,Focus')
        await userEvent.click(c.getByRole('button', { name: /Work/ }))
        expect(out.textContent).toBe('Focus')
        await userEvent.click(c.getByRole('button', { name: /none/ }))
        expect(out.textContent).toBe('')
    },
}
