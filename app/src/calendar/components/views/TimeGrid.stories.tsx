// Visual spec for <TimeGrid> — the shared 24h day-column grid behind Week/Day/ThreeDay (plus
// a sticky all-day row above). Unlike the other calendar view components, TimeGrid genuinely
// takes its data as props (dates/events/categories/store) rather than reading module-level
// state — but we still seed the module state via seedCalendarState() and read the resulting
// signals for the props, so the fixture data isn't duplicated. See
// app/src/ui/_calendarFixtures.ts for the full gotcha writeup.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { onCleanup, type JSX } from 'solid-js'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import { TimeGrid } from './TimeGrid'
import { EventStore, MemoryBackend } from '../../EventStore'
import { seedCalendarState } from '../../../ui/_calendarFixtures'
import { events, categories, showEventModal, settings } from '../../state'
import { addDays } from '../../dates'
import { todayISO } from '../../../../../core/src/dates'
import CalendarFrame from '../CalendarFrame'

// Fixed px, NOT a vh unit: Storybook's preview iframe is only ~315px tall with the Controls
// panel open, so 80vh resolved to 252px — which clipped the month grid's last two week rows and
// cut event chips mid-text. These views need a flex ancestor with real height; the app gives them
// the window, so a story has to state one.
const STORY_H = '760px'

const meta = {
    title: 'Calendar/TimeGrid',
    component: TimeGrid,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TimeGrid>

export default meta
type Story = StoryObj<typeof meta>

// Derived corners: a corner exists where both of its edges are drawn, and `data-edges` (the
// primitive's runtime hook) is the contract the count reads.
const corners = (root: ParentNode, v: 'top' | 'bottom', h: 'left' | 'right') =>
    root.querySelectorAll(`[data-edges~="${v}"][data-edges~="${h}"]`).length

const anchor = new Date(2026, 0, 12)

// A fresh function call, not an inline `showEventModal.value` read: TS's control-flow narrowing
// would otherwise track the `= null` reset in the play() below all the way through the DOM
// dispatches that follow it — it can't see that TimeGrid's mouseup handler, defined in another
// module, is what actually reassigns the box — and collapse the later read to `null`, making the
// post-guard type `never`. Routing through a call breaks that chain.
const readShowEventModal = () => showEventModal.value

/** A 5-day span covering every sample event: timed events, an all-day event, and a
 *  two-category ("Work" + "Focus") gradient chip. */
export const Default: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        const dates = Array.from({ length: 5 }, (_, i) => addDays(anchor, i))
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <TimeGrid
                        dates={dates}
                        events={events.value}
                        categories={categories.value}
                        store={new EventStore(new MemoryBackend())}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const heads = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="day-header"]')]
        const cols = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="time-grid-day-col"]')]
        expect(heads).toHaveLength(5)
        expect(cols).toHaveLength(5)
        // Fails if the header row and the hourly grid below it ever disagree about a day's
        // column geometry — the two rows are built from separate flex layouts and only
        // line up when every day cell in both shares the same `min-width: 0`.
        heads.forEach((h, i) => {
            const a = h.getBoundingClientRect()
            const b = cols[i].getBoundingClientRect()
            expect(Math.abs(b.left - a.left), `day ${i} left edge`).toBeLessThanOrEqual(1)
            expect(Math.abs(b.width - a.width), `day ${i} width`).toBeLessThanOrEqual(1)
        })
        // The ownership wiring, read off the derived corners (5 dates: header + all-day + 24 hours).
        // Each boundary is typed by exactly one cell: the header types its own top, so hour 0 omits
        // its top (`topTyped`); only the last column types a right; the header, the all-day row and
        // hour 23 type a bottom.
        // top-left: header 5 + hours 1..23 x 5 columns
        expect(corners(canvasElement, 'top', 'left')).toBe(5 + 23 * 5)
        // top-right: header 1 + hours 1..23 of the last column
        expect(corners(canvasElement, 'top', 'right')).toBe(1 + 23)
        // bottom-left: header 5 + all-day 5 + hour 23 x 5 columns
        expect(corners(canvasElement, 'bottom', 'left')).toBe(5 + 5 + 5)
        // bottom-right: header 1 + all-day 1 + hour 23 of the last column
        expect(corners(canvasElement, 'bottom', 'right')).toBe(1 + 1 + 1)
    },
}

/** Three overlapping meetings on one day — exercises TimeGrid's first-fit lane layout
 *  (computeLanes), which splits overlapping events into side-by-side columns instead of
 *  stacking them on top of each other. */
export const OverlappingEvents: Story = {
    render: () => {
        const day = todayISO(anchor)
        seedCalendarState({
            date: anchor,
            categories: [
                { name: 'Work', color: 'blue' },
                { name: 'Personal', color: 'rose' },
                { name: 'Focus', color: 'violet' },
            ],
            events: [
                {
                    id: 'ov-1',
                    title: 'Sync with design',
                    date: day,
                    startTime: '10:00',
                    endTime: '11:00',
                    category: 'Work',
                },
                {
                    id: 'ov-2',
                    title: '1:1 with manager',
                    date: day,
                    startTime: '10:15',
                    endTime: '10:45',
                    category: 'Personal',
                },
                {
                    id: 'ov-3',
                    title: 'Focus block',
                    date: day,
                    startTime: '10:30',
                    endTime: '12:00',
                    category: 'Focus',
                },
            ],
        })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <TimeGrid
                        dates={[anchor]}
                        events={events.value}
                        categories={categories.value}
                        store={new EventStore(new MemoryBackend())}
                    />
                </CalendarFrame>
            </div>
        )
    },
}

/** Regression coverage for the "drag to create a short event silently drops the end time" bug:
 *  both drag endpoints snap independently to 30-minute buckets (TimeGrid's SNAP_INTERVAL), so a
 *  real, sub-bucket drag nets zero minutes and used to leave `endTime` out of the payload
 *  entirely. Drives an actual mousedown -> mousemove -> mouseup sequence on a day column — the
 *  same pointer path a user takes — rather than calling computeCreatePayload directly, so a
 *  regression in the wiring (not just the arithmetic) would fail this too. */
export const DragCreatesEndTime: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <TimeGrid
                        dates={[anchor]}
                        events={events.value}
                        categories={categories.value}
                        store={new EventStore(new MemoryBackend())}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        showEventModal.value = null

        const col = canvasElement.querySelector<HTMLElement>(
            '[data-testid="time-grid-day-col"]',
        )
        if (!col) throw new Error('day column not found')
        const rect = col.getBoundingClientRect()
        const x = rect.left + 10
        // A real 22px drag (mousedown y=13, mouseup y=35 against the 1200px column) — the exact
        // repro that shipped with no endTime: both endpoints snap to the same 30-minute bucket.
        const yDown = rect.top + 13
        const yUp = rect.top + 35

        col.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                button: 0,
                clientX: x,
                clientY: yDown,
            }),
        )
        window.dispatchEvent(
            new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: yUp,
            }),
        )
        window.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: yUp,
            }),
        )

        const modal = readShowEventModal()
        if (!modal) throw new Error('drag did not open the create-event modal')
        await expect(modal.startTime).toBeDefined()
        await expect(modal.endTime).toBeDefined()
    },
}


/** Flips the calendar's own settings for one story and restores them on cleanup. */
function WithSettings(props: { militaryTime: boolean; children: JSX.Element }) {
    const prev = settings.value
    settings.value = { ...prev, militaryTime: props.militaryTime }
    onCleanup(() => {
        settings.value = prev
    })
    return <>{props.children}</>
}

/** `calendar.militaryTime` switches the hour gutter to 24h labels ("13:00", no AM/PM). */
export const MilitaryTimeGutter: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        return (
            <WithSettings militaryTime>
                <div style={{ height: STORY_H }}>
                    <CalendarFrame>
                        <TimeGrid
                            dates={[anchor]}
                            events={events.value}
                            categories={categories.value}
                            store={new EventStore(new MemoryBackend())}
                        />
                    </CalendarFrame>
                </div>
            </WithSettings>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        expect(c.getByText('13:00')).toBeInTheDocument()
        expect(c.queryByText('1 PM')).toBeNull()
    },
}

const dragStore = new EventStore(new MemoryBackend())

/** Dragging an event chip down two hours retimes it: the press arms on the slot, the window
 *  carries the move, and the release persists through the store and refreshes the grid. Real
 *  state end to end — the play() reads the new start time back out of the events signal. */
export const DragRetimesAnEvent: Story = {
    render: () => {
        seedCalendarState({ date: anchor, events: [], categories: [{ name: 'Work', color: 'blue' }] })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <TimeGrid
                        dates={[anchor]}
                        events={events.value}
                        categories={categories.value}
                        store={dragStore}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await dragStore.load()
        const created = await dragStore.addEvent({ title: 'Drag me', date: todayISO(anchor), startTime: '09:00', endTime: '10:00', category: 'Work' })
        events.value = [created]
        const slot = await c.findByTestId('time-grid-event')
        const col = c.getByTestId('time-grid-day-col')
        slot.scrollIntoView({ block: 'center' })
        const r = slot.getBoundingClientRect()
        const hourPx = col.getBoundingClientRect().height / 24
        const x = r.left + r.width / 2
        const y = r.top + 6
        await fireEvent.mouseDown(slot, { clientX: x, clientY: y, button: 0 })
        await fireEvent.mouseMove(window, { clientX: x, clientY: y + hourPx * 2 })
        await fireEvent.mouseUp(window, { clientX: x, clientY: y + hourPx * 2 })
        await waitFor(() => expect(events.value[0]?.startTime).toBe('11:00'))
        expect(events.value[0].endTime).toBe('12:00')
    },
}
