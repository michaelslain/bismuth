import type { Component, JSX } from 'solid-js'
import styles from './Popover.module.css'

export type PopoverProps = {
    class?: string
    children: JSX.Element
    /** What the box is FOR. `menu` is a list of rows (context menu, select list, autocomplete
     *  shell): opaque `--bg`, the 4px inset the rows sit in. `panel` is a box whose caller owns
     *  the content and its own padding (a find panel, a date picker): opaque `--surface-1`, no
     *  inset. Default `panel`, so the one caller that predates the prop (GraphView's find panel)
     *  keeps owning its own padding. */
    tone?: 'menu' | 'panel'
    /** `lift` is the hard zero-blur offset shadow; `flat` has none (a panel that already sits on
     *  a shadowed host). */
    elevation?: 'lift' | 'flat'
    /** Which screen edge the box is pinned to. `--lift` throws right, so a box on the right edge
     *  takes `start`, the mirrored `--lift-start`, and its shadow stays on screen. Only read when
     *  `elevation` is `lift`. */
    edge?: 'end' | 'start'
    /** Inline style for the box — a menu's fixed x/y/z-index. */
    style?: JSX.CSSProperties
    /** The root element, for a caller that positions a flyout beside it. */
    ref?: (el: HTMLDivElement) => void
    onClick?: (e: MouseEvent) => void
}

/**
 * THE floating surface — menus, panels and pickers over live content. No scrim, one
 * hard-offset "TUI drop-shadow" depth cue (--lift) instead of a blurred elevation shadow, and an
 * OPAQUE fill in both tones: it used to be the translucent `--pop-bg`, which let the note or the
 * graph ghost through behind the text of a menu. Hairline `--border`, radius 0.
 * Owns what `.asc-popover` styled bare in ui/ui.css (graph/GraphView.tsx, no owning component);
 * `.asc-popover` is a plain hashed local (`styles.popover`, see Popover.module.css).
 *
 * The rows a menu fills it with are `popover/MenuRow` via `popover/PopoverList`, which composes
 * this with `tone="menu"`; every other box that rebuilds this recipe composes it too.
 */
const Popover: Component<PopoverProps> = props => {
    const toneClass = () => (props.tone === 'menu' ? styles.menu : styles.panel)
    const elevationClass = () =>
        props.elevation === 'flat'
            ? styles.flat
            : props.edge === 'start'
              ? styles['lift-start']
              : styles.lift
    return (
        <div
            ref={props.ref}
            class={`${styles['asc-popover']} ${toneClass()} ${elevationClass()}${props.class ? ` ${props.class}` : ''}`}
            style={props.style}
            data-popover=""
            onClick={e => props.onClick?.(e)}
        >
            {props.children}
        </div>
    )
}

export default Popover
export { Popover }
