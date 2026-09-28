// Visual spec for <DayView> — TimeGrid scoped to a single date (currentDate). Same
// module-state pattern as MonthView/WeekView: only `store` is a prop.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { DayView } from './DayView'
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
    title: 'Calendar/DayView',
    component: DayView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DayView>

export default meta
type Story = StoryObj<typeof meta>

const anchor = new Date(2026, 0, 12)

/** The standard sample events, scoped to the anchor day (Standup + Design review). */
export const Default: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <DayView store={new EventStore(new MemoryBackend())} />
                </CalendarFrame>
            </div>
        )
    },
}

/** Three overlapping meetings on one day — TimeGrid's first-fit lane layout splits them
 *  into side-by-side columns instead of stacking them on top of each other. */
export const DenseDay: Story = {
    render: () => {
        const day = '2026-01-12'
        seedCalendarState({
            date: anchor,
            categories: [
                { name: 'Work', color: 'blue' },
                { name: 'Personal', color: 'rose' },
                { name: 'Focus', color: 'violet' },
            ],
            events: [
                {
                    id: 'ov-1',
                    title: 'Sync with design',
                    date: day,
                    startTime: '10:00',
                    endTime: '11:00',
                    category: 'Work',
                },
                {
                    id: 'ov-2',
                    title: '1:1 with manager',
                    date: day,
                    startTime: '10:15',
                    endTime: '10:45',
                    category: 'Personal',
                },
                {
                    id: 'ov-3',
                    title: 'Focus block',
                    date: day,
                    startTime: '10:30',
                    endTime: '12:00',
                    category: 'Focus',
                },
            ],
        })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <DayView store={new EventStore(new MemoryBackend())} />
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
                    <DayView store={new EventStore(new MemoryBackend())} {...{ placed }} />
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
