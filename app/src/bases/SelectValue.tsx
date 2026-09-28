// app/src/bases/SelectValue.tsx
// A declared `select` (enum) property as a dropdown of its options plus a `(clear)` entry. A
// stored value the base's `options:` list does not (or no longer) declare is still shown as the
// CURRENT selection, prepended to the menu rather than silently reading as cleared (#101).
import type { Component } from 'solid-js'
import Select from '../ui/Select'
import { selectChoices } from './propertyEdit'
import styles from './SelectValue.module.css'

export type SelectValueProps = {
    options: string[]
    value: unknown
    /** The chosen value, or null for `(clear)`. */
    onCommit: (value: string | null) => void
    /** The menu was dismissed without a choice. */
    onCancel: () => void
}

const SelectValue: Component<SelectValueProps> = props => {
    const current = () => (props.value == null ? '' : String(props.value))
    return (
        <div class={styles.select}>
            <Select
                value={current()}
                options={selectChoices(props.options, current())}
                onChange={v => props.onCommit(v === '' ? null : v)}
                onDismiss={props.onCancel}
                class={styles.trigger}
            />
        </div>
    )
}

export default SelectValue
