// app/src/ui/ascii/glyphPaint.ts
// The pure half of GlyphCanvas: batching a frame row into same-colour text runs, placing a scene
// in the box grid, and the loop's gating arithmetic. No DOM, so it is unit-tested (glyphPaint.test.ts).
import { COMPACT_FLOOR_SCALE } from '../../graph/asciiGrid'
import type { GlyphFrame } from './glyphScene'
import { clamp } from '../../math'

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
 *  at `cap`, MAX_SCALE unless a host asks for less). */
export function fitScale(
    boxW: number,
    boxH: number,
    sceneCols: number,
    sceneRows: number,
    cellW: number,
    cellH: number,
    cap = MAX_SCALE,
): number {
    const s = Math.min(boxW / (sceneCols * cellW), boxH / (sceneRows * cellH))
    if (s >= 1 && s - 1 <= 0.01) return 1
    return clamp(s, COMPACT_FLOOR_SCALE, Math.max(cap, COMPACT_FLOOR_SCALE))
}

/** A scene cell on the device-pixel grid: the scale it was snapped to, and the CSS-pixel cell size
 *  (both axes are whole device pixels). */
export type CellMetrics = { scale: number; cellW: number; cellH: number }

/** How far a snapped cell width may drift from the font's natural advance at the snapped scale. The
 *  advance is pinned to the cell with letterSpacing, so a few percent reads as tracking, not shear. */
export const CELL_W_TOLERANCE = 0.03

/** Snap a fitted scale DOWN onto the device-pixel grid so `cellW * dpr` and `cellH * dpr` are whole
 *  numbers. A cell that straddles device pixels is resampled by the compositor, which is why glyph
 *  art drawn at 1.33 on a 6.3px advance (8.4px) reads soft beside the DOM text. Shrinks only, so a
 *  scene that fitted still fits; steps the row height one device pixel at a time and takes the first
 *  whose rounded width stays within CELL_W_TOLERANCE of the font's natural advance. Pure. */
export function snapCell(
    scale: number,
    baseCellW: number,
    baseCellH: number,
    dpr: number,
): CellMetrics {
    const d = dpr > 0 ? dpr : 1
    const at = (n: number): CellMetrics => {
        const s = n / (baseCellH * d)
        const w = Math.max(1, Math.round(baseCellW * s * d))
        return { scale: s, cellW: w / d, cellH: n / d }
    }
    const top = Math.max(1, Math.floor(baseCellH * scale * d + 1e-9))
    const bottom = Math.max(1, Math.floor(top * 0.9))
    for (let n = top; n >= bottom; n--) {
        const c = at(n)
        const natural = baseCellW * c.scale
        if (Math.abs(c.cellW / natural - 1) <= CELL_W_TOLERANCE) return c
    }
    return at(top)
}
