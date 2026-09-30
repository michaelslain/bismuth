// Visual spec for <EventChip> — the single event pill rendered inside the day grid, month
// cell, and all-day row. Its category colour(s) draw an even 1px frame over a faint
// wash of the first category, title in the prose face; a 2+ category event splits its frame into
// one band per category and shows a dot per category (up to three, then "+n"); no resolvable
// category renders an outline-only "ghost" chip.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { showEventModal, events } from '../state'
import { toasts } from '../../toastStore'
import { EventChip } from './EventChip'
import { EventStore, MemoryBackend } from '../EventStore'
import { createSignal, Show } from 'solid-js'
import type { CalendarEvent, Category } from '../types'
import { Row } from '../../ui/_storyKit'
import { layoutDay } from './views/timeGridLayout'

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

/** The variants side by side: two-, three- and four-category chips (split frame + a dot per
 *  category, "+1" past three), an outline-only "ghost" chip (no resolvable category), and the
 *  compact layout TimeGrid uses for short (<= 30min) blocks. */
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
                        id: '2b',
                        title: 'Offsite dinner',
                        date: '2026-01-16',
                        startTime: '19:00',
                        endTime: '21:00',
                        category: 'Work',
                        categories: ['Work', 'Personal', 'Focus'],
                    }}
                    categories={CATEGORIES}
                    store={store}
                />
            </div>
            <div style={{ width: '220px' }}>
                <EventChip
                    event={{
                        id: '2c',
                        title: 'Everything at once',
                        date: '2026-01-16',
                        category: 'Work',
                        categories: ['Work', 'Personal', 'Focus', 'Health'],
                    }}
                    categories={[...CATEGORIES, { name: 'Health', color: 'green' }]}
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
            <div style={{ position: 'static', width: '220px', height: '22px' }}>
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
                    hideTime
                    inGrid
                    store={store}
                />
            </div>
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const chips = within(canvasElement).getAllByTestId('event-chip')
        // StatusDot marks itself with data-size; the "+n" is plain Text
        const dots = (el: HTMLElement) => el.querySelectorAll('[data-size]').length
        // one dot per category for 2 and 3; three dots + a "+1" past three; none on a single category
        expect(dots(chips[0])).toBe(2)
        expect(dots(chips[1])).toBe(3)
        expect(dots(chips[2])).toBe(3)
        expect(chips[2].textContent).toContain('+1')
        expect(dots(chips[4])).toBe(0)
        // the two-category frame is the banded image; a single category's is too (one band)
        expect(getComputedStyle(chips[0]).borderImageSource).toContain('linear-gradient')
    },
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


const MORE_CATEGORIES: Category[] = [...CATEGORIES, { name: 'Health', color: 'green' }]

/** One event in a real time-grid slot: height and `compact` come from `layoutDay`, the same
 *  geometry TimeGrid uses, so the story tracks the layout rule instead of a hand-typed box.
 *  `next` is a back-to-back event, which removes a short block's visual padding. */
function GridSlot(props: {
    event: CalendarEvent
    next?: CalendarEvent
    width?: string
    categories?: Category[]
}) {
    const item = () =>
        layoutDay(props.next ? [props.event, props.next] : [props.event])[0]
    return (
        <div
            style={{
                position: 'relative',
                width: props.width ?? '130px',
                height: `${item().height}px`,
            }}
        >
            <EventChip
                event={props.event}
                compact={item().compact}
                hideTime={item().short}
                inGrid
                categories={props.categories ?? CATEGORIES}
                store={store}
            />
        </div>
    )
}

const at = (id: string, title: string, startTime: string, endTime: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id,
    title,
    date: '2026-01-12',
    startTime,
    endTime,
    category: 'Work',
    ...extra,
})

/** Every block height a week column actually draws, at a narrow column width: 30-min blocks
 *  (which drop their time — padded ~34px, back-to-back ~22px, uncategorised), a 45-min block
 *  (time over one title line), and 1h+ blocks carrying four categories (three dots + "+1")
 *  beside their time range. */
export const GridSizes: Story = {
    render: () => (
        <Row gap="10px" column>
            <GridSlot event={at('g1', 'Veritus - NOTES review', '10:30', '11:00')} />
            <GridSlot
                event={at('g2', 'Veritus - NOTES review', '10:30', '11:00')}
                next={at('g2n', 'Next', '11:00', '12:00')}
            />
            <GridSlot event={at('g3', 'Unfiled quick call', '10:30', '11:00', { category: undefined })} />
            <GridSlot
                event={at('g3m', 'Veritus - NOTES review', '10:30', '11:00', { categories: ['Work', 'Personal', 'Focus', 'Health'] })}
                categories={MORE_CATEGORIES}
            />
            <GridSlot event={at('g3b', 'Veritus - NOTES review', '10:30', '11:15')} />
            <GridSlot
                event={at('g4', 'Morning Routine', '08:00', '09:00', { categories: ['Work', 'Personal', 'Focus', 'Health'] })}
                categories={MORE_CATEGORIES}
            />
            <GridSlot
                event={at('g5', 'Morning Routine', '08:00', '09:00', { categories: ['Work', 'Personal', 'Focus', 'Health'] })}
                categories={MORE_CATEGORIES}
                width="100px"
            />
            <GridSlot
                event={at('g6', 'Offsite planning', '13:00', '15:00', {
                    categories: ['Work', 'Personal', 'Focus', 'Health'],
                    location: 'Room 4B',
                })}
                categories={MORE_CATEGORIES}
            />
        </Row>
    ),
}

/** Where the location sits: under the title, with and without a link, in a free-flowing chip
 *  (month cell / all-day row) and in a 2h grid slot. */
export const LocationPlacement: Story = {
    render: () => (
        <Row gap="16px">
            <Row gap="10px" column>
                <div style={{ width: '200px' }}>
                    <EventChip event={at('p1', 'Lunch with Sam', '12:00', '13:00', { location: 'Café Borrone' })} categories={CATEGORIES} store={store} />
                </div>
                <div style={{ width: '200px' }}>
                    <EventChip event={at('p2', 'Lunch with Sam', '12:00', '13:00', { location: 'Café Borrone', link: 'https://example.com' })} categories={CATEGORIES} store={store} />
                </div>
            </Row>
            <GridSlot event={at('p3', 'Speak Out BBQ', '12:00', '14:00', { location: 'Marina Park, San Leandro' })} width="150px" />
            <GridSlot event={at('p4', 'Speak Out BBQ', '12:00', '14:00', { location: 'Marina Park', link: 'https://example.com' })} width="150px" />
        </Row>
    ),
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
