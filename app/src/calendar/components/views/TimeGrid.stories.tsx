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
import { GRID_PX } from './timeGridLayout'
import { EventStore, MemoryBackend } from '../../EventStore'
import { seedCalendarState } from '../../../ui/_calendarFixtures'
import { events, categories, showEventModal, settings } from '../../state'
import { addDays } from '../../dates'
import { fitTiles, whenAsciiGlyphTilesInstalled } from '../../../ui/ascii/asciiGlyphTiles'
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

/** The grid is 72px an hour — four 18px rows — so every hour line, half-hour cell and 15-minute
 *  snap lands on the row unit, and each hour block is corner tile + 4 dash pitches tall, so its typed
 *  `|` paints one pitch down (the unit the `-` paints across). At the old 50px an hour the run held
 *  2.43 pitches and `round` stretched it to 17px. Read off the real boxes. */
export const HourIsFourRows: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        const dates = Array.from({ length: 3 }, (_, i) => addDays(anchor, i))
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
        await whenAsciiGlyphTilesInstalled()
        const cs = getComputedStyle(document.documentElement)
        const rowH = parseFloat(cs.getPropertyValue('--row-h'))
        const tileH = parseFloat(cs.getPropertyValue('--ascii-tile-h'))
        const pitch = parseFloat(cs.getPropertyValue('--ascii-pitch'))
        expect(rowH, '--row-h resolves').toBeGreaterThan(0)
        const col = canvasElement.querySelector<HTMLElement>('[data-testid="time-grid-day-col"]')!
        // the column is 24 hours of exactly four rows, and the JS constant agrees with the CSS one
        expect(col.getBoundingClientRect().height).toBeCloseTo(24 * 4 * rowH, 1)
        expect(col.getBoundingClientRect().height).toBeCloseTo(GRID_PX, 1)
        // every typed hour overlay in the column (top edge = the :00 line) paints one pitch down
        const overlays = [...col.querySelectorAll<HTMLElement>('[data-edges~="left"]')]
        expect(overlays.length, 'one overlay per hour').toBeGreaterThanOrEqual(23)
        for (const el of overlays) {
            const r = el.getBoundingClientRect()
            const hour = r.height - tileH
            expect(hour, 'one hour block of room').toBeCloseTo(4 * rowH, 1)
            expect(fitTiles(r.height - 2 * tileH, pitch).pitch, 'painted pitch down').toBeCloseTo(pitch, 1)
        }
    },
}

/** Today's header: the accent disc is one row tall and square, and it no longer touches the `/`
 *  before it in `Tue 10/5` (it used to be 20px in an 18px line, flush against the slash). The gap is
 *  measured from the slash's own glyph box to the disc, the way a reader sees them. */
export const TodayMarkerClearsTheSlash: Story = {
    render: () => {
        seedCalendarState({ date: new Date() })
        const dates = Array.from({ length: 3 }, (_, i) => addDays(new Date(), i))
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <TimeGrid
                        dates={dates}
                        events={[]}
                        categories={categories.value}
                        store={new EventStore(new MemoryBackend())}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const rowH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'))
        const header = canvasElement.querySelector<HTMLElement>('[data-testid="day-header"]')!
        const disc = [...header.querySelectorAll<HTMLElement>('*')].find(
            el => getComputedStyle(el).borderTopLeftRadius === '50%' && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)',
        )!
        expect(disc, "today's header draws an accent disc").toBeTruthy()
        const d = disc.getBoundingClientRect()
        expect(d.width).toBeCloseTo(rowH, 0)
        expect(d.height).toBeCloseTo(rowH, 0)
        // the text node right before the disc ends in the `/`; take that last character's box
        const prev = disc.previousSibling!
        expect(prev.nodeType, 'a text node holds the `m/` before the disc').toBe(Node.TEXT_NODE)
        expect(prev.textContent!.endsWith('/')).toBe(true)
        const range = document.createRange()
        range.setStart(prev, prev.textContent!.length - 1)
        range.setEnd(prev, prev.textContent!.length)
        const gap = d.left - range.getBoundingClientRect().right
        expect(gap, 'clear air between the slash and the disc').toBeGreaterThanOrEqual(2)
    },
}

/** Fourteen all-day events on one day, in a short pane. The sticky all-day strip caps at six
 *  --row-h rows and scrolls inside its own column, so the hour grid still owns most of the pane and
 *  can scroll: uncapped, the strip alone (14 chips) was taller than the pane. */
export const ManyAllDayEventsDoNotPinThePane: Story = {
    render: () => {
        const day = todayISO(anchor)
        seedCalendarState({
            date: anchor,
            categories: [{ name: 'Work', color: 'blue' }],
            events: Array.from({ length: 14 }, (_, i) => ({
                id: `ad-${i}`,
                title: `All day ${i + 1}`,
                date: day,
                category: 'Work',
            })),
        })
        return (
            <div style={{ height: '420px' }}>
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
        const rowH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'))
        const cell = canvasElement.querySelector<HTMLElement>('[data-testid="allday-cell"]')!
        expect(cell.querySelectorAll('[data-testid="event-chip"]')).toHaveLength(14)
        const content = cell.firstElementChild as HTMLElement
        expect(content.clientHeight).toBeLessThanOrEqual(6 * rowH + 0.5)
        expect(content.scrollHeight).toBeGreaterThan(content.clientHeight)
        // the strip (header top to all-day bottom) leaves most of the pane to the hour grid, which
        // can therefore scroll: find its scroller by walking up from the column
        const col = canvasElement.querySelector<HTMLElement>('[data-testid="time-grid-day-col"]')!
        let scroller: HTMLElement | null = col.parentElement
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight && getComputedStyle(scroller).overflowY === 'auto'))
            scroller = scroller.parentElement
        expect(scroller, 'the hour grid has a scroll container').toBeTruthy()
        const head = canvasElement.querySelector<HTMLElement>('[data-testid="day-header"]')!.getBoundingClientRect()
        const strip = cell.getBoundingClientRect()
        const pinned = strip.bottom - head.top
        expect(pinned, 'pinned chrome').toBeLessThan(scroller!.clientHeight * 0.6)
        // scrolling the grid to 12:00 parks that hour line just under the strip — inside the pane,
        // not behind or beyond it (uncapped, the strip alone outgrew the pane and it never arrived)
        scroller!.scrollTop = 12 * 72
        const noon = col.getBoundingClientRect().top + 12 * 72
        expect(noon).toBeGreaterThanOrEqual(strip.bottom - 1)
        expect(noon).toBeLessThan(scroller!.getBoundingClientRect().bottom)
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
        // A real 22px drag (mousedown y=20, mouseup y=42 against the 1728px column, 1.2px a
        // minute) — the exact repro that shipped with no endTime: both endpoints snap to the same
        // 30-minute bucket (16.7 and 35 minutes both round to 30).
        const yDown = rect.top + 20
        const yUp = rect.top + 42

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
