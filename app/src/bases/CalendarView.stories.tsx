// Visual spec for <CalendarView> — one Bases view kind with two registers, gated on
// `viewMode(result.view)`:
//   - "normal" (default, `mode`/`calendarContent` both absent) — the pre-existing
//     month/week/3day/day calendar UI, backed by an EventStore instead of the shared
//     `ViewResult`/`BaseConfig` pipeline the other 11 Bases views use. With no `basePath` it
//     runs against an in-memory `MemoryBackend` (no vault file, no rows) — the genuine state
//     an inline/unsaved calendar renders in. Imports `calendar/Calendar.module.css` itself,
//     so it's styled with no extra wiring here.
//   - "tasks" (`viewMode(result.view) === 'tasks'`) — renders `result`'s resolved rows, same
//     as every other row-based Bases view. No EventStore/backend involved at all, so a
//     `result`/`config` fixture is all these stories need to feed it (see `taskRow`/
//     `tasksViewResult` below). `TASKS_VIEW` below deliberately keeps the legacy
//     `calendarContent: 'tasks'` spelling rather than `mode: 'tasks'`, so this story doubles
//     as coverage that a base file written before `mode:` existed still renders the register.
import { createSignal, onCleanup, onMount } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import { CalendarView } from './CalendarView'
import { currentDate, currentView, events, categories } from '../calendar/state'
import type { CalendarEvent, Category } from '../calendar/types'
import { EMPTY_FILE } from '../../../core/src/bases/types'
import type { Row, ViewResult, BaseConfig, ViewConfig } from '../../../core/src/bases/types'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import chipStyles from '../calendar/components/TaskChip.module.css'
import calStyles from '../calendar/Calendar.module.css'

const meta = {
    title: 'Bases/CalendarView',
    component: CalendarView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CalendarView>

export default meta
type Story = StoryObj<typeof meta>

/** No `basePath` -> `MemoryBackend`, zero events. The real (empty) rendering path — there is
 *  no props surface to feed it rows, since CalendarView owns its own EventStore instead of
 *  taking a `ViewResult`. */
export const Default: Story = {
    render: () => <CalendarView />,
}

/**
 * CalendarView has no `rows`/`result` prop to drive from outside — even a `basePath` wouldn't
 * help here, since it reads the file over `api.read()`, which 404s with no backend running in
 * Storybook. To show dated events without a backend, this story writes directly to the
 * calendar module's own exported state (`currentView`/`currentDate`/`events`/`categories` from
 * `calendar/state.ts`) — the SAME signals the real Toolbar and EventStore write through
 * elsewhere in the app, not a fabricated stand-in. The write is deferred a tick so it lands
 * AFTER CalendarView's own mount-time `refreshEvents()` (which would otherwise stomp it with
 * the empty store's data), and everything is restored on cleanup so it can't leak into other
 * stories. Caveat: this is timing-dependent (a `setTimeout`, not a prop), so it's worth a
 * visual double-check rather than trusting this comment.
 */
function SeededMonthCalendar() {
    const prevView = currentView.value
    const prevDate = currentDate.value
    const today = new Date()
    const seedDate = new Date(today.getFullYear(), today.getMonth(), 15)
    const iso = (day: number) => {
        const d = new Date(seedDate.getFullYear(), seedDate.getMonth(), day)
        return d.toISOString().slice(0, 10)
    }
    const SAMPLE_EVENTS: CalendarEvent[] = [
        {
            id: 'story-1',
            title: 'Ship storybook coverage',
            date: iso(5),
            startTime: '10:00',
            endTime: '11:00',
            category: 'Work',
        },
        {
            id: 'story-2',
            title: 'Vendor security review',
            date: iso(8),
            category: 'Work',
        },
        {
            id: 'story-3',
            title: 'Team retro',
            date: iso(15),
            startTime: '14:00',
            endTime: '15:00',
            category: 'Meetings',
        },
        {
            id: 'story-4',
            title: 'Draft the roadmap',
            date: iso(22),
            category: 'Planning',
        },
    ]
    const SAMPLE_CATEGORIES: Category[] = [
        { name: 'Work', color: 'var(--graph-0)' },
        { name: 'Meetings', color: 'var(--graph-1)' },
        { name: 'Planning', color: 'var(--graph-2)' },
    ]

    let timer: ReturnType<typeof setTimeout> | undefined
    onMount(() => {
        timer = setTimeout(() => {
            currentDate.value = seedDate
            currentView.value = 'month' // triggers CalendarView's own refreshEvents() first...
            events.value = SAMPLE_EVENTS // ...then these two land after, so they stick.
            categories.value = SAMPLE_CATEGORIES
        }, 50)
    })
    onCleanup(() => {
        clearTimeout(timer)
        currentView.value = prevView
        currentDate.value = prevDate
        events.value = []
        categories.value = []
    })

    return <CalendarView />
}

export const MonthWithEvents: Story = {
    render: () => <SeededMonthCalendar />,
}

// ---- wave-2 review finding (F5): EventsCalendar remounts per basePath -----------------

/** A minimal `type: base` calendar file with exactly one event, in the same row-table shape
 *  `calendarSerialize.ts` reads (see its own test fixture) — the live calendar's `BaseBackend`
 *  reads this over `api.read()`, so it needs a real (fake) transport, unlike `SeededMonthCalendar`
 *  above which bypasses the backend entirely via the module's own signals. `date` is today's, so
 *  the event lands in whatever the default view (week) shows without seeding `currentDate`. */
function eventsBaseFile(id: string, title: string): string {
    return [
        '---',
        'type: base',
        'view: calendar',
        '---',
        '',
        '| id | title | date | startTime | endTime | location | link | description | category | recurrence |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        `| ${id} | ${title} | ${todayISO()} |  |  |  |  |  |  |  |`,
    ].join('\n')
}
const EVENTS_A_PATH = 'Events Calendar A.md'
const EVENTS_B_PATH = 'Events Calendar B.md'
const EVENTS_A_BODY = eventsBaseFile('a1', 'Alpha Meeting')
const EVENTS_B_BODY = eventsBaseFile('b1', 'Beta Meeting')

/** Two buttons swap `basePath` on a single, persistently-mounted `<CalendarView>` — the same
 *  shape a real tab switch between two base-backed calendars produces (CalendarView itself is
 *  never remounted; only its `basePath` prop changes). No `result`/`config` passed, so
 *  `isTasks()` stays false and this always renders the EVENTS register. */
function EventsCalendarSwitcher() {
    const [basePath, setBasePath] = createSignal(EVENTS_A_PATH)
    return (
        <div>
            <div>
                <button
                    type="button"
                    data-testid="events-a"
                    onClick={() => setBasePath(EVENTS_A_PATH)}
                >
                    Calendar A
                </button>
                <button
                    type="button"
                    data-testid="events-b"
                    onClick={() => setBasePath(EVENTS_B_PATH)}
                >
                    Calendar B
                </button>
            </div>
            <CalendarView basePath={basePath()} />
        </div>
    )
}

/** Regression for the diag-3 finding "two events calendars show the other's events" (4/4 against
 *  the real vault — see the plan's measured-baseline table): `EventsCalendar`'s `backend`/`store`
 *  are built ONCE at component setup from `props.basePath` (plain variables, not signals), so an
 *  unkeyed `<Show>` around it — reacting only to `isTasks()`, never to `basePath` itself — reuses
 *  the SAME `EventsCalendar` instance across a basePath change and keeps showing (and would later
 *  SAVE into) the first calendar's file. The fix (CalendarView.tsx) keys the fallback `<Show>` on
 *  `props.basePath`, so a basePath change remounts `EventsCalendar` with a fresh backend/store. */
export const EventsRegisterRemountsPerBasePath: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [EVENTS_A_PATH]: EVENTS_A_BODY,
                    [EVENTS_B_PATH]: EVENTS_B_BODY,
                },
            }),
        )
        return <EventsCalendarSwitcher />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvas.getByText('Alpha Meeting')).toBeInTheDocument(),
        )
        await fireEvent.click(canvas.getByTestId('events-b'))
        await waitFor(() =>
            expect(canvas.getByText('Beta Meeting')).toBeInTheDocument(),
        )
        expect(canvas.queryByText('Alpha Meeting')).not.toBeInTheDocument()
    },
}

// ---- tasks register --------------------------------------------------------------------

/** One task row, shaped like `taskToRow` (core/src/bases/taskRow.ts) actually emits — same
 *  `note.*` keys, including the derived `placed` (scheduled falling back to due) the real
 *  pipeline always sets. `line` only needs to be unique per file for the toggle click to be
 *  wired to something real. */
function taskRow(
    description: string,
    opts: {
        line: number
        scheduled?: string
        due?: string
        resolved?: boolean
    },
): Row {
    const placed = opts.scheduled ?? opts.due
    return {
        file: {
            ...EMPTY_FILE,
            name: 'tasks',
            basename: 'tasks',
            path: 'tasks.md',
        },
        note: {
            description,
            status: opts.resolved ? 'done' : 'todo',
            statusChar: opts.resolved ? 'x' : ' ',
            line: opts.line,
            scheduled: opts.scheduled,
            due: opts.due,
            placed,
            resolved: !!opts.resolved,
            recurring: false,
        },
        formula: {},
    }
}

const TASKS_VIEW: ViewConfig = {
    type: 'calendar',
    name: 'Calendar',
    calendarContent: 'tasks',
}

function tasksResult(rows: Row[]): ViewResult {
    return { view: TASKS_VIEW, columns: [], groups: [{ key: '', rows }], summaries: {} }
}

const TASKS_BASE_CONFIG: BaseConfig = {
    source: { kind: 'tasks' },
    views: [TASKS_VIEW],
}

/** `renew passport`'s due date is 25 days in the past and unresolved, so it CARRIES onto
 *  today — the whole point of this fixture, since `bench/` invariants only see what a story
 *  actually renders and an unrendered carried register is unverified. Dates are relative to
 *  the real `todayISO()` (not a fixed calendar date) so the carry is real regardless of when
 *  the story is opened — `placeRows` computes lateness against the actual clock. */
function tasksFixtureRows(): Row[] {
    const today = todayISO()
    return [
        taskRow('renew passport', { line: 1, due: addDaysISO(today, -25) }),
        taskRow('pay rent', { line: 2, scheduled: addDaysISO(today, -1) }),
        taskRow('email ana', { line: 3, scheduled: today }),
        taskRow('draft the roadmap', { line: 4, due: addDaysISO(today, 6) }),
        // Resolved AND overdue: must stay on its OWN day (2026-…, whatever `today - 10` is),
        // never carried — `placeRows` only carries UNRESOLVED rows forward.
        taskRow('renewed the lease', {
            line: 5,
            due: addDaysISO(today, -10),
            resolved: true,
        }),
    ]
}

/** Seeds ONLY `currentView`/`currentDate` (the tasks register never reads `events`/
 *  `categories` at all) and restores both on cleanup. Unlike `SeededMonthCalendar`, there
 *  is no store race to dodge with a `setTimeout`: CalendarView mounts a DEDICATED
 *  `TasksCalendar` child for this register (see CalendarView.tsx), which never touches
 *  `EventStore`/`refreshEvents` at all — a plain synchronous set is enough. */
function TasksCalendarStory(props: { view: 'month' | 'week' }) {
    const prevView = currentView.value
    const prevDate = currentDate.value
    onMount(() => {
        currentView.value = props.view
        currentDate.value = new Date()
    })
    onCleanup(() => {
        currentView.value = prevView
        currentDate.value = prevDate
    })
    return (
        <CalendarView
            result={tasksResult(tasksFixtureRows())}
            config={TASKS_BASE_CONFIG}
        />
    )
}

/** Finds a rendered task chip's title element by its exact text, and the chip's ROOT div
 *  (the title span's direct parent — see TaskChip.tsx's structure) for class assertions.
 *  Shared by both play()s below so a render-only regression (nothing throws, but the wrong
 *  thing — or nothing — ends up on screen) actually fails the test instead of passing
 *  silently, which is exactly what a story with no `play()` cannot catch. */
function findChip(canvasElement: HTMLElement, title: string) {
    const el = Array.from(
        canvasElement.querySelectorAll<HTMLElement>(
            '[data-testid="task-chip-title"]',
        ),
    ).find(t => t.textContent === title)
    return { title: el, root: el?.parentElement ?? undefined }
}

/** Tasks register, month view. No `basePath`/backend/EventStore involved — `result`/`config`
 *  alone drive the whole render, same as any other row-based Bases view. Proves the carried
 *  (danger) register actually renders: `renew passport` and `pay rent` both carry onto
 *  today's cell with the box + hairline + "Nd late" chip, while `email ana` — placed on
 *  today itself, not carried — shares that same cell without the danger class. */
export const MonthWithTasks: Story = {
    render: () => <TasksCalendarStory view="month" />,
    play: async ({ canvasElement }) => {
        const passport = findChip(canvasElement, 'renew passport')
        const rent = findChip(canvasElement, 'pay rent')
        const email = findChip(canvasElement, 'email ana')
        expect(passport.title, 'renew passport chip rendered').toBeTruthy()
        expect(rent.title, 'pay rent chip rendered').toBeTruthy()
        expect(email.title, 'email ana chip rendered').toBeTruthy()

        // All three land in the SAME cell — today's — because an unresolved overdue row
        // carries onto today regardless of its original placed date (placeRows).
        const cellOf = (el: HTMLElement) => el.closest(`.${calStyles['month-cell']}`)
        const todayCell = cellOf(email.root!)
        expect(todayCell).toBeTruthy()
        expect(cellOf(passport.root!)).toBe(todayCell)
        expect(cellOf(rent.root!)).toBe(todayCell)

        // Carried vs not: the DANGER CLASS distinguishes them, not just the "Nd late" text —
        // a regression that dropped the class binding while leaving the text would still
        // pass a text-only check.
        expect(passport.root!.classList.contains(chipStyles.carried)).toBe(true)
        expect(rent.root!.classList.contains(chipStyles.carried)).toBe(true)
        expect(email.root!.classList.contains(chipStyles.carried)).toBe(false)
    },
}

/** Tasks register, week view. Tasks are all-day, so this exercises the all-day-gutter layout
 *  (TaskAllDayStrip) rather than the hourly time grid — the time grid is not used in this
 *  register at all. Same assertions as `MonthWithTasks`, against the week strip's own
 *  all-day-cell container instead of a month cell. */
export const WeekWithTasks: Story = {
    render: () => <TasksCalendarStory view="week" />,
    play: async ({ canvasElement }) => {
        const passport = findChip(canvasElement, 'renew passport')
        const rent = findChip(canvasElement, 'pay rent')
        const email = findChip(canvasElement, 'email ana')
        expect(passport.title, 'renew passport chip rendered').toBeTruthy()
        expect(rent.title, 'pay rent chip rendered').toBeTruthy()
        expect(email.title, 'email ana chip rendered').toBeTruthy()

        const cellOf = (el: HTMLElement) =>
            el.closest(`.${calStyles['time-grid-allday-cell']}`)
        const todayCell = cellOf(email.root!)
        expect(todayCell).toBeTruthy()
        expect(cellOf(passport.root!)).toBe(todayCell)
        expect(cellOf(rent.root!)).toBe(todayCell)

        expect(passport.root!.classList.contains(chipStyles.carried)).toBe(true)
        expect(rent.root!.classList.contains(chipStyles.carried)).toBe(true)
        expect(email.root!.classList.contains(chipStyles.carried)).toBe(false)
    },
}
