// Visual spec for <TimeGrid> — the shared 24h day-column grid behind Week/Day/ThreeDay (plus
// a sticky all-day row above). Unlike the other calendar view components, TimeGrid genuinely
// takes its data as props (dates/events/categories/store) rather than reading module-level
// state — but we still seed the module state via seedCalendarState() and read the resulting
// signals for the props, so the fixture data isn't duplicated. See
// app/src/ui/_calendarFixtures.ts for the full gotcha writeup.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { TimeGrid } from './TimeGrid'
import { EventStore, MemoryBackend } from '../../EventStore'
import { seedCalendarState } from '../../../ui/_calendarFixtures'
import { events, categories } from '../../state'
import { addDays, toDateStr } from '../../dates'
import styles from '../../Calendar.module.css'

// Fixed px, NOT a vh unit: Storybook's preview iframe is only ~315px tall with the Controls
// panel open, so 80vh resolved to 252px — which clipped the month grid's last two week rows and
// cut event chips mid-text. These views need a flex ancestor with real height; the app gives them
// the window, so a story has to state one.
const STORY_H = '760px'

const meta = {
    title: 'Calendar/TimeGrid',
    component: TimeGrid,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TimeGrid>

export default meta
type Story = StoryObj<typeof meta>

const anchor = new Date(2026, 0, 12)

/** A 5-day span covering every sample event: timed events, an all-day event, and a
 *  two-category ("Work" + "Focus") gradient chip. */
export const Default: Story = {
    render: () => {
        seedCalendarState({ date: anchor })
        const dates = Array.from({ length: 5 }, (_, i) => addDays(anchor, i))
        return (
            <div class={styles['calendar-app']} style={{ height: STORY_H }}>
                <TimeGrid
                    dates={dates}
                    events={events.value}
                    categories={categories.value}
                    store={new EventStore(new MemoryBackend())}
                />
            </div>
        )
    },
}

/** Three overlapping meetings on one day — exercises TimeGrid's first-fit lane layout
 *  (computeLanes), which splits overlapping events into side-by-side columns instead of
 *  stacking them on top of each other. */
export const OverlappingEvents: Story = {
    render: () => {
        const day = toDateStr(anchor)
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
            <div class={styles['calendar-app']} style={{ height: STORY_H }}>
                <TimeGrid
                    dates={[anchor]}
                    events={events.value}
                    categories={categories.value}
                    store={new EventStore(new MemoryBackend())}
                />
            </div>
        )
    },
}
