// Visual spec for <TimeGridDayColumn> — one day of the hourly grid: 24 hour blocks, the day's
// timed events as lane-offset slots, and the drag ghost. Interaction stories hold real state: the
// mousedown handlers record into signals the play() reads back.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, within } from 'storybook/test'
import TimeGridDayColumn from './TimeGridDayColumn'
import { EventStore, MemoryBackend } from '../../EventStore'
import type { CalendarEvent, Category } from '../../types'
import { GRID_PX } from './timeGridLayout'

const meta = {
    title: 'Calendar/Views/TimeGridDayColumn',
    component: TimeGridDayColumn,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TimeGridDayColumn>

export default meta
type Story = StoryObj<typeof meta>

// Derived corners: a corner exists where both of its edges are drawn, and `data-edges` (the
// primitive's runtime hook) is the contract the count reads.
const corners = (root: ParentNode, v: 'top' | 'bottom', h: 'left' | 'right') =>
    root.querySelectorAll(`[data-edges~="${v}"][data-edges~="${h}"]`).length

const store = new EventStore(new MemoryBackend())
const categories: Category[] = [{ name: 'Work', color: 'blue' }]
const events: CalendarEvent[] = [
    { id: '1', title: 'Standup', date: '2026-01-12', startTime: '09:00', endTime: '09:30', category: 'Work' },
    { id: '2', title: 'Design review', date: '2026-01-12', startTime: '09:15', endTime: '10:15', category: 'Work' },
    { id: '3', title: 'Other day', date: '2026-01-13', startTime: '09:00', endTime: '10:00', category: 'Work' },
    { id: '4', title: 'All day', date: '2026-01-12', category: 'Work' },
]

const Harness = (props: { today?: boolean }) => {
    const [downs, setDowns] = createSignal<string[]>([])
    return (
        <div data-testid="frame" style={{ display: 'flex', width: '260px', 'max-height': '360px', overflow: 'auto', '--time-grid-height': `${GRID_PX}px` }}>
            <TimeGridDayColumn
                date="2026-01-12"
                today={props.today}
                {...{ events, categories, store }}
                onMouseDown={() => setDowns(d => [...d, 'column'])}
                onEventMouseDown={(e, ev) => {
                    e.stopPropagation() // the grid's own handler claims the press, as TimeGrid does
                    setDowns(d => [...d, ev.id])
                }}
            />
            <output data-testid="downs">{downs().join(',')}</output>
        </div>
    )
}

export const DayWithOverlap: Story = {
    render: () => <Harness />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const col = c.getByTestId('time-grid-day-col')
        // one grid height, from the single constant
        expect(Math.round(col.getBoundingClientRect().height)).toBe(GRID_PX)
        // only THIS day's TIMED events: the other-day and all-day events are not drawn here
        expect(c.getAllByTestId('time-grid-event').length).toBe(2)
        // pressing an event reaches the grid's event handler, not the column's
        await fireEvent.mouseDown(c.getAllByTestId('time-grid-event')[0])
        expect(c.getByTestId('downs').textContent).toBe('1')
        await fireEvent.mouseDown(col, { clientY: 300 })
        expect(c.getByTestId('downs').textContent).toBe('1,column')
    },
}

/** The typed grid: 24 hour blocks each host one overlay (top `-` + left `|`, + the column's right
 *  `|` since it stands alone), the half-hour cell carries none, and no CSS border draws a line. */
export const TypedGrid: Story = {
    render: () => <Harness />,
    play: async ({ canvasElement }) => {
        const col = within(canvasElement).getByTestId('time-grid-day-col')
        expect(getComputedStyle(col).borderLeftWidth).toBe('0px')
        // one overlay per hour block, a top-left corner in each (first hour included: standalone)
        expect(col.querySelectorAll('[data-edges]')).toHaveLength(24)
        expect(corners(col, 'top', 'left')).toBe(24)
        // closed on the right in every hour, and at the bottom of the last hour only
        expect(corners(col, 'top', 'right')).toBe(24)
        expect(corners(col, 'bottom', 'left')).toBe(1)
        expect(corners(col, 'bottom', 'right')).toBe(1)
        // the overlay is a third child of the hour block, after the hour and half-hour cells
        const block = col.firstElementChild as HTMLElement
        expect(block.children).toHaveLength(3)
        expect(getComputedStyle(block.children[0] as HTMLElement).borderTopWidth).toBe('0px')
    },
}

export const Today: Story = {
    render: () => <Harness today />,
    play: async ({ canvasElement }) => {
        const col = within(canvasElement).getByTestId('time-grid-day-col')
        expect(getComputedStyle(col).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    },
}
