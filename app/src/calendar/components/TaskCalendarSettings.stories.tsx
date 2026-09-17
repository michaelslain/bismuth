// Visual spec for <TaskCalendarSettings> — the settings modal a `mode: tasks` calendar's gear
// should have opened (see the component's own header comment for why it didn't). Presentational
// and stateless about persistence: every prop is a plain value or callback, so every state below
// is just an `args` object — no fakeTransport wrapping needed, unlike CalendarSettings.
//
// The Categories list's swatches are INTERACTIVE — each one is a live `ColorChip`, and clicking
// it is how a person sets that category's colour (see `Interactive` below). The names beside them
// are derived from the data itself and cannot be added, renamed or deleted here.
//
// Every `colors` map below is built by calling `taskCategoryColors` — the same function
// `TasksCalendar` calls for real — rather than hand-written, so a name with no declared colour
// shows its real auto-assigned swatch instead of a fabricated stand-in.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, Show } from 'solid-js'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import TaskCalendarSettings from './TaskCalendarSettings'
import { taskCategoryColors, type TaskCategory } from '../taskCategory'

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

/** Three of the six names have a declared colour; the other three fall back to
 *  `autoCategoryColor` — matching what `taskCategoryColors` actually does for a set that is
 *  only partly configured. */
const THREE_DECLARED: TaskCategory[] = [
    { name: 'Work', color: 'blue' },
    { name: 'Personal', color: 'rose' },
    { name: 'Health', color: 'green' },
]

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
            colors={taskCategoryColors(SIX_NAMES, THREE_DECLARED)}
            onPickColor={() => {}}
            onSetField={() => {}}
            onClose={() => {}}
        />
    ),
}

/** Same as `Sourced`, but `taskFile` is unset — the destination field reads "Not set" and
 *  carries a hint that new tasks have nowhere to go until it is. No name here has a declared
 *  colour, so every swatch is auto-assigned — and, per `taskCategoryColors`, distinct. */
export const SourcedUnconfigured: Story = {
    render: () => (
        <TaskCalendarSettings
            ownsRows={false}
            columns={COLUMNS}
            notes={NOTES}
            names={SIX_NAMES}
            colors={taskCategoryColors(SIX_NAMES, undefined)}
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
 *  Categories section gains a Category-column mapping select above the colour list.
 *
 *  `Default category` is a free-text field (`ui/TextInput`) seeded with a `<datalist>` of
 *  `names`, not a closed `Select` — a fresh own-rows base has no rows yet, so a select built
 *  from `names` could never offer the very default the user needs to set. The play() below
 *  types a name that is NOT in `SIX_NAMES`, the case the old closed select made impossible. */
export const OwnRows: Story = {
    render: args => (
        <TaskCalendarSettings
            ownsRows
            columns={COLUMNS}
            notes={NOTES}
            dateField="due"
            categoryField="category"
            defaultCategory="Work"
            names={SIX_NAMES}
            colors={taskCategoryColors(SIX_NAMES, THREE_DECLARED)}
            onPickColor={() => {}}
            onSetField={args.onSetField}
            onClose={() => {}}
        />
    ),
    args: { onSetField: fn() },
    play: async ({ args }) => {
        const canvas = within(document.body)
        expect(canvas.getByText('Default category')).toBeInTheDocument()
        expect(canvas.getByText('Category column')).toBeInTheDocument()
        expect(
            canvas.queryByText('Destination note'),
        ).not.toBeInTheDocument()

        const input = canvas.getByDisplayValue('Work') as HTMLInputElement
        await userEvent.clear(input)
        await userEvent.type(input, 'Side projects')
        await expect(args.onSetField).toHaveBeenCalledWith(
            'defaultCategory',
            'Side projects',
        )
    },
}

/** A sourced base (`ownsRows: false`) with no categories yet — both the Category-column field
 *  (own-rows only) and the colour list (gated on `names.length`) are hidden, so without the
 *  hint this covers, the "Categories" heading would sit over empty space. */
export const CategoriesEmpty: Story = {
    render: () => (
        <TaskCalendarSettings
            ownsRows={false}
            columns={COLUMNS}
            notes={NOTES}
            dateField="scheduled"
            taskFile="[[Website Relaunch]]"
            names={[]}
            colors={new Map()}
            onPickColor={() => {}}
            onSetField={() => {}}
            onClose={() => {}}
        />
    ),
    play: async () => {
        const canvas = within(document.body)
        expect(canvas.getByText('Categories')).toBeInTheDocument()
        expect(
            canvas.getByText(
                'Categories appear here once tasks have a source note or a category value.',
            ),
        ).toBeInTheDocument()
    },
}

/** Open/close round-trips (trigger button, like CalendarSettings' own Interactive story), plus
 *  picking a category's colour: opens that name's popover, picking a swatch reports it through
 *  `onPickColor` and closes the popover. */
export const Interactive: Story = {
    render: () => {
        const [open, setOpen] = createSignal(false)
        const [colors, setColors] = createSignal(
            taskCategoryColors(['Work', 'Personal'], [
                { name: 'Work', color: 'blue' },
            ]),
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
