// Visual spec for <MonthView> — the month grid (a Bases "calendar" view kind, rendered by
// app/src/bases/CalendarView.tsx when currentView === 'month'). Like every view under
// calendar/components/views/ except TimeGrid, it takes only a `store` prop (plus, in the tasks
// register, a `placed` map) — events/categories/currentDate come from calendar/state.ts
// module-level signals (see app/src/ui/_calendarFixtures.ts). MonthView owns its own
// MonthView.module.css (2026-09-13) — nothing here imports Calendar.module.css.
import { createSignal, onCleanup } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import { MonthView } from './MonthView'
import { EventStore, MemoryBackend } from '../../EventStore'
import CalendarFrame from '../CalendarFrame'
import { seedCalendarState } from '../../../ui/_calendarFixtures'
import { currentDate } from '../../state'
import { placeRows } from '../../taskPlacement'
import type { PlacedTask } from '../../taskPlacement'
import { todayISO, addDaysISO } from '../../../../../core/src/dates'
import type { Row } from '../../../../../core/src/bases/types'
import { EMPTY_FILE } from '../../../../../core/src/bases/types'
import { assertChipsWhole, assertHeaderAligned, taskRow } from '../../../ui/_calendarAssertions'

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
                taskRow(`today task ${i + 1}`, { line: 100 + i, scheduled: today }),
            ),
            taskRow('a quiet task in three days', { line: 200, scheduled: addDaysISO(today, 3) }),
            taskRow('a quiet task in five days', { line: 201, scheduled: addDaysISO(today, 5) }),
            taskRow('a quiet task in nine days', { line: 202, scheduled: addDaysISO(today, 9) }),
        ]
        const placed = placeRows(rows, today)
        return (
            <div style={{ width: '720px', height: '560px' }}>
                <CalendarFrame>
                    <MonthView store={new EventStore(new MemoryBackend())} placed={placed} />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const chips = '[data-testid="task-chip-title"]'
        // assert on the chip ROOT (the title's parent), which is what squashed
        assertChipsWhole(canvasElement, `:has(> ${chips})`)
        assertHeaderAligned(canvasElement)
        const scroller = canvasElement.querySelector<HTMLElement>('[data-testid="month-scroller"]')!
        // the dense month MUST overflow, or the header-alignment-while-scrolling check above proved nothing
        expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
        // the busy week grew; a quiet week did not
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell"]')]
        const heights = cells.map(c => Math.round(c.getBoundingClientRect().height))
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
                    <MonthView store={new EventStore(new MemoryBackend())} placed={placed} />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const scroller = canvasElement.querySelector<HTMLElement>('[data-testid="month-scroller"]')!
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell"]')]
        expect(scroller.scrollHeight).toBeLessThanOrEqual(scroller.clientHeight + 1)
        const last = cells[cells.length - 1].getBoundingClientRect()
        expect(Math.abs(last.bottom - scroller.getBoundingClientRect().bottom)).toBeLessThanOrEqual(2)
        const heights = new Set(cells.map(c => Math.round(c.getBoundingClientRect().height)))
        expect(heights.size).toBeLessThanOrEqual(2) // equal rows (±1px rounding)
        // today's number keeps the circle's colour even though MonthView merges its own muted class onto
        // it — fails if DayNumber's `.root.today` specificity is ever lowered. The comparison number is
        // whatever in-month, non-today day happens to render first (full opacity, i.e. not a dimmed
        // leading/trailing-month spillover) — never a hardcoded day-of-month that could collide with
        // today's own real date.
        const numbers = cells.map(c => c.firstElementChild as HTMLElement)
        const todayCircle = numbers.find(n => Math.round(n.getBoundingClientRect().width) === 20)!
        const other = numbers.find(n => n !== todayCircle && getComputedStyle(n).opacity === '1')!
        expect(getComputedStyle(todayCircle).color).not.toBe(getComputedStyle(other).color)
    },
}
/** Minimal PlacedTask fixture for the transition stories below, matching
 *  TaskAllDayStrip.stories.tsx's own `task()` helper — these stories only need a task that
 *  renders one chip, not a real markdown-backed row. */
function placedTask(description: string, placed: string, late: number): PlacedTask {
    return {
        row: {
            file: { ...EMPTY_FILE, name: 'tasks', basename: 'tasks', path: 'tasks.md' },
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
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell"]')]
        expect(cells.length).toBeGreaterThan(20)
        expect(cells[10].querySelector('[data-testid="task-cell-composer-input"]')).toBeNull()
        await userEvent.click(cells[10])
        await new Promise(r => setTimeout(r, 0))
        expect(cells[10].querySelector('[data-testid="task-cell-composer-input"]')).not.toBeNull()
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
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell"]')]
        await userEvent.click(cells[10])
        await new Promise(r => setTimeout(r, 0))
        expect(cells[10].querySelector('[data-testid="task-cell-composer-input"]')).not.toBeNull()
        await userEvent.click(cells[11])
        await new Promise(r => setTimeout(r, 0))
        // the FIRST cell's composer is GONE — not merely a second one also present
        expect(cells[10].querySelector('[data-testid="task-cell-composer-input"]')).toBeNull()
        expect(cells[11].querySelector('[data-testid="task-cell-composer-input"]')).not.toBeNull()
    },
}

/** TaskChip already stops its own click from bubbling — clicking a chip must open its note
 *  (onOpenTask) and must never also open the month cell's composer underneath it. */
export const ChipClickDoesNotOpenComposer: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        const [openedCount, setOpenedCount] = createSignal(0)
        const placed = new Map([['2026-01-14', [placedTask('write the report', '2026-01-14', 0)]]])
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
        const title = canvasElement.querySelector<HTMLElement>('[data-testid="task-chip-title"]')!
        await userEvent.click(title)
        await new Promise(r => setTimeout(r, 0))
        expect(canvasElement.querySelector('[data-testid="opened-count"]')!.textContent).toBe('1')
        expect(canvasElement.querySelector('[data-testid="task-cell-composer-input"]')).toBeNull()
    },
}

/** A month cell with BOTH real task chips and an open composer — the composer must render LAST,
 *  after every chip, inside `month-cell-events`, never in front of or between them. */
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
            ...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell-events"]'),
        ]
        const box = boxes.find(b => b.querySelector('[data-testid="task-chip-title"]'))!
        const children = [...box.children]
        expect(children.length).toBe(3) // 2 chips + the composer
        expect(children[0].querySelector('[data-testid="task-chip-title"]')).not.toBeNull()
        expect(children[1].querySelector('[data-testid="task-chip-title"]')).not.toBeNull()
        // the composer is LAST — proves it never displaces the chips above it
        expect(children[2].querySelector('[data-testid="task-cell-composer-marker"]')).not.toBeNull()
        expect(children[2].querySelector('[data-testid="task-chip-title"]')).toBeNull()
    },
}
