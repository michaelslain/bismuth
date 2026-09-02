// The calendar toolbar's LEFT cluster: which slice of time is on screen, and the controls that
// move it. Prev/next/Today/label are one idea — "where am I, and how do I step" — so they are one
// component rather than four loose children of the bar. Toolbar.tsx composes this against the
// right-hand cluster (view switcher + Categories + Event).
//
// This used to be inlined in Toolbar.tsx with `Today` orphaned BEFORE the chevrons, so the bar
// read Today · ‹ · › · date instead of grouping the three time controls together.
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
                `drop="late"` and not `"early"`: this is the ONE word in the bar worth holding, and
                the reason is the icon beside it. A calendar glyph inside a calendar is the least
                self-descriptive mark in the app — "Tag" says categories and "Plus" says new, but a
                calendar next to a date says nothing the date did not already say. So it goes at
                the last label tier rather than the first, which is exactly the split BarLabel's
                two `drop` values exist for.
                The icon now rides VBtn's own `icon` prop instead of a hand-rolled span that the
                old tiers swapped IN as the word went out. That swap is deliberately not preserved:
                icon-plus-word is what Categories and + Event already do, so Today matching them is
                one less special case, and it deletes the `display: inline-flex` inline-style
                workaround the hand-rolled wrapper existed for. */}
            <VBtn
                class={styles.today}
                icon="Calendar"
                title="Jump to today"
                onClick={() => (currentDate.value = new Date())}
            >
                <BarLabel long="TODAY" drop="late" />
            </VBtn>
            {/* The bar's SUBJECT: sentence case against the uppercase tracked controls around it,
                so the eye lands here first. Both lengths are rendered and CSS picks one — see
                rangeLabel()'s note on why this cannot be a single string. No `drop`: the date is
                the one thing the bar exists to tell you and must survive every tier. */}
            {/* `data-testid`, and it is TEST-ONLY: nothing in production CSS or JS reads it. A story
                cannot select `.range` (CSS Modules hash it) and cannot select the BarLabel inside
                either (it is `display: inline`, so `clientWidth` is 0 and any overflow assertion on
                it is vacuous). THIS span is the box that ellipsizes — `display: block`, `overflow:
                hidden`, `text-overflow: ellipsis` — so it is the only element on which
                `scrollWidth > clientWidth` means "the date is being eaten". */}
            <span class={styles.range} data-testid="range">
                <BarLabel long={label().long} short={label().short} />
            </span>
        </div>
    )
}

export default DateNav
