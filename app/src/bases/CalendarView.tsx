import { onMount, createEffect, Show, Switch, Match } from 'solid-js'
import { lastChange } from '../serverVersion'
import { EventStore, MemoryBackend } from '../calendar/EventStore'
import {
    currentView,
    currentDate,
    settings,
    showEventModal,
    showCalendarSettings,
    applyDefaultView,
    userSwitchedView,
    reconcileDefaultView,
    resetUserSwitchedView,
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
import { placeRows } from '../calendar/taskPlacement'
import { todayISO } from '../../../core/src/dates'
import { api } from '../api'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import styles from '../calendar/Calendar.module.css'
import { BaseBackend } from './calendarBase'

/**
 * Calendar view type — one Bases view kind with two registers, `calendarContent:
 * 'events' | 'tasks'` (default "events"), mirroring the cards view's `cardContent`.
 *
 * This component ONLY decides which register to mount — `EventsCalendar` and
 * `TasksCalendar` below own everything else. That split is load-bearing, not a style
 * choice: `<Show>` genuinely unmounts the losing branch and mounts the winning one
 * fresh, so a live edit that flips `calendarContent` (the base's frontmatter changing
 * with the pane still open — an ordinary thing to do) tears down the events register's
 * backend/store and rebuilds it from a real `onMount` on the way back, instead of
 * leaving a stale `EventStore` bound to a `MemoryBackend` that a re-enabled events
 * register would otherwise be stuck with until the pane was closed and reopened.
 */
export function CalendarView(props: {
    basePath?: string
    result?: ViewResult
    config?: BaseConfig
    onChange?: () => void
}) {
    // `props.result` only exists for the tasks register (BaseView's `result()` memo
    // skips computing it for an events calendar — see fullPane() there).
    const isTasks = () => props.result?.view.calendarContent === 'tasks'

    return (
        <div class={styles['calendar-app']}>
            {/* No <Toolbar /> here any more — the calendar contributes SLOTS to the host's
                <ViewBar> regions (see `calendarSlots()` in calendar/components/Toolbar.tsx), so a
                calendar base shows one bar instead of two stacked ones. The import stays gone rather
                than being kept "just in case": a second call site is exactly how the two bars
                appeared. */}
            <Show
                when={isTasks()}
                fallback={
                    <EventsCalendar
                        basePath={props.basePath}
                        onChange={props.onChange}
                    />
                }
            >
                <TasksCalendar result={props.result} onChange={props.onChange} />
            </Show>
        </div>
    )
}

/**
 * Events register — the pre-existing calendar UI (month/week/3day/day + drag + modals +
 * recurrence), backed by a base `.md` file's own event table through
 * `BaseBackend`/`EventStore`. UNTOUCHED by the tasks register existing: every line here
 * is exactly what `CalendarView` itself used to be before the tasks register was added,
 * just moved into its own component so a live `calendarContent` flip unmounts/remounts
 * it (see the comment on `CalendarView` above) instead of leaving `backend`/`store`
 * frozen at whatever they were when the component first mounted.
 *
 * Note: reuses the calendar's global view/date signals, so a single calendar shows at
 * a time (same as the standalone Calendar tab).
 */
function EventsCalendar(props: { basePath?: string; onChange?: () => void }) {
    const backend = props.basePath ? new BaseBackend(props.basePath) : null
    const store = new EventStore(backend ?? new MemoryBackend())

    onMount(async () => {
        // Clear any prior manual-switch flag so this fresh mount honors the saved
        // defaultView (the flag is module-level and survives remounts otherwise).
        resetUserSwitchedView()
        if (backend) await backend.init()
        await store.load()
        await refreshEvents(store)
    })

    // The settings store seeds synchronously from DEFAULTS ('week') and hydrates
    // settings.yaml asynchronously, so `currentView` captured the seed at module load
    // and never saw the user's saved defaultView. Reconcile once hydration lands — but
    // stop the moment the user manually switches views, so we never clobber that switch.
    createEffect(() => {
        const next = reconcileDefaultView(
            settings.value.defaultView,
            currentView.value,
            userSwitchedView,
        )
        if (next !== null) applyDefaultView(next)
    })

    createEffect(() => {
        // re-derive the visible range whenever the view mode, focused date, or week-start changes
        currentView.value
        currentDate.value
        settings.value.weekStartsOnMonday
        void refreshEvents(store)
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
            await refreshEvents(store)
        })
    })

    return (
        <>
            {/* Fallback to week view so an unrecognized currentView (e.g. a typo'd
          defaultView in settings.yaml, or a transient during hydration) still
          renders a calendar instead of blanking the whole grid. */}
            <Switch fallback={<WeekView store={store} />}>
                <Match when={currentView.value === 'month'}>
                    <MonthView store={store} />
                </Match>
                <Match when={currentView.value === 'week'}>
                    <WeekView store={store} />
                </Match>
                <Match when={currentView.value === '3day'}>
                    <ThreeDayView store={store} />
                </Match>
                <Match when={currentView.value === 'day'}>
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
                />
            </Show>
        </>
    )
}

/**
 * Tasks register — renders `props.result`'s resolved rows on day buckets (`placeRows`:
 * scheduled first, due as the fallback, unfinished-and-late rows carried onto today) —
 * the same resolved-rows path `app/src/export/calendarHtml.ts` already renders through.
 * No `BaseBackend`/`EventStore` involved at all, so there is nothing here that needs
 * re-initialising on remount: `placed()` reads `props.result` fresh every render, live
 * across a rows refetch (a toggle, an edit, an SSE-driven revalidation) — unlike
 * `EventsCalendar`'s `backend`/`store`, this register has no persistent state to go
 * stale. Tasks are all-day, so week/3day/day render them in the all-day gutter and never
 * touch the hourly time grid.
 */
function TasksCalendar(props: { result?: ViewResult; onChange?: () => void }) {
    const placed = () =>
        placeRows(
            props.result?.groups.flatMap(g => g.rows) ?? [],
            todayISO(),
            props.result?.view.dateField,
        )

    // Left-click the marker toggles the task (POST /tasks/toggle by path + line, same
    // as every other row-based task view — ListView.tsx, CardBody.tsx); clicking the
    // chip body opens the source note.
    const toggleTaskRow = (row: Row) =>
        void api
            .toggleTask(row.file.path, row.note.line as number)
            .finally(() => props.onChange?.())
    const openTaskRow = (row: Row) =>
        window.dispatchEvent(
            new CustomEvent('bismuth-open', { detail: row.file.path }),
        )
    // Right-click marker → the shared status menu (taskStatusMenu.tsx), same affordance
    // ListView.tsx and the cards view already use. Sets the exact box char rather than
    // the binary toggle above.
    const setTaskStatus = (row: Row, char: string) =>
        void api
            .toggleTask(row.file.path, row.note.line as number, char)
            .finally(() => props.onChange?.())
    // Drag-to-reschedule: TaskChip already resolved WHICH field placed the row
    // (taskPlacement.ts's placementField, carried in the drag payload — see taskDrag.ts),
    // so this is a pure pass-through to the write endpoint. No row lookup needed here.
    const rescheduleTaskRow = (
        path: string,
        line: number,
        field: string,
        date: string,
    ) =>
        void api
            .rescheduleTask(path, line, field as 'due' | 'scheduled' | 'start', date)
            .finally(() => props.onChange?.())

    // No real EventStore is ever read in this register (every view component below only
    // touches `store` inside its OWN events-fallback branch, which `placed` being set
    // always bypasses) — this is a harmless placeholder to satisfy the shared prop type,
    // not a second data path.
    const store = new EventStore(new MemoryBackend())

    return (
        <Switch
            fallback={
                <WeekView
                    store={store}
                    placed={placed()}
                    onToggleTask={toggleTaskRow}
                    onOpenTask={openTaskRow}
                    onSetTaskStatus={setTaskStatus}
                    onRescheduleTask={rescheduleTaskRow}
                />
            }
        >
            <Match when={currentView.value === 'month'}>
                <MonthView
                    store={store}
                    placed={placed()}
                    onToggleTask={toggleTaskRow}
                    onOpenTask={openTaskRow}
                    onSetTaskStatus={setTaskStatus}
                    onRescheduleTask={rescheduleTaskRow}
                />
            </Match>
            <Match when={currentView.value === 'week'}>
                <WeekView
                    store={store}
                    placed={placed()}
                    onToggleTask={toggleTaskRow}
                    onOpenTask={openTaskRow}
                    onSetTaskStatus={setTaskStatus}
                    onRescheduleTask={rescheduleTaskRow}
                />
            </Match>
            <Match when={currentView.value === '3day'}>
                <ThreeDayView
                    store={store}
                    placed={placed()}
                    onToggleTask={toggleTaskRow}
                    onOpenTask={openTaskRow}
                    onSetTaskStatus={setTaskStatus}
                    onRescheduleTask={rescheduleTaskRow}
                />
            </Match>
            <Match when={currentView.value === 'day'}>
                <DayView
                    store={store}
                    placed={placed()}
                    onToggleTask={toggleTaskRow}
                    onOpenTask={openTaskRow}
                    onSetTaskStatus={setTaskStatus}
                    onRescheduleTask={rescheduleTaskRow}
                />
            </Match>
        </Switch>
    )
}
