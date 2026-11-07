// Visual spec for <TimeField> — a typed time of day with half-hour slots suggested, in place of
// the engine's clock control. Stores `HH:MM`; shows "2:30 pm", or "14:30" under the 24-hour
// setting. Plays prove a typed time commits only when finished, and a slot pick commits.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import TimeField from './TimeField'
import Text from './Text'

const meta = {
    title: 'UI/TimeField',
    component: TimeField,
    parameters: { layout: 'centered' },
    args: { value: '', onChange: () => {} },
} satisfies Meta<typeof TimeField>

export default meta
type Story = StoryObj<typeof meta>

function Host(props: { initial: string; military?: boolean; suggest?: boolean }) {
    const [value, setValue] = createSignal(props.initial)
    const [commits, setCommits] = createSignal(0)
    return (
        <div style={{ width: '200px', display: 'flex', 'flex-direction': 'column', gap: 'var(--sp-4)' }}>
            <TimeField
                value={value()}
                military={props.military}
                suggest={props.suggest}
                onChange={v => {
                    setValue(v)
                    setCommits(n => n + 1)
                }}
            />
            <Text as="span" size="micro" tone="muted" data-testid="stored">
                {value() || 'none'} // {commits()}
            </Text>
        </div>
    )
}

/** 12-hour labels: "2:30 pm". Typing commits nothing until focus leaves, then "4p" is 16:00. */
export const TwelveHour: Story = {
    render: () => <Host initial="14:30" />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const input = canvasElement.querySelector('input')!
        await expect(input.value).toBe('2:30 pm')
        await userEvent.clear(input)
        await userEvent.type(input, '4p')
        await expect(c.getByTestId('stored')).toHaveTextContent('14:30 // 0')
        input.blur()
        await waitFor(() => expect(c.getByTestId('stored')).toHaveTextContent('16:00 // 1'))
        await waitFor(() => expect(input.value).toBe('4:00 pm'))
    },
}

/** The 24-hour setting: "14:30", and typed "915" reads as 09:15 on the confirm key. */
export const Military: Story = {
    render: () => <Host initial="14:30" military />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const input = canvasElement.querySelector('input')!
        await expect(input.value).toBe('14:30')
        await userEvent.clear(input)
        await userEvent.type(input, '915{Enter}')
        await waitFor(() => expect(c.getByTestId('stored')).toHaveTextContent('09:15 // 1'))
    },
}

/** Focus opens the slot list on the time already set; a picked slot commits. */
export const PickSlot: Story = {
    render: () => <Host initial="14:30" />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(canvasElement.querySelector('input')!)
        const slot = await waitFor(() => body.getByText('3:00 pm'))
        await userEvent.click(slot)
        await waitFor(() => expect(c.getByTestId('stored')).toHaveTextContent('15:00 // 1'))
    },
}

/** Text that is not a time snaps back to the stored value when focus leaves. */
export const InvalidSnapsBack: Story = {
    render: () => <Host initial="09:00" suggest={false} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const input = canvasElement.querySelector('input')!
        await userEvent.clear(input)
        await userEvent.type(input, 'lunch')
        input.blur()
        await waitFor(() => expect(input.value).toBe('9:00 am'))
        await expect(c.getByTestId('stored')).toHaveTextContent('09:00 // 0')
    },
}

/** Empty: the placeholder shows a time in the field's own format. */
export const Empty: Story = {
    render: () => <Host initial="" />,
}
