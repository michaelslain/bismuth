// Sample data + a state-seeding helper for calendar-view stories (dev-only, Storybook). NOT a
// story file itself — the `*.stories.*` glob (see `.storybook/main.ts`) skips underscore-
// prefixed files.
//
// GOTCHA #1 — module-level state, not props: app/src/calendar/components/views/{Month,Week,
// Day,ThreeDay}View.tsx read `events`/`categories`/`currentDate` from the MODULE-LEVEL signals
// in app/src/calendar/state.ts (the `createBox` pattern), not from component props. A story
// MUST call `seedCalendarState()` before mounting one of those views, or it renders empty
// regardless of what props you pass it.
//
// GOTCHA #2 — every calendar view ALSO takes a `store: EventStore` prop. Pass
// `new EventStore(new MemoryBackend())` (app/src/calendar/EventStore.ts) — already fully
// in-memory, no fixture needed.
//
// GOTCHA #3 — CSS: app/src/calendar/Calendar.module.css is a CSS Module (2026-08
// modularization), so every component that renders one of its classes imports it directly as
// `styles` — including every file under calendar/components/, not just the three Bases
// consumers (CalendarView.tsx / BaseSettings.tsx / QueryBuilder.tsx) that predate the move.
// A story that builds its OWN wrapper markup (a bare `<div class="calendar-app">`-shaped host,
// not just the component under test) still needs its own `import styles from
// "../calendar/Calendar.module.css"` to read the same hashed names, or its wrapper renders
// unstyled even though the component inside it looks right.
import { currentDate, events, categories } from '../calendar/state'
import type { CalendarEvent, Category } from '../calendar/types'

/** Category colours are bare THEME TOKEN names (app/src/ui/palette.ts's `PALETTE_TOKENS`),
 *  not literal CSS colours — categoryColor.ts resolves them to `var(--<token>)` at render
 *  time, so they track the active theme like every other design token. */
const SAMPLE_CATEGORIES: Category[] = [
    { name: 'Work', color: 'blue' },
    { name: 'Personal', color: 'green' },
    { name: 'Focus', color: 'violet' },
]

function toDateStr(d: Date): string {
    return d.toISOString().slice(0, 10)
}

function sampleEvents(anchor: Date): CalendarEvent[] {
    const at = (dayOffset: number) => {
        const d = new Date(anchor)
        d.setDate(d.getDate() + dayOffset)
        return toDateStr(d)
    }
    return [
        {
            id: 'sample-1',
            title: 'Standup',
            date: at(0),
            startTime: '09:00',
            endTime: '09:15',
            category: 'Work',
        },
        {
            id: 'sample-2',
            title: 'Design review',
            date: at(0),
            startTime: '14:00',
            endTime: '15:00',
            category: 'Work',
        },
        { id: 'sample-3', title: 'Dentist', date: at(1), category: 'Personal' },
        {
            id: 'sample-4',
            title: 'Deep work block',
            date: at(2),
            startTime: '10:00',
            endTime: '12:00',
            category: 'Focus',
        },
        {
            id: 'sample-5',
            title: 'Team offsite',
            date: at(4),
            category: 'Work',
            categories: ['Work', 'Focus'],
        },
    ]
}

export interface CalendarStateSeed {
    /** Anchor date for `currentDate` and the sample events (default: `new Date()`). */
    date?: Date
    events?: CalendarEvent[]
    categories?: Category[]
}

/**
 * Seed the calendar's module-level signals (see GOTCHA #1 above) before a calendar story
 * renders. Call this at the top of the story's `render`, or in a `beforeEach`-style decorator
 * shared by every story in the file — the boxes are module-level, so they persist across
 * stories in the same Storybook session until reseeded.
 */
export function seedCalendarState(seed: CalendarStateSeed = {}): void {
    const anchor = seed.date ?? new Date()
    currentDate.value = anchor
    categories.value = seed.categories ?? SAMPLE_CATEGORIES
    events.value = seed.events ?? sampleEvents(anchor)
}
