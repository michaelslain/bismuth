// Visual spec for <TimeGridEvent> — the absolutely-positioned slot one timed event occupies in a
// day column: geometry from timeGridLayout, a lane offset for overlaps, faint while being dragged.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import TimeGridEvent from './TimeGridEvent'
import { layoutDay } from './timeGridLayout'
import { EventStore, MemoryBackend } from '../../EventStore'
import type { CalendarEvent, Category } from '../../types'

const meta = {
    title: 'Calendar/Views/TimeGridEvent',
    component: TimeGridEvent,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TimeGridEvent>

export default meta
type Story = StoryObj<typeof meta>

const store = new EventStore(new MemoryBackend())
const categories: Category[] = [{ name: 'Work', color: 'blue' }]
const ev = (id: string, startTime: string, endTime: string): CalendarEvent => ({ id, title: `Event ${id}`, date: '2026-01-12', startTime, endTime, category: 'Work' })

const Column = (props: { events: CalendarEvent[]; dimmedId?: string }) => (
    <div style={{ position: 'relative', width: '240px', height: '220px', border: '1px solid var(--border-soft)' }}>
        {layoutDay(props.events).map(item => (
            <TimeGridEvent
                {...{ item, categories, store }}
                date="2026-01-12"
                dimmed={props.dimmedId === item.event.id}
                onMouseDown={() => {}}
            />
        ))}
    </div>
)

export const Overlapping: Story = {
    render: () => <Column events={[ev('a', '00:30', '02:30'), ev('b', '01:00', '02:00')]} />,
    play: async ({ canvasElement }) => {
        const slots = within(canvasElement).getAllByTestId('time-grid-event')
        expect(slots.length).toBe(2)
        const [a, b] = slots.map(s => s.getBoundingClientRect())
        // the second lane starts to the right of the first and both reach the right edge
        expect(b.left).toBeGreaterThan(a.left + 20)
        expect(Math.round(b.right)).toBe(Math.round(a.right))
    },
}

export const DimmedWhileDragged: Story = {
    render: () => <Column events={[ev('a', '00:30', '02:00')]} dimmedId="a" />,
    play: async ({ canvasElement }) => {
        const slot = within(canvasElement).getByTestId('time-grid-event')
        expect(getComputedStyle(slot).opacity).toBe('0.3')
    },
}

// ---- event-look comparison — phase 2 keeps one ----------------------------------------------

/** Each candidate look (an ancestor `data-event-look`) over the same three overlapping lanes: a
 *  stacked lane rules itself off from the one behind with a hard line of ground. */
export const Looks: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '16px' }}>
            {(['tint', 'outline', 'outline-tint'] as const).map(look => (
                <div data-event-look={look}>
                    <Column events={[ev('a', '00:30', '03:00'), ev('b', '01:00', '02:00'), ev('c', '01:30', '03:30')]} />
                </div>
            ))}
        </div>
    ),
    play: async ({ canvasElement }) => {
        const stacked = canvasElement.querySelectorAll<HTMLElement>('[data-event-look] [data-testid="time-grid-event"]')
        // lanes 1 and 2 of each look carry the separator; lane 0 does not
        const shadows = [...stacked].map(s => getComputedStyle(s).boxShadow)
        expect(shadows.filter(s => s !== 'none').length).toBe(6)
    },
}
