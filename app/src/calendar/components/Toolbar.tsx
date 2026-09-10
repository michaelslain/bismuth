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
import { pushToast } from '../../toastStore'
import { appendTaskLine } from '../../bases/taskCreate'
import {
    newTaskVisible,
    prospectiveLineTaskRow,
    prospectiveStoredTaskRow,
} from '../../bases/taskScope'
import { refToPath } from '../../../../core/src/bases/sourceSpec'
import type { BaseConfig, ViewConfig } from '../../../../core/src/bases/types'
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
    /** The base's config and the active view's config — needed only to check whether the
     *  task `createTask` is about to write would actually survive this view's filters
     *  (`newTaskVisible`). Optional so the standalone `Toolbar()` below, and any caller that
     *  predates the scope check, keep compiling: with either absent, `createTask` writes and
     *  says nothing further, same as before this check existed. */
    config?: BaseConfig
    view?: ViewConfig
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
        // `resolved` and `statusChar` are DERIVED — normalizeStoredTaskRow computes both from
        // `status`. Writing them as real columns made them the user's own data under the rule
        // that a stored column always wins, so normalization stopped refreshing them and they
        // went stale on the first toggle: a completed task kept reporting `resolved: false`.
        // The shape below is the one BaseView's own "+ task" writes, and the description
        // matches it too — an empty one renders as a blank card the user cannot find again.
        const note = { description: 'New task', status: 'todo', scheduled: day }
        await api.rowCreate(ctx.basePath, note)
        // The write happened; this only tells the truth about where it went. A task that
        // cannot match this view's filters is invisible HERE, not lost — so name the file it
        // did land in, which is the one piece of information the user needs to go find it.
        if (ctx.config && ctx.view) {
            // The index passed here is a write-back handle, not data a filter can read —
            // no FilterNode expression can reference `Row.index` — so which number it is
            // does not change the answer. 0 is fine.
            const prospective = prospectiveStoredTaskRow(ctx.basePath, note, 0)
            if (!newTaskVisible(ctx.config, ctx.view, prospective))
                pushToast(
                    `Added to ${ctx.basePath} — it does not match this view's filters, so it will not appear here`,
                )
        }
        return
    }
    if (!ctx.taskFile) return // no destination named — nothing to guess, nothing to write
    // The append itself is bases/taskCreate.ts's, shared with the "+ task" every OTHER view
    // kind grew in tasks mode. Only the line's BODY is the calendar's own — it dates the task
    // on the day the grid is showing, which no other kind has.
    const body = `[scheduled ${day}]`
    await appendTaskLine(ctx.taskFile, body)
    if (ctx.config && ctx.view) {
        const dest = refToPath(ctx.taskFile)
        const prospective = prospectiveLineTaskRow(dest, body)
        if (prospective && !newTaskVisible(ctx.config, ctx.view, prospective))
            pushToast(
                `Added to ${dest} — it does not match this view's filters, so it will not appear here`,
            )
    }
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
                        onClick={() =>
                            /* Surfaced, not swallowed. `createTask` writes to the note named by
                               `taskFile`, and that write can fail for reasons the user can act on
                               — a taskFile naming a note that does not exist, a permission error.
                               Before this it rejected into nothing and the button just appeared
                               inert, which is indistinguishable from the button being broken. */
                            void createTask(ctx!).catch(err =>
                                pushToast(
                                    `Could not create the task: ${
                                        err instanceof Error
                                            ? err.message
                                            : String(err)
                                    }`,
                                ),
                            )
                        }
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
