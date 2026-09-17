import {
    onMount,
    createEffect,
    createMemo,
    createSignal,
    createResource,
    Show,
    Switch,
    Match,
} from 'solid-js'
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
import TaskCalendarSettings from '../calendar/components/TaskCalendarSettings'
import { placeRows } from '../calendar/taskPlacement'
import type { PlacedTask } from '../calendar/taskPlacement'
import type { TaskComposeProps } from '../calendar/taskCompose'
import {
    taskCategoryName,
    taskCategoryNames,
    taskCategoryColors,
} from '../calendar/taskCategory'
import {
    newTaskVisible,
    prospectiveLineTaskRow,
    prospectiveStoredTaskRow,
} from './taskScope'
import { appendTaskLine } from './taskCreate'
import { todayISO } from '../../../core/src/dates'
import { fileBasename } from '../../../core/src/pathUtils'
import { refToPath } from '../../../core/src/bases/sourceSpec'
import { api } from '../api'
import { pushToast } from '../toastStore'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { viewMode } from '../../../core/src/bases/types'
import CalendarFrame from '../calendar/components/CalendarFrame'
import { BaseBackend } from './calendarBase'

/**
 * Calendar view type — one Bases view kind with two registers, gated on `mode: 'normal' |
 * 'tasks'` (default "normal"/events), mirroring the cards view's `cardContent`. The legacy
 * `calendarContent: 'events' | 'tasks'` spelling still resolves via `viewMode()`.
 *
 * This component ONLY decides which register to mount — `EventsCalendar` and
 * `TasksCalendar` below own everything else. That split is load-bearing, not a style
 * choice: `<Show>` genuinely unmounts the losing branch and mounts the winning one
 * fresh, so a live edit that flips the mode (the base's frontmatter changing with the
 * pane still open — an ordinary thing to do) tears down the events register's
 * backend/store and rebuilds it from a real `onMount` on the way back, instead of
 * leaving a stale `EventStore` bound to a `MemoryBackend` that a re-enabled events
 * register would otherwise be stuck with until the pane was closed and reopened.
 */
export function CalendarView(props: {
    basePath?: string
    result?: ViewResult
    config?: BaseConfig
    ownsRows?: boolean
    viewIndex?: number
    onChange?: () => void
}) {
    // `props.result` only exists for the tasks register (BaseView's `result()` memo
    // skips computing it for an events calendar — see fullPane() there).
    const isTasks = () =>
        props.result ? viewMode(props.result.view) === 'tasks' : false

    return (
        <CalendarFrame>
            {/* No <Toolbar /> here any more — the calendar contributes SLOTS to the host's
                <ViewBar> regions (see `calendarSlots()` in calendar/components/Toolbar.tsx), so a
                calendar base shows one bar instead of two stacked ones. The import stays gone rather
                than being kept "just in case": a second call site is exactly how the two bars
                appeared. */}
            <Show
                when={isTasks()}
                fallback={
                    // Keyed on `basePath` so switching from one events calendar straight to
                    // another REMOUNTS EventsCalendar instead of reusing it — otherwise its
                    // `backend`/`store` (built once at mount from `props.basePath`) stay bound
                    // to the FIRST calendar's file, and a later save would write into the wrong
                    // one. See CalendarView.tsx's own comment on `EventsCalendar` above.
                    <Show
                        when={props.basePath}
                        keyed
                        fallback={<EventsCalendar onChange={props.onChange} />}
                    >
                        {basePath => (
                            <EventsCalendar
                                basePath={basePath}
                                onChange={props.onChange}
                            />
                        )}
                    </Show>
                }
            >
                <TasksCalendar
                    result={props.result}
                    config={props.config}
                    basePath={props.basePath}
                    ownsRows={props.ownsRows ?? false}
                    viewIndex={props.viewIndex ?? 0}
                    onChange={props.onChange}
                />
            </Show>
        </CalendarFrame>
    )
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
 * touch the hourly time grid. `placed` is a `createMemo` fed its own previous value as
 * `prev`, so `placeRows` can reuse unchanged rows' `PlacedTask` objects — a refetch where
 * only one row changed keeps every other chip's identity, so `<For>` doesn't remount them.
 *
 * Also owns the two things the bar's old `[ + task ]` button used to own, now that the
 * button is gone (Toolbar.tsx): a per-cell COMPOSER (clicking a day starts writing a task
 * right there, instead of a modal-less button that wrote a blank `[scheduled <day>]` line
 * nobody could find again) and the tasks register's own SETTINGS modal (the gear used to
 * toggle `showCalendarSettings`, a signal only `EventsCalendar`'s `<CalendarSettings>`
 * listened to — in the tasks register it looked live and did nothing).
 */
function TasksCalendar(props: {
    result?: ViewResult
    config?: BaseConfig
    basePath?: string
    ownsRows: boolean
    viewIndex: number
    onChange?: () => void
}) {
    const rows = createMemo(() => props.result?.groups.flatMap(g => g.rows) ?? [])
    // The active view's own config, already resolved server-side into `result.view` — the
    // same object `placed` below already reads `.dateField` off, so `dateField`/
    // `categoryField`/`taskFile`/`defaultCategory` all come from here rather than indexing
    // `props.config.views[props.viewIndex]` a second time.
    const view = () => props.result?.view

    const placed = createMemo<Map<string, PlacedTask[]>>(prev =>
        placeRows(rows(), todayISO(), view()?.dateField, prev),
    )

    // ---- colours: a task's SOURCE is its category (taskCategory.ts) ----------------------
    const categoryField = () => view()?.categoryField
    const colors = createMemo(() =>
        taskCategoryColors(
            taskCategoryNames(rows(), categoryField()),
            props.config?.categories,
        ),
    )
    const colorFor = (task: PlacedTask) => {
        const name = taskCategoryName(task.row, categoryField())
        return name === undefined ? undefined : colors().get(name)
    }

    // ---- composer: click a cell, start writing a task right there ------------------------
    // One signal for which day's cell is open — TaskCellComposer (Task 6) owns the input
    // itself; this only owns WHERE the composer is open and WHAT commit does with its text.
    const [composeDate, setComposeDate] = createSignal<string | null>(null)

    const destination = () => {
        if (props.ownsRows)
            return props.basePath ? fileBasename(props.basePath) : ''
        const taskFile = view()?.taskFile
        return taskFile ? fileBasename(refToPath(taskFile)) : ''
    }

    const commitTask = async (date: string, text: string) => {
        const vc = view()
        if (props.ownsRows) {
            if (!props.basePath) return
            const field = vc?.categoryField ?? 'category'
            const category = vc?.defaultCategory
            // The description comes FIRST and is never empty — the old bar button wrote
            // just `[scheduled <day>]`, a blank chip the user could not find again.
            const note: Record<string, unknown> = {
                description: text,
                status: 'todo',
                scheduled: date,
                ...(category ? { [field]: category } : {}),
            }
            try {
                await api.rowCreate(props.basePath, note)
            } catch (err) {
                pushToast(
                    `Could not create the task: ${err instanceof Error ? err.message : String(err)}`,
                )
                return
            }
            if (props.config && vc) {
                const prospective = prospectiveStoredTaskRow(props.basePath, note, 0)
                if (!newTaskVisible(props.config, vc, prospective))
                    pushToast(
                        `Added to ${props.basePath} — it does not match this view's filters, so it will not appear here`,
                    )
            }
            setComposeDate(null)
            props.onChange?.()
            return
        }

        const taskFile = vc?.taskFile
        if (!taskFile) {
            // No destination configured — a silent no-op here is exactly what made the
            // old button read as broken. Open settings so the user can name one.
            showCalendarSettings.value = true
            pushToast(
                'Set a destination note for new tasks in this calendar’s settings first',
            )
            return
        }
        const body = `${text} [scheduled ${date}]`
        let dest: string
        try {
            dest = await appendTaskLine(taskFile, body)
        } catch (err) {
            pushToast(
                `Could not create the task: ${err instanceof Error ? err.message : String(err)}`,
            )
            return
        }
        // Feed the scope check the path the write RETURNED, not a client-side guess.
        if (props.config && vc) {
            const prospective = prospectiveLineTaskRow(dest, body)
            if (prospective && !newTaskVisible(props.config, vc, prospective))
                pushToast(
                    `Added to ${dest} — it does not match this view's filters, so it will not appear here`,
                )
        }
        setComposeDate(null)
        props.onChange?.()
    }

    const compose: TaskComposeProps = {
        get date() {
            return composeDate()
        },
        get destination() {
            return destination()
        },
        open: date => setComposeDate(date),
        commit: (date, text) => void commitTask(date, text),
        cancel: () => setComposeDate(null),
    }

    // ---- settings: THIS register's own modal, not EventsCalendar's <CalendarSettings> ----
    const [notes] = createResource(async () => {
        const entries = await api.tree()
        return entries
            .filter(e => e.kind === 'file' && e.path.endsWith('.md'))
            .map(e => e.path)
    })
    const columns = createMemo(() => {
        const seen = new Set<string>()
        for (const row of rows()) for (const key of Object.keys(row.note)) seen.add(key)
        return [...seen]
    })
    const names = createMemo(() => taskCategoryNames(rows(), categoryField()))
    const onSetField = (
        key: 'dateField' | 'categoryField' | 'taskFile' | 'defaultCategory',
        value: string,
    ) => {
        if (!props.basePath) return
        void api.setViewProperty(props.basePath, props.viewIndex, key, value)
    }
    // Rewrites the base's WHOLE `categories:` array — preserving every category already
    // declared and adding the picked one only when it is not there yet.
    const onPickColor = (name: string, token: string) => {
        if (!props.basePath) return
        const declared = props.config?.categories ?? []
        const idx = declared.findIndex(c => c.name === name)
        const next =
            idx >= 0
                ? declared.map((c, i) => (i === idx ? { name, color: token } : c))
                : [...declared, { name, color: token }]
        void api.setProperty(props.basePath, 'categories', next)
    }

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
        <>
            <Switch
                fallback={
                    <WeekView
                        store={store}
                        placed={placed()}
                        onToggleTask={toggleTaskRow}
                        onOpenTask={openTaskRow}
                        onSetTaskStatus={setTaskStatus}
                        onRescheduleTask={rescheduleTaskRow}
                        compose={compose}
                        colorFor={colorFor}
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
                        compose={compose}
                        colorFor={colorFor}
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
                        compose={compose}
                        colorFor={colorFor}
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
                        compose={compose}
                        colorFor={colorFor}
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
                        compose={compose}
                        colorFor={colorFor}
                    />
                </Match>
            </Switch>
            <Show when={showCalendarSettings.value && props.basePath}>
                <TaskCalendarSettings
                    ownsRows={props.ownsRows}
                    columns={columns()}
                    notes={notes() ?? []}
                    dateField={view()?.dateField}
                    categoryField={view()?.categoryField}
                    taskFile={view()?.taskFile}
                    defaultCategory={view()?.defaultCategory}
                    names={names()}
                    colors={colors()}
                    onPickColor={onPickColor}
                    onSetField={onSetField}
                    onClose={() => (showCalendarSettings.value = false)}
                />
            </Show>
        </>
    )
}
