// The data shape both snapshots produce and the morph plan consumes. Pure types, no DOM.
import type { GlyphColor } from '../../ui/ascii/glyphScene'

/** One character of a snapshot. `col`/`row` place it on the base cell grid, which the plan pairs
 *  on and the art paints on. A text glyph also carries where the real glyph sits, in cell units, so
 *  the overlay can paint it on the real word's footprint instead of on a base cell: `x` is the
 *  fractional column of its slot's left edge, `y` the fractional row of its vertical centre, and
 *  `scale` its slot width and font size as a multiple of one cell. The three come together. */
export type MorphCell = {
    col: number
    row: number
    ch: string
    color: GlyphColor
    x?: number
    y?: number
    scale?: number
}

/** Sparse: only non-blank cells. cols/rows = the grid the overlay paints (the takeover's box / cell). */
export type MorphGrid = { cols: number; rows: number; cells: MorphCell[] }
