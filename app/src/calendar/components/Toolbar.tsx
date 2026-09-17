import { Show } from 'solid-js'
import {
    showCategoryPanel,
    showEventModal,
    currentView,
    currentDate,
} from '../state'
import ViewBar, { VBtn, type ViewBarSlots } from '../../ui/ViewBar'
import { SegmentedToggle } from '../../ui/SegmentedToggle'
import BarLabel from '../../ui/BarLabel'
import DateNav from './DateNav'
import { ViewType } from '../types'
import { toDateStr } from '../dates'
import styles from './Toolbar.module.css'

/** Each view carries BOTH label lengths; <BarLabel> renders both and the bar's shared ladder picks
 *  one. "3 Day" is why this exists: the only two-word label here, and it used to wrap onto a second
 *  line and push itself out of the 36px band the moment the pane got tight. */
const VIEWS: { id: ViewType; label: string; short: string }[] = [
    { id: 'month', label: 'Month', short: 'M' },
    { id: 'week', label: 'Week', short: 'W' },
    { id: '3day', label: '3 Day', short: '3D' },
    { id: 'day', label: 'Day', short: 'D' },
]

/** What `calendarSlots()` needs to know to pick the `actions` control for the ACTIVE register —
 *  everything else in the bar (locus/config) is identical for events and tasks. In tasks mode the
 *  `actions` slot renders NOTHING now: task creation lives in the grid's own cells (a click starts
 *  writing a task right there — see CalendarView.tsx's `TasksCalendar`), not behind a bar button.
 *  Passed in by BaseView.tsx, since the calendar's own module-level state has no notion of
 *  "which base/view is on screen" (that lives in BaseView's own `data()`/`activeViewConfig()`).
 *  Omitted entirely by the standalone `Toolbar()` below and by any caller that predates the
 *  tasks register — both fall back to the events "+ event" action unchanged. */
export interface CalendarSlotsCtx {
    isTasks: boolean
}

/**
 * The calendar's contribution to whichever view bar it lands in — the base's, or the standalone
 * one below. Three REGIONS, not one block:
 *
 *   locus   — DateNav (Today · prev · the date, which also jumps to today · next) followed by the period
 *             switcher.
 *             The switcher is here rather than in `facet` on purpose: "which span of time is on
 *             screen" is the same question prev/next/range answer, and in a calendar base with two
 *             or more views the base's OWN view tabs hold `facet`. Two segmented toggles of
 *             different scope in one bar have to be told apart by position, since they cannot be
 *             told apart by weight.
 *   config  — Categories, which governs what this session shows rather than doing anything.
 *   actions — the bar's one primary action: `+ Event` in the events register, nothing at all in
 *             the tasks register (a grid cell IS the create action there now).
 *
 * A FUNCTION RETURNING SLOTS, NOT A COMPONENT. The base owns exactly one <ViewBar>; a view kind
 * that rendered its own would stack a second full-height band of chrome above every calendar,
 * which is what the deleted `inline` prop existed to avoid. Returning slots says WHICH REGION each
 * control belongs in and lets the bar place it, so both paths get the same split with no prop to
 * remember.
 */
export function calendarSlots(ctx?: CalendarSlotsCtx): ViewBarSlots {
    return {
        locus: (
            <>
                <DateNav />
                <SegmentedToggle
                    class={styles.views}
                    value={currentView.value}
                    onChange={id => (currentView.value = id)}
                    size="sm"
                    options={VIEWS.map(v => ({
                        id: v.id,
                        title: v.label,
                        label: <BarLabel long={v.label} short={v.short} />,
                    }))}
                />
            </>
        ),
        config: (
            /* EVENTS REGISTER ONLY. `CategoryPanel` is mounted by `EventsCalendar`, so in the tasks
               register this button toggled a signal nothing was listening to — it looked live
               (it even took the active state) and did nothing. Categories colour EVENTS; a task
               has no category field to colour by. Gated on the same `isTasks` the actions slot
               below already uses, rather than on a second notion of which register is showing.

               FIRST TO GO when the bar narrows: it toggles a side panel that has no room to render
               in a pane this narrow either, it is the only control here that is neither navigation
               nor the primary action, and its state is visible again the moment the pane widens. */
            <Show when={!ctx?.isTasks}>
            <VBtn
                data-bar-drop="1"
                icon="Tag"
                title="Categories"
                active={showCategoryPanel.value}
                onClick={() =>
                    (showCategoryPanel.value = !showCategoryPanel.value)
                }
            >
                <BarLabel long="CATEGORIES" drop="early" />
            </VBtn>
            </Show>
        ),
        actions: (
            /* Tasks register: no button at all. Clicking a grid cell opens that cell's composer
               directly — see TasksCalendar's `compose` in CalendarView.tsx — so there is no longer
               a single destination for a bar-level "new task" action to write to. */
            <Show when={!ctx?.isTasks}>
                <VBtn
                    class={styles.cta}
                    icon="Plus"
                    title="New event"
                    onClick={() =>
                        (showEventModal.value = {
                            date: toDateStr(currentDate.value),
                        })
                    }
                >
                    <BarLabel long="EVENT" drop="early" />
                </VBtn>
            </Show>
        ),
    }
}

/** The standalone form — a full-page calendar with no base chrome above it. Nothing in the app
 *  takes this path today (a calendar is a Bases view kind and always arrives through BaseView), but
 *  it is the same slots in the same regions, so it can no longer drift from the shipping one the
 *  way the old `.cal-viewbar` rules did. */
export function Toolbar() {
    return <ViewBar {...calendarSlots()} />
}

export default Toolbar
