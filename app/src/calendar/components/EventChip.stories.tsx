// Visual spec for <EventChip> — the single event pill rendered inside the day grid, month
// cell, and all-day row. Category colour(s) determine the fill: one category tints solid,
// two+ blend into a gradient, and no resolvable category renders an outline-only "ghost"
// chip (categoryColor.ts's categoryFill()).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { showEventModal, events } from '../state'
import { toasts } from '../../toastStore'
import { EventChip } from './EventChip'
import { EventStore, MemoryBackend } from '../EventStore'
import { createSignal, For, onMount, Show } from 'solid-js'
import type { CalendarEvent, Category } from '../types'
import { Row } from '../../ui/_storyKit'
import { seedCalendarState } from '../../ui/_calendarFixtures'
import CalendarFrame from './CalendarFrame'
import { DayView } from './views/DayView'
import { WeekView } from './views/WeekView'
import MonthCell from './views/MonthCell'
import DragGhost from './views/DragGhost'
import { ghostBox } from './views/timeGridLayout'
import { categoryFill, eventCategoryColors } from '../categoryColor'

const meta = {
    title: 'Calendar/EventChip',
    component: EventChip,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof EventChip>

export default meta
type Story = StoryObj<typeof meta>

const CATEGORIES: Category[] = [
    { name: 'Work', color: 'blue' },
    { name: 'Personal', color: 'rose' },
    { name: 'Focus', color: 'violet' },
]

const store = new EventStore(new MemoryBackend())

/** A single-category timed event — the solid-tint chip used everywhere by default. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '220px' }}>
            <EventChip
                event={{
                    id: '1',
                    title: 'Design review',
                    date: '2026-01-12',
                    startTime: '14:00',
                    endTime: '15:00',
                    category: 'Work',
                }}
                categories={CATEGORIES}
                store={store}
            />
        </div>
    ),
}

/** Three variants side by side: a multi-category gradient chip, an outline-only "ghost"
 *  chip (no resolvable category), and the compact layout TimeGrid uses for short
 *  (<= 30min) blocks. */
export const Variants: Story = {
    render: () => (
        <Row gap="10px" column>
            <div style={{ width: '220px' }}>
                <EventChip
                    event={{
                        id: '2',
                        title: 'Team offsite',
                        date: '2026-01-16',
                        category: 'Work',
                        categories: ['Work', 'Focus'],
                    }}
                    categories={CATEGORIES}
                    store={store}
                />
            </div>
            <div style={{ width: '220px' }}>
                <EventChip
                    event={{
                        id: '3',
                        title: 'Unfiled reminder',
                        date: '2026-01-12',
                    }}
                    categories={CATEGORIES}
                    store={store}
                />
            </div>
            {/* The compact-mode CSS is scoped to ".event-chip.in-grid.compact", so the chip
          needs the `inGrid` prop for it to apply; the plain sized box stands in for the
          time-grid slot TimeGrid itself renders. */}
            <div style={{ position: 'static', width: '220px', height: '34px' }}>
                <EventChip
                    event={{
                        id: '4',
                        title: 'Quick sync',
                        date: '2026-01-12',
                        startTime: '09:00',
                        endTime: '09:15',
                        category: 'Personal',
                    }}
                    categories={CATEGORIES}
                    compact
                    inGrid
                    store={store}
                />
            </div>
        </Row>
    ),
}

/** A wrapping location line. The chip's meta row renders `location` at --fs-micro (10.5px),
 *  and `.app-shell` sets an ABSOLUTE `line-height: var(--row-h)` (18px) that any descendant
 *  without its own line-height inherits — so before `.event-chip-location` set one explicitly,
 *  a two-line address sat far looser than the title and time stacked above it. Narrow enough
 *  to force the wrap, in a tall block so nothing clips. */
export const WrappingLocation: Story = {
    render: () => (
        <div style={{ position: 'static', width: '120px', height: '150px' }}>
            <EventChip
                event={{
                    id: '5',
                    title: 'Speak Out BBQ',
                    date: '2026-01-12',
                    startTime: '12:00',
                    endTime: '16:30',
                    category: 'Personal',
                    location: 'Marina Park, San Leandro',
                }}
                categories={CATEGORIES}
                inGrid
                store={store}
            />
        </div>
    ),
}

/** The in-grid variant TimeGrid renders into an absolutely-positioned time-slot: the chip fills
 *  its container (height:100%) instead of sizing to its content. Asserts the `inGrid` prop
 *  actually switches on `.in-grid` — if that class stopped applying, the chip would fall back
 *  to its free-flowing content-sized height (~33px) instead of filling the 44px box. */
export const InGrid: Story = {
    render: () => (
        <div style={{ position: 'relative', width: '180px', height: '44px' }}>
            <EventChip
                event={{
                    id: '6',
                    title: 'Standup',
                    date: '2026-01-12',
                    startTime: '09:00',
                    endTime: '09:30',
                    category: 'Work',
                }}
                inGrid
                categories={CATEGORIES}
                store={store}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const chip = canvasElement.querySelector<HTMLElement>('[data-testid="event-chip"]')!
        // in-grid fills its slot: height:100% of a 44px box. The free-flowing chip is content-sized (~33px).
        expect(Math.round(chip.getBoundingClientRect().height)).toBe(44)
    },
}


// ---- keyboard, link safety, delete + undo -------------------------------------------------

const modalId = () =>
    (showEventModal.value as { event?: { id: string } } | null)?.event?.id

const LINKED = (link: string) => ({
    id: 'l1',
    title: 'Speak Out BBQ',
    date: '2026-01-12',
    startTime: '12:00',
    endTime: '13:00',
    location: 'Park',
    link,
    category: 'Work',
})

/** Enter and Space on the focused chip open the editor, same as a click — the chip is a real
 *  role=button in the tab order, not a div that only answers the mouse. */
export const OpensFromTheKeyboard: Story = {
    render: () => (
        <div style={{ width: '220px' }}>
            <EventChip event={LINKED('https://example.com')} categories={CATEGORIES} store={store} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        showEventModal.value = null
        const chip = within(canvasElement).getByTestId('event-chip')
        expect(chip.getAttribute('role')).toBe('button')
        expect(chip.tabIndex).toBe(0)
        chip.focus()
        await userEvent.keyboard('{Enter}')
        expect(modalId()).toBe('l1')
        showEventModal.value = null
        await userEvent.keyboard(' ')
        expect(modalId()).toBe('l1')
        showEventModal.value = null
    },
}

/** Only http(s) and mailto links open, always with `noopener`; a `javascript:` link is inert. */
export const LinkOpensOnlySafeSchemes: Story = {
    render: () => (
        <Row gap="10px" column>
            <div style={{ width: '220px' }} data-testid="safe">
                <EventChip event={LINKED('https://example.com/a')} categories={CATEGORIES} store={store} />
            </div>
            <div style={{ width: '220px' }} data-testid="unsafe">
                <EventChip event={{ ...LINKED('javascript:alert(1)'), id: 'l2' }} categories={CATEGORIES} store={store} />
            </div>
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const calls: unknown[][] = []
        const real = window.open
        window.open = ((...a: unknown[]) => (calls.push(a), null)) as typeof window.open
        try {
            await fireEvent.click(within(c.getByTestId('unsafe')).getByRole('button', { name: 'Open link' }))
            expect(calls.length).toBe(0)
            await fireEvent.click(within(c.getByTestId('safe')).getByRole('button', { name: 'Open link' }))
            expect(calls).toEqual([['https://example.com/a', '_blank', 'noopener']])
        } finally {
            window.open = real
        }
    },
}

/** A scheme-less link (`example.com/a`) opens with `https://` in front. */
export const SchemelessLinkGetsHttps: Story = {
    render: () => (
        <div style={{ width: '220px' }}>
            <EventChip event={LINKED('example.com/a')} categories={CATEGORIES} store={store} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const calls: unknown[][] = []
        const real = window.open
        window.open = ((...a: unknown[]) => (calls.push(a), null)) as typeof window.open
        try {
            await fireEvent.click(within(canvasElement).getByRole('button', { name: 'Open link' }))
            expect(calls).toEqual([['https://example.com/a', '_blank', 'noopener']])
        } finally {
            window.open = real
        }
    },
}

/** Delete from the context menu removes the event at once and toasts `deleted <name>` with an
 *  `undo` action that restores it. The store is a real MemoryBackend one, refreshed for real. */
export const DeleteIsImmediateWithUndo: Story = {
    render: () => {
        const own = new EventStore(new MemoryBackend())
        const [added, setAdded] = createSignal<CalendarEvent>()
        void own.load().then(async () => {
            const e = await own.addEvent({ title: 'Doomed sync', date: '2026-01-12', startTime: '09:00', endTime: '10:00', category: 'Work' })
            events.value = [e]
            setAdded(e)
        })
        return (
            <div style={{ width: '220px' }}>
                <Show when={added()}>
                    {e => <EventChip event={e()} categories={CATEGORIES} store={own} />}
                </Show>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const chip = await within(canvasElement).findByTestId('event-chip')
        await fireEvent.contextMenu(chip, { clientX: 20, clientY: 20 })
        const body = within(document.body)
        await fireEvent.click(await body.findByText('Delete'))
        await waitFor(() => expect(toasts().some(t => t.message === 'deleted Doomed sync')).toBe(true))
        expect(toasts().find(t => t.message === 'deleted Doomed sync')?.action?.label).toBe('undo')
        expect(events.value.length).toBe(0)
    },
}


// ---- event-look comparison — phase 2 keeps one ----------------------------------------------

const LOOKS = ['tint', 'outline', 'outline-tint'] as const

const LOOK_DAY = '2026-01-12'
const LOOK_EVENTS: CalendarEvent[] = [
    { id: 'lk-1', title: 'Conference', date: LOOK_DAY, category: 'Work', categories: ['Work', 'Focus'] },
    { id: 'lk-2', title: 'Dentist', date: LOOK_DAY, category: 'Personal' },
    { id: 'lk-3', title: 'Standup', date: LOOK_DAY, startTime: '08:30', endTime: '08:45', category: 'Work' },
    { id: 'lk-4', title: 'Sync with design', date: LOOK_DAY, startTime: '09:30', endTime: '10:30', category: 'Work' },
    { id: 'lk-5', title: '1:1 with manager', date: LOOK_DAY, startTime: '09:45', endTime: '10:15', category: 'Personal' },
    { id: 'lk-6', title: 'Focus block', date: LOOK_DAY, startTime: '10:00', endTime: '11:30', category: 'Focus' },
    { id: 'lk-7', title: 'Team offsite planning', date: LOOK_DAY, startTime: '12:00', endTime: '13:30', category: 'Work', categories: ['Work', 'Focus'] },
    { id: 'lk-8', title: 'Unfiled reminder', date: LOOK_DAY, startTime: '14:00', endTime: '15:00' },
    { id: 'lk-9', title: 'Speak Out BBQ', date: LOOK_DAY, startTime: '15:30', endTime: '17:00', category: 'Personal', location: 'Marina Park, San Leandro' },
]

/** One look's column: the real DayView (all-day row, a compact block, three overlapping lanes, a
 *  two-category block, an uncategorised block, a block with a location), a month cell's pills of
 *  the same events, and the drag ghost for a create and for a two-category move. */
const LookColumn = (props: { look: (typeof LOOKS)[number] }) => {
    let host!: HTMLDivElement
    // The day view opens at midnight; scroll its body to 8am so the fixtures are in view.
    onMount(() =>
        requestAnimationFrame(() => {
            for (const el of host.querySelectorAll<HTMLElement>('*'))
                if (getComputedStyle(el).overflowY === 'auto') el.scrollTop = 7.5 * 50
        }),
    )
    const moveFill = categoryFill(eventCategoryColors(LOOK_EVENTS[6], CATEGORIES)) ?? 'var(--accent)'
    return (
        <div ref={host} data-event-look={props.look} style={{ flex: '1', 'min-width': '0' }}>
            <Row label={props.look} column gap="12px">
                <div style={{ height: '500px' }}>
                    <CalendarFrame>
                        <DayView store={store} />
                    </CalendarFrame>
                </div>
                <div style={{ width: '220px' }}>
                    <MonthCell date={LOOK_DAY} day={12} inMonth today={false} onOpen={() => {}}>
                        <For each={LOOK_EVENTS.filter(e => e.id !== 'lk-5' && e.id !== 'lk-9')}>
                            {e => <EventChip event={e} categories={CATEGORIES} store={store} />}
                        </For>
                    </MonthCell>
                </div>
                <div style={{ position: 'relative', height: '84px', border: '1px solid var(--border-soft)' }}>
                    <DragGhost {...ghostBox(0, 90)} startMin={540} endMin={630} color="var(--accent)" />
                </div>
                <div style={{ position: 'relative', height: '84px', border: '1px solid var(--border-soft)' }}>
                    <DragGhost {...ghostBox(0, 90)} startMin={720} endMin={810} color={moveFill} />
                </div>
            </Row>
        </div>
    )
}

type TitleFont = 'mono' | 'prose'

/** The candidate event looks side by side, over the SAME fixtures and the real views: a day view
 *  (all-day row, compact, overlapping lanes, two categories, uncategorised, a location), a month
 *  cell's pills, and the drag ghost for a create and a two-category move. `titleFont` flips every
 *  title between the mono UI face and the prose serif. Pick one; phase 2 deletes the rest. */
export const LookComparison: StoryObj<{ titleFont: TitleFont }> = {
    parameters: { layout: 'fullscreen' },
    args: { titleFont: 'prose' },
    argTypes: { titleFont: { control: 'inline-radio', options: ['mono', 'prose'] } },
    render: args => {
        seedCalendarState({ date: new Date(2026, 0, 12), categories: CATEGORIES, events: LOOK_EVENTS })
        return (
            <div
                data-event-title={args.titleFont}
                style={{ display: 'flex', gap: '20px', padding: '16px', background: 'var(--bg)' }}
            >
                <For each={LOOKS}>{look => <LookColumn look={look} />}</For>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        for (const look of LOOKS) {
            const col = canvasElement.querySelector<HTMLElement>(`[data-event-look="${look}"]`)!
            // every fixture that should reach the grid did (all-day row + month pills + timed blocks)
            await waitFor(() => expect(within(col).getAllByTestId('event-chip').length).toBeGreaterThanOrEqual(16))
        }
    },
}

// A realistic busy week — back-to-back meetings in one category, overlaps, two-category and
// unfiled events — because one light day is exactly where the looks differ least.
const WEEK_CATEGORIES: Category[] = [...CATEGORIES, { name: 'Health', color: 'green' }, { name: 'Admin', color: 'gold' }]
const wk = (d: number, id: string, title: string, start: string, end: string, cats: string[] = []): CalendarEvent => ({
    id, title, date: `2026-01-${String(d).padStart(2, '0')}`, startTime: start, endTime: end,
    ...(cats.length ? { category: cats[0], categories: cats } : {}),
})
const WEEK_EVENTS: CalendarEvent[] = [
    { id: 'w-ad1', title: 'Conference', date: '2026-01-14', category: 'Work', categories: ['Work', 'Focus'] },
    { id: 'w-ad2', title: 'Rent due', date: '2026-01-16', category: 'Admin' },
    wk(12, 'w1', 'Standup', '09:00', '09:15', ['Work']),
    wk(12, 'w2', 'Design review', '09:30', '10:30', ['Work']),
    wk(12, 'w3', 'Roadmap sync', '10:30', '11:30', ['Work']),
    wk(12, 'w4', 'Lunch with Sam', '12:00', '13:00', ['Personal']),
    wk(12, 'w5', 'Deep work', '13:30', '16:00', ['Focus']),
    wk(13, 'w6', 'Standup', '09:00', '09:15', ['Work']),
    wk(13, 'w7', 'Dentist', '10:00', '11:00', ['Health']),
    wk(13, 'w8', '1:1 with manager', '11:00', '11:30', ['Work']),
    wk(13, 'w9', 'Call the bank', '14:00', '14:30'),
    wk(13, 'w10', 'Pairing', '14:00', '15:30', ['Work', 'Focus']),
    wk(14, 'w11', 'Standup', '09:00', '09:15', ['Work']),
    wk(14, 'w12', 'Interview loop', '10:00', '12:00', ['Work']),
    wk(14, 'w13', 'Hiring debrief', '11:00', '11:45', ['Work']),
    wk(14, 'w14', 'Gym', '17:00', '18:00', ['Health']),
    wk(15, 'w15', 'Standup', '09:00', '09:15', ['Work']),
    wk(15, 'w16', 'Focus block', '09:30', '12:00', ['Focus']),
    wk(15, 'w17', 'Taxes', '13:00', '14:00', ['Admin']),
    wk(15, 'w18', 'Coffee with Ana', '15:00', '15:45', ['Personal']),
    wk(16, 'w19', 'Standup', '09:00', '09:15', ['Work']),
    wk(16, 'w20', 'Demo prep', '10:00', '11:00', ['Work']),
    wk(16, 'w21', 'Team demo', '11:00', '12:00', ['Work']),
    wk(16, 'w22', 'Retro', '12:00', '13:00', ['Work']),
    wk(16, 'w23', 'Unfiled thing', '15:00', '16:00'),
    wk(17, 'w24', 'Farmers market', '10:00', '11:30', ['Personal']),
    wk(17, 'w25', 'Run', '08:00', '09:00', ['Health']),
    wk(18, 'w26', 'Family dinner', '17:30', '19:30', ['Personal']),
]

const WeekLook = (props: { look: (typeof LOOKS)[number] }) => {
    let host!: HTMLDivElement
    onMount(() =>
        requestAnimationFrame(() => {
            for (const el of host.querySelectorAll<HTMLElement>('*'))
                if (getComputedStyle(el).overflowY === 'auto') el.scrollTop = 7.5 * 50
        }),
    )
    return (
        <div ref={host} data-event-look={props.look}>
            <Row label={props.look} column gap="8px">
                <div style={{ height: '620px' }}>
                    <CalendarFrame>
                        <WeekView store={store} />
                    </CalendarFrame>
                </div>
            </Row>
        </div>
    )
}

/** The same candidate looks over a full, busy week (stacked, one week view per look) — the case a
 *  calendar is actually read in. Same `titleFont` switch as LookComparison. */
export const LookComparisonWeek: StoryObj<{ titleFont: TitleFont }> = {
    parameters: { layout: 'fullscreen' },
    args: { titleFont: 'prose' },
    argTypes: { titleFont: { control: 'inline-radio', options: ['mono', 'prose'] } },
    render: args => {
        seedCalendarState({ date: new Date(2026, 0, 12), categories: WEEK_CATEGORIES, events: WEEK_EVENTS })
        return (
            <div
                data-event-title={args.titleFont}
                style={{ display: 'flex', 'flex-direction': 'column', gap: '28px', padding: '16px', background: 'var(--bg)' }}
            >
                <For each={LOOKS.filter(l => l !== 'outline')}>{look => <WeekLook look={look} />}</For>
            </div>
        )
    },
}
