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

/** The height (in ink-logical units) a standalone drawing block should reserve: from the widget
 *  TOP — which is y=0 in the stored frame, and is the block boundary the ink is anchored to —
 *  down to one `pad` past the ink's lowest point. Zero for an empty stroke list.
 *
 *  Measured from the ink's ACTUAL EXTENT below the anchor, not from its span, because the space
 *  above the ink is not slack to be re-invented: it is the gap the user left between the block
 *  boundary and where they put the pen, and the widget has to reserve it for the ink to paint
 *  where it was drawn (inkCommit.ts's `trailingAnchor`). Two consequences worth stating:
 *
 *  - A NORMALIZED drawing — the only kind left, made in a note with no block above it — stores
 *    its top at exactly `pad`, so this returns `span + 2*pad` and its height is unchanged.
 *  - An ANCHORED drawing whose ink starts at the boundary stores its top at 0, where the old
 *    span-plus-two-pads reserved a top pad under nothing: a strip of dead space above ink that
 *    was already flush with the widget. It now reserves `span + pad`, one pad shorter.
 *
 *  The ink is inside the box for any `minY >= 0`, which is what `planStrokeEdit`'s floor keeps
 *  true — there is deliberately no ceiling, because a drawing's box grows down with its ink
 *  (InkOverlay's `growsDown`). */
export function standaloneHeight(strokes: Stroke[], pad: number): number {
    const bounds = inkBounds(strokes)
    if (!bounds) return 0
    return Math.max(0, bounds.maxY + pad)
}
