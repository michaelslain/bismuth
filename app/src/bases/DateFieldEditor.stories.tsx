// Visual spec for <DateFieldEditor> — a date property as one input-height trigger that opens
// the app's DatePicker. The play() proves the round trip: open, pick a preset, value updates,
// popover closes.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import DateFieldEditor from './DateFieldEditor'
import { dateFieldPresets } from './dateFieldPresets'

const meta = {
    title: 'Bases/DateFieldEditor',
    component: DateFieldEditor,
} satisfies Meta<typeof DateFieldEditor>

export default meta
type Story = StoryObj<typeof meta>

const Harness = (p: { initial: string; time?: boolean }) => {
    const [value, setValue] = createSignal<unknown>(p.initial)
    return (
        <div style={{ width: '360px' }}>
            <DateFieldEditor time={p.time} value={value()} onCommit={setValue} />
        </div>
    )
}

export const Empty: Story = {
    args: { value: '', onCommit: () => {} },
    render: () => <Harness initial="" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const trigger = canvas.getByTestId('date-field-trigger')
        await expect(trigger).toHaveTextContent('Set date…')
        await userEvent.click(trigger)
        const popover = await waitFor(() => body.getByTestId('date-field-popover'))
        const row = within(popover).getByText('Tomorrow')
        await userEvent.pointer({ keys: '[MouseLeft>]', target: row })
        const tomorrow = dateFieldPresets()[1].date
        await waitFor(() => expect(trigger).toHaveTextContent(tomorrow))
        await waitFor(() => expect(body.queryByTestId('date-field-popover')).toBeNull())
    },
}

export const WithValue: Story = {
    args: { value: '2026-09-14', onCommit: () => {} },
    render: () => <Harness initial="2026-09-14" />,
}

export const DateTime: Story = {
    args: { value: '2026-09-14T09:30', time: true, onCommit: () => {} },
    render: () => <Harness initial="2026-09-14T09:30" time />,
}
