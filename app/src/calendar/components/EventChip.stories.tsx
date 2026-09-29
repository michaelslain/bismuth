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
import { createSignal, Show } from 'solid-js'
import type { CalendarEvent, Category } from '../types'
import { Row } from '../../ui/_storyKit'

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
