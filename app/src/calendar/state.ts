import { createSignal } from 'solid-js'
import { CalendarEvent, Category, ViewType, CalendarSettings } from './types'
import { settings as appSettings, setSettings } from '../settings'

function createBox<T>(initial: T) {
  const [get, set] = createSignal<T>(initial)
  return { get value() { return get() }, set value(v: T) { set(() => v) } }
}

// Calendar settings now live in the unified store under `settings.calendar`.
// This box is a thin adapter preserving the historic `settings.value.X` shape
// for the 8 calendar consumers: reads proxy the unified store, writes funnel
// each field back through `setSettings`. The unified store owns persistence
// (settings.yaml), so the old `three-brains.calendar.settings` localStorage box
// is gone.
export const settings = {
  get value(): CalendarSettings {
    return {
      defaultView: appSettings.calendar.defaultView,
      weekStartsOnMonday: appSettings.calendar.weekStartsOnMonday,
      militaryTime: appSettings.calendar.militaryTime,
    }
  },
  set value(v: CalendarSettings) {
    setSettings('calendar', {
      defaultView: v.defaultView,
      weekStartsOnMonday: v.weekStartsOnMonday,
      militaryTime: v.militaryTime,
    })
  },
}
export const currentView = createBox<ViewType>(settings.value.defaultView)
export const currentDate = createBox<Date>(new Date())
export const events = createBox<CalendarEvent[]>([])
export const categories = createBox<Category[]>([])
export const showEventModal = createBox<{
  date?: string; event?: CalendarEvent; masterId?: string; occurrenceDate?: string; startTime?: string; endTime?: string
} | null>(null)
export const showCategoryPanel = createBox(false)

export type DragState =
  | { type: 'create'; date: string; startMinutes: number; currentMinutes: number }
  | { type: 'move'; event: CalendarEvent; masterId?: string; date: string; startMinutes: number; currentMinutes: number; offsetMinutes: number }
export const dragState = createBox<DragState | null>(null)

export const recurrenceAction = createBox<{
  type: 'edit' | 'delete'; masterId: string; occurrenceDate: string; updates?: Partial<CalendarEvent>
} | null>(null)

// (removed) calendar settings now persist via the unified settings store.
