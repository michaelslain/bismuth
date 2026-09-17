// Visual spec for <TaskCalendarSettings> — the settings modal a `mode: tasks` calendar's gear
// should have opened (see the component's own header comment for why it didn't). Presentational
// and stateless about persistence: every prop is a plain value or callback, so every state below
// is just an `args` object — no fakeTransport wrapping needed, unlike CalendarSettings.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, Show } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import TaskCalendarSettings from './TaskCalendarSettings'

const meta = {
    title: 'Calendar/TaskCalendarSettings',
    component: TaskCalendarSettings,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TaskCalendarSettings>

export default meta
type Story = StoryObj<typeof meta>

const COLUMNS = ['date', 'scheduled', 'due', 'title', 'notes']
const NOTES = [
    'Projects/Website Relaunch.md',
    'Areas/Health.md',
    'reading/quotes/Gamma.md',
    'archive/Gamma.md',
]
const SIX_NAMES = ['Work', 'Personal', 'Health', 'Errands', 'Reading', 'Ideas']

/** A base with `source:` set (`ownsRows: false`) — new tasks need a destination note, so the
 *  "New tasks" section shows the Destination-note picker rather than a default category. Six
 *  category names, three carrying a declared colour and three falling back to the default
 *  swatch. */
export const Sourced: Story = {
    render: () => (
        <TaskCalendarSettings
            ownsRows={false}
            columns={COLUMNS}
            notes={NOTES}
            dateField="scheduled"
            taskFile="[[Website Relaunch]]"
            names={SIX_NAMES}
            colors={
                new Map([
                    ['Work', 'var(--blue)'],
                    ['Personal', 'var(--rose)'],
                    ['Health', 'var(--green)'],
                ])
            }
            onPickColor={() => {}}
            onSetField={() => {}}
            onClose={() => {}}
        />
    ),
}

/** Same as `Sourced`, but `taskFile` is unset — the destination field reads "Not set" and
 *  carries a hint that new tasks have nowhere to go until it is. */
export const SourcedUnconfigured: Story = {
    render: () => (
        <TaskCalendarSettings
            ownsRows={false}
            columns={COLUMNS}
            notes={NOTES}
            names={SIX_NAMES}
            colors={new Map()}
            onPickColor={() => {}}
            onSetField={() => {}}
            onClose={() => {}}
        />
    ),
    play: async () => {
        const canvas = within(document.body)
        expect(canvas.getAllByText('Not set').length).toBeGreaterThan(0)
        expect(
            canvas.getByText(
                'New tasks have nowhere to go until this is set.',
            ),
        ).toBeInTheDocument()
    },
}

/** A base that owns its rows (no `source:`) — new tasks are written straight into the base's
 *  own notes, so "New tasks" offers a Default category instead of a destination, and the
 *  Categories section gains a Category-column mapping select above the colour list. */
export const OwnRows: Story = {
    render: () => (
        <TaskCalendarSettings
            ownsRows
            columns={COLUMNS}
            notes={NOTES}
            dateField="due"
            categoryField="category"
            defaultCategory="Work"
            names={SIX_NAMES}
            colors={
                new Map([
                    ['Work', 'var(--blue)'],
                    ['Personal', 'var(--rose)'],
                    ['Health', 'var(--green)'],
                ])
            }
            onPickColor={() => {}}
            onSetField={() => {}}
            onClose={() => {}}
        />
    ),
    play: async () => {
        const canvas = within(document.body)
        expect(canvas.getByText('Default category')).toBeInTheDocument()
        expect(canvas.getByText('Category column')).toBeInTheDocument()
        expect(
            canvas.queryByText('Destination note'),
        ).not.toBeInTheDocument()
    },
}

/** Open/close round-trips (trigger button, like CalendarSettings' own Interactive story), plus
 *  picking a category's colour: opens that name's popover, picking a swatch reports it through
 *  `onPickColor` and closes the popover. */
export const Interactive: Story = {
    render: () => {
        const [open, setOpen] = createSignal(false)
        const [colors, setColors] = createSignal(
            new Map([['Work', 'var(--blue)']]),
        )
        return (
            <Show
                when={open()}
                fallback={
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                    >
                        Open task calendar settings
                    </button>
                }
            >
                <TaskCalendarSettings
                    ownsRows
                    columns={COLUMNS}
                    notes={NOTES}
                    categoryField="category"
                    names={['Work', 'Personal']}
                    colors={colors()}
                    onPickColor={(name, token) =>
                        setColors(m =>
                            new Map(m).set(name, `var(--${token})`),
                        )
                    }
                    onSetField={() => {}}
                    onClose={() => setOpen(false)}
                />
            </Show>
        )
    },
    play: async () => {
        const canvas = within(document.body)
        const trigger = canvas.getByText('Open task calendar settings')
        await userEvent.click(trigger)
        await waitFor(() =>
            expect(
                document.querySelector(
                    '[role="dialog"][aria-label="Task calendar settings"]',
                ),
            ).not.toBeNull(),
        )

        // Pick a new colour for "Personal" via its chip's popover.
        const chips = document.querySelectorAll(
            '[data-testid="category-chip"]',
        )
        const personalChip = chips[1] as HTMLElement
        const swatch = personalChip.querySelector(
            'button[aria-label="Choose colour"]',
        ) as HTMLElement
        await userEvent.click(swatch)
        const violet = document.querySelector(
            'button[aria-label="violet"]',
        ) as HTMLElement
        await userEvent.click(violet)
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).toBeNull(),
        )

        const closeBtn = canvas.getByLabelText('Close')
        await userEvent.click(closeBtn)
        await waitFor(() =>
            expect(
                document.querySelector(
                    '[role="dialog"][aria-label="Task calendar settings"]',
                ),
            ).toBeNull(),
        )
    },
}
