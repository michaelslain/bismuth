// Visual spec for <TaskAllDayStrip> — the week/3day/day layout for the tasks register (see
// WeekView/ThreeDayView/DayView, which all delegate to this when `props.placed` is set). No
// module-level calendar state involved (unlike EventChip-based views): `dates`/`placed` are
// plain props, so this renders the same regardless of what any other story left in
// `calendar/state.ts`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
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
        // the busy last day is the user's screenshot case: every long title here must be fully
        // visible (never clipped) and, this narrow, must wrap onto more than one line rather
        // than reading as "W…"
        const lastDayCell = cells[cells.length - 1]
        const lastDayTitles = [
            ...lastDayCell.querySelectorAll<HTMLElement>('[data-testid="task-chip-title"]'),
        ]
        expect(lastDayTitles.length).toBeGreaterThan(0)
        lastDayTitles.forEach((t, i) => {
            const lineHeight = parseFloat(getComputedStyle(t).lineHeight)
            expect(t.scrollWidth, `title ${i} clipped`).toBeLessThanOrEqual(t.clientWidth + 1)
            expect(
                t.getBoundingClientRect().height,
                `title ${i} single line`,
            ).toBeGreaterThanOrEqual(lineHeight * 2 - 1)
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
