// Visual spec for <MonthView> — the month grid (a Bases "calendar" view kind, rendered by
// app/src/bases/CalendarView.tsx when currentView === 'month'). Like every view under
// calendar/components/views/ except TimeGrid, it takes only a `store` prop (plus, in the tasks
// register, a `placed` map) — events/categories/currentDate come from calendar/state.ts
// module-level signals (see app/src/ui/_calendarFixtures.ts). MonthView owns its own
// MonthView.module.css (2026-09-13) — nothing here imports Calendar.module.css.
import { createSignal, onCleanup } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { settings } from '../../state'
import { encodeTaskDrag, TASK_DRAG_MIME } from '../../taskDrag'
import type { JSX } from 'solid-js'
import { MonthView } from './MonthView'
import { EventStore, MemoryBackend } from '../../EventStore'
import CalendarFrame from '../CalendarFrame'
import { seedCalendarState } from '../../../ui/_calendarFixtures'
import { whenAsciiGlyphTilesInstalled } from '../../../ui/ascii/asciiGlyphTiles'
import { currentDate } from '../../state'
import { placeRows } from '../../taskPlacement'
import type { PlacedTask } from '../../taskPlacement'
import { todayISO, addDaysISO } from '../../../../../core/src/dates'
import type { Row } from '../../../../../core/src/bases/types'
import { EMPTY_FILE } from '../../../../../core/src/bases/types'
import {
    assertChipsWhole,
    assertHeaderAligned,
    taskRow,
} from '../../../ui/_calendarAssertions'

// Fixed px, NOT a vh unit: Storybook's preview iframe is only ~315px tall with the Controls
// panel open, so 80vh resolved to 252px — which clipped the month grid's last two week rows and
// cut event chips mid-text. These views need a flex ancestor with real height; the app gives them
// the window, so a story has to state one.
const STORY_H = '760px'

const meta = {
    title: 'Calendar/MonthView',
    component: MonthView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MonthView>

export default meta
type Story = StoryObj<typeof meta>

// Derived corners: a corner exists where both of its edges are drawn, and `data-edges` (the
// primitive's runtime hook) is the contract the count reads.
const corners = (root: ParentNode, v: 'top' | 'bottom', h: 'left' | 'right') =>
    root.querySelectorAll(`[data-edges~="${v}"][data-edges~="${h}"]`).length

const anchor = new Date(2026, 0, 12)

/** The standard sample events (timed events, an all-day event, a two-category gradient
 *  chip) spread across the anchor week. */
export const Default: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <MonthView store={new EventStore(new MemoryBackend())} />
                </CalendarFrame>
            </div>
        )
    },
    // The grid is typed, closed on all four sides, each boundary typed by exactly one cell:
    // header + body cells each type a top-left `+`, except the first body row (the header's heavy
    // `=` is its top); the right column adds top-right, the last row adds bottom-right.
    play: async ({ canvasElement }) => {
        const cells = canvasElement.querySelectorAll('[data-testid="month-cell"]').length
        const rows = cells / 7
        const n = (v: 'top' | 'bottom', h: 'left' | 'right') => corners(canvasElement, v, h)
        // the seven weekday header cells each type their bottom heavy: the `=` under the labels
        const names = [
            ...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-day-name"]'),
        ]
        expect(names).toHaveLength(7)
        names.forEach(nm =>
            expect(nm.parentElement!.querySelector('[data-heavy~="bottom"]')).toBeTruthy(),
        )
        expect(canvasElement.querySelectorAll('[data-heavy~="bottom"]')).toHaveLength(7)
        expect(n('top', 'left')).toBe(7 + 7 * (rows - 1))
        expect(n('top', 'right')).toBe(rows)
        expect(n('bottom', 'left')).toBe(14) // the header's heavy underline + the last row, one per column
        expect(n('bottom', 'right')).toBe(2) // the header's last column + the grid's last cell
        // the header is one typed row: tall enough for a whole `|` between its corners (corner
        // halves + one vertical pitch, --ascii-row-h), and no taller than a table header's row —
        // not the old two line boxes, which left the weekday names floating
        const head = canvasElement
            .querySelector<HTMLElement>('[data-testid="month-day-name"]')!
            .parentElement!.getBoundingClientRect()
        await whenAsciiGlyphTilesInstalled()
        const rootCs = getComputedStyle(document.documentElement)
        const rowH = parseFloat(rootCs.getPropertyValue('--ascii-row-h'))
        const control = parseFloat(rootCs.getPropertyValue('--h-control'))
        expect(rowH, 'the glyph tiles are installed').toBeGreaterThan(0)
        expect(head.height).toBeGreaterThanOrEqual(rowH - 0.5)
        expect(head.height).toBeLessThanOrEqual(Math.max(rowH, control) + 0.5)
    },
}

/** One day packed with six events, to see how the month grid handles a dense day — the
 *  week-row grows to fit every chip at full height instead of squashing them. */
export const DenseDay: Story = {
    render: () => {
        const day = '2026-01-14'
        seedCalendarState({
            date: anchor,
            categories: [
                { name: 'Work', color: 'blue' },
                { name: 'Personal', color: 'rose' },
            ],
            events: Array.from({ length: 6 }, (_, i) => ({
                id: `dense-${i}`,
                title: `Meeting ${i + 1}`,
                date: day,
                startTime: `${String(9 + i).padStart(2, '0')}:00`,
                endTime: `${String(9 + i).padStart(2, '0')}:30`,
                category: i % 2 === 0 ? 'Work' : 'Personal',
            })),
        })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <MonthView store={new EventStore(new MemoryBackend())} />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await new Promise(r => setTimeout(r, 100)) // the story seeds state on a 50ms timer
        assertChipsWhole(canvasElement, '[data-testid="event-chip"]')
        assertHeaderAligned(canvasElement)
    },
}

/** The user's screenshot: a busy today carrying a dozen overdue tasks plus a handful placed on
 *  today itself, while the rest of the month stays quiet. Dates are relative to the real
 *  `todayISO()` (not a fixed calendar date), so the dense cell lands on TODAY regardless of when
 *  the story is opened — `placeRows` computes carry-forward against the actual clock. */
export const DenseTasks: Story = {
    render: () => {
        // Restored in onCleanup, same shape DateNav.stories.tsx's navClickToToday uses —
        // without it, setting the real clock date here leaks into whichever story renders
        // next and pins its own fixed date.
        const prevDate = currentDate.value
        currentDate.value = new Date()
        onCleanup(() => {
            currentDate.value = prevDate
        })
        const today = todayISO()
        const rows: Row[] = [
            ...Array.from({ length: 12 }, (_, i) =>
                taskRow(
                    `follow up on the overdue item number ${i + 1} — a long enough description ` +
                        'that a squashed 6px chip would clip it mid-word instead of showing it whole',
                    { line: i + 1, due: addDaysISO(today, -(i * 2 + 1)) },
                ),
            ),
            ...Array.from({ length: 4 }, (_, i) =>
                taskRow(`today task ${i + 1}`, {
                    line: 100 + i,
                    scheduled: today,
                }),
            ),
            taskRow('a quiet task in three days', {
                line: 200,
                scheduled: addDaysISO(today, 3),
            }),
            taskRow('a quiet task in five days', {
                line: 201,
                scheduled: addDaysISO(today, 5),
            }),
            taskRow('a quiet task in nine days', {
                line: 202,
                scheduled: addDaysISO(today, 9),
            }),
        ]
        const placed = placeRows(rows, today)
        return (
            <div style={{ width: '720px', height: '560px' }}>
                <CalendarFrame>
                    <MonthView
                        store={new EventStore(new MemoryBackend())}
                        placed={placed}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const chips = '[data-testid="task-chip-title"]'
        // assert on the chip ROOT (the title's parent), which is what squashed
        assertChipsWhole(canvasElement, `:has(> ${chips})`)
        assertHeaderAligned(canvasElement)
        const scroller = canvasElement.querySelector<HTMLElement>(
            '[data-testid="month-scroller"]',
        )!
        // the dense month MUST overflow, or the header-alignment-while-scrolling check above proved nothing
        expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
        // the busy week grew; a quiet week did not
        const cells = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="month-cell"]',
            ),
        ]
        const heights = cells.map(c =>
            Math.round(c.getBoundingClientRect().height),
        )
        expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights) * 2)
    },
}

/** No carried/overdue tasks at all — rows should fill the pane evenly instead of leaving the
 *  bottom empty, and today's number should still keep its accent circle. */
export const QuietTasks: Story = {
    render: () => {
        // Restored in onCleanup, same shape DateNav.stories.tsx's navClickToToday uses —
        // without it, setting the real clock date here leaks into whichever story renders
        // next and pins its own fixed date.
        const prevDate = currentDate.value
        currentDate.value = new Date()
        onCleanup(() => {
            currentDate.value = prevDate
        })
        const today = todayISO()
        // Descriptions stay short (single word) on purpose: this story's assertion is that
        // QUIET rows are all the same height, and the title now wraps onto as many lines as it
        // needs (Task 1: full wrap, no clamp) — a longer description would legitimately wrap to
        // a different line count at this column width and make the rows unequal for a reason
        // that has nothing to do with "quiet vs dense".
        const rows: Row[] = [
            taskRow('email', { line: 1, scheduled: today }),
            taskRow('roadmap', { line: 2, scheduled: addDaysISO(today, 2) }),
            taskRow('lease', { line: 3, scheduled: addDaysISO(today, 4) }),
        ]
        const placed = placeRows(rows, today)
        return (
            <div style={{ width: '720px', height: '560px' }}>
                <CalendarFrame>
                    <MonthView
                        store={new EventStore(new MemoryBackend())}
                        placed={placed}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const scroller = canvasElement.querySelector<HTMLElement>(
            '[data-testid="month-scroller"]',
        )!
        const cells = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="month-cell"]',
            ),
        ]
        expect(scroller.scrollHeight).toBeLessThanOrEqual(
            scroller.clientHeight + 1,
        )
        const last = cells[cells.length - 1].getBoundingClientRect()
        // the scroller pads its bottom by half a line box, room for the last row's typed `-`
        const padBottom = parseFloat(getComputedStyle(scroller).paddingBottom)
        expect(padBottom).toBeGreaterThan(0)
        expect(
            Math.abs(
                last.bottom - (scroller.getBoundingClientRect().bottom - padBottom),
            ),
        ).toBeLessThanOrEqual(2)
        const heights = new Set(
            cells.map(c => Math.round(c.getBoundingClientRect().height)),
        )
        expect(heights.size).toBeLessThanOrEqual(2) // equal rows (±1px rounding)
        // today's number keeps the circle's colour even though MonthView merges its own muted class onto
        // it — fails if DayNumber's `.root.today` specificity is ever lowered. The comparison number is
        // whatever in-month, non-today day happens to render first (full opacity, i.e. not a dimmed
        // leading/trailing-month spillover) — never a hardcoded day-of-month that could collide with
        // today's own real date.
        const numbers = cells.map(c => c.firstElementChild as HTMLElement)
        const todayCircle = numbers.find(
            n => Math.round(n.getBoundingClientRect().width) === 20,
        )!
        const other = numbers.find(
            n => n !== todayCircle && getComputedStyle(n).opacity === '1',
        )!
        expect(getComputedStyle(todayCircle).color).not.toBe(
            getComputedStyle(other).color,
        )
    },
}
/** Minimal PlacedTask fixture for the transition stories below, matching
 *  TaskAllDayStrip.stories.tsx's own `task()` helper — these stories only need a task that
 *  renders one chip, not a real markdown-backed row. */
function placedTask(
    description: string,
    placed: string,
    late: number,
): PlacedTask {
    return {
        row: {
            file: {
                ...EMPTY_FILE,
                name: 'tasks',
                basename: 'tasks',
                path: 'tasks.md',
            },
            note: { description, placed, resolved: false },
            formula: {},
        },
        placed,
        late,
    }
}

/** Clicking a bare cell in the TASKS register opens the inline composer for that day — proven
 *  directly against MonthView's OWN click-wiring, which is separate code from
 *  TaskAllDayStrip's (the month grid never delegates to it). */
export const ComposerOpensOnCellClick: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <MonthView
                        store={new EventStore(new MemoryBackend())}
                        placed={new Map()}
                        compose={{
                            date: openDate(),
                            destination: 'General Tasks',
                            targets: [],
                            target: '',
                            setTarget: () => {},
                            open: d => setOpenDate(d),
                            commit: () => setOpenDate(null),
                            cancel: () => setOpenDate(null),
                        }}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const cells = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="month-cell"]',
            ),
        ]
        expect(cells.length).toBeGreaterThan(20)
        expect(
            cells[10].querySelector('[data-testid="task-cell-composer-input"]'),
        ).toBeNull()
        await userEvent.click(cells[10])
        await new Promise(r => setTimeout(r, 0))
        expect(
            cells[10].querySelector('[data-testid="task-cell-composer-input"]'),
        ).not.toBeNull()
    },
}

/** Open on one day, then click a different day — the FIRST cell's composer must actually close,
 *  not merely leave a second one also open. */
export const ComposerMovesBetweenCells: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <MonthView
                        store={new EventStore(new MemoryBackend())}
                        placed={new Map()}
                        compose={{
                            date: openDate(),
                            destination: 'General Tasks',
                            targets: [],
                            target: '',
                            setTarget: () => {},
                            open: d => setOpenDate(d),
                            commit: () => setOpenDate(null),
                            cancel: () => setOpenDate(null),
                        }}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const cells = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="month-cell"]',
            ),
        ]
        await userEvent.click(cells[10])
        await new Promise(r => setTimeout(r, 0))
        expect(
            cells[10].querySelector('[data-testid="task-cell-composer-input"]'),
        ).not.toBeNull()
        await userEvent.click(cells[11])
        await new Promise(r => setTimeout(r, 0))
        // the FIRST cell's composer is GONE — not merely a second one also present
        expect(
            cells[10].querySelector('[data-testid="task-cell-composer-input"]'),
        ).toBeNull()
        expect(
            cells[11].querySelector('[data-testid="task-cell-composer-input"]'),
        ).not.toBeNull()
    },
}

/** Task 2 (discoverable add): a quiet `+` sits in the top-right corner of every tasks-register
 *  cell, invisible until the cell is hovered or a control inside it holds focus — otherwise this
 *  is the finding the whole plan started from ("there is no way to add a task"), just moved from
 *  "click empty space" to "click a labelled button", so the affordance must actually be there to
 *  find. Proves it's present, quiet at rest, revealed on hover, and opens the SAME composer a
 *  bare cell click does. */
export const AddTaskButtonReveals: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <MonthView
                        store={new EventStore(new MemoryBackend())}
                        placed={new Map()}
                        compose={{
                            date: openDate(),
                            destination: 'General Tasks',
                            targets: [],
                            target: '',
                            setTarget: () => {},
                            open: d => setOpenDate(d),
                            commit: () => setOpenDate(null),
                            cancel: () => setOpenDate(null),
                        }}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const cells = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="month-cell"]',
            ),
        ]
        const cell = cells[10]
        const button = cell.querySelector<HTMLElement>(
            '[aria-label="Add task"]',
        )!
        expect(button).not.toBeNull()
        // quiet at rest
        expect(getComputedStyle(button).opacity).toBe('0')
        // Real pointer hover isn't reliably reproducible through synthetic events in this
        // runner, so this proves the OTHER half of "quiet by default, reachable by keyboard":
        // giving the button itself real DOM focus reveals it via `.month-cell:focus-within`,
        // which is unconditional on HOW focus arrived (unlike `:hover`, which needs a real
        // pointer move) — this is exactly the path a keyboard user tabbing through the grid
        // takes.
        button.focus()
        // the opacity change is CSS-transitioned (`--dur`), so the computed value right after
        // triggering it is still mid-transition — wait past the transition before reading it.
        await new Promise(r => setTimeout(r, 200))
        expect(getComputedStyle(button).opacity).toBe('1')
        await userEvent.click(button)
        await new Promise(r => setTimeout(r, 0))
        expect(
            cell.querySelector('[data-testid="task-cell-composer-input"]'),
        ).not.toBeNull()
    },
}

/** The whole add-a-task loop with REAL state, so it can be tried by hand: `+` (or a click on
 *  empty cell space) opens the composer, the `→` picker switches which note the task goes to,
 *  Enter adds a chip in that note's colour and keeps the composer open for the next one. The
 *  rows live in a signal here, standing in for the vault write + refetch the real calendar does
 *  (`CalendarView.tsx`'s commitTask), which Storybook's fake transport cannot persist. */
export const AddTasksToACategory: Story = {
    render: () => {
        const today = todayISO()
        seedCalendarState({ date: new Date(`${today}T12:00:00`) })
        const notes = [
            {
                id: 'tasks/General Tasks.md',
                label: 'General Tasks',
                color: 'var(--blue)',
            },
            {
                id: 'tasks/MATH 128A Tasks.md',
                label: 'MATH 128A Tasks',
                color: 'var(--rose)',
            },
            {
                id: 'tasks/HIST 100 Tasks.md',
                label: 'HIST 100 Tasks',
                color: 'var(--green)',
            },
        ]
        const fileOf = (id: string) => {
            const n = notes.find(x => x.id === id)!
            return {
                ...EMPTY_FILE,
                name: n.label,
                basename: n.label,
                path: n.id,
            }
        }
        const [rows, setRows] = createSignal<Row[]>([
            {
                ...taskRow('problem set 3', { line: 0, scheduled: today }),
                file: fileOf(notes[1].id),
            },
        ])
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        const [target, setTarget] = createSignal(notes[0].id)
        const placed = () => placeRows(rows(), today)
        const colorOf = (t: PlacedTask) =>
            notes.find(n => n.id === t.row.file.path)?.color
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <MonthView
                        store={new EventStore(new MemoryBackend())}
                        placed={placed()}
                        colorFor={colorOf}
                        compose={{
                            date: openDate(),
                            destination: notes.find(n => n.id === target())!
                                .label,
                            color: notes.find(n => n.id === target())!.color,
                            targets: notes,
                            target: target(),
                            setTarget,
                            open: d => setOpenDate(d),
                            commit: (date, text) =>
                                setRows(r => [
                                    ...r,
                                    {
                                        ...taskRow(text, {
                                            line: r.length,
                                            scheduled: date,
                                        }),
                                        file: fileOf(target()),
                                    },
                                ]),
                            cancel: () => setOpenDate(null),
                        }}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const cell = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="month-cell"]',
            ),
        ].find(c => !!c.querySelector('[role="button"]'))!
        await userEvent.click(
            cell.querySelector<HTMLElement>('[aria-label="Add task"]')!,
        )
        await new Promise(r => setTimeout(r, 0))
        const trigger = cell.querySelector<HTMLElement>(
            '[data-select-trigger]',
        )!
        await userEvent.click(trigger)
        const option = [
            ...document.body.querySelectorAll<HTMLElement>('*'),
        ].find(
            e =>
                e.children.length === 0 &&
                e.textContent?.trim() === 'HIST 100 Tasks',
        )!
        await userEvent.click(option)
        await new Promise(r => setTimeout(r, 0))
        expect(trigger.textContent).toContain('HIST 100 Tasks')
        // the composer survived the pick, and focus went back to the input
        const input = cell.querySelector<HTMLInputElement>(
            '[data-testid="task-cell-composer-input"]',
        )!
        expect(document.activeElement).toBe(input)
        await userEvent.type(input, 'read chapter 4{Enter}')
        await new Promise(r => setTimeout(r, 0))
        expect(cell.textContent).toContain('read chapter 4')
    },
}

/** TaskChip already stops its own click from bubbling — clicking a chip must open its note
 *  (onOpenTask) and must never also open the month cell's composer underneath it. */
export const ChipClickDoesNotOpenComposer: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        const [openedCount, setOpenedCount] = createSignal(0)
        const placed = new Map([
            ['2026-01-14', [placedTask('write the report', '2026-01-14', 0)]],
        ])
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <MonthView
                        store={new EventStore(new MemoryBackend())}
                        placed={placed}
                        onOpenTask={() => setOpenedCount(c => c + 1)}
                        compose={{
                            date: openDate(),
                            destination: 'General Tasks',
                            targets: [],
                            target: '',
                            setTarget: () => {},
                            open: d => setOpenDate(d),
                            commit: () => setOpenDate(null),
                            cancel: () => setOpenDate(null),
                        }}
                    />
                </CalendarFrame>
                <div data-testid="opened-count">{openedCount()}</div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-title"]',
        )!
        await userEvent.click(title)
        await new Promise(r => setTimeout(r, 0))
        expect(
            canvasElement.querySelector('[data-testid="opened-count"]')!
                .textContent,
        ).toBe('1')
        expect(
            canvasElement.querySelector(
                '[data-testid="task-cell-composer-input"]',
            ),
        ).toBeNull()
    },
}

/** A month cell with BOTH real task chips and an open composer — the composer must render LAST,
 *  after every chip, inside `month-cell-events`, never in front of or between them.
 *  `compose.color` is also set here (the view's resolved defaultCategory colour), so this
 *  doubles as proof that the colour actually reaches TaskCellComposer's marker — a prop
 *  CalendarView already populates but neither grid wired through until this fix. */
export const ComposerBelowChips: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        const placed = new Map([
            [
                '2026-01-14',
                [
                    placedTask('renew passport', '2026-01-01', 13),
                    placedTask('pay rent', '2026-01-08', 6),
                ],
            ],
        ])
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <MonthView
                        store={new EventStore(new MemoryBackend())}
                        placed={placed}
                        compose={{
                            date: '2026-01-14',
                            destination: 'General Tasks',
                            color: 'var(--blue)',
                            targets: [],
                            target: '',
                            setTarget: () => {},
                            open: () => {},
                            commit: () => {},
                            cancel: () => {},
                        }}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const boxes = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="month-cell-events"]',
            ),
        ]
        const box = boxes.find(b =>
            b.querySelector('[data-testid="task-chip-title"]'),
        )!
        const children = [...box.children]
        expect(children.length).toBe(3) // 2 chips + the composer
        expect(
            children[0].querySelector('[data-testid="task-chip-title"]'),
        ).not.toBeNull()
        expect(
            children[1].querySelector('[data-testid="task-chip-title"]'),
        ).not.toBeNull()
        // the composer is LAST — proves it never displaces the chips above it
        const composer = children[2]
        expect(
            composer.querySelector('[data-testid="task-cell-composer-marker"]'),
        ).not.toBeNull()
        expect(
            composer.querySelector('[data-testid="task-chip-title"]'),
        ).toBeNull()
        // the colour reaches the marker itself, as an inline style carrying the exact design
        // token, not a hardcoded stand-in colour
        const marker = composer.querySelector<HTMLElement>(
            '[data-testid="task-cell-composer-marker"]',
        )!
        expect(marker.style.color).toBe('var(--blue)')
    },
}

function WithWeekStart(props: { monday: boolean; children: JSX.Element }) {
    const prev = settings.value
    settings.value = { ...prev, weekStartsOnMonday: props.monday }
    onCleanup(() => {
        settings.value = prev
    })
    return <>{props.children}</>
}

/** `calendar.weekStartsOnMonday` reorders the weekday header AND shifts the grid, so a month
 *  that starts on a Tuesday leads with one spill day, not two. */
export const WeekStartsOnMonday: Story = {
    render: () => {
        seedCalendarState({ date: new Date(2026, 8, 15), events: [] })
        return (
            <WithWeekStart monday>
                <div style={{ height: '520px' }}>
                    <CalendarFrame>
                        <MonthView store={new EventStore(new MemoryBackend())} />
                    </CalendarFrame>
                </div>
            </WithWeekStart>
        )
    },
    play: async ({ canvasElement }) => {
        const names = within(canvasElement).getAllByTestId('month-day-name').map(n => n.textContent)
        expect(names[0]).toBe('Mon')
        expect(names[6]).toBe('Sun')
        // 1 Sept 2026 is a Tuesday: exactly one leading spill day on a Monday-first grid
        const cells = within(canvasElement).getAllByTestId('month-cell')
        expect(cells[1].textContent).toContain('1')
        expect(cells.length % 7).toBe(0)
    },
}

/** Dropping a task chip's drag payload on a day cell reschedules it to THAT day: the view hands
 *  the parsed payload and the cell's date to `onRescheduleTask`. State is a real signal. */
export const DropReschedulesToTheCellDay: Story = {
    render: () => {
        seedCalendarState({ date: new Date(2026, 8, 15), events: [] })
        const [moved, setMoved] = createSignal('nothing')
        return (
            <div style={{ height: '520px' }}>
                <CalendarFrame>
                    <MonthView
                        store={new EventStore(new MemoryBackend())}
                        placed={new Map()}
                        onRescheduleTask={(ref, date) => setMoved(`${ref.path}:${ref.line}->${date}`)}
                    />
                </CalendarFrame>
                <output data-testid="moved">{moved()}</output>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const cell = c.getAllByTestId('month-cell').find(el => el.textContent?.trim() === '20')!
        const dataTransfer = new DataTransfer()
        dataTransfer.setData(TASK_DRAG_MIME, encodeTaskDrag({ path: 'todo.md', line: 4, field: 'due' }))
        cell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
        await waitFor(() => expect(c.getByTestId('moved').textContent).toBe('todo.md:4->2026-09-20'))
    },
}
