// Visual spec for <EventsCalendar> — the events register of a calendar base: the month/week/3day/
// day grids over an EventStore backed by the base file's own event table (`BaseBackend`), plus the
// event modal, recurrence dialog and category panel. Runs against a real fake transport carrying
// one base file, so the events come from a read, not from seeded signals.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import EventsCalendar from './EventsCalendar'
import CalendarFrame from '../calendar/components/CalendarFrame'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { todayISO } from '../../../core/src/dates'

const meta = {
    title: 'Bases/EventsCalendar',
    component: EventsCalendar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof EventsCalendar>

export default meta
type Story = StoryObj<typeof meta>

const PATH = 'Team Calendar.md'
const BODY = [
    '---',
    'type: base',
    'view: calendar',
    '---',
    '',
    '| id | title | date | startTime | endTime | location | link | description | category | recurrence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    `| e1 | Sprint planning | ${todayISO()} | 10:00 | 11:00 |  |  |  |  |  |`,
    `| e2 | Offsite | ${todayISO()} |  |  |  |  |  |  |  |`,
].join('\n')

/** No `basePath`: an in-memory calendar with no events, the state an unsaved calendar is in. */
export const Empty: Story = {
    render: () => (
        <CalendarFrame>
            <EventsCalendar />
        </CalendarFrame>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(within(canvasElement).queryAllByTestId('event-chip').length).toBe(0))
    },
}

/** A base path: the events are read from the file. A timed event lands in the time grid, an
 *  untimed one in the all-day row — both as chips. */
export const FromABaseFile: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [PATH]: BODY } }))
        return (
            <CalendarFrame>
                <EventsCalendar basePath={PATH} />
            </CalendarFrame>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await waitFor(() => expect(c.getByText('Sprint planning')).toBeInTheDocument())
        expect(c.getByText('Offsite')).toBeInTheDocument()
    },
}

const RECURRING_PATH = 'Routine.md'
const RECURRING_BODY = [
    '---',
    'type: base',
    'view: calendar',
    '---',
    '',
    '| id | title | date | startTime | endTime | location | link | description | category | recurrence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    `| r1 | Morning routine | ${todayISO()} | 08:00 | 09:00 |  |  |  |  | {"type":"daily","startDate":"2026-01-01","seriesId":"s1"} |`,
].join('\n')

/** A daily recurring event in the week grid: each day shows one occurrence. Dragging one
 *  occurrence to another day or time asks which occurrences the move applies to. */
export const RecurringEvent: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [RECURRING_PATH]: RECURRING_BODY } }))
        return (
            <CalendarFrame>
                <EventsCalendar basePath={RECURRING_PATH} />
            </CalendarFrame>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await waitFor(() => expect(c.getAllByText('Morning routine').length).toBeGreaterThan(1))
    },
}
