// Visual spec for <WeekView> — a thin composition wrapping TimeGrid with the 7 dates of the
// week containing `currentDate`. Same module-state pattern as MonthView (see its story file
// for the two gotchas): only `store` is a prop.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { CalendarEvent, Category } from '../../types'
import { onMount } from 'solid-js'
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

// A realistic busy week — back-to-back meetings in one category, overlaps, two-category and
// unfiled events: the density a calendar is actually read at.
const WEEK_CATEGORIES: Category[] = [
    { name: 'Work', color: 'blue' },
    { name: 'Personal', color: 'rose' },
    { name: 'Focus', color: 'violet' }, { name: 'Health', color: 'green' }, { name: 'Admin', color: 'gold' }]
const wk = (d: number, id: string, title: string, start: string, end: string, cats: string[] = []): CalendarEvent => ({
    id, title, date: `2026-01-${String(d).padStart(2, '0')}`, startTime: start, endTime: end,
    ...(cats.length ? { category: cats[0], categories: cats } : {}),
})
const WEEK_EVENTS: CalendarEvent[] = [
    { id: 'w-ad1', title: 'Conference', date: '2026-01-14', category: 'Work', categories: ['Work', 'Focus'] },
    { id: 'w-ad2', title: 'Rent due', date: '2026-01-16', category: 'Admin' },
    wk(12, 'w1', 'Standup', '09:00', '09:15', ['Work']),
    wk(12, 'w2', 'Design review', '09:30', '10:30', ['Work']),
    wk(12, 'w3', 'Roadmap sync', '10:30', '11:30', ['Work']),
    wk(12, 'w4', 'Lunch with Sam', '12:00', '13:00', ['Personal']),
    wk(12, 'w5', 'Deep work', '13:30', '16:00', ['Focus']),
    wk(13, 'w6', 'Standup', '09:00', '09:15', ['Work']),
    wk(13, 'w7', 'Dentist', '10:00', '11:00', ['Health']),
    wk(13, 'w8', '1:1 with manager', '11:00', '11:30', ['Work']),
    wk(13, 'w9', 'Call the bank', '14:00', '14:30'),
    wk(13, 'w10', 'Pairing', '14:00', '15:30', ['Work', 'Focus']),
    wk(14, 'w11', 'Standup', '09:00', '09:15', ['Work']),
    wk(14, 'w12', 'Interview loop', '10:00', '12:00', ['Work']),
    wk(14, 'w13', 'Hiring debrief', '11:00', '11:45', ['Work']),
    wk(14, 'w14', 'Gym', '17:00', '18:00', ['Health']),
    wk(15, 'w15', 'Standup', '09:00', '09:15', ['Work']),
    wk(15, 'w16', 'Focus block', '09:30', '12:00', ['Focus']),
    wk(15, 'w17', 'Taxes', '13:00', '14:00', ['Admin']),
    wk(15, 'w18', 'Coffee with Ana', '15:00', '15:45', ['Personal']),
    wk(16, 'w19', 'Standup', '09:00', '09:15', ['Work']),
    wk(16, 'w20', 'Demo prep', '10:00', '11:00', ['Work']),
    wk(16, 'w21', 'Team demo', '11:00', '12:00', ['Work']),
    wk(16, 'w22', 'Retro', '12:00', '13:00', ['Work']),
    wk(16, 'w23', 'Unfiled thing', '15:00', '16:00'),
    wk(17, 'w24', 'Farmers market', '10:00', '11:30', ['Personal']),
    wk(17, 'w25', 'Run', '08:00', '09:00', ['Health']),
    wk(18, 'w26', 'Family dinner', '17:30', '19:30', ['Personal']),
]


/** A full, busy week (Mon 1/12 – Sun 1/18): back-to-back meetings in one category, overlapping
 *  lanes, a two-category event and an all-day one, unfiled events, five categories. The body is
 *  scrolled to 7:30am so the day's events are in view. */
export const BusyWeek: Story = {
    render: () => {
        seedCalendarState({ date: new Date(2026, 0, 12), categories: WEEK_CATEGORIES, events: WEEK_EVENTS })
        let host!: HTMLDivElement
        // The grid opens at midnight; scroll its body to 7:30am (50px per hour, GRID_PX / 24).
        onMount(() =>
            requestAnimationFrame(() => {
                for (const el of host.querySelectorAll<HTMLElement>('*'))
                    if (getComputedStyle(el).overflowY === 'auto') el.scrollTop = 7.5 * 50
            }),
        )
        return (
            <div ref={host} style={{ height: STORY_H }}>
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
