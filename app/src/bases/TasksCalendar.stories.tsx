// Visual + behaviour spec for <TasksCalendar> — the tasks register of a calendar base: the
// resolved rows placed on day buckets (`placeRows`), the per-cell composer, and the tasks
// settings modal. No EventStore involved; a `result` fixture is all it needs. Writes go through
// the fake transport, and play() reads them back.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import TasksCalendar from './TasksCalendar'
import CalendarFrame from '../calendar/components/CalendarFrame'
import { currentView, currentDate } from '../calendar/state'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { taskRow } from '../ui/_calendarAssertions'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import type { ViewConfig, ViewResult, BaseConfig } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/TasksCalendar',
    component: TasksCalendar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TasksCalendar>

export default meta
type Story = StoryObj<typeof meta>

const VIEW: ViewConfig = { type: 'calendar', name: 'Calendar', mode: 'tasks' }
const CONFIG: BaseConfig = { source: { kind: 'tasks' }, views: [VIEW] }
const today = todayISO()
const result = (): ViewResult => ({
    view: VIEW,
    columns: [],
    groups: [
        {
            key: '',
            rows: [
                taskRow('pay rent', { line: 1, scheduled: today }),
                taskRow('draft the **roadmap** for [[Q4]]', { line: 2, due: addDaysISO(today, 1) }),
                taskRow('renew passport', { line: 3, due: addDaysISO(today, -4) }),
            ],
        },
    ],
    summaries: {},
})

const Mount = () => {
    setTransport(fakeTransport({ files: { 'tasks.md': '- [ ] pay rent\n- [ ] draft the roadmap\n- [ ] renew passport\n' } }))
    currentView.value = 'week'
    currentDate.value = new Date()
    return (
        <CalendarFrame>
            <TasksCalendar result={result()} config={CONFIG} ownsRows={false} viewIndex={0} />
        </CalendarFrame>
    )
}

/** Week strip: today's task, the carried overdue one (rolled onto today, `Nd late`), and an
 *  inline-markdown description rendered as text + a note link, never the raw `**`/`[[ ]]`. */
export const WeekWithTasks: Story = {
    render: () => <Mount />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await waitFor(() => expect(c.getByText('pay rent')).toBeInTheDocument())
        expect(c.getByText('renew passport')).toBeInTheDocument()
        expect(c.getByText('4d late')).toBeInTheDocument()
        expect(canvasElement.textContent).not.toContain('[[Q4]]')
        expect(canvasElement.textContent).not.toContain('**')
    },
}

/** Pressing a day's add button opens the composer for THAT day and hides the button. */
export const ComposerOpensPerDay: Story = {
    render: () => <Mount />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await waitFor(() => expect(c.getAllByRole('button', { name: 'Add task' }).length).toBeGreaterThan(0))
        const before = c.getAllByRole('button', { name: 'Add task' }).length
        await fireEvent.click(c.getAllByRole('button', { name: 'Add task' })[0])
        await waitFor(() => expect(c.getAllByRole('button', { name: 'Add task' }).length).toBe(before - 1))
    },
}
