// Visual spec for <ThreeDayView> — TimeGrid scoped to currentDate + the next 2 days. Same
// module-state pattern as the other views: only `store` is a prop.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ThreeDayView } from './ThreeDayView'
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
    title: 'Calendar/ThreeDayView',
    component: ThreeDayView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ThreeDayView>

export default meta
type Story = StoryObj<typeof meta>

const anchor = new Date(2026, 0, 12)

/** The standard sample events across the anchor 3-day span. */
export const Default: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <ThreeDayView store={new EventStore(new MemoryBackend())} />
                </CalendarFrame>
            </div>
        )
    },
}

/** Each of the 3 days carries a different category colour, including a two-category
 *  ("Work" + "Focus") gradient chip on the last day. */
export const CategoryColors: Story = {
    render: () => {
        seedCalendarState({
            date: anchor,
            categories: [
                { name: 'Work', color: 'blue' },
                { name: 'Personal', color: 'rose' },
                { name: 'Focus', color: 'violet' },
            ],
            events: [
                {
                    id: 'cc-1',
                    title: 'Standup',
                    date: '2026-01-12',
                    startTime: '09:00',
                    endTime: '09:15',
                    category: 'Work',
                },
                {
                    id: 'cc-2',
                    title: 'Dentist',
                    date: '2026-01-13',
                    startTime: '15:00',
                    endTime: '16:00',
                    category: 'Personal',
                },
                {
                    id: 'cc-3',
                    title: 'Team offsite',
                    date: '2026-01-14',
                    startTime: '10:00',
                    endTime: '16:00',
                    category: 'Work',
                    categories: ['Work', 'Focus'],
                },
            ],
        })
        return (
            <div style={{ height: STORY_H }}>
                <CalendarFrame>
                    <ThreeDayView store={new EventStore(new MemoryBackend())} />
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
                    <ThreeDayView store={new EventStore(new MemoryBackend())} {...{ placed }} />
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
