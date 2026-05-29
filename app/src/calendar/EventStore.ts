import { CalendarEvent, Category, EventsFile } from './types'
import { expandRecurrence, toDateStr, addDays } from './dates'

const uuid = () => crypto.randomUUID()

export interface CalendarStorage {
  load(): EventsFile | null
  save(data: EventsFile): void
}

const KEY = 'three-brains.calendar'

export class LocalStorageBackend implements CalendarStorage {
  load(): EventsFile | null {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as EventsFile) : null
    } catch { return null }
  }
  save(data: EventsFile): void {
    try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* ignore quota */ }
  }
}

export class MemoryBackend implements CalendarStorage {
  private data: EventsFile | null = null
  load() { return this.data }
  save(d: EventsFile) { this.data = structuredClone(d) }
}

export class EventStore {
  private data: EventsFile = { events: [], categories: [] }
  constructor(private storage: CalendarStorage = new LocalStorageBackend()) {}

  async load(): Promise<void> {
    const raw = this.storage.load()
    this.data = { events: raw?.events ?? [], categories: raw?.categories ?? [] }
  }
  private async save(): Promise<void> { this.storage.save(this.data) }

  getEventsForRange(rangeStart: string, rangeEnd: string): CalendarEvent[] {
    const result: CalendarEvent[] = []
    for (const event of this.data.events) {
      if (!event.recurrence) {
        if (event.date >= rangeStart && event.date <= rangeEnd) result.push(event)
      } else {
        for (const date of expandRecurrence(event.recurrence, rangeStart, rangeEnd)) result.push({ ...event, date })
      }
    }
    return result
  }

  getCategories(): Category[] { return this.data.categories }

  async addEvent(event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent> {
    const newEvent = { ...event, id: uuid() }
    this.data.events.push(newEvent)
    await this.save()
    return newEvent
  }

  async updateEvent(id: string, updates: Partial<CalendarEvent>): Promise<void> {
    const idx = this.data.events.findIndex(e => e.id === id)
    if (idx !== -1) { this.data.events[idx] = { ...this.data.events[idx], ...updates }; await this.save() }
  }

  async deleteEvent(id: string): Promise<void> {
    this.data.events = this.data.events.filter(e => e.id !== id)
    await this.save()
  }

  async editOccurrence(masterId: string, occurrenceDate: string, updates: Partial<CalendarEvent>): Promise<void> {
    const master = this.data.events.find(e => e.id === masterId)
    if (!master?.recurrence) return
    const { seriesId, endDate: originalEndDate } = master.recurrence
    const dayBefore = toDateStr(addDays(new Date(occurrenceDate + 'T00:00:00'), -1))
    const dayAfter = toDateStr(addDays(new Date(occurrenceDate + 'T00:00:00'), 1))
    await this.updateEvent(masterId, { recurrence: { ...master.recurrence, endDate: dayBefore } })
    if (!originalEndDate || originalEndDate > occurrenceDate) {
      const { id, ...masterRest } = master
      await this.addEvent({ ...masterRest, recurrence: { ...master.recurrence, startDate: dayAfter, endDate: originalEndDate, seriesId } })
    }
    const { id, recurrence, ...rest } = master
    const { recurrence: _excluded, ...singleUpdates } = updates as CalendarEvent
    await this.addEvent({ ...rest, ...singleUpdates, date: occurrenceDate })
  }

  async editSeries(seriesId: string, updates: Partial<CalendarEvent>): Promise<void> {
    const masters = this.data.events.filter(e => e.recurrence?.seriesId === seriesId)
    for (const m of masters) await this.updateEvent(m.id, updates)
  }

  async editFollowing(masterId: string, occurrenceDate: string, updates: Partial<CalendarEvent>): Promise<void> {
    const master = this.data.events.find(e => e.id === masterId)
    if (!master?.recurrence) return
    const originalEndDate = master.recurrence.endDate
    const dayBefore = toDateStr(addDays(new Date(occurrenceDate + 'T00:00:00'), -1))
    await this.updateEvent(masterId, { recurrence: { ...master.recurrence, endDate: dayBefore } })
    const { id, ...masterRest } = master
    await this.addEvent({ ...masterRest, ...updates, recurrence: { ...master.recurrence, ...(updates.recurrence ?? {}), startDate: occurrenceDate, endDate: originalEndDate, seriesId: uuid() } })
  }

  async deleteOccurrence(masterId: string, occurrenceDate: string): Promise<void> {
    const master = this.data.events.find(e => e.id === masterId)
    if (!master?.recurrence) return
    const { seriesId, endDate: originalEndDate } = master.recurrence
    const dayBefore = toDateStr(addDays(new Date(occurrenceDate + 'T00:00:00'), -1))
    const dayAfter = toDateStr(addDays(new Date(occurrenceDate + 'T00:00:00'), 1))
    await this.updateEvent(masterId, { recurrence: { ...master.recurrence, endDate: dayBefore } })
    if (!originalEndDate || originalEndDate > occurrenceDate) {
      const { id, ...masterRest } = master
      await this.addEvent({ ...masterRest, recurrence: { ...master.recurrence, startDate: dayAfter, endDate: originalEndDate, seriesId } })
    }
  }

  async deleteSeries(seriesId: string): Promise<void> {
    this.data.events = this.data.events.filter(e => e.recurrence?.seriesId !== seriesId)
    await this.save()
  }

  async deleteFollowing(masterId: string, occurrenceDate: string): Promise<void> {
    const master = this.data.events.find(e => e.id === masterId)
    if (!master?.recurrence) return
    const dayBefore = toDateStr(addDays(new Date(occurrenceDate + 'T00:00:00'), -1))
    await this.updateEvent(masterId, { recurrence: { ...master.recurrence, endDate: dayBefore } })
  }

  async addCategory(category: Category): Promise<void> { this.data.categories.push(category); await this.save() }

  async updateCategory(name: string, updates: Partial<Category>): Promise<void> {
    const idx = this.data.categories.findIndex(c => c.name === name)
    if (idx !== -1) {
      this.data.categories[idx] = { ...this.data.categories[idx], ...updates }
      if (updates.name && updates.name !== name) {
        this.data.events = this.data.events.map(e => (e.category === name ? { ...e, category: updates.name } : e))
      }
      await this.save()
    }
  }

  async deleteCategory(name: string, reassignTo?: string): Promise<void> {
    this.data.categories = this.data.categories.filter(c => c.name !== name)
    this.data.events = this.data.events.map(e => (e.category === name ? { ...e, category: reassignTo ?? undefined } : e))
    await this.save()
  }
}
