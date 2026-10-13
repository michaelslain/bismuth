import { onMount, createEffect, Show, Switch, Match, type Component } from 'solid-js'
import { lastChange } from '../serverVersion'
import { EventStore, MemoryBackend } from '../calendar/EventStore'
import {
    useCalendarNav,
    settings,
    showEventModal,
    showCalendarSettings,
} from '../calendar/state'
import { refreshEvents } from '../calendar/refresh'
import { MonthView } from '../calendar/components/views/MonthView'
import { WeekView } from '../calendar/components/views/WeekView'
import { ThreeDayView } from '../calendar/components/views/ThreeDayView'
import { DayView } from '../calendar/components/views/DayView'
import { EventModal } from '../calendar/components/EventModal'
import { RecurrenceDialog } from '../calendar/components/RecurrenceDialog'
import { CategoryPanel } from '../calendar/components/CategoryPanel'
import { CalendarSettings } from '../calendar/components/CalendarSettings'
import { BaseBackend } from './calendarBase'

export type EventsCalendarProps = {
    basePath?: string
    onChange?: () => void
    onOpenBaseSettings?: () => void
}

/**
 * Events register — the pre-existing calendar UI (month/week/3day/day + drag + modals +
 * recurrence), backed by a base `.md` file's own event table through
 * `BaseBackend`/`EventStore`. UNTOUCHED by the tasks register existing: every line here
 * is exactly what `CalendarView` itself used to be before the tasks register was added,
 * just moved into its own component so a live mode flip unmounts/remounts
 * it (see the comment on `CalendarView` above) instead of leaving `backend`/`store`
 * frozen at whatever they were when the component first mounted.
 *
 * Its period and date come from the calendar's own nav (`useCalendarNav`), which BaseView
 * keys by base path.
 */
const EventsCalendar: Component<EventsCalendarProps> = props => {
    const backend = props.basePath ? new BaseBackend(props.basePath) : null
    const store = new EventStore(backend ?? new MemoryBackend())
    const nav = useCalendarNav()

    onMount(async () => {
        if (backend) await backend.init()
        await store.load()
        await refreshEvents(store, nav)
    })

    createEffect(() => {
        // re-derive the visible range whenever the view mode, focused date, or week-start changes
        nav.view.value
        nav.date.value
        settings.value.weekStartsOnMonday
        void refreshEvents(store, nav)
    })

    // Re-read the base file when it changes on disk underneath us (e.g. a background Google
    // Calendar sync rewrote it). Without this the snapshot taken at mount goes stale and the
    // next in-app edit would clobber the sync's changes. Skips our own writes (lastText match).
    let firstChange = true
    createEffect(() => {
        const change = lastChange() // track every server change
        const b = backend
        if (firstChange) {
            firstChange = false
            return
        } // initial run: onMount already loaded
        if (!b || !props.basePath) return
        if (change.paths.length > 0 && !change.paths.includes(props.basePath))
            return // unrelated file
        void b.reloadIfChanged().then(async changed => {
            if (!changed) return
            await store.load()
            await refreshEvents(store, nav)
        })
    })

    return (
        <>
            {/* Fallback to week view so an unrecognized view (e.g. a typo'd
          defaultView in settings.yaml, or a transient during hydration) still
          renders a calendar instead of blanking the whole grid. */}
            <Switch fallback={<WeekView store={store} />}>
                <Match when={nav.view.value === 'month'}>
                    <MonthView store={store} />
                </Match>
                <Match when={nav.view.value === 'week'}>
                    <WeekView store={store} />
                </Match>
                <Match when={nav.view.value === '3day'}>
                    <ThreeDayView store={store} />
                </Match>
                <Match when={nav.view.value === 'day'}>
                    <DayView store={store} />
                </Match>
            </Switch>
            <Show when={showEventModal.value} keyed>
                <EventModal store={store} />
            </Show>
            <RecurrenceDialog store={store} />
            <CategoryPanel store={store} />
            <Show when={showCalendarSettings.value && props.basePath} keyed>
                <CalendarSettings
                    basePath={props.basePath!}
                    onChange={props.onChange}
                    onOpenBaseSettings={props.onOpenBaseSettings}
                />
            </Show>
        </>
    )
}

export default EventsCalendar
