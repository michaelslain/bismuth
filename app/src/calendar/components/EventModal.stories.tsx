// Visual spec for <EventModal> — the create/edit form for a single calendar event: title,
// date/all-day, location/link, a markdown description, category chips, and the repeat
// controls. Takes only `store: EventStore`; WHETHER it's open, and whether it's creating or
// editing, come from the module-level `showEventModal` box in calendar/state.ts (same pattern
// as CategoryPanel.stories.tsx — read that file's header first) — stories set the box directly
// rather than passing props.
//
// <Modal> (which EventModal renders through) mounts via a Solid <Portal> straight onto
// document.body — outside canvasElement/#storybook-root entirely (see Modal.tsx). So every
// play below queries `document`, not `canvasElement`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Show } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { EventModal } from './EventModal'
import { EventStore, MemoryBackend } from '../EventStore'
import { showEventModal, events, currentDate } from '../state'
import { seedCalendarState } from '../../ui/_calendarFixtures'
import '../Calendar.css'

const meta = {
    title: 'Calendar/EventModal',
    component: EventModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EventModal>

export default meta
type Story = StoryObj<typeof meta>

// A fixed anchor (not `new Date()`) so `Interactive`'s save lands inside the same month
// `refreshEvents` queries after the save — see that story's play.
const ANCHOR = new Date(2026, 7, 20)

/** Reactive host: EventModal itself reads `showEventModal.value` once, synchronously, at the
 *  top of its function body (`if (!modal) return null`) — not inside a tracked JSX
 *  expression — so it never re-renders itself closed. Wrapping it in a keyed <Show> here (the
 *  box read IS reactive as a JSX `when`) lets the Interactive story's play watch the portal
 *  content unmount for real when a save/cancel sets the box back to null. */
function Host(props: { store: EventStore }) {
    return (
        <Show when={showEventModal.value}>
            <EventModal store={props.store} />
        </Show>
    )
}

/** A new, blank event seeded for 2026-08-20 — no `startTime`, so the form opens all-day. */
export const NewEvent: Story = {
    render: () => {
        seedCalendarState({ date: ANCHOR, events: [] })
        showEventModal.value = { date: '2026-08-20' }
        return <Host store={new EventStore(new MemoryBackend())} />
    },
}

/** Editing an existing timed event that already carries location, link, description and a
 *  category — every optional field populated at once, the form's fullest resting state. */
export const EditingTimedEvent: Story = {
    render: () => {
        const editing = {
            id: 'evt-1',
            title: 'Design review',
            date: '2026-08-20',
            startTime: '14:00',
            endTime: '15:00',
            location: 'Room 4B',
            link: 'meet.example.com/design-review',
            description: 'Walk through the **new onboarding flow** mockups.',
            category: 'Work',
        }
        seedCalendarState({ date: ANCHOR, events: [editing] })
        showEventModal.value = { event: editing }
        return <Host store={new EventStore(new MemoryBackend())} />
    },
}

/** Editing a recurring weekly event — shows the day-of-week picker and the optional "Ends"
 *  date field, both hidden for a non-recurring event. */
export const RecurringWeekly: Story = {
    render: () => {
        const editing = {
            id: 'evt-2',
            title: 'Standup',
            date: '2026-08-17',
            startTime: '09:00',
            endTime: '09:15',
            category: 'Work',
            recurrence: {
                type: 'weekly' as const,
                daysOfWeek: [1, 3, 5],
                startDate: '2026-08-17',
                endDate: '2026-09-30',
                seriesId: 'series-1',
            },
        }
        seedCalendarState({ date: ANCHOR, events: [editing] })
        showEventModal.value = { event: editing }
        return <Host store={new EventStore(new MemoryBackend())} />
    },
}

/** No categories at all — the "None" chip is the only option, exercising the empty
 *  category-vocabulary case CategoryPanel's own stories don't cover from this side. */
export const NoCategories: Story = {
    render: () => {
        seedCalendarState({ date: ANCHOR, events: [], categories: [] })
        showEventModal.value = { date: '2026-08-20' }
        return <Host store={new EventStore(new MemoryBackend())} />
    },
}

/** End to end: type a title, flip off all-day (revealing the time fields), pick a category,
 *  then CREATE EVENT. Proves the save path really writes through `store.addEvent` +
 *  `refreshEvents` (the new title shows up in `events.value` for the seeded month) and that
 *  the modal actually closes (the portal content unmounts) — not just that the button is
 *  clickable. */
export const Interactive: Story = {
    render: () => {
        seedCalendarState({ date: ANCHOR, events: [] })
        showEventModal.value = { date: '2026-08-20' }
        return <Host store={new EventStore(new MemoryBackend())} />
    },
    play: async () => {
        const body = within(document.body)

        const titleInput = document.querySelector(
            '.evm-titlein',
        ) as HTMLInputElement | null
        if (!titleInput) throw new Error('title input not found')
        await userEvent.type(titleInput, 'Plan the offsite')

        // All-day defaults on (no startTime seeded); flip it off to reveal the time row.
        const allDayToggle = body.getByText('All day')
        await userEvent.click(allDayToggle)
        await waitFor(() =>
            expect(document.querySelector('.evm-times')).not.toBeNull(),
        )

        const catChip = body.getByText('Work')
        await userEvent.click(catChip)

        const createBtn = body.getByText('CREATE EVENT')
        await userEvent.click(createBtn)

        // The box flips back to null and the Host's <Show> unmounts the portal content.
        await waitFor(() =>
            expect(document.querySelector('.evm-modal')).toBeNull(),
        )
        await waitFor(() =>
            expect(events.value.some(e => e.title === 'Plan the offsite')).toBe(
                true,
            ),
        )
        expect(currentDate.value.getMonth()).toBe(ANCHOR.getMonth())
    },
}
