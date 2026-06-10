import { onMount, createEffect, Show, Switch, Match } from "solid-js";
import { EventStore, MemoryBackend } from "../calendar/EventStore";
import { currentView, currentDate, settings, showEventModal, showCalendarSettings, applyDefaultView, userSwitchedView, reconcileDefaultView, resetUserSwitchedView } from "../calendar/state";
import { refreshEvents } from "../calendar/refresh";
import { Toolbar } from "../calendar/components/Toolbar";
import { MonthView } from "../calendar/components/views/MonthView";
import { WeekView } from "../calendar/components/views/WeekView";
import { ThreeDayView } from "../calendar/components/views/ThreeDayView";
import { DayView } from "../calendar/components/views/DayView";
import { EventModal } from "../calendar/components/EventModal";
import { RecurrenceDialog } from "../calendar/components/RecurrenceDialog";
import { CategoryPanel } from "../calendar/components/CategoryPanel";
import { CalendarSettings } from "../calendar/components/CalendarSettings";
import "../calendar/Calendar.css";
import { BaseBackend } from "./calendarBase";

/**
 * Calendar view type — the full existing calendar UI (month/week/3day/day + drag +
 * modals + recurrence), backed by a base `.md` file instead of localStorage.
 *
 * Note: reuses the calendar's global view/date signals, so a single calendar shows at
 * a time (same as the standalone Calendar tab).
 */
export function CalendarView(props: { basePath?: string; onChange?: () => void }) {
  const backend = props.basePath ? new BaseBackend(props.basePath) : null;
  const store = new EventStore(backend ?? new MemoryBackend());

  onMount(async () => {
    // Clear any prior manual-switch flag so this fresh mount honors the saved
    // defaultView (the flag is module-level and survives remounts otherwise).
    resetUserSwitchedView();
    if (backend) await backend.init();
    await store.load();
    await refreshEvents(store);
  });

  // The settings store seeds synchronously from DEFAULTS ('week') and hydrates
  // settings.yaml asynchronously, so `currentView` captured the seed at module load
  // and never saw the user's saved defaultView. Reconcile once hydration lands — but
  // stop the moment the user manually switches views, so we never clobber that switch.
  createEffect(() => {
    const next = reconcileDefaultView(settings.value.defaultView, currentView.value, userSwitchedView);
    if (next !== null) applyDefaultView(next);
  });

  createEffect(() => {
    // re-derive the visible range whenever the view mode, focused date, or week-start changes
    currentView.value;
    currentDate.value;
    settings.value.weekStartsOnMonday;
    void refreshEvents(store);
  });

  return (
    <div class="calendar-app">
      <Toolbar />
      <Switch>
        <Match when={currentView.value === "month"}><MonthView store={store} /></Match>
        <Match when={currentView.value === "week"}><WeekView store={store} /></Match>
        <Match when={currentView.value === "3day"}><ThreeDayView store={store} /></Match>
        <Match when={currentView.value === "day"}><DayView store={store} /></Match>
      </Switch>
      <Show when={showEventModal.value} keyed><EventModal store={store} /></Show>
      <RecurrenceDialog store={store} />
      <CategoryPanel store={store} />
      <Show when={showCalendarSettings.value && props.basePath} keyed>
        <CalendarSettings basePath={props.basePath!} onChange={props.onChange} />
      </Show>
    </div>
  );
}
