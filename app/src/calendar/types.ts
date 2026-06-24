export interface Category { name: string; color: string }

export type RecurrenceType = 'daily' | 'weekly' | 'biweekly' | 'monthly'

export interface Recurrence {
  type: RecurrenceType
  daysOfWeek?: number[] // 0–6, Sunday=0
  startDate: string     // "YYYY-MM-DD"
  endDate?: string      // "YYYY-MM-DD"
  seriesId: string
}

export interface CalendarEvent {
  id: string
  title: string
  date: string          // "YYYY-MM-DD"
  startTime?: string     // "HH:MM" — undefined = all-day
  endTime?: string
  location?: string
  link?: string
  description?: string
  category?: string
  recurrence?: Recurrence
  // ISO timestamp stamped on every local create/edit (EventStore). Used by Google
  // Calendar sync as the last-write-wins tiebreaker against the remote `updated` time.
  localUpdated?: string
}

export interface EventsFile { events: CalendarEvent[]; categories: Category[] }

export type ViewType = 'month' | 'week' | '3day' | 'day'

export interface CalendarSettings {
  defaultView: ViewType
  weekStartsOnMonday: boolean
  militaryTime: boolean
}
