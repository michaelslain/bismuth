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
// `userSwitchedView` flips the first time anything writes `currentView.value`
// (e.g. the Toolbar view buttons). CalendarView's one-shot hydration effect uses
// it to avoid clobbering a manual view switch with the saved defaultView once the
// async settings hydration lands. The box value itself is seeded from the
// synchronous DEFAULTS; the saved defaultView is reconciled in CalendarView.
export let userSwitchedView = false
let setCurrentViewRaw: (v: ViewType) => void
function createViewBox(initial: ViewType) {
  const [get, set] = createSignal<ViewType>(initial)
  setCurrentViewRaw = (v: ViewType) => set(() => v)
  return {
    get value() { return get() },
    set value(v: ViewType) { userSwitchedView = true; set(() => v) },
  }
}
export const currentView = createViewBox(settings.value.defaultView)

// Apply the saved defaultView WITHOUT marking it as a manual user switch. Used by
// CalendarView's one-shot hydration effect so the box reconciles with the
// asynchronously-hydrated settings.value.defaultView on first paint.
export function applyDefaultView(v: ViewType) {
  setCurrentViewRaw(v)
}

// Pure decision for CalendarView's hydration effect: given the (possibly just
// hydrated) saved default, the current view, and whether the user has manually
// switched, return the view to apply or null for "leave it alone". A manual
// switch always wins; otherwise reconcile the seeded view to the saved default.
export function reconcileDefaultView(
  savedDefault: ViewType,
  current: ViewType,
  switched: boolean,
): ViewType | null {
  if (switched) return null
  if (current === savedDefault) return null
  return savedDefault
}
export const currentDate = createBox<Date>(new Date())
export const events = createBox<CalendarEvent[]>([])
export const categories = createBox<Category[]>([])
export const showEventModal = createBox<{
  date?: string; event?: CalendarEvent; masterId?: string; occurrenceDate?: string; startTime?: string; endTime?: string
} | null>(null)
export const showCategoryPanel = createBox(false)
export const showCalendarSettings = createBox(false)

export type DragState =
  | { type: 'create'; date: string; startMinutes: number; currentMinutes: number }
  | { type: 'move'; event: CalendarEvent; masterId?: string; date: string; startMinutes: number; currentMinutes: number; offsetMinutes: number }
export const dragState = createBox<DragState | null>(null)

export const recurrenceAction = createBox<{
  type: 'edit' | 'delete'; masterId: string; occurrenceDate: string; updates?: Partial<CalendarEvent>
} | null>(null)

// (removed) calendar settings now persist via the unified settings store.
