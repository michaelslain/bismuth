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
            taskRow('call the plumber about [[Home]] #chore', { line: 1, scheduled: today }),
            taskRow('file the **quarterly** taxes', { line: 2, scheduled: today, resolved: true }),
        ],
        today,
    ).get(today)!

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
        <div style={{ position: 'relative', width: '240px', 'min-height': '120px', padding: '8px', margin: '12px' }}>
            <AsciiCellEdges edges={['top', 'right', 'bottom', 'left']} />
            <TaskDayCell date={today} tasks={tasks()} compose={compose} onToggleTask={() => setToggled(n => n + 1)} />
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
        // revealed, the button sits inside the cell's typed edges: below the top `-` run's stroke, and
        // at least one `ch` clear of the right `|` stem. The overlay overhangs the host by half a
        // tile, so the stem (centre of the right-edge tile) is the HOST's right edge.
        const host = add.parentElement!.getBoundingClientRect()
        const tileW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ascii-tile-w'))
        expect(tileW, 'the glyph tiles are installed').toBeGreaterThan(0)
        const ab = add.getBoundingClientRect()
        expect(host.right - ab.right, 'add button clears the right | by at least 1ch').toBeGreaterThanOrEqual(tileW - 0.5)
        expect(ab.top - host.top, 'add button sits on the top - run').toBeGreaterThanOrEqual(3)
        await fireEvent.click(add)
        expect(c.queryByRole('button', { name: 'Add task' })).toBeNull()
    },
}
