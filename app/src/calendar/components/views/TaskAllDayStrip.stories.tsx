// Visual spec for <TaskAllDayStrip> — the week/3day/day layout for the tasks register (see
// WeekView/ThreeDayView/DayView, which all delegate to this when `props.placed` is set). No
// module-level calendar state involved (unlike EventChip-based views): `dates`/`placed` are
// plain props, so this renders the same regardless of what any other story left in
// `calendar/state.ts`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { TaskAllDayStrip } from './TaskAllDayStrip'
import type { PlacedTask } from '../../taskPlacement'
import { EMPTY_FILE } from '../../../../../core/src/bases/types'
import styles from '../../Calendar.module.css'

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
            <div class={styles['calendar-app']}>
                <TaskAllDayStrip
                    dates={dates(7)}
                    placed={placed}
                    onToggleTask={() => {}}
                    onOpenTask={() => {}}
                />
            </div>
        )
    },
}

/** A single day (the DayView shape) with no tasks — the empty-cell case, so a bare gutter
 *  with no chips still renders the header + row structure instead of collapsing to nothing. */
export const EmptyDay: Story = {
    render: () => (
        <div class={styles['calendar-app']}>
            <TaskAllDayStrip
                dates={[ANCHOR]}
                placed={new Map()}
                onToggleTask={() => {}}
                onOpenTask={() => {}}
            />
        </div>
    ),
}
