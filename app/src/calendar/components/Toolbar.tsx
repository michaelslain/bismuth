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
import { api } from '../../api'
import { appendTaskLine } from '../../bases/taskCreate'
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

/** What `calendarSlots()` needs to know to draw the right `actions` control for the ACTIVE
 *  register — everything else in the bar (locus/config) is identical for events and tasks.
 *  Passed in by BaseView.tsx, since the calendar's own module-level state has no notion of
 *  "which base/view is on screen" (that lives in BaseView's own `data()`/`activeViewConfig()`).
 *  Omitted entirely by the standalone `Toolbar()` below and by any caller that predates the
 *  tasks register — both fall back to the events "+ event" action unchanged. */
export interface CalendarSlotsCtx {
    isTasks: boolean
    /** The open base file's path — for a self-owned base, this IS the file a new row writes
     *  into (`upsertRow` via `POST /row/update`). */
    basePath?: string
    /** True when the view resolves NO declared `source:` (base-level or view-level) — the
     *  base owns its rows in its own inline table, same test `source.ts` uses to fall back to
     *  a base's own rows. */
    ownsRows: boolean
    /** `source: tasks` register only: the note a new task line is appended to. Absent means
     *  no create action at all — see createTask below. */
    taskFile?: string
}

/** `[ + task ]`'s write, decided by the SAME two cases the design doc's creation table lays
 *  out: a self-owned base gets a new ROW (rowOps.ts's `upsertRow`, via the same `POST
 *  /row/update` the CLI `base`/`card` groups and EditCardsModal already use); a `source:
 *  tasks` base gets a checkbox LINE appended to `taskFile`, dated on the day the calendar is
 *  currently showing (`currentDate`, the same date the "+ event" action already uses). Both
 *  writes are read-refreshed reactively by the vault's normal version-bump/SSE path — no
 *  local refetch needed here. */
async function createTask(ctx: CalendarSlotsCtx): Promise<void> {
    const day = toDateStr(currentDate.value)
    if (ctx.ownsRows) {
        if (!ctx.basePath) return
        await api.rowCreate(ctx.basePath, {
            description: '',
            resolved: false,
            statusChar: ' ',
            scheduled: day,
        })
        return
    }
    if (!ctx.taskFile) return // no destination named — nothing to guess, nothing to write
    // The append itself is bases/taskCreate.ts's, shared with the "+ task" every OTHER view
    // kind grew in tasks mode. Only the line's BODY is the calendar's own — it dates the task
    // on the day the grid is showing, which no other kind has.
    await appendTaskLine(ctx.taskFile, `[scheduled ${day}]`)
}

/**
 * The calendar's contribution to whichever view bar it lands in — the base's, or the standalone
 * one below. Four REGIONS, not one block:
 *
 *   locus   — DateNav (prev · next · Today · the range label) followed by the period switcher.
 *             The switcher is here rather than in `facet` on purpose: "which span of time is on
 *             screen" is the same question prev/next/range answer, and in a calendar base with two
 *             or more views the base's OWN view tabs hold `facet`. Two segmented toggles of
 *             different scope in one bar have to be told apart by position, since they cannot be
 *             told apart by weight.
 *   config  — Categories, which governs what this session shows rather than doing anything.
 *   actions — the bar's one primary action, last: `+ Event` in the events register, `+ Task` in
 *             the tasks register (omitted outright when a `source: tasks` base names no
 *             `taskFile` — see `createTask`).
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
            /* FIRST TO GO. It toggles a side panel that has no room to render in a pane this narrow
               either, it is the only control here that is neither navigation nor the primary
               action, and its state is visible again the moment the pane is widened. */
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
        ),
        actions: (
            <Show
                when={ctx?.isTasks}
                fallback={
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
                }
            >
                {/* A `source: tasks` base with no `taskFile` renders NO button at all — a
                    grid cell says which DAY, not which FILE, and nothing here guesses one. */}
                <Show when={ctx!.ownsRows || ctx!.taskFile}>
                    <VBtn
                        class={styles.cta}
                        icon="Plus"
                        title="New task"
                        onClick={() => void createTask(ctx!)}
                    >
                        <BarLabel long="TASK" drop="early" />
                    </VBtn>
                </Show>
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
