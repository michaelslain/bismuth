import { Show } from 'solid-js'
import type { ViewResult, BaseConfig } from '../../../core/src/bases/types'
import { viewMode } from '../../../core/src/bases/types'
import CalendarFrame from '../calendar/components/CalendarFrame'
import EventsCalendar from './EventsCalendar'
import TasksCalendar from './TasksCalendar'

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
    onChange?: () => void
    /** Opens the base's generic settings panel (kind, filters, source) — reachable from the
     *  calendar's own settings modal, whose gear the bar routes here instead. */
    onOpenBaseSettings?: () => void
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
                        fallback={
                            <EventsCalendar
                                onChange={props.onChange}
                                onOpenBaseSettings={props.onOpenBaseSettings}
                            />
                        }
                    >
                        {basePath => (
                            <EventsCalendar
                                basePath={basePath}
                                onChange={props.onChange}
                                onOpenBaseSettings={props.onOpenBaseSettings}
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
                    onOpenBaseSettings={props.onOpenBaseSettings}
                    onChange={props.onChange}
                />
            </Show>
        </CalendarFrame>
    )
}
