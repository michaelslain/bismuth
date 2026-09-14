// The calendar toolbar's LEFT cluster: which slice of time is on screen, and the controls that
// move it. Prev/next/the date are one idea — "where am I, and how do I step" — so they are one
// component rather than three loose children of the bar. Toolbar.tsx composes this against the
// right-hand cluster (view switcher + Categories + Event).
//
// This used to be inlined in Toolbar.tsx, and used to carry a separate TODAY button (with its own
// calendar glyph) ahead of the chevrons. The date IS the "today" control now — clicking `‹ date ›`
// jumps back — so the bar is down to three controls: prev, the date, next.
import { currentView, currentDate, settings } from '../state'
import { VBtn } from '../../ui/ViewBar'
import BarLabel from '../../ui/BarLabel'
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
            <VBtn
                class={styles.step}
                icon="ChevronLeft"
                title="Previous"
                onClick={step(-1)}
            />
            {/* The date IS the "today" control. A separate TODAY button spent a word and a calendar
                glyph saying what the date beside it already said; clicking the thing that tells you
                where you are is the natural way back. Both label lengths render and CSS picks one —
                see rangeLabel(). No `drop`: the date must survive every collapse tier. */}
            <VBtn
                class={styles.range}
                title="Jump to today"
                onClick={() => (currentDate.value = new Date())}
            >
                {/* TEST-ONLY testid: the span is the box that ellipsizes (block + overflow hidden),
                    so it is the one element where scrollWidth > clientWidth means "date eaten". */}
                <span class={styles['range-text']} data-testid="range">
                    <BarLabel long={label().long} short={label().short} />
                </span>
            </VBtn>
            <VBtn
                class={styles.step}
                icon="ChevronRight"
                title="Next"
                onClick={step(1)}
            />
        </div>
    )
}

export default DateNav
