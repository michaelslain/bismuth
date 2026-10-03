// app/src/ui/ascii/glyphScene.ts
// The seam between a glyph-art SCENE (pure: time -> characters) and the canvas that paints it
// (GlyphCanvas). A scene writes chars, a colour NAME and an alpha per cell into a GlyphFrame;
// the canvas resolves names to the theme's CSS vars, so every theme recolours every scene.
// Pure — no DOM, no framework — so scenes are unit-testable under bun test.

export const GLYPH_COLORS = [
    'fg',
    'muted',
    'faint',
    'accent',
    'graph0',
    'graph1',
    'graph2',
    'graph3',
    'graph4',
] as const
export type GlyphColor = (typeof GLYPH_COLORS)[number]

/** The CSS custom property each colour name reads — the same vars AsciiGraphRenderer reads. */
export const GLYPH_COLOR_VARS: Record<GlyphColor, string> = {
    fg: '--fg',
    muted: '--text-muted',
    faint: '--faint',
    accent: '--accent',
    graph0: '--graph-0',
    graph1: '--graph-1',
    graph2: '--graph-2',
    graph3: '--graph-3',
    graph4: '--graph-4',
}

export type GlyphFrame = {
    cols: number
    rows: number
    /** Char code per cell, row-major. 32 (space) = empty. */
    chars: Uint16Array
    /** Index into GLYPH_COLORS per cell. */
    color: Uint8Array
    /** 0..255 per cell. */
    alpha: Uint8Array
}

export type GlyphScene = {
    /** The grid the scene is authored for; GlyphCanvas centres it in its box. */
    cols: number
    rows: number
    /** Length of the reveal phase; t >= revealMs is ambient. */
    revealMs: number
    /** Pure: the same t always writes the same frame. Must clear `out` itself. */
    frame(t: number, out: GlyphFrame): void
}

/** Ambient frames per second — terminal cadence, and cheap. */
export const AMBIENT_FPS = 12

export function createFrame(cols: number, rows: number): GlyphFrame {
    const n = cols * rows
    return {
        cols,
        rows,
        chars: new Uint16Array(n).fill(32),
        color: new Uint8Array(n),
        alpha: new Uint8Array(n),
    }
}

export function clearFrame(f: GlyphFrame): void {
    f.chars.fill(32)
    f.color.fill(0)
    f.alpha.fill(0)
}

/** Write one char; silently ignores cells outside the frame. */
export function putChar(
    f: GlyphFrame,
    col: number,
    row: number,
    ch: string,
    color: GlyphColor,
    alpha = 255,
): void {
    if (col < 0 || row < 0 || col >= f.cols || row >= f.rows) return
    const i = row * f.cols + col
    f.chars[i] = ch.charCodeAt(0)
    f.color[i] = GLYPH_COLORS.indexOf(color)
    f.alpha[i] = alpha
}

/** Write a string left to right from (col, row); clips at the frame edge. */
export function putText(
    f: GlyphFrame,
    col: number,
    row: number,
    text: string,
    color: GlyphColor,
    alpha = 255,
): void {
    for (let k = 0; k < text.length; k++)
        putChar(f, col + k, row, text[k], color, alpha)
}

/** The frame as plain text, rows joined by '\n' — for tests and snapshots. */
export function frameToText(f: GlyphFrame): string {
    const lines: string[] = []
    for (let r = 0; r < f.rows; r++) {
        let line = ''
        for (let c = 0; c < f.cols; c++)
            line += String.fromCharCode(f.chars[r * f.cols + c])
        lines.push(line)
    }
    return lines.join('\n')
}

/** Deterministic 0..1 hash of a cell + seed — the scenes' only randomness. */
export function cellHash(col: number, row: number, seed = 0): number {
    let h = (col * 374761393 + row * 668265263 + seed * 2147483647) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h ^= h >>> 16
    return (h >>> 0) / 0x100000000
}
