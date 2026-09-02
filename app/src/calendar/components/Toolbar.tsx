import {
    showCategoryPanel,
    showEventModal,
    currentView,
    currentDate,
} from '../state'
import ViewBar from '../../ui/ViewBar'
import { VBtn } from '../../ui/ViewBar'
import { SegmentedToggle } from '../../ui/SegmentedToggle'
import DateNav from './DateNav'
import { ViewType } from '../types'
import { toDateStr } from '../dates'
import styles from './Toolbar.module.css'

/** Each view carries BOTH label lengths. The bar swaps to `short` in a narrow pane via a
 *  container query, and CSS cannot rewrite text — so both are rendered and one is hidden.
 *  "3 Day" is the reason this exists: it is the only two-word label, and it used to wrap onto a
 *  second line and push itself out of the 36px band the moment the pane got tight. */
const VIEWS: { id: ViewType; label: string; short: string }[] = [
    { id: 'month', label: 'Month', short: 'M' },
    { id: 'week', label: 'Week', short: 'W' },
    { id: '3day', label: '3 Day', short: '3D' },
    { id: 'day', label: 'Day', short: 'D' },
]

export type ToolbarProps = {
    /**
     * Render the CONTROLS ONLY, with no <ViewBar> wrapper of its own.
     *
     * A calendar base used to stack TWO bars: BaseView's (crumb + view tabs + gear + source) and
     * this one directly underneath, because CalendarView rendered <Toolbar /> as a sibling of the
     * bar rather than into it. Two full-height bands of chrome above every calendar, for one view.
     * BaseView now renders `<Toolbar inline />` INSIDE its own ViewBar, so there is one bar with
     * the calendar's controls in it — which is also why this component keeps owning its controls
     * rather than BaseView reimplementing them per view kind.
     *
     * INLINE IS THE ONLY PATH THAT SHIPS. Nothing in the app renders the standalone form; a
     * calendar is a Bases view kind and always arrives through BaseView. That is why every rule
     * in Toolbar.module.css hangs off `.toolbar` — an element BOTH paths render — instead of off
     * the old `.cal-viewbar`, which only existed on the standalone <ViewBar> and therefore styled
     * the one calendar nobody ever sees. Inline, the bar fell back to bare `.vbtn`: zero gap
     * (`--bar-icon-gap` is 0px, and `.cal-viewbar` was what overrode it to 8px), so the base's
     * name sat flush against Today; no accent fill on + Event; and `.active` flipped from a grey
     * chip to an accent outline, making Today indistinguishable from the selected view tab.
     */
    inline?: boolean
}

export function Toolbar(props: ToolbarProps = {}) {
    const controls = () => (
        // TWO ELEMENTS, and the split is load-bearing. `.toolbar` is the query CONTAINER; `.row` is
        // the flex row every collapse tier restyles. They cannot be one element: an @container rule
        // styles the container's DESCENDANTS, never the container itself, so folding these together
        // silently drops every tier rule whose subject is the row — the gap and the overflow — while
        // the descendant rules beside them keep working. Nothing errors; the bar just overflows its
        // own box at the narrowest width and paints over the buttons next to it.
        //
        // `flex: 1` + its own spacer, in BOTH paths. Inline this is what lets the calendar own a
        // real region of the bar instead of clumping against the crumb: the base name sizes to its
        // content first, this block takes the rest, and BaseView's gear/source stay pinned right.
        // The container measures the PANE, not the window, since a calendar in a split is narrow
        // inside a wide one.
        <div class={styles.toolbar}>
            <div class={styles.row}>
                <DateNav />
                <div class={styles.spacer} />
                <SegmentedToggle
                    class={styles.views}
                    value={currentView.value}
                    onChange={id => (currentView.value = id)}
                    size="sm"
                    options={VIEWS.map(v => ({
                        id: v.id,
                        title: v.label,
                        label: (
                            <>
                                <span class={styles.long}>{v.label}</span>
                                <span class={styles.short}>{v.short}</span>
                            </>
                        ),
                    }))}
                />
                {/* `.categories` exists only so the narrowest tier can drop this one control —
                    see Toolbar.module.css tier 3 on why it is the one that goes. */}
                <VBtn
                    class={`${styles.action} ${styles.categories}`}
                    icon="Tag"
                    title="Categories"
                    active={showCategoryPanel.value}
                    onClick={() =>
                        (showCategoryPanel.value = !showCategoryPanel.value)
                    }
                >
                    <span class={styles.actionLabel}>Categories</span>
                </VBtn>
                <VBtn
                    class={`${styles.action} ${styles.cta}`}
                    icon="Plus"
                    title="New event"
                    onClick={() =>
                        (showEventModal.value = {
                            date: toDateStr(currentDate.value),
                        })
                    }
                >
                    <span class={styles.actionLabel}>Event</span>
                </VBtn>
            </div>
        </div>
    )
    // Standalone (a full-page calendar with no base chrome above it) still gets its own bar. The
    // whole block goes in ONE slot because it is still one undivided block — Task 5 is what splits
    // it across locus/facet/config/actions, in both paths at once.
    return props.inline ? controls() : <ViewBar locus={controls()} />
}

export default Toolbar
