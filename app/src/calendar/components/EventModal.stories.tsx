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
import { ToastHost } from '../../ui/ToastHost'
import { toasts, dismissToast } from '../../ui/toastStore'
import { EventStore, MemoryBackend } from '../EventStore'
import { showEventModal, events, currentDate } from '../state'
import { seedCalendarState } from '../../ui/_calendarFixtures'
import type { CalendarEvent } from '../types'

/** The modal is open and holds a form. Every story ends on this: a play that closes the modal
 *  (save, delete, duplicate) ends by re-opening it on the event it just wrote, so the shot shows
 *  the dialog instead of a blank 1200x800 frame — and a regression that leaves nothing on screen
 *  fails here instead of passing. */
async function expectModalOpen(): Promise<void> {
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
    expect(document.querySelector('[data-testid="event-modal-title"]')).not.toBeNull()
}

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
            '[data-testid="event-modal-title"]',
        ) as HTMLInputElement | null
        if (!titleInput) throw new Error('title input not found')
        await userEvent.type(titleInput, 'Plan the offsite')

        // All-day defaults on (no startTime seeded); flip it off to reveal the time row.
        const allDayToggle = body.getByRole('switch', { name: 'all day' })
        await userEvent.click(allDayToggle)
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="event-modal-times"]'),
            ).not.toBeNull(),
        )

        await userEvent.click(body.getByRole('button', { name: /Work/ }))

        const createBtn = body.getByText('create event')
        await userEvent.click(createBtn)

        // The box flips back to null and the Host's <Show> unmounts the portal content.
        await waitFor(() =>
            expect(document.querySelector('[role="dialog"]')).toBeNull(),
        )
        await waitFor(() =>
            expect(events.value.some(e => e.title === 'Plan the offsite')).toBe(
                true,
            ),
        )
        expect(currentDate.value.getMonth()).toBe(ANCHOR.getMonth())

        // End with the saved event open for editing, so the frame shows the form.
        showEventModal.value = {
            event: events.value.find(e => e.title === 'Plan the offsite')!,
        }
        await expectModalOpen()
        expect(
            (document.querySelector('[data-testid="event-modal-title"]') as HTMLInputElement)
                .value,
        ).toBe('Plan the offsite')
    },
}

/** Keyboard-only proof for the three rows that became real bracket toggles: category,
 *  weekday and all-day. Each control is a real `<button>` — focusable, Space flips it, and
 *  `aria-pressed` tracks the flip. Seeded with a weekly recurrence whose days (Mon/Wed/Fri)
 *  exclude Thursday, and no category, so "work"/"thu" both start unpicked and all-day starts
 *  on (no `startTime`). */
export const KeyboardToggles: Story = {
    render: () => {
        const editing = {
            id: 'evt-kb',
            title: 'Keyboard demo',
            date: '2026-08-20',
            recurrence: {
                type: 'weekly' as const,
                daysOfWeek: [1, 3, 5],
                startDate: '2026-08-20',
                seriesId: 'series-kb',
            },
        }
        seedCalendarState({ date: ANCHOR, events: [editing] })
        showEventModal.value = { event: editing }
        return <Host store={new EventStore(new MemoryBackend())} />
    },
    play: async () => {
        const body = within(document.body)

        const workBtn = body.getByRole('button', { name: /^work/i })
        expect(workBtn).toHaveAttribute('aria-pressed', 'false')
        workBtn.focus()
        await userEvent.keyboard(' ')
        expect(workBtn).toHaveAttribute('aria-pressed', 'true')

        const thuBtn = body.getByRole('button', { name: 'thu' })
        expect(thuBtn).toHaveAttribute('aria-pressed', 'false')
        thuBtn.focus()
        await userEvent.keyboard(' ')
        expect(thuBtn).toHaveAttribute('aria-pressed', 'true')

        // Enter on a focused toggle must flip the toggle, not save-and-close the modal.
        const tueBtn = body.getByRole('button', { name: 'tue' })
        expect(tueBtn).toHaveAttribute('aria-pressed', 'false')
        tueBtn.focus()
        await userEvent.keyboard('{Enter}')
        expect(tueBtn).toHaveAttribute('aria-pressed', 'true')
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()

        // Backspace on a focused toggle must not delete the event.
        tueBtn.focus()
        await userEvent.keyboard('{Backspace}')
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()

        const allDayBtn = body.getByRole('switch', { name: 'all day' })
        expect(allDayBtn).toHaveAttribute('aria-checked', 'true')
        allDayBtn.focus()
        await userEvent.keyboard(' ')
        expect(allDayBtn).toHaveAttribute('aria-checked', 'false')
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="event-modal-times"]'),
            ).not.toBeNull(),
        )
    },
}

/** Regression: Backspace with focus on the modal body used to DELETE the event (a window listener).
 *  There is no Backspace delete; the event and the dialog must survive. */
export const BackspaceDoesNotDelete: Story = {
    render: () => {
        const editing = {
            id: 'evt-bs',
            title: 'Keep me',
            date: '2026-08-20',
            startTime: '10:00',
            endTime: '11:00',
        }
        seedCalendarState({ date: ANCHOR, events: [editing] })
        showEventModal.value = { event: editing }
        return <Host store={new EventStore(new MemoryBackend())} />
    },
    play: async () => {
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement
        dialog.tabIndex = -1
        dialog.focus()
        await userEvent.keyboard('{Backspace}')
        await new Promise(r => setTimeout(r, 100))
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
        expect(events.value.some(e => e.id === 'evt-bs')).toBe(true)
    },
}

/** A store that really holds `event` (addEvent pushes synchronously), so delete / duplicate act on
 *  a row that exists. Returns the stored master, which carries the store's id. */
function storeWith(event: Omit<CalendarEvent, 'id'>) {
    const store = new EventStore(new MemoryBackend())
    void store.addEvent(event)
    const editing = (store as unknown as { data: { events: CalendarEvent[] } }).data
        .events[0]
    seedCalendarState({ date: ANCHOR, events: [editing] })
    showEventModal.value = { event: editing }
    return { store, editing }
}

const clearToasts = () => toasts().forEach(t => dismissToast(t.id))

/** Delete is immediate: the dialog closes, `deleted <title>` appears with an undo, and undo puts
 *  the event back. */
export const DeleteWithUndo: Story = {
    render: () => {
        clearToasts()
        const { store } = storeWith({
            title: 'Dentist',
            date: '2026-08-20',
            startTime: '10:00',
            endTime: '11:00',
        })
        return (
            <>
                <Host {...{ store }} />
                <ToastHost />
            </>
        )
    },
    play: async () => {
        const body = within(document.body)
        await userEvent.click(body.getByRole('button', { name: 'delete' }))
        await waitFor(() =>
            expect(document.querySelector('[role="dialog"]')).toBeNull(),
        )
        expect(events.value.some(e => e.title === 'Dentist')).toBe(false)
        expect(body.getByText('deleted Dentist')).toBeTruthy()
        await userEvent.click(await body.findByRole('button', { name: 'undo' }))
        await waitFor(() =>
            expect(events.value.some(e => e.title === 'Dentist')).toBe(true),
        )

        // End with the restored event open for editing, so the frame shows the form.
        showEventModal.value = {
            event: events.value.find(e => e.title === 'Dentist')!,
        }
        await expectModalOpen()
    },
}

/** Duplicate of an untouched event adds a second copy and closes. */
export const Duplicate: Story = {
    render: () => {
        const { store } = storeWith({
            title: 'Retro',
            date: '2026-08-20',
            startTime: '15:00',
            endTime: '16:00',
        })
        return <Host {...{ store }} />
    },
    play: async () => {
        await userEvent.click(
            within(document.body).getByRole('button', { name: 'duplicate' }),
        )
        await waitFor(() =>
            expect(events.value.filter(e => e.title === 'Retro')).toHaveLength(2),
        )
        expect(document.querySelector('[role="dialog"]')).toBeNull()

        // End with the duplicate open for editing, so the frame shows the form.
        showEventModal.value = {
            event: events.value.filter(e => e.title === 'Retro')[1],
        }
        await expectModalOpen()
    },
}

class FailingStore extends EventStore {
    async addEvent(): Promise<never> {
        throw new Error('disk full')
    }
}

/** A failing write toasts and leaves the modal open (nothing is lost), instead of an unhandled
 *  rejection with a dialog that looks frozen. */
export const SaveError: Story = {
    render: () => {
        clearToasts()
        seedCalendarState({ date: ANCHOR, events: [] })
        showEventModal.value = { date: '2026-08-20' }
        return (
            <>
                <Host store={new FailingStore(new MemoryBackend())} />
                <ToastHost />
            </>
        )
    },
    play: async () => {
        const body = within(document.body)
        await userEvent.type(
            document.querySelector('[data-testid="event-modal-title"]') as HTMLElement,
            'Will fail',
        )
        await userEvent.click(body.getByRole('button', { name: 'create event' }))
        expect(
            await body.findByText('Could not save the event: disk full'),
        ).toBeTruthy()
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    },
}

/** Repeat: biweekly keeps the weekday chips; switching to monthly drops them; `ends` stays. */
export const BiweeklyToMonthly: Story = {
    render: () => {
        const editing = {
            id: 'evt-bw',
            title: 'Payroll',
            date: '2026-08-21',
            recurrence: {
                type: 'biweekly' as const,
                daysOfWeek: [5],
                startDate: '2026-08-21',
                endDate: '2026-12-31',
                seriesId: 'series-bw',
            },
        }
        seedCalendarState({ date: ANCHOR, events: [editing] })
        showEventModal.value = { event: editing }
        return <Host store={new EventStore(new MemoryBackend())} />
    },
    play: async () => {
        const body = within(document.body)
        expect(body.getByTestId('recurrence-days')).toBeTruthy()
        expect(body.getByText('ends')).toBeTruthy()
        await userEvent.click(body.getByRole('button', { name: 'monthly' }))
        expect(body.queryByTestId('recurrence-days')).toBeNull()
        expect(body.getByText('ends')).toBeTruthy()
    },
}
