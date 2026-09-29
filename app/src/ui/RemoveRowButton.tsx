import type { Component } from 'solid-js'
import IconButton from './IconButton'

export type RemoveRowButtonProps = {
    /** Accessible name and tooltip, e.g. `remove tag`. */
    label: string
    onClick: (e: MouseEvent) => void
    class?: string
}

/** The `[x]` that removes one row from an editable list (a property, a category, a card field).
 *  `--faint` at rest and `--danger` on hover (DESIGN.md, lists in a modal): repeated down a list, a
 *  red mark on every row reads as a column of errors; the tone marks the row about to go. */
const RemoveRowButton: Component<RemoveRowButtonProps> = props => (
    <IconButton
        icon="X"
        danger="hover"
        size="sm"
        label={props.label}
        title={props.label}
        class={props.class}
        onClick={e => props.onClick(e)}
    />
)

export default RemoveRowButton
