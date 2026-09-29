// Visual spec for <WeekView> — a thin composition wrapping TimeGrid with the 7 dates of the
// week containing `currentDate`. Same module-state pattern as MonthView (see its story file
// for the two gotchas): only `store` is a prop.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { WeekView } from './WeekView'
import { EventStore, MemoryBackend } from '../../EventStore'
import { seedCalendarState } from '../../../ui/_calendarFixtures'
import CalendarFrame from '../CalendarFrame'

// Fixed px, NOT a vh unit: Storybook's preview iframe is only ~315px tall with the Controls
// panel open, so 80vh resolved to 252px — which clipped the month grid's last two week rows and
// cut event chips mid-text. These views need a flex ancestor with real height; the app gives them
// the window, so a story has to state one.
const STORY_H = '760px'

import { expect, within } from 'storybook/test'
import { placeRows } from '../../taskPlacement'
import { taskRow } from '../../../ui/_calendarAssertions'
import { todayISO } from '../../../../../core/src/dates'

const meta = {
    title: 'Calendar/WeekView',
    component: WeekView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WeekView>

export default meta
type Story = StoryObj<typeof meta>

const anchor = new Date(2026, 0, 14) // a Wednesday, mid-week

/** The standard sample events across the anchor week. */
export const Default: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <WeekView store={new EventStore(new MemoryBackend())} />
                </CalendarFrame>
            </div>
        )
    },
}

/** An all-day event alongside timed events on the same day — exercises the sticky
 *  all-day row above the time grid. */
export const AllDayRow: Story = {
    render: () => {
        seedCalendarState({
            date: anchor,
            categories: [
                { name: 'Work', color: 'gold' },
                { name: 'Personal', color: 'teal' },
            ],
            events: [
                {
                    id: 'ad-1',
                    title: 'Conference (all day)',
                    date: '2026-01-14',
                    category: 'Work',
                },
                {
                    id: 'ad-2',
                    title: 'Standup',
                    date: '2026-01-14',
                    startTime: '09:00',
                    endTime: '09:15',
                    category: 'Work',
                },
                {
                    id: 'ad-3',
                    title: 'Lunch with Sam',
                    date: '2026-01-14',
                    startTime: '12:30',
                    endTime: '13:15',
                    category: 'Personal',
                },
            ],
        })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <WeekView store={new EventStore(new MemoryBackend())} />
                </CalendarFrame>
            </div>
        )
    },
}

/** The tasks register: `placed` selects it, so the view draws all-day task chips through
 *  TaskAllDayStrip and never mounts the hourly grid. */
export const TasksRegister: Story = {
    render: () => {
        seedCalendarState({ date: new Date() })
        const today = todayISO()
        const placed = placeRows(
            [
                taskRow('pay rent', { line: 1, scheduled: today }),
                taskRow('call [[Ana]] about **the** roadmap', { line: 2, scheduled: today }),
            ],
            today,
        )
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <WeekView store={new EventStore(new MemoryBackend())} {...{ placed }} />
                </CalendarFrame>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        expect(c.getAllByRole('checkbox').length).toBe(2)
        expect(c.queryByTestId('time-grid-day-col')).toBeNull()
        expect(canvasElement.textContent).not.toContain('[[Ana]]')
    },
}
