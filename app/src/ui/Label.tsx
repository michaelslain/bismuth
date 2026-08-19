import type { Component, JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import styles from './Label.module.css'
import './ui.css'

export type LabelTag = 'span' | 'div'
export type LabelTone = 'default' | 'muted' | 'faint'

export type LabelProps = {
    /** Tag to render. 'span' (default) for an inline run inside a row, 'div' for a block
     *  context (a cards-view cover title/author, which stacks rather than sitting in a row). */
    as?: LabelTag
    /** Adds `flex: 1` — the common case for a primary value in a flex row that must grow to
     *  take the row's remaining space before it truncates (daemon-row-label, pane-header-label,
     *  tab-rail-label, palette-label, graph-search-label, ltext). Omit for a label that sits
     *  outside a flex row, or that a caller's own rule already positions (margin-left: auto,
     *  a fixed max-width, a flex-shrink: 0) — that placement stays in the caller's module; see
     *  Label.module.css for why. */
    fill?: boolean
    /** Text color: 'default' reads --fg, 'muted' --text-muted, 'faint' --faint. Omit to inherit
     *  the ambient color instead — several call sites deliberately leave color to an ancestor
     *  selector (a focused-pane rule, a hover reveal, a `:global(.selected)` state) that must
     *  keep reaching the element by its own class name, not this component's. */
    tone?: LabelTone
    /** 1 (default): single-line ellipsis. 2: a two-line `-webkit-line-clamp` clamp (the cards
     *  view's cover title) — wraps normally instead of `white-space: nowrap`. */
    lines?: 1 | 2
    /** `display: inline-block` for a label inside a non-flex ancestor (a table `<th>`) — a bare
     *  `<span>` is inline and `text-overflow: ellipsis` silently does nothing on an inline box.
     *  Every other call site is already a flex item (which blockifies it automatically), so this
     *  defaults to off. */
    inline?: boolean
    class?: string
    children?: JSX.Element
}

function labelClass(props: LabelProps): string {
    const tone = props.tone
    const lines = props.lines ?? 1
    return [
        styles.label,
        props.fill ? styles['label--fill'] : '',
        props.inline ? styles['label--inline'] : '',
        tone ? styles[`label--${tone}`] : '',
        lines === 2 ? styles['label--lines2'] : '',
        props.class,
    ]
        .filter(Boolean)
        .join(' ')
}

/**
 * The truncating-label primitive: a value that must ellipsize instead of wrapping or blowing
 * out its container — a row's title, a secondary value pinned to the row's edge, a card's cover
 * text. `text-overflow: ellipsis` does not truncate a bare text child of a flex container (the
 * text becomes an anonymous flex item whose min-width defaults to its content width) — this
 * component always sets `min-width: 0` alongside `overflow: hidden` so truncation actually
 * fires; see Label.module.css and shell/DragGhost.module.css's header for the fuller trap
 * writeup. Variants are props (fill/tone/lines/inline), not separate components.
 */
const Label: Component<LabelProps> = props => {
    return (
        <Dynamic component={props.as ?? 'span'} class={labelClass(props)}>
            {props.children}
        </Dynamic>
    )
}

export default Label
