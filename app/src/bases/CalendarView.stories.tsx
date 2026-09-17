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
//     `result`/`config` fixture is all these stories need to feed it (see the imported
//     `taskRow` helper and `tasksViewResult` below). `TASKS_VIEW` below deliberately keeps the legacy
//     `calendarContent: 'tasks'` spelling rather than `mode: 'tasks'`, so this story doubles
//     as coverage that a base file written before `mode:` existed still renders the register.
//
// No component `.module.css` is imported here, per the "a story must not import a component's
// module" rule — every DOM query below goes through a `data-testid` (a fixed, shared contract —
// `day-header`/`month-cell`/`month-day-name`/etc., defined once by the component that owns each
// element) or a computed style, never a class name.
import { createSignal, onCleanup, onMount } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { CalendarView } from './CalendarView'
import { currentDate, currentView, events, categories } from '../calendar/state'
import type { CalendarEvent, Category } from '../calendar/types'
import type { Row, ViewResult, BaseConfig, ViewConfig } from '../../../core/src/bases/types'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import { assertChipsWhole, assertHeaderAligned, taskRow } from '../ui/_calendarAssertions'
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'

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

/** Narrowest measured width, MONTH shape: today's cell carries all 12
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

/** Narrowest measured width, WEEK shape — the same alignment + containment loop
 *  (TaskAllDayStrip.stories.tsx's `DenseNarrow`), run against the real
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

// ---- result reconciliation (placeRows(prev)) -------------------------------------------

/** Renders the tasks register off a local `result` signal (unlike `TasksCalendarStory`'s fixed
 *  prop) with a button that pushes a second `ViewResult`: `bravo`'s row object is replaced
 *  (`resolved` flipped) while `alpha` and `charlie` keep their EXACT object — the same shape a
 *  real toggle-driven refetch produces (`reconcileViewResult` only replaces the row that
 *  changed).
 */
function ReconcileStory() {
    const prevView = currentView.value
    const prevDate = currentDate.value
    onMount(() => {
        currentView.value = 'month'
        currentDate.value = new Date()
    })
    onCleanup(() => {
        currentView.value = prevView
        currentDate.value = prevDate
    })

    const today = todayISO()
    const alpha = taskRow('alpha', { line: 1, scheduled: today })
    const bravo = taskRow('bravo', { line: 2, scheduled: today })
    const charlie = taskRow('charlie', { line: 3, scheduled: today })
    const [result, setResult] = createSignal<ViewResult>(tasksResult([alpha, bravo, charlie]))

    const flip = () => {
        const bravoResolved = taskRow('bravo', { line: 2, scheduled: today, resolved: true })
        setResult(tasksResult([alpha, bravoResolved, charlie]))
    }

    return (
        <div>
            <button type="button" data-testid="flip-bravo" onClick={flip}>
                flip bravo
            </button>
            <CalendarView result={result()} config={TASKS_BASE_CONFIG} />
        </div>
    )
}

/** Proves task chips keep their DOM identity across a `result` update where only one row
 *  changed — the fix for the flicker this plan's diagnosis found in `placeRows` (it rebuilt
 *  EVERY `PlacedTask` on every recompute, so `<For>` remounted every chip even though
 *  `reconcileViewResult` had kept the untouched rows' objects identical). RED without wiring
 *  `prev` through `TasksCalendar`'s `placed` memo: `alpha`'s and `charlie`'s chip-title nodes
 *  are replaced by the flip even though neither row changed.
 */
export const ReconcilePreservesUnchangedChips: Story = {
    render: () => <ReconcileStory />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const chipsByTitle = () =>
            new Map(
                Array.from(
                    canvasElement.querySelectorAll<HTMLElement>(
                        '[data-testid="task-chip-title"]',
                    ),
                ).map(el => [el.textContent, el.parentElement as HTMLElement]),
            )

        const before = chipsByTitle()
        expect(before.size, 'three chips rendered before the flip').toBe(3)

        await fireEvent.click(canvas.getByTestId('flip-bravo'))

        await waitFor(() => {
            const bravoRoot = chipsByTitle().get('bravo')!
            expect(bravoRoot.getAttribute('aria-label')).toContain('done')
        })

        const after = chipsByTitle()
        expect(after.size).toBe(3)

        // alpha and charlie did not change — same chip root element, still connected.
        for (const title of ['alpha', 'charlie']) {
            const prevRoot = before.get(title)!
            const nextRoot = after.get(title)!
            expect(prevRoot.isConnected, `${title} old node still connected`).toBe(true)
            expect(nextRoot, `${title} same node reused`).toBe(prevRoot)
        }

        // bravo DID change — a fresh node for it is fine, but it must reflect the new state.
        expect(after.get('bravo')!.getAttribute('aria-label')).toContain('done')
    },
}

// ---- category colours + the cell composer -----------------------------------------------

/** Three rows from three different SOURCE notes (`file.name`), each on today — `taskCategory.ts`
 *  rule 2: a SCANNED row's (`note.line` is a number, same as every `taskRow` fixture) category is
 *  its source note's basename, with no `categoryField` declared on this view. Distinct sources are
 *  therefore distinct categories, so `TasksCalendar`'s `colorFor` should paint each chip's marker a
 *  different colour (`autoCategoryColor`'s stable hash — no `categories:` declared on
 *  `TASKS_BASE_CONFIG`, so every one of the three is auto-assigned). */
function sourcedFrom(row: Row, name: string): Row {
    return { ...row, file: { ...row.file, name, basename: name, path: `${name}.md` } }
}

function coloredTasksRows(): Row[] {
    const today = todayISO()
    return [
        sourcedFrom(taskRow('email ana', { line: 1, scheduled: today }), 'Inbox'),
        sourcedFrom(taskRow('renew passport', { line: 2, scheduled: today }), 'Errands'),
        sourcedFrom(taskRow('draft the roadmap', { line: 3, scheduled: today }), 'Work'),
    ]
}

// The marker's category colour, read from the INLINE style (never getComputedStyle) so an
// uncategorised marker reads as '' rather than whatever --text-muted resolves to.
function markerColor(root: HTMLElement): string {
    const el = root.querySelector('[data-testid="task-chip-marker"]') as HTMLElement | null
    return el?.style.color ?? ''
}

/** Seeds `currentView`/`currentDate` the same way `TasksCalendarStory` does, but with the
 *  3-source `coloredTasksRows()` fixture instead of the 22-row carried-pile one — that fixture
 *  puts every row through the SAME source note (`taskRow`'s fixed `file.name: 'tasks'`), so it
 *  cannot exercise per-category colour at all. */
function ColoredTasksStory() {
    const prevView = currentView.value
    const prevDate = currentDate.value
    onMount(() => {
        currentView.value = 'month'
        currentDate.value = new Date()
    })
    onCleanup(() => {
        currentView.value = prevView
        currentDate.value = prevDate
    })
    return (
        <CalendarView
            result={tasksResult(coloredTasksRows())}
            config={TASKS_BASE_CONFIG}
        />
    )
}

export const TasksWithCategoryColours: Story = {
    render: () => <ColoredTasksStory />,
    play: async ({ canvasElement }) => {
        const chips = [
            findChip(canvasElement, 'email ana'),
            findChip(canvasElement, 'renew passport'),
            findChip(canvasElement, 'draft the roadmap'),
        ]
        chips.forEach((c, i) =>
            expect(c.title, `chip ${i} rendered`).toBeTruthy(),
        )
        const colors = chips.map(c => markerColor(c.root!))
        colors.forEach((c, i) => expect(c, `chip ${i} has a marker colour`).not.toBe(''))
        // At least two of the three differ — a stable per-name hash makes the same source
        // always the same colour, so three DIFFERENT sources landing on the same colour would
        // mean colours aren't being looked up per-category at all.
        expect(new Set(colors).size, 'not every chip got the same colour').toBeGreaterThan(1)
    },
}

/** Clicking an empty day cell opens that cell's composer (`TaskComposeProps.open`, wired by
 *  MonthView) instead of doing nothing — the FIRST half of "super jank": there used to be no
 *  way to start a task from the grid at all. Targets a cell with no chips in it so the
 *  composer's own markup isn't lost among 15 stacked chips. */
export const TasksComposerOpen: Story = {
    render: () => <TasksCalendarStory view="month" />,
    play: async ({ canvasElement }) => {
        const cells = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="month-cell"]',
            ),
        ]
        const quiet = cells.find(
            c => !c.querySelector('[data-testid="task-chip-title"]'),
        )!
        await fireEvent.click(quiet)
        await waitFor(() => {
            const input = quiet.querySelector(
                'input, textarea, [contenteditable="true"], [role="textbox"]',
            )
            expect(input, 'composer input opened in the clicked cell').toBeTruthy()
        })
    },
}

/** The write itself: open the composer in a day cell, type, press Enter, and read the note back
 *  — the committed line carries the description FIRST with the day appended, never the old blank
 *  `[scheduled <day>]`. `_fakeTransport.ts` implements `POST /tasks/create` (mirroring
 *  core/src/taskCreate.ts's resolution + append rules), so this asserts the real bytes rather
 *  than spying on `api.createTask`. Replaces Toolbar.stories.tsx's deleted
 *  `ClickingCreatesTaskLineInTaskFile`, which proved the same bytes through the deleted button —
 *  this is that proof restored, through the composer instead. */
export const TasksCommitsTaskLineInTaskFile: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { 'Inbox.md': '- [ ] existing\n' } }))
        const prevView = currentView.value
        const prevDate = currentDate.value
        onMount(() => {
            currentView.value = 'month'
            currentDate.value = new Date()
        })
        onCleanup(() => {
            currentView.value = prevView
            currentDate.value = prevDate
        })
        const view: ViewConfig = { ...TASKS_VIEW, taskFile: '[[Inbox]]' }
        return (
            <CalendarView
                basePath="cal.md"
                result={{ ...tasksResult([]), view }}
                config={TASKS_BASE_CONFIG}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const cells = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="month-cell"]',
            ),
        ]
        const quiet = cells.find(
            c => !c.querySelector('[data-testid="task-chip-title"]'),
        )!
        await userEvent.click(quiet)
        const input = await waitFor(() => {
            const el = quiet.querySelector<HTMLInputElement>(
                '[data-testid="task-cell-composer-input"]',
            )
            expect(el, 'composer opened').not.toBeNull()
            return el!
        })
        await userEvent.type(input, 'buy milk{Enter}')
        const text = await waitFor(async () => {
            const t = await api.read('Inbox.md')
            expect(t, 'new line written to Inbox.md').toContain('buy milk')
            return t
        })
        // the existing line survives
        expect(text).toContain('- [ ] existing')
        // description FIRST and non-empty, day appended — the "jank" this plan fixes.
        expect(text).toMatch(/- \[ \] buy milk \[scheduled \d{4}-\d{2}-\d{2}\]/)
    },
}
