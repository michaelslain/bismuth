import type { Component, JSX } from 'solid-js'
import styles from './Popover.module.css'

export type PopoverProps = {
    class?: string
    children: JSX.Element
}

/**
 * The floating surface used by menus/palettes/tooltips over live content — no scrim, one
 * hard-offset "TUI drop-shadow" depth cue (--lift) instead of the old blurred elevation shadow.
 * Owns what `.asc-popover` styled bare in ui/ui.css (3x by graph/GraphView.tsx, no owning
 * component). Those call sites are a later wave's job; this component only introduces the
 * primitive they will eventually compose. `asc-popover` is written as a bare string literal,
 * not `styles[...]`, because the class is still a `:global()` bridge in Popover.module.css —
 * see that file's header.
 */
const Popover: Component<PopoverProps> = props => {
    return (
        <div
            class={`${styles['popover-marker']} asc-popover${props.class ? ` ${props.class}` : ''}`}
            data-popover=""
        >
            {props.children}
        </div>
    )
}

export default Popover
export { Popover }
