// app/src/ui/ascii/glyphPaint.ts
// The pure half of GlyphCanvas: batching a frame row into same-colour text runs, placing a scene
// in the box grid, and the loop's gating arithmetic. No DOM, so it is unit-tested (glyphPaint.test.ts).
import { COMPACT_FLOOR_SCALE } from '../../graph/asciiGrid'
import type { GlyphFrame } from './glyphScene'

export type GlyphRun = {
    row: number
    col: number
    text: string
    /** Index into GLYPH_COLORS. */
    color: number
    /** Quantized 0..255. */
    alpha: number
}

/** Alpha snaps to 16 levels, so a fade does not break every run into one-cell fillText calls.
 *  Full alpha stays 255 (a plain mask would paint it at 240/255). */
export function quantizeAlpha(a: number): number {
    return a >= 248 ? 255 : a & 0xf0
}

/** One row as runs: consecutive non-space cells sharing a colour index and a quantized alpha
 *  merge. A space, or an alpha that quantizes to 0 (nothing would be visible), breaks the run. */
export function rowRuns(f: GlyphFrame, row: number): GlyphRun[] {
    const runs: GlyphRun[] = []
    let cur: GlyphRun | null = null
    for (let col = 0; col < f.cols; col++) {
        const i = row * f.cols + col
        const code = f.chars[i]
        const alpha = quantizeAlpha(f.alpha[i])
        if (code === 32 || alpha === 0) {
            cur = null
            continue
        }
        const color = f.color[i]
        if (cur && cur.color === color && cur.alpha === alpha) {
            cur.text += String.fromCharCode(code)
        } else {
            cur = {
                row,
                col,
                text: String.fromCharCode(code),
                color,
                alpha,
            }
            runs.push(cur)
        }
    }
    return runs
}

/** Offset of the scene's (0,0) in the box grid; negative when the scene is larger (it clips). */
export type SceneFit = { col: number; row: number }

export function fitScene(
    boxCols: number,
    boxRows: number,
    sceneCols: number,
    sceneRows: number,
): SceneFit {
    return {
        col: Math.floor((boxCols - sceneCols) / 2),
        row: Math.floor((boxRows - sceneRows) / 2),
    }
}

/** Whether the rAF loop should be scheduled at all. */
export function shouldRun(
    active: boolean,
    hidden: boolean,
    reduced: boolean,
): boolean {
    return active && !hidden && !reduced
}

/** Milliseconds between ambient paints at `fps`. */
export function frameInterval(fps: number): number {
    return 1000 / fps
}

/** Largest cell scale fitScale will grow a scene to. */
export const MAX_SCALE = 2

/** Cell scale that fits the scene in the box: 1 when it fits the graph's own cell grid within 1%,
 *  otherwise shrunk to fit (floored at the graph's COMPACT_FLOOR_SCALE) or grown to fill (capped
 *  at MAX_SCALE). */
export function fitScale(
    boxW: number,
    boxH: number,
    sceneCols: number,
    sceneRows: number,
    cellW: number,
    cellH: number,
): number {
    const s = Math.min(boxW / (sceneCols * cellW), boxH / (sceneRows * cellH))
    if (Math.abs(s - 1) <= 0.01) return 1
    return Math.min(MAX_SCALE, Math.max(COMPACT_FLOOR_SCALE, s))
}
