// Pure geometry helpers for a ```draw block's ink — no CodeMirror or DOM import, so this
// runs headless under `bun test` (see the comment at the top of blockRegions.ts for why that
// constraint exists in this codebase: livePreview.ts statically imports Solid/JSX widgets that
// `bun test`'s bundler can't load, so anything that needs to run under the test runner has to
// live outside it).
//
// A stroke's `pts` is a flat array of (x, y, pressure) triples — see core/src/drawing/inkCodec.ts
// (encode/decode) and app/src/drawing/DrawingCanvas.tsx, which both stride by 3, not 2.
import type { Stroke } from '../../../core/src/drawing/model'

export interface InkBounds {
    minX: number
    minY: number
    maxX: number
    maxY: number
}

/** The bounding box of every point in every stroke, or null when there is no ink. */
export function inkBounds(strokes: Stroke[]): InkBounds | null {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let found = false

    for (const stroke of strokes) {
        const pts = stroke.pts
        for (let i = 0; i + 1 < pts.length; i += 3) {
            const x = pts[i]
            const y = pts[i + 1]
            found = true
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
    }

    return found ? { minX, minY, maxX, maxY } : null
}

/** The height (in ink-logical units) a standalone drawing block should reserve: the ink's
 *  vertical span plus `pad` on both the top and bottom. Zero for an empty stroke list. */
export function standaloneHeight(strokes: Stroke[], pad: number): number {
    const bounds = inkBounds(strokes)
    if (!bounds) return 0
    return bounds.maxY - bounds.minY + pad * 2
}
