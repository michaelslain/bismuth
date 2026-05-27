import { createSignal, createRoot, createEffect } from 'solid-js'
import { CalendarEvent, Category, ViewType, CalendarSettings, DEFAULT_SETTINGS } from './types'

// Wrap a Solid signal but expose Preact-style `.value` get/set so ported
// components keep their original syntax. The getter calls the accessor during
// render, so Solid tracks reads normally.
function box<T>(initial: T) {
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

export const settings = box<CalendarSettings>(loadSettings())
export const currentView = box<ViewType>(settings.value.defaultView)
export const currentDate = box<Date>(new Date())
export const events = box<CalendarEvent[]>([])
export const categories = box<Category[]>([])
export const showEventModal = box<{
  date?: string; event?: CalendarEvent; masterId?: string; occurrenceDate?: string; startTime?: string; endTime?: string
} | null>(null)
export const showCategoryPanel = box(false)

export type DragState =
  | { type: 'create'; date: string; startMinutes: number; currentMinutes: number }
  | { type: 'move'; event: CalendarEvent; masterId?: string; date: string; startMinutes: number; currentMinutes: number; offsetMinutes: number }
export const dragState = box<DragState | null>(null)

export const recurrenceAction = box<{
  type: 'edit' | 'delete'; masterId: string; occurrenceDate: string; updates?: Partial<CalendarEvent>
} | null>(null)

// Persist calendar settings whenever they change (browser only).
if (typeof localStorage !== 'undefined') {
  createRoot(() => createEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value)) } catch { /* ignore */ }
  }))
}
