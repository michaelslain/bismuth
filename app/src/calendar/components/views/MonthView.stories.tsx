// Visual spec for <MonthView> — the month grid (a Bases "calendar" view kind, rendered by
// app/src/bases/CalendarView.tsx when currentView === 'month'). Like every view under
// calendar/components/views/ except TimeGrid, it takes only a `store` prop (plus, in the tasks
// register, a `placed` map) — events/categories/currentDate come from calendar/state.ts
// module-level signals (see app/src/ui/_calendarFixtures.ts). MonthView owns its own
// MonthView.module.css (2026-09-13) — nothing here imports Calendar.module.css.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { MonthView } from './MonthView'
import { EventStore, MemoryBackend } from '../../EventStore'
import CalendarFrame from '../CalendarFrame'
import { seedCalendarState } from '../../../ui/_calendarFixtures'
import { currentDate } from '../../state'
import { placeRows } from '../../taskPlacement'
import { todayISO, addDaysISO } from '../../../../../core/src/dates'
import { EMPTY_FILE } from '../../../../../core/src/bases/types'
import type { Row } from '../../../../../core/src/bases/types'

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

/** Every chip keeps its natural height (not squashed) and sits wholly inside its own day cell. */
function assertChipsWhole(canvasElement: HTMLElement, chipSelector: string) {
    const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell"]')]
    let seen = 0
    cells.forEach((cell, i) => {
        const cb = cell.getBoundingClientRect()
        cell.querySelectorAll<HTMLElement>(chipSelector).forEach(chip => {
            seen++
            const r = chip.getBoundingClientRect()
            // D2: a squashed chip's box is shorter than its content (6px box, ~22px content)
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
 *  week-row grows to fit every chip at full height instead of squashing them (D2). */
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
        assertChipsWhole(canvasElement, '[data-testid="event-chip"]') // testid added by Task 1
        assertHeaderAligned(canvasElement)
    },
}

/** A synthetic tasks-register row — mirrors app/src/bases/CalendarView.stories.tsx's own
 *  `taskRow` (not exported from there, so duplicated here rather than reached into another
 *  story file's private helper). */
function taskRow(
    description: string,
    opts: { line: number; scheduled?: string; due?: string; resolved?: boolean },
): Row {
    const placed = opts.scheduled ?? opts.due
    return {
        file: { ...EMPTY_FILE, name: 'tasks', basename: 'tasks', path: 'tasks.md' },
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

/** The user's screenshot: a busy today carrying a dozen overdue tasks plus a handful placed on
 *  today itself, while the rest of the month stays quiet. Dates are relative to the real
 *  `todayISO()` (not a fixed calendar date), so the dense cell lands on TODAY regardless of when
 *  the story is opened — `placeRows` computes carry-forward against the actual clock. */
export const DenseTasks: Story = {
    render: () => {
        currentDate.value = new Date()
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
        currentDate.value = new Date()
        const today = todayISO()
        const rows: Row[] = [
            taskRow('email ana', { line: 1, scheduled: today }),
            taskRow('draft the roadmap', { line: 2, scheduled: addDaysISO(today, 2) }),
            taskRow('renew the lease', { line: 3, scheduled: addDaysISO(today, 4) }),
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
