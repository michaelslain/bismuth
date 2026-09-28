import type { Component } from 'solid-js'
import IconButton from './IconButton'

export type RemoveRowButtonProps = {
    /** Accessible name and tooltip, e.g. `remove tag`. */
    label: string
    onClick: (e: MouseEvent) => void
    class?: string
}

/** The `[x]` that removes one row from an editable list (a property, a category, a card field). */
const RemoveRowButton: Component<RemoveRowButtonProps> = props => (
    <IconButton
        icon="X"
        danger
        size="sm"
        label={props.label}
        title={props.label}
        class={props.class}
        onClick={e => props.onClick(e)}
    />
)

export default RemoveRowButton
