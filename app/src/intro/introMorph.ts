// The intro's morph state machine, pure: VaultIntro feeds it every slide move and reads progress
// each frame. No framework or DOM imports.
import { GLYPH_COLORS, type GlyphFrame } from '../ui/ascii/glyphScene'
import type { MorphCell, MorphGrid } from './morph/morphGrid'
import { MORPH_MS } from './morph/morphFrame'

export type MorphState =
    | { phase: 'idle' }
    | {
          phase: 'running'
          fromIndex: number
          toIndex: number
          startedAt: number
      }

export const MORPH_IDLE: MorphState = { phase: 'idle' }

/** The state after a slide move. Reduced motion cuts (idle). A move while running retargets: the
 *  new flight starts from what is on screen now, toward the newest slide, and nothing queues. */
export function morphOnMove(
    state: MorphState,
    fromIndex: number,
    toIndex: number,
    now: number,
    reduced: boolean,
): MorphState {
    if (reduced) return MORPH_IDLE
    if (state.phase === 'running') {
        return {
            phase: 'running',
            fromIndex: state.toIndex,
            toIndex,
            startedAt: now,
        }
    }
    if (fromIndex === toIndex) return MORPH_IDLE
    return { phase: 'running', fromIndex, toIndex, startedAt: now }
}

/** 0..1 across MORPH_MS from the state's start; idle reads as settled (1). */
export function morphProgress(state: MorphState, now: number): number {
    if (state.phase === 'idle') return 1
    return Math.min(1, Math.max(0, (now - state.startedAt) / MORPH_MS))
}

/** The non-blank cells of an overlay frame as a MorphGrid: the `from` of a retargeted flight, so a
 *  second press continues from the characters on screen instead of jumping. */
export function frameToGrid(f: GlyphFrame): MorphGrid {
    const cells: MorphCell[] = []
    for (let row = 0; row < f.rows; row++) {
        for (let col = 0; col < f.cols; col++) {
            const i = row * f.cols + col
            if (f.chars[i] === 32 || f.alpha[i] === 0) continue
            cells.push({
                col,
                row,
                ch: String.fromCharCode(f.chars[i]),
                color: GLYPH_COLORS[f.color[i]],
            })
        }
    }
    return { cols: f.cols, rows: f.rows, cells }
}
