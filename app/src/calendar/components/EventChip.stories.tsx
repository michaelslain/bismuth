// Visual spec for <EventChip> — the single event pill rendered inside the day grid, month
// cell, and all-day row. Category colour(s) determine the fill: one category tints solid,
// two+ blend into a gradient, and no resolvable category renders an outline-only "ghost"
// chip (categoryColor.ts's categoryFill()).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { EventChip } from './EventChip'
import { EventStore, MemoryBackend } from '../EventStore'
import type { Category } from '../types'
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
