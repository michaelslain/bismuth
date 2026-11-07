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

const Harness = (p: {
    initial: string
    time?: boolean
    placeholder?: string
    className?: string
    onDismiss?: () => void
}) => {
    const [value, setValue] = createSignal<unknown>(p.initial)
    return (
        <div style={{ width: '360px' }}>
            <DateFieldEditor
                time={p.time}
                placeholder={p.placeholder}
                className={p.className}
                value={value()}
                onCommit={setValue}
                onDismiss={p.onDismiss}
            />
            {/* Read by the plays only: the raw committed value, `null` once cleared. */}
            <span hidden data-testid="raw">
                {JSON.stringify(value())}
            </span>
        </div>
    )
}

export const Empty: Story = {
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

/** Escape dismisses the open popover, via AnchoredPopover's `isDismissKey` handling — the
 *  round trip is: open, press Escape, wait for the popover to actually unmount. */
export const DismissesOnEscape: Story = {
    render: () => <Harness initial="" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const trigger = canvas.getByTestId('date-field-trigger')
        await userEvent.click(trigger)
        await waitFor(() => body.getByTestId('date-field-popover'))
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(body.queryByTestId('date-field-popover')).toBeNull())
    },
}

/** `onDismiss` fires on Escape (no pick) — held in real state, not a noop. */
export const OnDismissFires: Story = {
    render: () => {
        const [dismissed, setDismissed] = createSignal(false)
        return (
            <>
                <Harness initial="" onDismiss={() => setDismissed(true)} />
                <span hidden data-testid="dismissed">
                    {String(dismissed())}
                </span>
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(canvas.getByTestId('date-field-trigger'))
        await waitFor(() => body.getByTestId('date-field-popover'))
        await expect(canvas.getByTestId('dismissed')).toHaveTextContent('false')
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(canvas.getByTestId('dismissed')).toHaveTextContent('true'))
    },
}

/** Clicking the trigger while the popover is open closes it — and is NOT a dismiss. The host's
 *  `onDismiss` (which cancels the edit in a real host) must not fire, and the value survives. */
export const TriggerClickClosesWithoutCancelling: Story = {
    render: () => {
        const [dismissed, setDismissed] = createSignal(false)
        return (
            <>
                <Harness initial="2026-09-14" onDismiss={() => setDismissed(true)} />
                <span hidden data-testid="dismissed">
                    {String(dismissed())}
                </span>
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const trigger = canvas.getByTestId('date-field-trigger')
        await userEvent.click(trigger)
        await waitFor(() => body.getByTestId('date-field-popover'))
        // The backdrop covers the trigger, so a real press lands on IT, not the trigger: press
        // at whatever element is under the trigger's centre.
        const r = trigger.getBoundingClientRect()
        const under = canvasElement.ownerDocument.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
        ) as HTMLElement
        await expect(under).not.toBe(trigger)
        await userEvent.pointer({
            keys: '[MouseLeft]',
            target: under,
            coords: { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 },
        })
        await waitFor(() => expect(body.queryByTestId('date-field-popover')).toBeNull())
        await expect(canvas.getByTestId('dismissed')).toHaveTextContent('false')
        await expect(canvas.getByTestId('raw')).toHaveTextContent('"2026-09-14"')
        // The click that follows the press must not reopen it.
        await new Promise(r => setTimeout(r, 150))
        await expect(body.queryByTestId('date-field-popover')).toBeNull()
    },
}

export const WithValue: Story = {
    render: () => <Harness initial="2026-09-14" />,
}

export const DateTime: Story = {
    render: () => <Harness initial="2026-09-14T09:30" time />,
}

/** A caller's `placeholder` replaces the default empty label, and `className` reaches the trigger. */
export const PlaceholderAndClassName: Story = {
    render: () => <Harness initial="" placeholder="Pick a due date" className="caller-class" />,
    play: async ({ canvasElement }) => {
        const trigger = within(canvasElement).getByTestId('date-field-trigger')
        await expect(trigger).toHaveTextContent('Pick a due date')
        await expect(trigger.classList.contains('caller-class')).toBe(true)
    },
}

/** A `datetime` field with a date already set: changing only the time commits `date + new time`
 *  and closes the popover. */
export const TimeOnlyCommit: Story = {
    render: () => <Harness initial="2026-09-14T09:30" time />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(canvas.getByTestId('date-field-trigger'))
        const popover = await waitFor(() => body.getByTestId('date-field-popover'))
        const time = popover.querySelector<HTMLInputElement>('[data-time-field] input')!
        await waitFor(() => expect(time.value).toBe('9:30 am'))
        await userEvent.clear(time)
        await userEvent.type(time, '10:15{Enter}')
        await waitFor(() => expect(canvas.getByTestId('raw')).toHaveTextContent('"2026-09-14T10:15"'))
        await waitFor(() => expect(body.queryByTestId('date-field-popover')).toBeNull())
    },
}

/** `[clear]` under the grid clears the field: the value commits null and the placeholder returns. */
export const ClearCommitsNull: Story = {
    render: () => <Harness initial="2026-09-14" />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        const trigger = canvas.getByTestId('date-field-trigger')
        await userEvent.click(trigger)
        const popover = await waitFor(() => body.getByTestId('date-field-popover'))
        await waitFor(() =>
            expect(popover.querySelector('[aria-selected="true"]')?.getAttribute('data-iso')).toBe(
                '2026-09-14',
            ),
        )
        await userEvent.click(within(popover).getByText('clear'))
        await waitFor(() => expect(canvas.getByTestId('raw')).toHaveTextContent('null'))
        await expect(trigger).toHaveTextContent('Set date…')
    },
}

/** A picked day on the grid commits and closes; a required field (an event's day) offers no clear. */
export const GridPickRequired: Story = {
    render: () => {
        const [value, setValue] = createSignal<unknown>('2026-09-14')
        return (
            <div style={{ width: '360px' }}>
                <DateFieldEditor required value={value()} onCommit={setValue} />
                <span hidden data-testid="raw">
                    {JSON.stringify(value())}
                </span>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(canvas.getByTestId('date-field-trigger'))
        const popover = await waitFor(() => body.getByTestId('date-field-popover'))
        await expect(within(popover).queryByText('clear')).toBeNull()
        const day = popover.querySelector<HTMLElement>('[data-iso="2026-09-25"]')!
        await userEvent.pointer({ keys: '[MouseLeft>]', target: day })
        await waitFor(() => expect(canvas.getByTestId('raw')).toHaveTextContent('"2026-09-25"'))
        await waitFor(() => expect(body.queryByTestId('date-field-popover')).toBeNull())
    },
}
