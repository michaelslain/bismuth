import type { Component, JSX } from 'solid-js'
import Text from './Text'
import styles from './ValueChip.module.css'

export type ValueChipProps = {
    children: JSX.Element
    /** CSS colour for the brackets and label. Default `--accent`. */
    color?: string
    class?: string
}

/** A non-interactive `[value]` bracket chip — the same look as a selected ChipToggle, for
 *  DISPLAYING a multiselect value. A `<span>`: no role, no tabindex. */
const ValueChip: Component<ValueChipProps> = props => (
    <Text
        as="span"
        inherit
        class={[styles['value-chip'], props.class].filter(Boolean).join(' ')}
        style={props.color ? { '--chip-color': props.color } : undefined}
    >
        {props.children}
    </Text>
)

export default ValueChip
