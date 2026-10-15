import { Show } from 'solid-js'
import {
    showCategoryPanel,
    showEventModal,
    currentView,
    currentDate,
    CalendarNavContext,
    type CalendarNav,
} from '../state'
import ViewBar, { type ViewBarSlots } from '../../ui/ViewBar'
import { SegmentedToggle } from '../../ui/SegmentedToggle'
import BarTwin from '../../ui/BarTwin'
import { IconButton } from '../../ui/IconButton'
import BarLabel from '../../ui/BarLabel'
import Text from '../../ui/Text'
import DateNav from './DateNav'
import { ViewType } from '../types'
import { todayISO } from '../../../../core/src/dates'
import styles from './Toolbar.module.css'

/** Each view carries BOTH label lengths; <BarLabel> renders both and the bar's shared ladder picks
 *  one. "3 day" is why this exists: the only two-word label here, and it used to wrap onto a second
 *  line and push itself out of the 36px band the moment the pane got tight. */
const VIEWS: { id: ViewType; label: string; short: string }[] = [
    { id: 'month', label: 'month', short: 'm' },
    { id: 'week', label: 'week', short: 'w' },
    { id: '3day', label: '3 day', short: '3d' },
    { id: 'day', label: 'day', short: 'd' },
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
    /** The calendar on screen's own period and date. Omitted, the slots drive the fallback nav
     *  that stories seed through `currentView` / `currentDate`. */
    nav?: CalendarNav
}

/**
 * The calendar's contribution to whichever view bar it lands in — the base's, or the standalone
 * one below. Three REGIONS, not one block:
 *
 *   locus   — DateNav (Today · prev · the date, which also jumps to today · next) followed by the period
 *             switcher. "Which span of time is on screen" is one question, so prev/next/range
 *             and the period switcher share a region.
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
    const nav = ctx?.nav ?? { view: currentView, date: currentDate }
    return {
        locus: (
            // The slots are built in BaseView, outside the calendar's own tree, so DateNav gets the
            // nav from a provider of its own here.
            <CalendarNavContext.Provider value={nav}>
                <DateNav />
                {/* data-bar-yields-identity: the bar drops its crumb title at the floor tier
                    (ViewBar.module.css) so these segments keep the room. display: contents, so layout is unchanged. */}
                <div data-bar-yields-identity class={styles.yields}>
                    <SegmentedToggle
                        class={styles.views}
                        value={nav.view.value}
                        onChange={id => (nav.view.value = id)}
                        size="sm"
                        options={VIEWS.map(v => ({
                            id: v.id,
                            title: v.label,
                            label: <BarLabel long={v.label} short={v.short} />,
                        }))}
                    />
                </div>
            </CalendarNavContext.Provider>
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
                {/* A worded/icon twin (ui/BarTwin.tsx): below the viewbar tier where the word goes, the
                    bare icon takes over, so an OFF toggle never draws icon-only brackets. The wrapper
                    carries data-bar-drop, so the floor hides the whole pair. */}
                <Text as="span" inherit data-bar-drop="1">
                    <BarTwin
                        drop="early"
                        icon="Tag"
                        label="categories"
                        title="Categories"
                        active={showCategoryPanel.value}
                        onClick={() =>
                            (showCategoryPanel.value = !showCategoryPanel.value)
                        }
                    />
                </Text>
            </Show>
        ),
        actions: (
            /* Tasks register: no button at all. Clicking a grid cell opens that cell's composer
               directly — see TasksCalendar's `compose` in CalendarView.tsx — so there is no longer
               a single destination for a bar-level "new task" action to write to. */
            <Show when={!ctx?.isTasks}>
                <IconButton
                    icon="Plus"
                    label="New event"
                    onClick={() =>
                        (showEventModal.value = {
                            date: todayISO(nav.date.value),
                        })
                    }
                />
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
