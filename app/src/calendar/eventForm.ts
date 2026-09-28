// The event form's value model, pure: what the modal opens with, what a save writes, and whether
// the user has typed anything yet. No framework imports, so it is unit-tested directly.
import type { CalendarEvent, RecurrenceType } from './types'

/** Segmented repeat control: label shown to the user → stored RecurrenceType ('' = none). */
export const RECUR: [string, RecurrenceType | ''][] = [
    ['none', ''],
    ['daily', 'daily'],
    ['weekly', 'weekly'],
    ['biweekly', 'biweekly'],
    ['monthly', 'monthly'],
]

/** Weekday chips, Monday first: label → `Date.getDay()` index. */
export const DOW: [string, number][] = [
    ['mon', 1],
    ['tue', 2],
    ['wed', 3],
    ['thu', 4],
    ['fri', 5],
    ['sat', 6],
    ['sun', 0],
]

export type EventFormState = {
    title: string
    date: string
    startTime: string
    endTime: string
    allDay: boolean
    location: string
    link: string
    description: string
    /** Every category the event belongs to; the first is mirrored into the legacy `category`. */
    cats: string[]
    recType: RecurrenceType | ''
    recDays: number[]
    recStart: string
    recEnd: string
}

export type EventFormSeed = {
    date?: string
    startTime?: string
    endTime?: string
}

const namesOf = (e: CalendarEvent): string[] =>
    e.categories && e.categories.length
        ? [...e.categories]
        : e.category
          ? [e.category]
          : []

export function dayOfWeekOf(date: string): number {
    const [y, m, d] = date.split('-').map(Number)
    return new Date(y, m - 1, d).getDay()
}

export function initialEventForm(
    editing: CalendarEvent | undefined,
    seed: EventFormSeed,
    today: string,
): EventFormState {
    const date = editing?.date ?? seed.date ?? today
    const startTime = editing?.startTime ?? seed.startTime ?? ''
    return {
        title: editing?.title ?? '',
        date,
        startTime,
        endTime: editing?.endTime ?? seed.endTime ?? '',
        allDay: !startTime,
        location: editing?.location ?? '',
        link: editing?.link ?? '',
        description: editing?.description ?? '',
        cats: editing ? namesOf(editing) : [],
        recType: editing?.recurrence?.type ?? '',
        recDays: editing?.recurrence?.daysOfWeek
            ? [...editing.recurrence.daysOfWeek]
            : [dayOfWeekOf(date)],
        recStart: editing?.recurrence?.startDate ?? date,
        recEnd: editing?.recurrence?.endDate ?? '',
    }
}

/** The payload a save (or a duplicate) writes. `seriesId` is chosen by the caller: the event's
 *  own for a save, a fresh one for a copy so it is its own independent series. */
export function buildEventData(
    f: EventFormState,
    seriesId: string,
): Omit<CalendarEvent, 'id'> {
    const weekly = f.recType === 'weekly' || f.recType === 'biweekly'
    return {
        title: f.title,
        date: f.date,
        ...(f.allDay || !f.startTime
            ? {}
            : {
                  startTime: f.startTime,
                  ...(f.endTime && f.endTime > f.startTime
                      ? { endTime: f.endTime }
                      : {}),
              }),
        ...(f.location ? { location: f.location } : {}),
        ...(f.link ? { link: f.link } : {}),
        ...(f.description ? { description: f.description } : {}),
        // Both keys are always present (even undefined) so clearing categories on an edit really
        // clears them — updateEvent merges, so an omitted key would persist.
        category: f.cats[0],
        categories: f.cats.length > 1 ? [...f.cats] : undefined,
        ...(f.recType
            ? {
                  recurrence: {
                      type: f.recType,
                      ...(weekly
                          ? {
                                daysOfWeek: f.recDays.length
                                    ? [...f.recDays]
                                    : undefined,
                            }
                          : {}),
                      startDate: f.recStart || f.date,
                      endDate: f.recEnd || undefined,
                      seriesId,
                  },
              }
            : {}),
    }
}

/** True once any field differs from what the form opened with. */
export function formDirty(now: EventFormState, opened: EventFormState): boolean {
    return JSON.stringify(now) !== JSON.stringify(opened)
}
