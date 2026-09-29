// app/src/ui/OptionRow.tsx
// A single-choice row: an icon mark, a label, and a faint sublabel on the row's trailing edge — the
// shape of a daemon crons row (name left, faint status right). Lives in a RowList and matches
// ListRow by metrics (see OptionRow.module.css).
// The "pick one of these scopes" control RecurrenceDialog hand-rolled as a bare <button>.
//
// Not TextButton (which enforces lowercase bracket labels) and not Button (documented internal-only) —
// a sentence-case, two-line, full-width choice row is a different control, so it is its own
// primitive rather than a special case of the label button.
import { Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import styles from './OptionRow.module.css'

export type OptionRowProps = {
    /** Icon name from the icon registry. */
    icon: string
    label: string
    sublabel?: string
    /** Destructive tone — the mark, hover and focus ring take --danger instead of --accent. */
    danger?: boolean
    onClick: () => void
    class?: string
}

const OptionRow: Component<OptionRowProps> = props => (
    <button
        type="button"
        class={styles['option-row']}
        classList={{
            [styles['danger']!]: !!props.danger,
            [props.class ?? '']: !!props.class,
        }}
        onClick={() => props.onClick()}
    >
        <span class={styles['option-ic']}>
            <Icon value={props.icon} />
        </span>
        <span class={styles['option-lab']}>{props.label}</span>
        <Show when={props.sublabel}>
            {s => <span class={styles['option-sub']}>{s()}</span>}
        </Show>
    </button>
)

export default OptionRow
export { OptionRow }
