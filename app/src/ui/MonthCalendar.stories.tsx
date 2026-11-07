// Visual spec for <MonthCalendar> — the app's own month grid, used by DatePicker in place of the
// engine's date overlay. `today` is pinned so every frame is reproducible.
// Plays prove the picks: a press on a day, the arrows + confirm key, and the month steppers.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import MonthCalendar from './MonthCalendar'
import Text from './Text'

const TODAY = '2026-08-17'

const meta = {
    title: 'UI/MonthCalendar',
    component: MonthCalendar,
    parameters: { layout: 'centered' },
    args: { value: '', onPick: () => {} },
} satisfies Meta<typeof MonthCalendar>

export default meta
type Story = StoryObj<typeof meta>

function Host(props: { initial: string; mondayFirst?: boolean }) {
    const [value, setValue] = createSignal(props.initial)
    return (
        <div
            class="bismuth-popover"
            style={{ width: '230px', padding: 'var(--sp-3)', display: 'flex', 'flex-direction': 'column', gap: 'var(--sp-3)' }}
        >
            <MonthCalendar
                value={value()}
                today={TODAY}
                mondayFirst={props.mondayFirst}
                onPick={setValue}
            />
            <Text as="span" size="micro" tone="muted" data-testid="picked">
                {value() || 'none'}
            </Text>
        </div>
    )
}

/** A picked day `[20]` beside today (17, accent, no brackets), August 2026, Sunday first. */
export const Picked: Story = {
    render: () => <Host initial="2026-08-20" />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('august 2026')).toBeTruthy()
        const picked = canvasElement.querySelector('[aria-selected="true"]')!
        await expect(picked.getAttribute('data-iso')).toBe('2026-08-20')
        const today = canvasElement.querySelector('[aria-current="date"]')!
        await expect(today.getAttribute('data-iso')).toBe(TODAY)
        // Sunday first: Aug 2026 starts on a Saturday, so the grid opens on Jul 26.
        const first = canvasElement.querySelector('[role="gridcell"]')!
        await expect(first.getAttribute('data-iso')).toBe('2026-07-26')
        // A press picks.
        const day = canvasElement.querySelector<HTMLElement>('[data-iso="2026-08-05"]')!
        await userEvent.pointer({ keys: '[MouseLeft>]', target: day })
        await waitFor(() => expect(c.getByTestId('picked')).toHaveTextContent('2026-08-05'))
    },
}

/** Nothing picked: the grid opens on today's month with no brackets anywhere. */
export const Empty: Story = {
    render: () => <Host initial="" />,
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('august 2026')).toBeTruthy()
        await expect(canvasElement.querySelector('[aria-selected="true"]')).toBeNull()
    },
}

/** The `weekStartsOnMonday` setting: weeks open on mo. */
export const MondayFirst: Story = {
    render: () => <Host initial="2026-08-20" mondayFirst />,
    play: async ({ canvasElement }) => {
        const first = canvasElement.querySelector('[role="gridcell"]')!
        await expect(first.getAttribute('data-iso')).toBe('2026-07-27')
    },
}

/** Keyboard: the arrows move the roving focus (across a month edge, which turns the page), and
 *  the confirm key picks the focused day. */
export const Keyboard: Story = {
    render: () => <Host initial="2026-08-31" />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const start = canvasElement.querySelector<HTMLElement>('[data-iso="2026-08-31"]')!
        start.focus()
        await userEvent.keyboard('{ArrowRight}')
        await waitFor(() => expect(c.getByText('september 2026')).toBeTruthy())
        await waitFor(() =>
            expect(document.activeElement?.getAttribute('data-iso')).toBe('2026-09-01'),
        )
        await userEvent.keyboard('{ArrowDown}{Enter}')
        await waitFor(() => expect(c.getByTestId('picked')).toHaveTextContent('2026-09-08'))
    },
}

/** The steppers turn the page without picking; December → January carries the year. */
export const Steppers: Story = {
    render: () => <Host initial="2026-12-03" />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByLabelText('next month'))
        await waitFor(() => expect(c.getByText('january 2027')).toBeTruthy())
        await userEvent.click(c.getByLabelText('previous month'))
        await userEvent.click(c.getByLabelText('previous month'))
        await waitFor(() => expect(c.getByText('november 2026')).toBeTruthy())
        await expect(c.getByTestId('picked')).toHaveTextContent('2026-12-03')
    },
}
