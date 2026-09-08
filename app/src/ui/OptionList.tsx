// app/src/ui/OptionList.tsx
// The grouped container a set of <OptionRow>s lives in: one bordered panel on --surface-2 with the
// rows separated by hairlines, rather than N free-floating cards.
//
// WHY THIS EXISTS. Every other list of choosable rows in the modal family is already this shape —
// `.cat-group` wrapping `.cat-row`, `.set-cols` wrapping `.set-col`, `.propset-list` wrapping
// `.propset-row`. OptionRow was the one that carried its own background and border, so
// RecurrenceDialog stacked three separate cards where its neighbours draw one panel. That is what
// made the dialog read as foreign next to the rest of the app even after its colour was fixed.
//
// The container also owns the ROUNDING and the clipping, which is why the hairline between rows can
// be a plain `border-top` on the row and still not poke out at the panel's corners.
import { type Component, type JSX } from 'solid-js'
import styles from './OptionList.module.css'

export type OptionListProps = {
    /** The <OptionRow>s. */
    children: JSX.Element
    class?: string
}

const OptionList: Component<OptionListProps> = props => (
    <div
        class={styles['option-list']}
        classList={{ [props.class ?? '']: !!props.class }}
    >
        {props.children}
    </div>
)

export default OptionList
export { OptionList }
