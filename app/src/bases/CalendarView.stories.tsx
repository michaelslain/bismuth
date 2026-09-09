// Visual spec for <CalendarView> — one Bases view kind with two registers:
//   - "events" (default, `calendarContent` absent) — the pre-existing month/week/3day/day
//     calendar UI, backed by an EventStore instead of the shared `ViewResult`/`BaseConfig`
//     pipeline the other 11 Bases views use. With no `basePath` it runs against an in-memory
//     `MemoryBackend` (no vault file, no rows) — the genuine state an inline/unsaved calendar
//     renders in. Imports `calendar/Calendar.module.css` itself, so it's styled with no extra
//     wiring here.
//   - "tasks" (`result.view.calendarContent === 'tasks'`) — renders `result`'s resolved rows,
//     same as every other row-based Bases view. No EventStore/backend involved at all, so a
//     `result`/`config` fixture is all these stories need to feed it (see `taskRow`/
//     `tasksViewResult` below).
import { onCleanup, onMount } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { CalendarView } from './CalendarView'
import { currentDate, currentView, events, categories } from '../calendar/state'
import type { CalendarEvent, Category } from '../calendar/types'
import { EMPTY_FILE } from '../../../core/src/bases/types'
import type { Row, ViewResult, BaseConfig, ViewConfig } from '../../../core/src/bases/types'
import { todayISO, addDaysISO } from '../../../core/src/dates'

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
 *  `categories` at all) and restores both on cleanup — the tasks-mode `onMount` returns
 *  early with no `refreshEvents()` call, so unlike `SeededMonthCalendar` there's no store
 *  race to dodge with a `setTimeout`; a plain synchronous set is enough. */
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

/** Tasks register, month view. No `basePath`/backend/EventStore involved — `result`/`config`
 *  alone drive the whole render, same as any other row-based Bases view. Proves the carried
 *  (danger) register actually renders: `renew passport` and `pay rent` both carry onto
 *  today's cell with the box + hairline + "Nd late" chip. */
export const MonthWithTasks: Story = {
    render: () => <TasksCalendarStory view="month" />,
}

/** Tasks register, week view. Tasks are all-day, so this exercises the all-day-gutter layout
 *  (TaskAllDayStrip) rather than the hourly time grid — the time grid is not used in this
 *  register at all. */
export const WeekWithTasks: Story = {
    render: () => <TasksCalendarStory view="week" />,
}
