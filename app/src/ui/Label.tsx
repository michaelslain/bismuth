import { splitProps, type Component, type JSX } from 'solid-js'
import Text from './Text'
import styles from './Label.module.css'

export type LabelTag = 'span' | 'div'
export type LabelTone = 'default' | 'muted' | 'faint'
/** 'ui' (default) leaves the ambient --ui-font-stack; 'prose' switches ONLY the family to
 *  --prose-font — what a person WROTE (a note title, a search hit), not mechanism/data. */
export type LabelRegister = 'ui' | 'prose'

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
    /** Type register: 'ui' (default) or 'prose' (the serif, for text a person wrote). Callers
     *  pass this instead of a local class that swaps `font-family`. */
    register?: LabelRegister
    /** `display: inline-block` for a label inside a non-flex ancestor (a table `<th>`) — a bare
     *  `<span>` is inline and `text-overflow: ellipsis` silently does nothing on an inline box.
     *  Every other call site is already a flex item (which blockifies it automatically), so this
     *  defaults to off. */
    inline?: boolean
    class?: string
    children?: JSX.Element
} & Omit<JSX.HTMLAttributes<HTMLElement>, 'class' | 'children'>

function labelClass(props: LabelProps): string {
    const lines = props.lines ?? 1
    return [
        props.fill ? styles['label--fill'] : '',
        props.inline ? styles['label--inline'] : '',
        lines === 2 ? styles['label--lines2'] : '',
        props.class,
    ]
        .filter(Boolean)
        .join(' ')
}

/**
 * The truncating-label primitive: a value that must ellipsize instead of wrapping or blowing
 * out its container — a row's title, a secondary value pinned to the row's edge, a card's cover
 * text. It composes `Text` (inheriting size and weight, so the label takes its look from the row)
 * and reads Text's tone map and `truncate` — which carries the `min-width: 0` that makes
 * `text-overflow: ellipsis` fire inside a flex row; see Text.module.css and
 * shell/DragGhost.module.css's header for the trap writeup. Label keeps only its own layout
 * (fill / inline / the two-line clamp). Variants are props (fill/tone/lines/inline/register),
 * not separate components. Every other HTML attribute and `ref` pass through onto the element.
 */
const Label: Component<LabelProps> = props => {
    const [local, rest] = splitProps(props, [
        'as',
        'fill',
        'tone',
        'lines',
        'inline',
        'register',
        'class',
        'children',
    ])
    return (
        <Text
            {...rest}
            inherit
            as={local.as ?? 'span'}
            tone={local.tone}
            register={local.register === 'prose' ? 'prose' : 'chrome'}
            truncate={(local.lines ?? 1) !== 2}
            class={labelClass(props)}
        >
            {local.children}
        </Text>
    )
}

export default Label
