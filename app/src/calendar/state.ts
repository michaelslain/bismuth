import { createContext, createSignal, useContext } from 'solid-js'
import { CalendarEvent, Category, ViewType, CalendarSettings } from './types'
import { settings as appSettings, setSettings } from '../settings'

function createBox<T>(initial: T) {
    const [get, set] = createSignal<T>(initial)
    return {
        get value() {
            return get()
        },
        set value(v: T) {
            set(() => v)
        },
    }
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
/** One calendar's navigation: which period it shows and which date anchors it. Every calendar
 *  owns its own, so a period picked on one calendar never shows up on another.
 *
 *  `view` reads the saved `defaultView` until this calendar picks one, then keeps its own pick.
 *  Settings hydrate asynchronously, so a calendar opened before the hydration lands still ends
 *  up on the saved default rather than the DEFAULTS seed. */
export type CalendarNav = {
    view: { value: ViewType }
    date: { value: Date }
}

export function createCalendarNav(): CalendarNav {
    const [picked, setPicked] = createSignal<ViewType | undefined>()
    return {
        view: {
            get value() {
                return picked() ?? settings.value.defaultView
            },
            set value(v: ViewType) {
                setPicked(() => v)
            },
        },
        date: createBox<Date>(new Date()),
    }
}

// Keyed by the base's path. Module scope so a calendar keeps its period and date across a tab
// switch or a pane remount, but not across an app reload, matching the flashcards session store.
const navs = new Map<string, CalendarNav>()

/** The nav for the calendar base at `path`, created on first use. */
export function calendarNavFor(path: string): CalendarNav {
    let nav = navs.get(path)
    if (!nav) {
        nav = createCalendarNav()
        navs.set(path, nav)
    }
    return nav
}

/** The nav a calendar reads when no base supplies one: stories and fixtures render a calendar on
 *  its own and seed it through `currentView` / `currentDate`. */
const fallbackNav = createCalendarNav()
export const currentView = fallbackNav.view
export const currentDate = fallbackNav.date

/** BaseView provides the nav of the base on screen. Everything below it reads it from here. */
export const CalendarNavContext = createContext<CalendarNav>(fallbackNav)

export function useCalendarNav(): CalendarNav {
    return useContext(CalendarNavContext)
}
export const events = createBox<CalendarEvent[]>([])
export const categories = createBox<Category[]>([])
export const showEventModal = createBox<{
    date?: string
    event?: CalendarEvent
    masterId?: string
    occurrenceDate?: string
    startTime?: string
    endTime?: string
} | null>(null)
export const showCategoryPanel = createBox(false)
export const showCalendarSettings = createBox(false)

export type DragState =
    | {
          type: 'create'
          date: string
          startMinutes: number
          currentMinutes: number
      }
    | {
          type: 'move'
          event: CalendarEvent
          masterId?: string
          date: string
          startMinutes: number
          currentMinutes: number
          offsetMinutes: number
      }
export const dragState = createBox<DragState | null>(null)

export const recurrenceAction = createBox<{
    type: 'edit' | 'delete'
    masterId: string
    occurrenceDate: string
    updates?: Partial<CalendarEvent>
} | null>(null)

// (removed) calendar settings now persist via the unified settings store.

/** `path:line` of the task chip that should take focus when it next mounts. A keyboard reschedule or
 *  toggle rewrites the row, and the refetch renders the chip as a NEW element — often in another
 *  cell — so focus would otherwise fall back to <body>. Cleared by the chip that consumes it, or
 *  after 3s if no chip ever mounts (the write failed and nothing re-rendered). */
export const focusTaskKey = createBox<string | null>(null)

export function requestTaskFocus(key: string): void {
    focusTaskKey.value = key
    setTimeout(() => {
        if (focusTaskKey.value === key) focusTaskKey.value = null
    }, 3000)
}
