import { CalendarEvent, Category, EventsFile } from './types'
import { addDays } from './dates'
import { todayISO } from '../../../core/src/dates'
import {
    expandRecurrence,
    daysBetween,
    shiftRecurrence,
} from '../../../core/src/bases/recurrence'
import { addDaysISO } from '../../../core/src/dates'

export const uuid = () => crypto.randomUUID()

function dayBefore(isoDate: string): string {
    return todayISO(addDays(new Date(isoDate + 'T00:00:00'), -1))
}

export interface CalendarStorage {
    load(): EventsFile | null
    save(data: EventsFile): void
}

export class MemoryBackend implements CalendarStorage {
    private data: EventsFile | null = null
    load() {
        return this.data
    }
    save(d: EventsFile) {
        this.data = structuredClone(d)
    }
}

export class EventStore {
    private data: EventsFile = { events: [], categories: [] }
    constructor(private storage: CalendarStorage = new MemoryBackend()) {}

    async load(): Promise<void> {
        const raw = this.storage.load()
        this.data = {
            events: raw?.events ?? [],
            categories: raw?.categories ?? [],
        }
    }
    private async save(): Promise<void> {
        this.storage.save(this.data)
    }

    getEventsForRange(rangeStart: string, rangeEnd: string): CalendarEvent[] {
        const result: CalendarEvent[] = []
        for (const event of this.data.events) {
            if (!event.recurrence) {
                if (event.date >= rangeStart && event.date <= rangeEnd)
                    result.push(event)
            } else {
                for (const date of expandRecurrence(
                    event.recurrence,
                    rangeStart,
                    rangeEnd,
                ))
                    result.push({ ...event, date })
            }
        }
        return result
    }

    // Return a fresh array, not the live internal one: callers assign this straight to
    // a Solid signal (`categories.value = store.getCategories()`), and Solid skips the
    // update if the reference is unchanged — so an in-place category edit would never
    // re-render. A new array each call makes those assignments actually propagate.
    getCategories(): Category[] {
        return [...this.data.categories]
    }

    async addEvent(event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent> {
        const newEvent = {
            ...event,
            id: uuid(),
            localUpdated: new Date().toISOString(),
        }
        this.data.events.push(newEvent)
        await this.save()
        return newEvent
    }

    async updateEvent(
        id: string,
        updates: Partial<CalendarEvent>,
    ): Promise<void> {
        const idx = this.data.events.findIndex(e => e.id === id)
        if (idx !== -1) {
            this.data.events[idx] = {
                ...this.data.events[idx],
                ...updates,
                localUpdated: new Date().toISOString(),
            }
            await this.save()
        }
    }

    async deleteEvent(id: string): Promise<void> {
        this.data.events = this.data.events.filter(e => e.id !== id)
        await this.save()
    }

    async editOccurrence(
        masterId: string,
        occurrenceDate: string,
        updates: Partial<CalendarEvent>,
    ): Promise<void> {
        const master = this.data.events.find(e => e.id === masterId)
        if (!master?.recurrence) return
        await this.splitSeriesAroundOccurrence(master, occurrenceDate)
        const { id, recurrence, ...rest } = master
        const { recurrence: _excluded, ...singleUpdates } =
            updates as CalendarEvent
        // A drag or a date edit names the day the occurrence moves to; without one it stays put.
        await this.addEvent({
            ...rest,
            ...singleUpdates,
            date: updates.date ?? occurrenceDate,
        })
    }

    /**
     * Apply `updates` to every segment of a series. When `occurrenceDate` is given and
     * `updates.date` moves that occurrence to another day, the whole series moves by the same
     * number of days (start, end and weekdays); `date` itself is never copied onto the masters,
     * since a recurring event's days come from its rule.
     */
    async editSeries(
        seriesId: string,
        updates: Partial<CalendarEvent>,
        occurrenceDate?: string,
    ): Promise<void> {
        const masters = this.data.events.filter(
            e => e.recurrence?.seriesId === seriesId,
        )
        if (!occurrenceDate) {
            for (const m of masters) await this.updateEvent(m.id, updates)
            return
        }
        const { date, ...rest } = updates
        const days = date ? daysBetween(occurrenceDate, date) : 0
        for (const m of masters) {
            const rule = rest.recurrence ?? m.recurrence!
            await this.updateEvent(m.id, {
                ...rest,
                ...(days
                    ? {
                          date: addDaysISO(m.date, days),
                          recurrence: shiftRecurrence(rule, days),
                      }
                    : {}),
            })
        }
    }

    private async truncateSeriesBefore(
        master: CalendarEvent,
        occurrenceDate: string,
    ): Promise<void> {
        await this.updateEvent(master.id, {
            recurrence: {
                ...master.recurrence!,
                endDate: dayBefore(occurrenceDate),
            },
        })
    }

    /**
     * Split a recurring series around ONE occurrence: drop-or-truncate the head segment, then re-add
     * the tail segment when the series continued past that date.
     *
     * Shared verbatim by editOccurrence and deleteOccurrence, which carried byte-identical copies of
     * this block (the only difference was the word "Editing" vs "Deleting" in the comment).
     * editOccurrence is exactly this plus one extra addEvent for the edited occurrence itself.
     */
    private async splitSeriesAroundOccurrence(
        master: CalendarEvent,
        occurrenceDate: string,
    ): Promise<void> {
        const { seriesId, endDate: originalEndDate } = master.recurrence!
        const dayAfterDate = todayISO(
            addDays(new Date(occurrenceDate + 'T00:00:00'), 1),
        )
        // The FIRST occurrence has no head segment to keep, so drop the master entirely rather than
        // leaving a zombie with endDate < startDate.
        if (occurrenceDate === master.recurrence!.startDate) {
            await this.deleteEvent(master.id)
        } else {
            await this.truncateSeriesBefore(master, occurrenceDate)
        }
        if (!originalEndDate || originalEndDate > occurrenceDate) {
            const { id, ...masterRest } = master
            await this.addEvent({
                ...masterRest,
                recurrence: {
                    ...master.recurrence!,
                    startDate: dayAfterDate,
                    endDate: originalEndDate,
                    seriesId,
                },
            })
        }
    }

    async editFollowing(
        masterId: string,
        occurrenceDate: string,
        updates: Partial<CalendarEvent>,
    ): Promise<void> {
        const master = this.data.events.find(e => e.id === masterId)
        if (!master?.recurrence) return
        const originalEndDate = master.recurrence.endDate
        // The new segment moves by as many days as the occurrence did, so a drag from Wednesday
        // to Tuesday makes the rest of the series fall on Tuesdays.
        const days = updates.date
            ? daysBetween(occurrenceDate, updates.date)
            : 0
        const recurrence = shiftRecurrence(
            {
                ...master.recurrence,
                ...(updates.recurrence ?? {}),
                startDate: occurrenceDate,
                endDate: originalEndDate,
                seriesId: uuid(),
            },
            days,
        )
        // The old segment ends before whichever comes first, the dragged occurrence or the new
        // segment's first day: a series moved earlier must not overlap its own old tail.
        const cut =
            recurrence.startDate < occurrenceDate
                ? recurrence.startDate
                : occurrenceDate
        if (cut <= master.recurrence.startDate) await this.deleteEvent(master.id)
        else await this.truncateSeriesBefore(master, cut)
        const { id, ...masterRest } = master
        await this.addEvent({
            ...masterRest,
            ...updates,
            date: recurrence.startDate,
            recurrence,
        })
    }

    async deleteOccurrence(
        masterId: string,
        occurrenceDate: string,
    ): Promise<void> {
        const master = this.data.events.find(e => e.id === masterId)
        if (!master?.recurrence) return
        await this.splitSeriesAroundOccurrence(master, occurrenceDate)
    }

    async deleteSeries(seriesId: string): Promise<void> {
        this.data.events = this.data.events.filter(
            e => e.recurrence?.seriesId !== seriesId,
        )
        await this.save()
    }

    async deleteFollowing(
        masterId: string,
        occurrenceDate: string,
    ): Promise<void> {
        const master = this.data.events.find(e => e.id === masterId)
        if (!master?.recurrence) return
        await this.truncateSeriesBefore(master, occurrenceDate)
    }

    /** Puts snapshot rows back with their ORIGINAL ids: a row with the same id is replaced,
     *  anything else is appended. */
    async restoreEvents(rows: CalendarEvent[]): Promise<void> {
        for (const row of structuredClone(rows)) {
            const at = this.data.events.findIndex(e => e.id === row.id)
            if (at >= 0) this.data.events[at] = row
            else this.data.events.push(row)
        }
        await this.save()
    }

    async addCategory(category: Category, index?: number): Promise<void> {
        if (index === undefined) this.data.categories.push(category)
        else this.data.categories.splice(index, 0, category)
        await this.save()
    }

    async updateCategory(
        name: string,
        updates: Partial<Category>,
    ): Promise<void> {
        const idx = this.data.categories.findIndex(c => c.name === name)
        if (idx !== -1) {
            this.data.categories[idx] = {
                ...this.data.categories[idx],
                ...updates,
            }
            if (updates.name && updates.name !== name) {
                const renamed = updates.name
                this.data.events = this.data.events.map(e => {
                    let ev = e
                    if (e.category === name) ev = { ...ev, category: renamed }
                    if (e.categories?.includes(name))
                        ev = {
                            ...ev,
                            categories: ev.categories!.map(c =>
                                c === name ? renamed : c,
                            ),
                        }
                    return ev
                })
            }
            await this.save()
        }
    }

    async deleteCategory(name: string, reassignTo?: string): Promise<void> {
        this.data.categories = this.data.categories.filter(c => c.name !== name)
        this.data.events = this.data.events.map(e => {
            let ev = e
            if (e.category === name)
                ev = { ...ev, category: reassignTo ?? undefined }
            if (e.categories?.includes(name)) {
                const next = ev
                    .categories!.map(c => (c === name ? reassignTo : c))
                    .filter((c): c is string => !!c)
                ev = { ...ev, categories: [...new Set(next)] }
            }
            return ev
        })
        await this.save()
    }
}
