// Visual spec for <RecurrenceDialog> — "This event / This and following / All events" scope
// picker shown after a save/delete on a recurring occurrence. Takes only `store: EventStore`;
// whether it's open (and delete-vs-edit copy/icon/danger styling) comes entirely from the
// module-level `recurrenceAction` box in calendar/state.ts (same pattern as
// CategoryPanel.stories.tsx and EventModal.stories.tsx — read either's header first). The
// component itself already wraps its content in `<Show when={recurrenceAction.value}>`, so
// (unlike EventModal) it DOES re-render closed reactively — no extra Host wrapper needed here.
//
// <Modal> mounts via a Solid <Portal> straight onto document.body — outside
// canvasElement/#storybook-root entirely (see Modal.tsx). So every play below queries
// `document`, not `canvasElement`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { RecurrenceDialog } from './RecurrenceDialog'
import { EventStore, MemoryBackend } from '../EventStore'
import { recurrenceAction, events } from '../state'
import type { CalendarEvent } from '../types'

const meta = {
    title: 'Calendar/RecurrenceDialog',
    component: RecurrenceDialog,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RecurrenceDialog>

export default meta
type Story = StoryObj<typeof meta>

const MASTER: CalendarEvent = {
    id: 'master-1',
    title: 'Standup',
    date: '2026-08-17',
    startTime: '09:00',
    endTime: '09:15',
    category: 'Work',
    recurrence: {
        type: 'weekly',
        daysOfWeek: [1, 3, 5],
        startDate: '2026-08-17',
        seriesId: 'series-1',
    },
}

/** A delete on one occurrence of a recurring series — the danger-tinted variant (`.rec-opts
 *  .danger`), trash icon, red DELETE styling on the parent form it followed. */
export const DeleteScope: Story = {
    render: () => {
        events.value = [MASTER]
        recurrenceAction.value = {
            type: 'delete',
            masterId: MASTER.id,
            occurrenceDate: '2026-08-19',
        }
        return <RecurrenceDialog store={new EventStore(new MemoryBackend())} />
    },
}

/** An edit on one occurrence — the repeat icon + non-danger styling, and `updates` carried
 *  through to whichever scope is chosen. */
export const EditScope: Story = {
    render: () => {
        events.value = [MASTER]
        recurrenceAction.value = {
            type: 'edit',
            masterId: MASTER.id,
            occurrenceDate: '2026-08-19',
            updates: { title: 'Standup (moved)' },
        }
        return <RecurrenceDialog store={new EventStore(new MemoryBackend())} />
    },
}

/** The master event isn't in `events.value` (e.g. it scrolled out of the loaded range) — the
 *  sub-title falls back to the generic "Choose which occurrences..." copy instead of a title. */
export const UnresolvedTitle: Story = {
    render: () => {
        events.value = []
        recurrenceAction.value = {
            type: 'delete',
            masterId: 'missing-master',
            occurrenceDate: '2026-08-19',
        }
        return <RecurrenceDialog store={new EventStore(new MemoryBackend())} />
    },
}

/** Choosing "This event" clears `recurrenceAction` and closes the dialog for real — proves the
 *  scope buttons actually drive the store, not just that they're clickable. */
export const Interactive: Story = {
    render: () => {
        events.value = [MASTER]
        recurrenceAction.value = {
            type: 'delete',
            masterId: MASTER.id,
            occurrenceDate: '2026-08-19',
        }
        return <RecurrenceDialog store={new EventStore(new MemoryBackend())} />
    },
    play: async () => {
        const body = within(document.body)
        const thisEvent = body.getByText('This event')
        await userEvent.click(thisEvent)
        await waitFor(() =>
            expect(document.querySelector('.recurrence-dialog')).toBeNull(),
        )
        expect(recurrenceAction.value).toBeNull()
    },
}
