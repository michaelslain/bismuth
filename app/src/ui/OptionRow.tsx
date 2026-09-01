// app/src/ui/OptionRow.tsx
// A large single-choice row: an accent icon tile, a label, a sublabel, and a trailing chevron.
// The "pick one of these scopes" control RecurrenceDialog hand-rolled as a bare <button>.
//
// Not TextButton (which enforces UPPERCASE labels) and not Button (documented internal-only) —
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
    /** Destructive tone — the row tints rose on hover instead of accent. */
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
            <Icon value={props.icon} size={17} />
        </span>
        <span class={styles['option-txt']}>
            <span class={styles['option-lab']}>{props.label}</span>
            <Show when={props.sublabel}>
                {s => <span class={styles['option-sub']}>{s()}</span>}
            </Show>
        </span>
        <span class={styles['option-chev']}>
            <Icon value="chevron-right" size={15} />
        </span>
    </button>
)

export default OptionRow
export { OptionRow }
