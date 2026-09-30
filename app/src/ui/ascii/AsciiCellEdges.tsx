// The typed cell-grid overlay: draws a cell's edges with the UI font's own `+ - | =` glyphs
// (rasterised once into mask tiles by asciiGlyphTiles.ts), so a table or a calendar is typed on
// the character grid rather than drawn with `border`. See DESIGN.md's Typed Grid Rule.
//
// Host contract: the host cell is `position: relative` and does not clip (the glyphs straddle
// the boundary — half a line box above the top edge, half a `ch` left of the left edge). Render
// this as a child of the host; it renders one overlay, plus one `backdrop` ring before it when asked. Ownership: each boundary is typed by exactly one cell — a cell
// types its top + left; the last column adds right, the last row adds bottom; a header types its
// bottom heavy and the first body row omits top; a summary row types its top heavy and the row
// above omits bottom; a full-width band types top, left, right (no interior `|`).
import { createMemo, Show, type Component } from 'solid-js'
import { edgeAttrs, edgesKey } from './asciiGlyphTiles'
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
    /** Paint an opaque `--bg` ring over this cell's glyph overhang, for cells in a sticky header, so
     *  content scrolling beneath never shows through. With no `top` edge the ring skips its top band
     *  (the cell above owns that line). Default false. */
    backdrop?: boolean
    class?: string
}

const AsciiCellEdges: Component<AsciiCellEdgesProps> = props => {
    // ONE memo per instance: the edge set as the two runtime hooks the stylesheet selects the
    // glyph sprite from — `data-edges` (drawn edges, `top right bottom left` order) and
    // `data-heavy` (the ones typed `=`, absent when none)
    const attrs = createMemo(() =>
        edgeAttrs(edgesKey(props.edges, props.weight, props.edgeWeight)),
    )
    // The edges are ONE element, no children: a nine-slice mask of the UI font's own glyphs
    // (asciiGlyphTiles.ts) over the ink colour. With `backdrop`, one ring element precedes it — an
    // opaque `--bg` frame over the overhang only, never the host's own box — so the glyphs paint on
    // top of it.
    return (
        <>
            <Show when={props.backdrop}>
                <div
                    aria-hidden="true"
                    data-backdrop
                    class={`${styles.backdrop} ${(props.edges ?? ['top', 'left']).includes('top') ? '' : styles.backdropNoTop}`}
                />
            </Show>
            <div
                aria-hidden="true"
                data-edges={attrs().edges}
                data-heavy={attrs().heavy}
                class={`${styles.edges} ${props.ink === 'firm' ? styles.firm : ''} ${props.class ?? ''}`}
            />
        </>
    )
}

export default AsciiCellEdges
