// The calendar toolbar's LEFT cluster: which slice of time is on screen, and the controls that
// move it. Prev/next/Today/label are one idea — "where am I, and how do I step" — so they are one
// component rather than four loose children of the bar. Toolbar.tsx composes this against the
// right-hand cluster (view switcher + Categories + Event).
//
// This used to be inlined in Toolbar.tsx with `Today` orphaned BEFORE the chevrons, so the bar
// read Today · ‹ · › · date instead of grouping the three time controls together.
import { currentView, currentDate, settings } from '../state'
import { VBtn } from '../../ui/ViewBar'
import { Icon } from '../../icons/Icon'
import { rangeLabel, stepDate } from '../dates'
import styles from './DateNav.module.css'

export type DateNavProps = {
    /** Merged onto the root, so the toolbar can size this cluster in its own layout. */
    class?: string
}

export function DateNav(props: DateNavProps) {
    const label = () =>
        rangeLabel(
            currentDate.value,
            currentView.value,
            settings.value.weekStartsOnMonday,
        )
    const step = (dir: -1 | 1) => () =>
        (currentDate.value = stepDate(
            currentDate.value,
            currentView.value,
            dir,
        ))

    return (
        <div class={`${styles.nav} ${props.class ?? ''}`}>
            {/* A tight pair, not two text buttons that happen to hold arrows: `.step` strips the
                text padding so prev/next read as one control, adjacent, instead of as a gap. */}
            <div class={styles.steps}>
                <VBtn
                    class={styles.step}
                    icon="ChevronLeft"
                    title="Previous"
                    onClick={step(-1)}
                />
                <VBtn
                    class={styles.step}
                    icon="ChevronRight"
                    title="Next"
                    onClick={step(1)}
                />
            </div>
            {/* NOT `active`. Today is a one-shot jump, not a toggle — see VBtn's own note.
                The icon is rendered as a CHILD rather than through VBtn's `icon` prop, and inside
                a span of its own, so it can be swapped for the word at the narrowest tier — the
                word is the clearer label while there is room for it, and two marks this close to
                the base crumb's own read as clutter. The wrapper is not ceremony: <Icon> sets
                `display: inline-flex` as an INLINE STYLE, which no class rule can override, so
                `class` on the Icon itself cannot hide it. */}
            <VBtn
                class={styles.today}
                title="Jump to today"
                onClick={() => (currentDate.value = new Date())}
            >
                <span class={styles.todayIcon}>
                    <Icon value="Calendar" />
                </span>
                <span class={styles.todayLabel}>Today</span>
            </VBtn>
            {/* The bar's SUBJECT: sentence case against the uppercase tracked controls around it,
                so the eye lands here first. Both lengths are rendered and CSS picks one — see
                rangeLabel()'s note on why this cannot be a single string. */}
            <span class={styles.range}>
                <span class={styles.long}>{label().long}</span>
                <span class={styles.short}>{label().short}</span>
            </span>
        </div>
    )
}

export default DateNav
