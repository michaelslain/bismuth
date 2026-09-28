// Visual spec for <RecurrenceField> — the repeat picker. Holds real state: choosing weekly shows
// the weekday chips, monthly hides them, and `ends` shows only while a repeat is set.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import RecurrenceField from './RecurrenceField'
import SettingsGrid from '../../ui/SettingsGrid'
import type { RecurrenceType } from '../types'

const meta = {
    title: 'Calendar/RecurrenceField',
    component: RecurrenceField,
} satisfies Meta<typeof RecurrenceField>

export default meta
type Story = StoryObj<typeof meta>

function Host(props: { type: RecurrenceType | ''; days?: number[]; end?: string }) {
    const [type, setType] = createSignal(props.type)
    const [days, setDays] = createSignal(props.days ?? [1])
    const [end, setEnd] = createSignal(props.end ?? '')
    return (
        <SettingsGrid>
            <RecurrenceField
                type={type()}
                days={days()}
                end={end()}
                onType={setType}
                onDays={setDays}
                onEnd={setEnd}
            />
        </SettingsGrid>
    )
}

export const NoRepeat: Story = { render: () => <Host type="" /> }
export const Weekly: Story = {
    render: () => <Host type="weekly" days={[1, 3, 5]} end="2026-09-30" />,
}
export const Biweekly: Story = {
    render: () => <Host type="biweekly" days={[2, 4]} />,
}
export const Monthly: Story = { render: () => <Host type="monthly" end="2026-12-31" /> }

export const Interactive: Story = {
    render: () => <Host type="" />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        expect(c.queryByText('ends')).toBeNull()
        await userEvent.click(c.getByRole('button', { name: 'weekly' }))
        expect(c.getByTestId('recurrence-days')).toBeTruthy()
        expect(c.getByText('ends')).toBeTruthy()
        await userEvent.click(c.getByRole('button', { name: 'monthly' }))
        expect(c.queryByTestId('recurrence-days')).toBeNull()
        expect(c.getByText('ends')).toBeTruthy()
        await userEvent.click(c.getByRole('button', { name: 'none' }))
        expect(c.queryByText('ends')).toBeNull()
    },
}
