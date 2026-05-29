import { createSignal, createRoot, createEffect } from 'solid-js'
import { CalendarEvent, Category, ViewType, CalendarSettings, DEFAULT_SETTINGS } from './types'

function createBox<T>(initial: T) {
  const [get, set] = createSignal<T>(initial)
  return { get value() { return get() }, set value(v: T) { set(() => v) } }
}

const SETTINGS_KEY = 'three-brains.calendar.settings'
function loadSettings(): CalendarSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

export const settings = createBox<CalendarSettings>(loadSettings())
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

// Persist calendar settings whenever they change (browser only).
if (typeof localStorage !== 'undefined') {
  createRoot(() => createEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value)) } catch { /* ignore */ }
  }))
}
