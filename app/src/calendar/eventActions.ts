// Final signatures:
//   type RecurrenceScope = 'one' | 'following' | 'all'   (the RecurrenceDialog's stored scopes)
//   deleteEventWithUndo(store: EventStore, event: CalendarEvent, scope?: RecurrenceScope): Promise<void>
//   duplicateEvent(store: EventStore, event: CalendarEvent): Promise<CalendarEvent>
//
// `event` is what a chip/modal holds: for a recurring event that is an expanded occurrence, so
// `event.id` is the master id and `event.date` the occurrence date. A non-recurring event ignores
// `scope`; a recurring one defaults to 'one'. Deletes exactly as RecurrenceDialog does
// (deleteOccurrence / deleteFollowing / deleteSeries), then pushes `deleted <title>` with an undo.
//
// Undo snapshots the affected masters (the event, or the whole series — a split creates new masters
// under the same seriesId) BEFORE the delete, and on undo replaces the series with that snapshot.
// EventStore keeps its rows private, so the snapshot reads `data` through a cast; undo puts the
// rows back through `restoreEvents`, with their original ids.
import type { CalendarEvent, EventsFile } from './types'
import { EventStore, uuid } from './EventStore'
import { refreshEvents } from './refresh'
import { pushUndoToast } from '../undoToast'

export type RecurrenceScope = 'one' | 'following' | 'all'

const masterRows = (store: EventStore): CalendarEvent[] =>
    (store as unknown as { data: EventsFile }).data.events

const withoutId = ({ id: _id, ...rest }: CalendarEvent) => rest

export async function deleteEventWithUndo(
    store: EventStore,
    event: CalendarEvent,
    scope: RecurrenceScope = 'one',
): Promise<void> {
    const seriesId = event.recurrence?.seriesId
    const snapshot = structuredClone(
        seriesId
            ? masterRows(store).filter(e => e.recurrence?.seriesId === seriesId)
            : masterRows(store).filter(e => e.id === event.id),
    )

    if (!seriesId) await store.deleteEvent(event.id)
    else if (scope === 'all') await store.deleteSeries(seriesId)
    else if (scope === 'following')
        await store.deleteFollowing(event.id, event.date)
    else await store.deleteOccurrence(event.id, event.date)
    await refreshEvents(store)

    pushUndoToast(`deleted ${event.title}`, async () => {
        // a split ('one') can leave extra masters under the seriesId with fresh ids: clear them,
        // then put the snapshot back under its ORIGINAL ids so gcal links survive.
        if (seriesId) await store.deleteSeries(seriesId)
        await store.restoreEvents(snapshot)
        await refreshEvents(store)
    })
}

export async function duplicateEvent(
    store: EventStore,
    event: CalendarEvent,
): Promise<CalendarEvent> {
    const { localUpdated: _stamp, ...rest } = withoutId(event)
    const copy = await store.addEvent({
        ...rest,
        ...(event.recurrence
            ? { recurrence: { ...event.recurrence, seriesId: uuid() } }
            : {}),
    })
    await refreshEvents(store)
    return copy
}
