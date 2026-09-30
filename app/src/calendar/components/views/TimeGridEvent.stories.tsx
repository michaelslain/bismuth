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
        // the stacked lane rules itself off from the one behind; the first lane does not
        expect(getComputedStyle(slots[0]).boxShadow).toBe('none')
        expect(getComputedStyle(slots[1]).boxShadow).not.toBe('none')
    },
}

export const DimmedWhileDragged: Story = {
    render: () => <Column events={[ev('a', '00:30', '02:00')]} dimmedId="a" />,
    play: async ({ canvasElement }) => {
        const slot = within(canvasElement).getByTestId('time-grid-event')
        expect(getComputedStyle(slot).opacity).toBe('0.3')
    },
}
