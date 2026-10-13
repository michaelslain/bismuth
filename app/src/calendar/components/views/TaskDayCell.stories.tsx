// Visual + behaviour spec for <TaskDayCell> — one day of the tasks register: the day's chips, the
// quiet "add a task" button, and the inline composer. Shared by the month grid and the
// week/3-day/day strip. The composer state is a real signal; play() opens it via the button.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, within } from 'storybook/test'
import AsciiCellEdges from '../../../ui/ascii/AsciiCellEdges'
import TaskDayCell from './TaskDayCell'
import { placeRows } from '../../taskPlacement'
import type { TaskComposeProps } from '../../taskCompose'
import { taskRow } from '../../../ui/_calendarAssertions'
import { todayISO } from '../../../../../core/src/dates'
import MonthCell from './MonthCell'
import { TaskAllDayStrip } from './TaskAllDayStrip'

const meta = {
    title: 'Calendar/Views/TaskDayCell',
    component: TaskDayCell,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TaskDayCell>

export default meta
type Story = StoryObj<typeof meta>

const today = todayISO()
const tasks = () =>
    placeRows(
        [
            taskRow('call the plumber about [[Home]] #chore', {
                line: 1,
                scheduled: today,
            }),
            taskRow('file the **quarterly** taxes', {
                line: 2,
                scheduled: today,
                resolved: true,
            }),
        ],
        today,
    ).get(today)!

const manyTasks = () =>
    placeRows(
        [
            taskRow('call the plumber about the leaking kitchen tap', {
                line: 1,
                scheduled: today,
            }),
            taskRow('file the quarterly taxes', {
                line: 2,
                scheduled: today,
                resolved: true,
            }),
            taskRow('book flights #travel', { line: 3, scheduled: today }),
            taskRow('reply to the landlord', { line: 4, scheduled: today }),
        ],
        today,
    ).get(today)!

const compose = (): TaskComposeProps => ({
    date: null,
    destination: 'tasks',
    targets: [{ id: 'tasks.md', label: 'tasks' }],
    target: 'tasks.md',
    setTarget: () => {},
    open: () => {},
    commit: () => {},
    cancel: () => {},
})

/** The add button's box overlaps no chip's box: it holds its own row after the day's chips. */
const expectClearOfChips = (root: HTMLElement, add: HTMLElement) => {
    const ab = add.getBoundingClientRect()
    expect(ab.width, 'the add button is laid out').toBeGreaterThan(0)
    const chips = [
        ...root.querySelectorAll<HTMLElement>('[role="checkbox"]'),
    ].map(m => m.closest<HTMLElement>('[role="button"]')!)
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
        const cb = chip.getBoundingClientRect()
        const overlaps =
            ab.left < cb.right &&
            ab.right > cb.left &&
            ab.top < cb.bottom &&
            ab.bottom > cb.top
        expect(overlaps, `add button overlaps chip "${chip.textContent}"`).toBe(
            false,
        )
        expect(
            ab.top,
            'add button sits below the chips',
        ).toBeGreaterThanOrEqual(cb.bottom)
    }
}

const Harness = () => {
    const [composeDate, setComposeDate] = createSignal<string | null>(null)
    const [toggled, setToggled] = createSignal(0)
    const compose: TaskComposeProps = {
        get date() {
            return composeDate()
        },
        destination: 'tasks',
        targets: [{ id: 'tasks.md', label: 'tasks' }],
        target: 'tasks.md',
        setTarget: () => {},
        open: d => setComposeDate(d),
        commit: () => setComposeDate(null),
        cancel: () => setComposeDate(null),
    }
    return (
        <div
            style={{
                position: 'relative',
                width: '240px',
                'min-height': '120px',
                padding: '8px',
                margin: '12px',
            }}
        >
            <AsciiCellEdges edges={['top', 'right', 'bottom', 'left']} />
            <TaskDayCell
                date={today}
                tasks={tasks()}
                compose={compose}
                onToggleTask={() => setToggled(n => n + 1)}
            />
            <output data-testid="toggled">{toggled()}</output>
        </div>
    )
}

export const ChipsAndAddButton: Story = {
    render: () => <Harness />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        // the description renders as inline markdown, not a raw string
        expect(canvasElement.textContent).not.toContain('[[Home]]')
        expect(canvasElement.textContent).not.toContain('**')
        const marks = c.getAllByRole('checkbox')
        expect(marks.length).toBe(2)
        await fireEvent.click(marks[0])
        expect(c.getByTestId('toggled').textContent).toBe('1')
        // the button is quiet at rest, the composer takes over when it is pressed
        const add = c.getByRole('button', { name: 'Add task' })
        expect(getComputedStyle(add).opacity).toBe('0')
        expectClearOfChips(canvasElement, add)
        await fireEvent.click(add)
        expect(c.queryByRole('button', { name: 'Add task' })).toBeNull()
    },
}

/** A month cell holding four chips, the button revealed by focus (MonthCell's `:focus-within`). */
export const InMonthCellRevealed: Story = {
    render: () => (
        <div style={{ width: '200px', margin: '12px' }}>
            <MonthCell
                date={today}
                day={Number(today.slice(8))}
                inMonth
                today={false}
                onOpen={() => {}}
                isLastCol
                isLastRow
            >
                <TaskDayCell
                    date={today}
                    tasks={manyTasks()}
                    compose={compose()}
                />
            </MonthCell>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const add = within(canvasElement).getByRole('button', {
            name: 'Add task',
        })
        add.focus()
        expectClearOfChips(canvasElement, add)
    },
}

/** The week/3-day/day strip, where no day number leads the chips: the button still follows them. */
export const InStripRevealed: Story = {
    render: () => (
        <div
            style={{
                width: '300px',
                height: '220px',
                display: 'flex',
                'flex-direction': 'column',
                margin: '12px',
            }}
        >
            <TaskAllDayStrip
                dates={[new Date(today + 'T00:00:00')]}
                placed={new Map([[today, manyTasks()]])}
                compose={compose()}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const add = within(canvasElement).getByRole('button', {
            name: 'Add task',
        })
        add.focus()
        expectClearOfChips(canvasElement, add)
    },
}
