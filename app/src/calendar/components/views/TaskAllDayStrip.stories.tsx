// Visual spec for <TaskAllDayStrip> — the week/3day/day layout for the tasks register (see
// WeekView/ThreeDayView/DayView, which all delegate to this when `props.placed` is set). No
// module-level calendar state involved (unlike EventChip-based views): `dates`/`placed` are
// plain props, so this renders the same regardless of what any other story left in
// `calendar/state.ts`.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import { TaskAllDayStrip } from './TaskAllDayStrip'
import CalendarFrame from '../CalendarFrame'
import type { PlacedTask } from '../../taskPlacement'
import { EMPTY_FILE } from '../../../../../core/src/bases/types'

const meta = {
    title: 'Calendar/Components/TaskAllDayStrip',
    component: TaskAllDayStrip,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TaskAllDayStrip>

export default meta
type Story = StoryObj<typeof meta>

const ANCHOR = new Date(2026, 8, 9) // a Wednesday
const dates = (n: number) =>
    Array.from(
        { length: n },
        (_, i) => new Date(ANCHOR.getFullYear(), ANCHOR.getMonth(), ANCHOR.getDate() + i),
    )

function task(description: string, placed: string, late: number): PlacedTask {
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

/** A week strip: two carried tasks stacked on the anchor day, one ordinary task on a later
 *  day, and every other day empty — proves the all-day gutter (not a time grid) is what
 *  renders here, matching TimeGrid's own day-header + all-day-row classes. */
export const WeekStrip: Story = {
    render: () => {
        const placed = new Map([
            [
                '2026-09-09',
                [
                    task('renew passport', '2026-08-15', 25),
                    task('pay rent', '2026-09-08', 1),
                ],
            ],
            ['2026-09-11', [task('draft the roadmap', '2026-09-11', 0)]],
        ])
        return (
            <CalendarFrame>
                <TaskAllDayStrip
                    dates={dates(7)}
                    placed={placed}
                    onToggleTask={() => {}}
                    onOpenTask={() => {}}
                />
            </CalendarFrame>
        )
    },
    play: async ({ canvasElement }) => {
        // only the sticky header's cells are ringed; the task row under it is not sticky and its
        // cells carry none (a ring there would clip its chips)
        const heads = canvasElement.querySelectorAll('[data-testid="day-header"]')
        const cells = canvasElement.querySelectorAll('[data-testid="allday-cell"]')
        expect(heads.length).toBe(7)
        expect(canvasElement.querySelectorAll('[data-backdrop]').length).toBe(7)
        for (const h of heads) expect(h.querySelector('[data-backdrop]')).toBeTruthy()
        for (const c of cells) expect(c.querySelector('[data-backdrop]')).toBeNull()
    },
}

/** A single day (the DayView shape) with no tasks — the empty-cell case, so a bare gutter
 *  with no chips still renders the header + row structure instead of collapsing to nothing. */
export const EmptyDay: Story = {
    render: () => (
        <CalendarFrame>
            <TaskAllDayStrip
                dates={[ANCHOR]}
                placed={new Map()}
                onToggleTask={() => {}}
                onOpenTask={() => {}}
            />
        </CalendarFrame>
    ),
}

/** The last day carries 10 long-titled carried tasks (forcing that all-day
 *  cell to want far more than its equal share of width) while day 2 carries one short task and
 *  every other day is empty, in a 460px-wide frame — the narrowest width the drift was measured
 *  at. Before the min-width:0 fix, a busy cell could not shrink below its content's min-content
 *  width while the header cell above it could, so the header and the cells disagreed about
 *  where each day's column actually was (measured -140px drift on the last day at 460px). */
export const DenseNarrow: Story = {
    render: () => {
        const longTasks = Array.from({ length: 10 }, (_, i) =>
            task(`Reply to the landlord about the lease renewal ${i + 1}`, '2026-09-08', i + 1),
        )
        const placed = new Map([
            ['2026-09-10', [task('short', '2026-09-10', 0)]],
            ['2026-09-15', longTasks],
        ])
        return (
            <div style={{ width: '460px', height: '600px' }}>
                <CalendarFrame>
                    <TaskAllDayStrip
                        dates={dates(7)}
                        placed={placed}
                        onToggleTask={() => {}}
                        onOpenTask={() => {}}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const heads = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="day-header"]')]
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="allday-cell"]')]
        expect(heads).toHaveLength(7)
        expect(cells).toHaveLength(7)
        heads.forEach((h, i) => {
            const a = h.getBoundingClientRect()
            const b = cells[i].getBoundingClientRect()
            // measured -140px on the last day before the min-width:0 fix above
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
        // the busy last day is the user's screenshot case. A cell this narrow (under ~90px of chip
        // content) COLLAPSES: each title is ONE line that ends in an ellipsis. It used to wrap
        // one word per line and split words mid-letter (`passp/ort`); a chip's full title is in
        // its accessible name and opens on click.
        const lastDayCell = cells[cells.length - 1]
        const lastDayTitles = [
            ...lastDayCell.querySelectorAll<HTMLElement>('[data-testid="task-chip-title"]'),
        ]
        expect(lastDayTitles.length).toBeGreaterThan(0)
        lastDayTitles.forEach((t, i) => {
            const lineHeight = parseFloat(getComputedStyle(t).lineHeight)
            expect(getComputedStyle(t).textOverflow, `title ${i} ellipsis`).toBe('ellipsis')
            expect(
                t.getBoundingClientRect().height,
                `title ${i} single line`,
            ).toBeLessThanOrEqual(lineHeight + 1)
        })
        // every cell in the row stretches to match the tallest (was content-sized with a blank
        // void below, before the min-width:0 fix). Checked directly on cell heights rather than
        // against the strip's own (fixed, scrollable) viewport bottom: with titles now wrapping
        // fully, the busy day's chips make the row far taller than the 600px frame, so the row
        // legitimately scrolls — that must not be mistaken for the blank-void bug the original
        // assertion caught.
        const cellHeights = cells.map(c => Math.round(c.getBoundingClientRect().height))
        expect(new Set(cellHeights).size, 'every cell should stretch to the same height').toBe(1)
    },
}
/** Clicking a bare day cell opens the inline task composer for that day (Task 6's cell-click
 *  wiring) — TaskCellComposer's own input becomes visible inside that cell. */
export const ComposerOpensOnCellClick: Story = {
    render: () => {
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        return (
            <CalendarFrame>
                <TaskAllDayStrip
                    dates={dates(3)}
                    placed={new Map()}
                    onToggleTask={() => {}}
                    onOpenTask={() => {}}
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
        )
    },
    play: async ({ canvasElement }) => {
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="task-day-cell"]')]
        expect(cells).toHaveLength(3)
        expect(cells[0].querySelector('[data-testid="task-cell-composer-input"]')).toBeNull()
        await userEvent.click(cells[0])
        await new Promise(r => setTimeout(r, 0))
        expect(cells[0].querySelector('[data-testid="task-cell-composer-input"]')).not.toBeNull()
    },
}

/** Task 2 (discoverable add): the same quiet `+` MonthView.stories.tsx's
 *  `AddTaskButtonReveals` proves for the month grid, here for the week/3-day/day strip —
 *  a separate component (TaskAllDayStrip.tsx), so its own wiring needs its own proof. */
export const AddTaskButtonReveals: Story = {
    render: () => {
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        return (
            <CalendarFrame>
                <TaskAllDayStrip
                    dates={dates(3)}
                    placed={new Map()}
                    onToggleTask={() => {}}
                    onOpenTask={() => {}}
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
        )
    },
    play: async ({ canvasElement }) => {
        const cell = canvasElement.querySelector<HTMLElement>('[data-testid="task-day-cell"]')!
        const button = cell.querySelector<HTMLElement>('[aria-label="Add task"]')!
        expect(button).not.toBeNull()
        expect(getComputedStyle(button).opacity).toBe('0')
        // See MonthView.stories.tsx's `AddTaskButtonReveals` for why this focuses the button
        // directly rather than simulating a pointer hover.
        button.focus()
        // the opacity change is CSS-transitioned (`--dur`), so the computed value right after
        // triggering it is still mid-transition — wait past the transition before reading it.
        await new Promise(r => setTimeout(r, 200))
        expect(getComputedStyle(button).opacity).toBe('1')
        await userEvent.click(button)
        await new Promise(r => setTimeout(r, 0))
        expect(cell.querySelector('[data-testid="task-cell-composer-input"]')).not.toBeNull()
    },
}

/** Open on one day, then click a different day — the FIRST cell's composer must actually close,
 *  not merely leave a second one also open. A naive per-cell signal (one `open` boolean stored
 *  PER cell, instead of one shared `date` at the view level) would pass the "second opened" half
 *  of this and fail the "first closed" half. */
export const ComposerMovesBetweenCells: Story = {
    render: () => {
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        return (
            <CalendarFrame>
                <TaskAllDayStrip
                    dates={dates(3)}
                    placed={new Map()}
                    onToggleTask={() => {}}
                    onOpenTask={() => {}}
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
        )
    },
    play: async ({ canvasElement }) => {
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="task-day-cell"]')]
        expect(cells).toHaveLength(3)
        await userEvent.click(cells[0])
        await new Promise(r => setTimeout(r, 0))
        expect(cells[0].querySelector('[data-testid="task-cell-composer-input"]')).not.toBeNull()
        await userEvent.click(cells[1])
        await new Promise(r => setTimeout(r, 0))
        // the FIRST cell's composer is GONE — not merely a second one also present
        expect(cells[0].querySelector('[data-testid="task-cell-composer-input"]')).toBeNull()
        expect(cells[1].querySelector('[data-testid="task-cell-composer-input"]')).not.toBeNull()
    },
}

/** TaskChip already stops its own click from bubbling — clicking a chip must open its note
 *  (onOpenTask) and must never also open the composer for the day it sits in. */
export const ChipClickDoesNotOpenComposer: Story = {
    render: () => {
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        const [openedCount, setOpenedCount] = createSignal(0)
        const day = '2026-09-09'
        const placed = new Map([[day, [task('write the report', day, 0)]]])
        return (
            <CalendarFrame>
                <TaskAllDayStrip
                    dates={dates(3)}
                    placed={placed}
                    onToggleTask={() => {}}
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
                <div data-testid="opened-count">{openedCount()}</div>
            </CalendarFrame>
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

/** A cell that has BOTH real task chips and an open composer — the composer must render LAST,
 *  after every chip, never in front of or between them. `compose.color` is also set here (the
 *  view's resolved defaultCategory colour), so this doubles as proof that the colour actually
 *  reaches TaskCellComposer's marker — a prop CalendarView already populates but neither grid
 *  wired through until this fix. */
export const ComposerBelowChips: Story = {
    render: () => {
        const day = '2026-09-09'
        const placed = new Map([
            [day, [task('renew passport', '2026-08-15', 25), task('pay rent', '2026-09-08', 1)]],
        ])
        return (
            <CalendarFrame>
                <TaskAllDayStrip
                    dates={dates(3)}
                    placed={placed}
                    onToggleTask={() => {}}
                    onOpenTask={() => {}}
                    compose={{
                        date: day,
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
        )
    },
    play: async ({ canvasElement }) => {
        const cell = canvasElement.querySelector<HTMLElement>('[data-testid="task-day-cell"]')!
        const children = [...cell.children]
        expect(children.length).toBe(3) // 2 chips + the composer
        expect(children[0].querySelector('[data-testid="task-chip-title"]')).not.toBeNull()
        expect(children[1].querySelector('[data-testid="task-chip-title"]')).not.toBeNull()
        // the composer is LAST — proves it never displaces the chips above it
        const composer = children[2]
        expect(composer.querySelector('[role="checkbox"]')).not.toBeNull()
        expect(composer.querySelector('[data-testid="task-chip-title"]')).toBeNull()
        // the colour reaches the marker itself, as an inline style carrying the exact design
        // token, not a hardcoded stand-in colour
        const marker = composer.querySelector<HTMLElement>('[role="checkbox"]')!
        expect(marker.style.getPropertyValue('--task-check-color')).toBe('var(--blue)')
    },
}

/** One busy day makes the strip tall; scrolled to the bottom, a click low in a quiet column opens
 *  that column's composer, whose place in the flow (right after its few chips) is far above the
 *  viewport. It must open pinned in view under the header, so focusing it and committing a task
 *  leave the scroll where the person put it instead of jumping the strip back to the top. */
export const ComposerKeepsScroll: Story = {
    render: () => {
        const [openDate, setOpenDate] = createSignal<string | null>(null)
        const busy = Array.from({ length: 60 }, (_, i) =>
            task(`overdue errand ${i + 1}`, '2026-09-01', 8),
        )
        return (
            <div style={{ width: '700px', height: '400px' }}>
                <CalendarFrame>
                    <TaskAllDayStrip
                        dates={dates(7)}
                        placed={new Map([['2026-09-09', busy]])}
                        onToggleTask={() => {}}
                        onOpenTask={() => {}}
                        compose={{
                            date: openDate(),
                            destination: 'General Tasks',
                            targets: [],
                            target: '',
                            setTarget: () => {},
                            open: d => setOpenDate(d),
                            commit: () => {},
                            cancel: () => setOpenDate(null),
                        }}
                    />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const frame = () => new Promise(r => requestAnimationFrame(() => r(null)))
        const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="task-day-cell"]')]
        // the strip is the ancestor that scrolls: overflow auto AND a box (AllDayRow's
        // `display: contents` wrapper also says overflow auto, but has no box)
        let strip = cells[0].parentElement!
        while (getComputedStyle(strip).overflowY !== 'auto' || strip.clientHeight === 0)
            strip = strip.parentElement!
        expect(strip.scrollHeight).toBeGreaterThan(strip.clientHeight * 2)
        strip.scrollTop = strip.scrollHeight
        await frame()
        const before = strip.scrollTop
        expect(before).toBeGreaterThan(0)

        const quiet = cells[2]
        const r = quiet.getBoundingClientRect()
        const sr = strip.getBoundingClientRect()
        await userEvent.pointer({
            keys: '[MouseLeft]',
            target: quiet,
            coords: { clientX: r.left + r.width / 2, clientY: sr.bottom - 20 },
        })
        await frame()
        await frame()
        const input = quiet.querySelector<HTMLElement>('[data-testid="task-cell-composer-input"]')!
        expect(input).not.toBeNull()
        expect(document.activeElement).toBe(input)
        expect(strip.scrollTop, 'opening scrolled the strip').toBe(before)
        // pinned in view, under the sticky header rather than behind it
        const head = canvasElement.querySelector<HTMLElement>('[data-testid="day-header"]')!
        const ir = input.getBoundingClientRect()
        expect(ir.top).toBeGreaterThanOrEqual(head.getBoundingClientRect().bottom)
        expect(ir.bottom).toBeLessThanOrEqual(sr.bottom)

        await userEvent.type(input, 'buy stamps{Enter}')
        await frame()
        expect(strip.scrollTop, 'committing scrolled the strip').toBe(before)
    },
}
