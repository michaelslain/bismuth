// Visual spec for <CalendarView> — one Bases view kind with two registers, gated on
// `viewMode(result.view)`:
//   - "normal" (default, `mode`/`calendarContent` both absent) — the pre-existing
//     month/week/3day/day calendar UI, backed by an EventStore instead of the shared
//     `ViewResult`/`BaseConfig` pipeline the other 11 Bases views use. With no `basePath` it
//     runs against an in-memory `MemoryBackend` (no vault file, no rows) — the genuine state
//     an inline/unsaved calendar renders in. `CalendarView` itself mounts on `<CalendarFrame>`
//     (was `.calendar-app` from the now-deleted `calendar/Calendar.module.css`); every view
//     underneath it owns its own colocated module.
//   - "tasks" (`viewMode(result.view) === 'tasks'`) — renders `result`'s resolved rows, same
//     as every other row-based Bases view. No EventStore/backend involved at all, so a
//     `result`/`config` fixture is all these stories need to feed it (see `taskRow`/
//     `tasksViewResult` below). `TASKS_VIEW` below deliberately keeps the legacy
//     `calendarContent: 'tasks'` spelling rather than `mode: 'tasks'`, so this story doubles
//     as coverage that a base file written before `mode:` existed still renders the register.
//
// No component `.module.css` is imported here, per the "a story must not import a component's
// module" rule — every DOM query below goes through a `data-testid` (see the shared-hooks table
// in the plan's global constraints) or a computed style, never a class name.
import { onCleanup, onMount } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
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
        // Override for a resolved row whose real marker isn't `x` — a cancelled task
        // (`-`), which TaskChip still strikes through via `resolved`, not `status`.
        statusChar?: string
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
            statusChar: opts.statusChar ?? (opts.resolved ? 'x' : ' '),
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

/** 22 rows mirroring the repro vault: 12 unresolved + overdue ("carried" — rolled onto today
 *  by `placeRows`, late 1 through 23 days so the pile is deep enough to prove ordering and
 *  `renew passport` alone reaches the DenseNarrow stories' max), 3 placed on today itself
 *  (never carried), and 7 spread over the next 16 days (5 open, 1 done, 1 cancelled — none of
 *  which carry, since `placeRows` only rolls forward an UNRESOLVED row whose day has passed).
 *  `renew passport`/`pay rent`/`email ana`/`draft the roadmap` keep their original names so
 *  `MonthWithTasks`/`WeekWithTasks` below can still find them by exact title text. Dates are
 *  relative to the real `todayISO()` (not a fixed calendar date) so the carry is real
 *  regardless of when the story is opened — `placeRows` computes lateness against the actual
 *  clock. */
function tasksFixtureRows(): Row[] {
    const today = todayISO()
    const longTitle = (n: number) =>
        `follow up on the overdue item number ${n} — a long enough description that a squashed ` +
        'chip would clip it mid-word instead of showing it whole'

    // 12 carried, late 1..23 in steps of 2 (odd, so the max is exactly 23 — the value the
    // DenseNarrowMonth play asserts as the head of the sorted pile).
    const carriedLates = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]
    const carried = carriedLates.map((late, i) => {
        if (late === 1) return taskRow('pay rent', { line: i + 1, scheduled: addDaysISO(today, -late) })
        if (late === 23) return taskRow('renew passport', { line: i + 1, due: addDaysISO(today, -late) })
        return taskRow(longTitle(late), { line: i + 1, due: addDaysISO(today, -late) })
    })

    // 3 on today — never carried, since they are already on today, not before it.
    const onToday = [
        taskRow('email ana', { line: 50, scheduled: today }),
        taskRow('call the plumber', { line: 51, scheduled: today }),
        taskRow('review the pr', { line: 52, scheduled: today }),
    ]

    // 7 spread over the next 16 days — 5 open, 1 done, 1 cancelled. All placed on or after
    // today, so none of them ever carry regardless of resolved state.
    const spread = [
        taskRow('draft the roadmap', { line: 60, due: addDaysISO(today, 6) }),
        taskRow('renew the gym membership', { line: 61, scheduled: addDaysISO(today, 2) }),
        taskRow('book the dentist', { line: 62, scheduled: addDaysISO(today, 4) }),
        taskRow('file the expense report', { line: 63, due: addDaysISO(today, 9) }),
        taskRow('plan the offsite', { line: 64, scheduled: addDaysISO(today, 13) }),
        taskRow('renewed the lease', {
            line: 65,
            due: addDaysISO(today, 11),
            resolved: true,
        }),
        taskRow('cancelled the standing meeting', {
            line: 66,
            scheduled: addDaysISO(today, 16),
            resolved: true,
            statusChar: '-',
        }),
    ]

    return [...carried, ...onToday, ...spread]
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
        const cellOf = (el: HTMLElement) => el.closest('[data-testid="month-cell"]')
        const todayCell = cellOf(email.root!)
        expect(todayCell).toBeTruthy()
        expect(cellOf(passport.root!)).toBe(todayCell)
        expect(cellOf(rent.root!)).toBe(todayCell)

        // Carried vs not: the PAINTED border distinguishes them (TaskChip.module.css's
        // `.carried` sets `border: 1px solid var(--danger)`), not just the "Nd late" text — a
        // regression that dropped the class binding while leaving the text would still pass a
        // text-only check. Fails if `.carried` stops being applied to the two overdue chips,
        // or starts leaking onto the one placed on today itself.
        expect(getComputedStyle(passport.root!).borderTopStyle).toBe('solid')
        expect(getComputedStyle(rent.root!).borderTopStyle).toBe('solid')
        expect(getComputedStyle(email.root!).borderTopStyle).toBe('none')
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

        const cellOf = (el: HTMLElement) => el.closest('[data-testid="allday-cell"]')
        const todayCell = cellOf(email.root!)
        expect(todayCell).toBeTruthy()
        expect(cellOf(passport.root!)).toBe(todayCell)
        expect(cellOf(rent.root!)).toBe(todayCell)

        expect(getComputedStyle(passport.root!).borderTopStyle).toBe('solid')
        expect(getComputedStyle(rent.root!).borderTopStyle).toBe('solid')
        expect(getComputedStyle(email.root!).borderTopStyle).toBe('none')
    },
}

/** Copies of MonthView.stories.tsx's `assertChipsWhole`/`assertHeaderAligned` AS THEY EXIST
 *  NOW (month rows are `grid-auto-rows: auto` + `align-content: stretch`, not `1fr`) — cannot
 *  import them from another story file (a story must not import a component's module, and the
 *  same one-importer discipline applies to story-local helpers), so they are duplicated here
 *  rather than reached into MonthView.stories.tsx's private scope. */
function assertChipsWhole(canvasElement: HTMLElement, chipSelector: string) {
    const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell"]')]
    let seen = 0
    cells.forEach((cell, i) => {
        const cb = cell.getBoundingClientRect()
        cell.querySelectorAll<HTMLElement>(chipSelector).forEach(chip => {
            seen++
            const r = chip.getBoundingClientRect()
            // A squashed chip's box is shorter than its content (a few px box, ~22px content).
            expect(r.height, `chip in cell ${i} squashed`).toBeGreaterThanOrEqual(chip.scrollHeight - 1)
            expect(r.top, `chip in cell ${i} escapes top`).toBeGreaterThanOrEqual(cb.top - 1)
            expect(r.bottom, `chip in cell ${i} escapes bottom`).toBeLessThanOrEqual(cb.bottom + 1)
            expect(r.left).toBeGreaterThanOrEqual(cb.left - 1)
            expect(r.right).toBeLessThanOrEqual(cb.right + 1)
        })
    })
    expect(seen, 'no chips found — the assertion would be vacuous').toBeGreaterThan(0)
}

function assertHeaderAligned(canvasElement: HTMLElement) {
    const names = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-day-name"]')]
    const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell"]')].slice(0, 7)
    expect(names).toHaveLength(7)
    names.forEach((n, i) => {
        expect(Math.abs(cells[i].getBoundingClientRect().left - n.getBoundingClientRect().left), `col ${i}`).toBeLessThanOrEqual(1)
        expect(Math.abs(cells[i].getBoundingClientRect().width - n.getBoundingClientRect().width), `col ${i}`).toBeLessThanOrEqual(1)
    })
}

/** D1/D2 regression, narrowest measured width, MONTH shape: today's cell carries all 12
 *  overdue rows (late 1..23) on top of the 3 placed on today itself, while the rest of the
 *  visible month stays quiet with the 7 future-spread rows — at 460px, the narrowest width the
 *  header/cell alignment drift was measured at (see TaskAllDayStrip.stories.tsx's
 *  `DenseNarrow`). Proves the busy week grows to fit every chip whole, the header stays
 *  column-aligned while the grid scrolls, and the carried pile is ordered worst-first so a
 *  23-day-late task isn't buried under recent ones. */
export const DenseNarrowMonth: Story = {
    render: () => (
        <div style={{ width: '460px', height: '640px' }}>
            <TasksCalendarStory view="month" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        assertChipsWhole(canvasElement, ':has(> [data-testid="task-chip-title"])')
        assertHeaderAligned(canvasElement)
        const scroller = canvasElement.querySelector<HTMLElement>('[data-testid="month-scroller"]')!
        // 15 chips packed into today's cell at 460px MUST overflow, or the alignment check
        // above proved nothing about a grid that's actually scrolling.
        expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)

        const todayCell = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell"]')]
            .find(c => c.querySelector('[data-testid="task-chip-title"]')?.parentElement?.textContent?.includes('d late'))!
        const lates = [...todayCell.querySelectorAll('[data-testid="task-chip-title"]')]
            .map(t => Number(t.parentElement!.textContent!.match(/(\d+)d late/)?.[1] ?? 0))
        expect(lates).toEqual([...lates].sort((a, b) => b - a))
        expect(lates[0]).toBe(23)
    },
}

/** D1 regression, narrowest measured width, WEEK shape — Task 8 Step 1's alignment +
 *  containment loop (TaskAllDayStrip.stories.tsx's `DenseNarrow`), run against the real
 *  tasks-register fixture instead of a synthetic `placed` map: every day header stays aligned
 *  with its all-day cell directly below it, and every chip stays inside its own day's column,
 *  even with today's column forced far wider than an equal 1/7th share by 15 stacked chips. */
export const DenseNarrowWeek: Story = {
    render: () => (
        <div style={{ width: '460px', height: '640px' }}>
            <TasksCalendarStory view="week" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const heads = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="day-header"]')]
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="allday-cell"]')]
        expect(heads).toHaveLength(7)
        expect(cells).toHaveLength(7)
        heads.forEach((h, i) => {
            const a = h.getBoundingClientRect()
            const b = cells[i].getBoundingClientRect()
            expect(Math.abs(b.left - a.left), `day ${i} left edge`).toBeLessThanOrEqual(1)
            expect(Math.abs(b.width - a.width), `day ${i} width`).toBeLessThanOrEqual(1)
        })
        // every chip stays inside its own day's column
        cells.forEach((c, i) => {
            const cb = c.getBoundingClientRect()
            c.querySelectorAll<HTMLElement>('[data-testid="task-chip-title"]').forEach(t => {
                const r = t.parentElement!.getBoundingClientRect()
                expect(r.left, `chip in day ${i}`).toBeGreaterThanOrEqual(cb.left - 1)
                expect(r.right, `chip in day ${i}`).toBeLessThanOrEqual(cb.right + 1)
            })
        })
    },
}
