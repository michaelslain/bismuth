// Visual spec for <CalendarColumnMapping> — the column-mapping section of the calendar settings
// modal, rendered on its own with local state so a change round-trips through the Select.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import CalendarColumnMapping from './CalendarColumnMapping'
import { defaultColumnMap, STD_COLS } from '../calendarColumnMap'

const meta = {
    title: 'Calendar/CalendarColumnMapping',
    component: CalendarColumnMapping,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CalendarColumnMapping>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    args: {
        values: defaultColumnMap(),
        columns: [...STD_COLS],
        onChange: () => {},
    },
}

export const CustomColumns: Story = {
    args: {
        values: { ...defaultColumnMap(), dateField: 'whenDue' },
        columns: [...STD_COLS, 'whenDue', 'owner'],
        onChange: () => {},
    },
}

/** Live state: picking a column in the first Select updates the value it shows. */
export const Interactive: Story = {
    args: Default.args,
    render: args => {
        const [values, setValues] = createSignal<Record<string, string>>(args.values)
        return (
            <CalendarColumnMapping
                values={values()}
                columns={[...args.columns, 'whenDue']}
                onChange={(k, c) => setValues(v => ({ ...v, [k]: c }))}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const first = canvasElement.querySelector<HTMLElement>(
            '[data-select-trigger]',
        )
        await expect(first?.textContent).toContain('date')
        await userEvent.click(first!)
        const option = await within(document.body).findByText('whenDue')
        await userEvent.click(option)
        await expect(first?.textContent).toContain('whenDue')
    },
}
