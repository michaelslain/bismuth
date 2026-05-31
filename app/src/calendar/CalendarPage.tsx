import { onMount, createEffect, Show, Switch, Match } from 'solid-js'
import { EventStore } from './EventStore'
import { currentView, currentDate, settings, showEventModal, applyDefaultView, userSwitchedView, reconcileDefaultView } from './state'
import { refreshEvents } from './refresh'
import { Toolbar } from './components/Toolbar'
import { MonthView } from './components/views/MonthView'
import { WeekView } from './components/views/WeekView'
import { ThreeDayView } from './components/views/ThreeDayView'
import { DayView } from './components/views/DayView'
import { EventModal } from './components/EventModal'
import { RecurrenceDialog } from './components/RecurrenceDialog'
import { CategoryPanel } from './components/CategoryPanel'
import './Calendar.css'

const store = new EventStore()
let loaded = false

export function CalendarPage() {
  onMount(async () => {
    if (!loaded) {
      await store.load()
      loaded = true
    }
    await refreshEvents(store)
  })

  // The settings store seeds synchronously from DEFAULTS ('week') and hydrates
  // settings.yaml asynchronously, so `currentView` captured the seed at module
  // load and never saw the user's saved defaultView. Track that value reactively
  // and reconcile the initial view to it once hydration lands — but stop the
  // moment the user manually switches views, so we never clobber a manual switch.
  createEffect(() => {
    const next = reconcileDefaultView(
      settings.value.defaultView, // re-runs when hydration reconciles it
      currentView.value,
      userSwitchedView,
    )
    if (next !== null) applyDefaultView(next)
  })

  createEffect(() => {
    currentView.value
    currentDate.value
    settings.value.weekStartsOnMonday
    refreshEvents(store)
  })

  return (
    <div class="calendar-app">
      <Toolbar />
      <Switch>
        <Match when={currentView.value === 'month'}><MonthView store={store} /></Match>
        <Match when={currentView.value === 'week'}><WeekView store={store} /></Match>
        <Match when={currentView.value === '3day'}><ThreeDayView store={store} /></Match>
        <Match when={currentView.value === 'day'}><DayView store={store} /></Match>
      </Switch>
      <Show when={showEventModal.value} keyed><EventModal store={store} /></Show>
      <RecurrenceDialog store={store} />
      <CategoryPanel store={store} />
    </div>
  )
}
