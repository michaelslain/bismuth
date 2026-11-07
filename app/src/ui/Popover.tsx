import type { Component, JSX } from 'solid-js'
import styles from './Popover.module.css'

export type PopoverProps = {
    class?: string
    children: JSX.Element
    /** What the box is FOR. Both tones are the same box (opaque `--menu-bg`, one soft hairline);
     *  they differ in who owns the inside spacing. `menu` is a list of rows (context menu, select
     *  list, autocomplete shell): rows edge to edge, half a menu gap above and below. `panel` is a
     *  box whose caller owns the content and its own padding (a find panel, a toolbar's settings).
     *  Default `panel`, so the one caller that predates the prop (GraphView's find panel) keeps
     *  owning its own padding. */
    tone?: 'menu' | 'panel'
    /** `lift` is the hard zero-blur offset shadow; `flat` has none (a panel that already sits on
     *  a shadowed host). Default `flat`. */
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
 * THE floating surface — menus, panels and pickers over live content. No scrim and, by default, no
 * shadow: an OPAQUE `--menu-bg` fill (darker than the note under it on dark themes) and one
 * `--rule-soft` hairline, radius 0, set it apart. `elevation="lift"` adds the hard-offset --lift
 * for a box that needs a depth cue.
 * Owns what `.asc-popover` styled bare in ui/ui.css (graph/GraphView.tsx, no owning component);
 * `.asc-popover` is a plain hashed local (`styles.popover`, see Popover.module.css).
 *
 * The rows a menu fills it with are `popover/MenuRow` via `popover/PopoverList`, which composes
 * this with `tone="menu"`; every other box that rebuilds this recipe composes it too.
 */
const Popover: Component<PopoverProps> = props => {
    // a panel is the bare box: its caller's own class sets the padding, so the tone adds none
    const toneClass = () => (props.tone === 'menu' ? styles.menu : '')
    // Flat by default: the darker fill and the hairline set the box apart from what it covers.
    const elevation = () => props.elevation ?? 'flat'
    const elevationClass = () =>
        elevation() === 'flat'
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
