// Visual spec for <TimeGrid> — the shared 24h day-column grid behind Week/Day/ThreeDay (plus
// a sticky all-day row above). Unlike the other calendar view components, TimeGrid genuinely
// takes its data as props (dates/events/categories/store) rather than reading module-level
// state — but we still seed the module state via seedCalendarState() and read the resulting
// signals for the props, so the fixture data isn't duplicated. See
// app/src/ui/_calendarFixtures.ts for the full gotcha writeup.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { TimeGrid } from './TimeGrid'
import { EventStore, MemoryBackend } from '../../EventStore'
import { seedCalendarState } from '../../../ui/_calendarFixtures'
import { events, categories, showEventModal } from '../../state'
import { addDays, toDateStr } from '../../dates'
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
    },
}

/** Three overlapping meetings on one day — exercises TimeGrid's first-fit lane layout
 *  (computeLanes), which splits overlapping events into side-by-side columns instead of
 *  stacking them on top of each other. */
export const OverlappingEvents: Story = {
    render: () => {
        const day = toDateStr(anchor)
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
