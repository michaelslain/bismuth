import type { Component, JSX } from 'solid-js'
import styles from './Popover.module.css'

export type PopoverProps = {
    class?: string
    children: JSX.Element
}

/**
 * The floating surface used by menus/palettes/tooltips over live content — no scrim, one
 * hard-offset "TUI drop-shadow" depth cue (--lift) instead of the old blurred elevation shadow.
 * Owns what `.asc-popover` styled bare in ui/ui.css (graph/GraphView.tsx, no owning component).
 * GraphView.tsx now composes this component directly, so `.asc-popover` is a plain hashed local
 * (`styles['asc-popover']`, see Popover.module.css) like any other component class.
 */
const Popover: Component<PopoverProps> = props => {
    return (
        <div
            class={`${styles['asc-popover']}${props.class ? ` ${props.class}` : ''}`}
            data-popover=""
        >
            {props.children}
        </div>
    )
}

export default Popover
export { Popover }
