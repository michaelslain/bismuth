// The calendar toolbar's LEFT cluster: which slice of time is on screen, and the controls that
// move it. TODAY, prev/next and the date are one idea — "where am I, and how do I get back /
// step" — so they are one component rather than four loose children of the bar. Toolbar.tsx
// composes this against the right-hand cluster (view switcher + Categories + Event).
//
// Four controls, in this order: TODAY, prev, the date, next. TODAY is the explicit one-shot jump;
// the date stays clickable too, as a secondary jump back (see its own comment below).
import { currentView, currentDate, settings } from '../state'
import { VBtn } from '../../ui/ViewBar'
import BarLabel from '../../ui/BarLabel'
import Text from '../../ui/Text'
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
    const jumpToToday = () => (currentDate.value = new Date())

    return (
        <div class={`${styles.nav} ${props.class ?? ''}`}>
            {/* NOT `active`. Today is a one-shot jump, not a toggle. `drop="late"` because a
                calendar glyph inside a calendar is the least self-descriptive mark in the app — a
                calendar next to a date says nothing the date does not already say — so the word is
                the last thing this bar gives up. */}
            <VBtn
                class={styles.today}
                icon="Calendar"
                title="Today"
                onClick={jumpToToday}
            >
                <BarLabel long="TODAY" drop="late" />
            </VBtn>
            <VBtn
                class={styles.step}
                icon="ChevronLeft"
                title="Previous"
                onClick={step(-1)}
            />
            {/* The date stays clickable as a SECONDARY jump back — TODAY is now the explicit
                control, but clicking the thing that tells you where you are is still the natural
                way back too. Both label lengths render and CSS picks one — see rangeLabel(). No
                `drop`: the date must survive every collapse tier. */}
            <VBtn
                class={styles.range}
                title="Jump to today"
                onClick={jumpToToday}
            >
                {/* TEST-ONLY testid: the span is the box that ellipsizes (block + overflow hidden),
                    so it is the one element where scrollWidth > clientWidth means "date eaten". */}
                <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="inherit"
                    class={styles['range-text']}
                    data-testid="range"
                >
                    <BarLabel long={label().long} short={label().short} />
                </Text>
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
