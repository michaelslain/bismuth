// The typed cell-grid overlay: draws a cell's edges with `+ - | =` as real text, so a table or a
// calendar is typed on the character grid rather than drawn with `border`. See DESIGN.md's Typed
// Grid Rule.
//
// Host contract: the host cell is `position: relative` and does not clip (the glyphs straddle
// the boundary — half a line box above the top edge, half a `ch` left of the left edge). Render
// this as a child of the host. Ownership: each boundary is typed by exactly one cell — a cell
// types its top + left; the last column adds right, the last row adds bottom; a header types its
// bottom heavy and the first body row omits top; a summary row types its top heavy and the row
// above omits bottom; a full-width band types top, left, right (no interior `|`).
import { Show, type Component } from 'solid-js'
import styles from './AsciiCellEdges.module.css'

export type AsciiEdge = 'top' | 'right' | 'bottom' | 'left'
export type AsciiEdgeWeight = 'rule' | 'heavy'
export type AsciiCellEdgesProps = {
    /** Edges to type. Default ['top', 'left']. */
    edges?: AsciiEdge[]
    /** Horizontal glyph: 'rule' = `-`, 'heavy' = `=`. Vertical edges are always `|`. Default 'rule'. */
    weight?: AsciiEdgeWeight
    /** Per-edge override of `weight`, e.g. { bottom: 'heavy' } for a header cell. */
    edgeWeight?: Partial<Record<'top' | 'bottom', AsciiEdgeWeight>>
    /** 'soft' = --faint ink (row/column rules), 'firm' = --border ink (structural). Default 'soft'. */
    ink?: 'soft' | 'firm'
    class?: string
}

const AsciiCellEdges: Component<AsciiCellEdgesProps> = props => {
    const has = (edge: AsciiEdge) => (props.edges ?? ['top', 'left']).includes(edge)
    const weight = (edge: 'top' | 'bottom') =>
        (props.edgeWeight?.[edge] ?? props.weight ?? 'rule') === 'heavy'
            ? styles.heavy
            : styles.rule
    // a corner is typed only where BOTH of its edges are drawn
    const corner = (v: 'top' | 'bottom', h: 'left' | 'right') => has(v) && has(h)
    return (
        <div
            aria-hidden="true"
            class={`${styles.edges} ${props.ink === 'firm' ? styles.firm : ''} ${props.class ?? ''}`}
        >
            <Show when={has('top')}>
                <div class={`${styles.run} ${styles.top} ${weight('top')}`} />
            </Show>
            <Show when={has('bottom')}>
                <div class={`${styles.run} ${styles.bottom} ${weight('bottom')}`} />
            </Show>
            <Show when={has('left')}>
                <div class={`${styles.bar} ${styles.left}`} />
            </Show>
            <Show when={has('right')}>
                <div class={`${styles.bar} ${styles.right}`} />
            </Show>
            <Show when={corner('top', 'left')}>
                <div class={`${styles.corner} ${styles.top} ${styles.left}`} data-corner="top-left" />
            </Show>
            <Show when={corner('top', 'right')}>
                <div class={`${styles.corner} ${styles.top} ${styles.right}`} data-corner="top-right" />
            </Show>
            <Show when={corner('bottom', 'left')}>
                <div class={`${styles.corner} ${styles.bottom} ${styles.left}`} data-corner="bottom-left" />
            </Show>
            <Show when={corner('bottom', 'right')}>
                <div class={`${styles.corner} ${styles.bottom} ${styles.right}`} data-corner="bottom-right" />
            </Show>
        </div>
    )
}

export default AsciiCellEdges
