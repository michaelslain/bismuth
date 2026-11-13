// app/src/terminalMetrics.ts
// The terminal grid's row height, as xterm's `lineHeight` multiplier. Pure: no DOM, no xterm.

/**
 * The `lineHeight` multiplier for the terminal's grid. `row` is the note's line (px) the shell
 * prompt matches; `glyphRow` is the row xterm drew at multiplier 1 (the font's own height).
 *
 * A full-screen program (opencode, vim, htop: anything on the alternate screen) draws with block
 * and box glyphs that span exactly one font-high cell. On a taller row they leave a gap between
 * every pair of rows, so a logo breaks into stripes and a `┃` border into dashes: that screen gets
 * the font's own height. xterm's DOM renderer has no custom glyphs to stretch them instead.
 */
export function terminalLineHeight(
    row: number,
    glyphRow: number,
    alternateScreen: boolean,
): number {
    if (alternateScreen || !(row > 0) || !(glyphRow > 0)) return 1
    return row / glyphRow
}
