// Visual + behaviour spec for <TasksCalendar> — the tasks register of a calendar base: the
// resolved rows placed on day buckets (`placeRows`), the per-cell composer, and the tasks
// settings modal. No EventStore involved; a `result` fixture is all it needs. Writes go through
// the fake transport, and play() reads them back.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import TasksCalendar from './TasksCalendar'
import CalendarFrame from '../calendar/components/CalendarFrame'
import { currentView, currentDate } from '../calendar/state'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { taskRow } from '../ui/_calendarAssertions'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import type { ViewConfig, ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/TasksCalendar',
    component: TasksCalendar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TasksCalendar>

export default meta
type Story = StoryObj<typeof meta>

const VIEW: ViewConfig = { type: 'calendar', mode: 'tasks' }
const CONFIG: BaseConfig = { source: { kind: 'tasks' }, view: VIEW }
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
            <TasksCalendar result={result()} config={CONFIG} ownsRows={false} />
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

const fromNote = (name: string, row: ReturnType<typeof taskRow>) => ({
    ...row,
    file: { ...row.file, name, basename: name, path: `${name}.md` },
})

const multiSourceRows = () => [
    fromNote('work', taskRow('ship the release', { line: 1, scheduled: today })),
    fromNote('work', taskRow('review the pr', { line: 2, scheduled: today, resolved: true })),
    fromNote('home', taskRow('water the plants', { line: 1, scheduled: today })),
    fromNote('home', taskRow('call the bank', { line: 2, scheduled: today, resolved: true })),
    fromNote('work', taskRow('book the venue', { line: 3, scheduled: today })),
]

/** `POST /tasks/toggle` flips (or sets) the matching row for real, the way the server rewrites
 *  the line, so a checkbox click in the story re-sorts the day exactly as it does in the app. */
const toggleRow = (row: Row, status?: string): Row => {
    const char = status ?? (row.note.resolved ? ' ' : 'x')
    const resolved = char === 'x' || char === '-'
    return {
        ...row,
        note: {
            ...row.note,
            statusChar: char,
            status: char === '-' ? 'cancelled' : char === 'x' ? 'done' : char === '/' ? 'in-progress' : 'todo',
            resolved,
        },
    }
}

const MultiSource = () => {
    const [rows, setRows] = createSignal(multiSourceRows())
    const fake = fakeTransport({ files: { 'work.md': '', 'home.md': '' } })
    setTransport({
        ...fake,
        post: (path, body) => {
            if (path === '/tasks/toggle') {
                const b = body as { path: string; line: number; status?: string }
                setRows(rs =>
                    rs.map(r => (r.file.path === b.path && r.note.line === b.line ? toggleRow(r, b.status) : r)),
                )
                return Promise.resolve(new Response('ok'))
            }
            return fake.post(path, body)
        },
    })
    currentView.value = 'day'
    currentDate.value = new Date()
    const result = (): ViewResult => ({
        view: VIEW,
        columns: [],
        groups: [{ key: '', rows: rows() }],
        summaries: {},
    })
    return (
        <CalendarFrame>
            <TasksCalendar result={result()} config={CONFIG} ownsRows={false} />
        </CalendarFrame>
    )
}

const dayOrder = (el: HTMLElement, names: string[]) => {
    const text = el.textContent ?? ''
    return [...names].sort((a, b) => text.indexOf(a) - text.indexOf(b))
}
const ALL = ['ship the release', 'book the venue', 'water the plants', 'review the pr', 'call the bank']

/** Two source notes on one day: every open task comes before every done one, and each half
 *  reads source by source (work, then home), whatever order the rows arrived in. The boxes
 *  work: checking one sinks it into the done half, unchecking lifts it back to its source. */
export const DoneSinksAcrossSources: Story = {
    render: () => <MultiSource />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await waitFor(() => expect(c.getByText('ship the release')).toBeInTheDocument())
        expect(dayOrder(canvasElement, ALL)).toEqual(ALL)
        const box = (name: string) => c.getByRole('checkbox', { name })
        fireEvent.click(box('ship the release'))
        await waitFor(() =>
            expect(dayOrder(canvasElement, ALL)).toEqual([
                'book the venue', 'water the plants', 'ship the release', 'review the pr', 'call the bank',
            ]),
        )
        fireEvent.click(box('ship the release'))
        await waitFor(() => expect(dayOrder(canvasElement, ALL)).toEqual(ALL))
        ;(document.activeElement as HTMLElement | null)?.blur()
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
