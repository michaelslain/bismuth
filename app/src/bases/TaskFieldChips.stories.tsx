// Visual spec for <TaskFieldChips> — the muted signifiers after a task's description.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import TaskFieldChips from './TaskFieldChips'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import { formatDateField } from '../../../core/src/taskFields'
import styles from './TaskFieldChips.module.css'

const meta = {
    title: 'Bases/TaskFieldChips',
    component: TaskFieldChips,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TaskFieldChips>

export default meta
type Story = StoryObj<typeof meta>

const today = todayISO()
const D = {
    start: addDaysISO(today, -2),
    scheduled: addDaysISO(today, 2),
    past: addDaysISO(today, -3),
    future: addDaysISO(today, 10),
}

/** Every chip at once: priority, start, scheduled, due, recurrence. */
export const Every: Story = {
    render: () => (
        <span>
            plan the offsite
            <TaskFieldChips
                priority="high"
                start={D.start}
                scheduled={D.scheduled}
                due={D.future}
                recurrence="every week"
            />
        </span>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        for (const text of [
            '[high]',
            formatDateField('start', D.start),
            formatDateField('scheduled', D.scheduled),
            formatDateField('due', D.future),
            '[every week]',
        ])
            expect(canvas.getByText(text)).toBeInTheDocument()
        expect(canvasElement.querySelectorAll(`.${styles.field}`).length).toBe(5)
    },
}

/** No fields: nothing renders. `priority="none"` counts as no priority. */
export const Empty: Story = {
    render: () => (
        <span>
            bare task
            <TaskFieldChips priority="none" />
        </span>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelectorAll(`.${styles.field}`).length).toBe(0)
    },
}

/** A past due date with `overdue` set turns the due chip danger-coloured. */
export const Overdue: Story = {
    render: () => (
        <span>
            late
            <TaskFieldChips due={D.past} overdue />
        </span>
    ),
    play: async ({ canvasElement }) => {
        const chip = within(canvasElement).getByText(
            formatDateField('due', D.past),
        )
        expect(chip.classList.contains(styles.overdue)).toBe(true)
    },
}
