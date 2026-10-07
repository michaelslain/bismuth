// app/src/bases/SelectValue.tsx
// A declared `select` (enum) property as a dropdown of its options plus a `(clear)` entry. A
// stored value the base's `options:` list does not (or no longer) declare is still shown as the
// CURRENT selection, prepended to the menu rather than silently reading as cleared (#101).
// UNSET reads as the muted placeholder, never as the `(clear)` row in full ink. A value that is a
// known status keeps its dot and category colour while edited (the look `renderStatus` gives it at
// rest), so entering edit does not strip it.
import { Show, type Component } from 'solid-js'
import Select from '../ui/Select'
import StatusDot, { STATUS_COLOR, statusColor } from '../ui/StatusDot'
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
    const isStatus = () => current().trim().toLowerCase() in STATUS_COLOR
    return (
        <div
            class={styles.select}
            style={
                isStatus()
                    ? { '--select-status-color': statusColor(current()) }
                    : undefined
            }
        >
            <Show when={isStatus()}>
                <StatusDot status={current()} />
            </Show>
            <Select
                value={current()}
                options={selectChoices(props.options, current())}
                placeholder="Select…"
                onChange={v => props.onCommit(v === '' ? null : v)}
                onDismiss={props.onCancel}
                class={styles.trigger}
                triggerClass={isStatus() ? styles.status : undefined}
            />
        </div>
    )
}

export default SelectValue
