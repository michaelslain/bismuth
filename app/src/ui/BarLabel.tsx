// app/src/ui/BarLabel.tsx — a view-bar label that knows how to get smaller.
//
// The bar's collapse ladder lives ONCE, in ui/ui.css, and a view opts into it by TAGGING rather
// than by writing container queries of its own. This is the label half of that vocabulary; the
// other half is `data-bar-drop` on a whole control (see the ladder's own comment).
import { type Component, Show } from 'solid-js'
import styles from './BarLabel.module.css'
import './ui.css'

export type BarLabelProps = {
    /** Full text. Shown whenever there is room. */
    long: string
    /** Abbreviation, swapped in at the abbreviate tier. Omit to keep `long` at every width. */
    short?: string
    /** 'early' drops the word entirely at the first tier, 'late' holds until the last.
     *  Omit and the word is never dropped — the attribute is still emitted, EMPTY (see below).
     *
     *  TWO TIERS, NOT ONE, and the calendar is why: it sheds "CATEGORIES"/"EVENT" early — both
     *  buttons keep an icon that already names them — but holds "TODAY" almost to the floor,
     *  because a calendar glyph inside a calendar is the least self-descriptive icon in the app. */
    drop?: 'early' | 'late'
    /** Merged onto the root, so a caller can adjust one instance without forking the primitive. */
    class?: string
}

/** A bar label that knows how to get smaller. Both lengths are in the DOM and CSS picks one — the
 *  only honest way to abbreviate, since CSS cannot rewrite text.
 *
 *  THE HOOKS ARE `data-*`, NEVER CLASSES. The rules that read them live in the GLOBAL ui.css, and a
 *  global rule naming a CSS-module class hashes to a different local and matches nothing, silently
 *  — the trap CLAUDE.md documents and bench/moduleClassCheck.ts exists to catch. Attribute
 *  selectors are never hashed.
 *
 *  The wrapper spans are not ceremony either: <Icon> sets `display: inline-flex` as an INLINE
 *  STYLE, which no class rule can override, so a bare text node beside an Icon has nothing a tier
 *  rule can address.
 *
 *  `data-bar-label` IS ALWAYS EMITTED, empty when there is no `drop`, and that empty string is
 *  load-bearing. The abbreviate tier has to out-specify this file's own default
 *  `.label [data-bar-abbr='short'] { display: none }` — same two-class weight, and BarLabel.module.css
 *  is emitted AFTER ui.css on both surfaces, so a tie loses. Matching through `[data-bar-label]`
 *  gives the tier a third compound and it wins on specificity rather than on load order, which is
 *  the thing that differs between the app bundle and Storybook. Dropping the attribute when `drop`
 *  is unset would exclude exactly the plain labels the tier most needs to reach. */
const BarLabel: Component<BarLabelProps> = props => (
    <span
        class={`${styles.label} ${props.class ?? ''}`}
        data-bar-label={props.drop ?? ''}
    >
        <span data-bar-abbr="long">{props.long}</span>
        <Show when={props.short}>
            {s => <span data-bar-abbr="short">{s()}</span>}
        </Show>
    </span>
)

export default BarLabel
export { BarLabel }
