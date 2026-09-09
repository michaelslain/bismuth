// app/src/editor/inkCommit.ts
//
// The PURE half of "a stroke becomes markdown": given a note's text, one finished stroke in
// absolute ink-logical coordinates, and a table describing where the note's blocks end, produce
// the new note text with the stroke cut at every seam it crossed and each piece written into its
// owning block's ```draw fence (creating fences that do not exist yet).
//
// NO CodeMirror and NO DOM import, deliberately, for two reasons: it runs headless under
// `bun test` (see the comment at the top of blockRegions.ts for why that constraint exists here),
// and text-to-text is what lets InkOverlay apply a whole drawing session as ONE transaction.
//
// ── The coordinate contract ─────────────────────────────────────────────────────────────────
// A fence's payload stores its strokes RELATIVE TO THE TOP OF ITS OWN REPLACED RANGE — the top
// of the block widget drawBlock.ts renders in place of the fence. One rule, both shapes:
//
//   - ATTACHED (no blank line above the fence): the widget is zero-height and sits immediately
//     after the last line of the block it decorates, so its top IS that block's bottom. Ink drawn
//     over the paragraph therefore has NEGATIVE y. When the paragraph moves — because text was
//     inserted above it, or it grew — the fence moves with it and the ink follows for free. That
//     replaces the `.ink` sidecar's per-stroke `a: {p, y}` anchor with the fence's own position,
//     which is a thing the document already tracks and nothing has to remap.
//   - STANDALONE (a blank line above): the widget reserves the ink's own height
//     (drawBlockGeometry.ts's `standaloneHeight`), and the ink paints inside it from the same
//     origin. A fence created from scratch is normalized so the ink's top sits exactly `pad`
//     below the widget top — which is precisely the space `standaloneHeight` reserves for it.
//
// `Seam.origin` is what carries that top back in. It defaults to `Seam.y` because for a text
// block the two ARE the same number (the block's bottom is where its attached fence begins); a
// band that is itself an existing standalone drawing has to pass its widget top explicitly,
// because there the widget top and the widget bottom are a whole drawing apart.
import { splitStrokeAtSeams } from '../../../core/src/drawing/splitStroke'
import {
    insertDrawBlock,
    scanDrawBlocks,
    writeDrawBlock,
} from '../../../core/src/drawing/drawBlocks'
import { roundStrokes, type Stroke } from '../../../core/src/drawing/model'

/** One block's contribution to the seam table.
 *
 *  `y` — where this block ENDS, in absolute ink-logical units. This is the cut line: a stroke
 *  passing through it is split there. The table MUST be ascending in `y`; `splitStrokeAtSeams`
 *  walks it by index and returns nonsense (not an error) for an unsorted list.
 *
 *  `afterLine` — the 1-based line after which this block's ```draw fence lives, or would be
 *  inserted. For a text block that is its last line. For a band that is ITSELF an existing
 *  standalone drawing it is the blank line directly above that fence, so the one lookup rule
 *  ("the fence at `afterLine + 1`") covers both cases.
 *
 *  `origin` — the ink-logical y this band's fence stores its strokes relative to (the fence
 *  widget's top). Defaults to `y`, which is correct for every text block. */
export interface Seam {
    y: number
    afterLine: number
    origin?: number
}

/** Ink-logical padding reserved above and below a freshly-created standalone drawing. Must equal
 *  `drawBlock.ts`'s `STANDALONE_PAD`, which is what the widget actually reserves — a mismatch
 *  would park the ink outside its own box. Kept as a plain number rather than an import because
 *  this module must not pull in CodeMirror; `inkCommit.test.ts` pins the two together, and
 *  InkOverlay passes the real constant through explicitly. */
export const DEFAULT_STANDALONE_PAD = 24

const FENCE_MARKER = /^\s*(?:`{3,}|~{3,})/

/** Shift a stroke vertically. x is never touched — horizontal position inside the reading column
 *  is absolute and meaningful — and neither is the pressure byte. */
function translateY(stroke: Stroke, dy: number): Stroke {
    return {
        ...stroke,
        pts: stroke.pts.map((n, i) => (i % 3 === 1 ? Math.round(n + dy) : n)),
    }
}

function minY(stroke: Stroke): number {
    let m = Infinity
    for (let i = 1; i < stroke.pts.length; i += 3) {
        if (stroke.pts[i] < m) m = stroke.pts[i]
    }
    return m === Infinity ? 0 : m
}

/** drawBlocks.ts's attached/standalone rule, applied to a fence that does not exist yet: a fence
 *  inserted after `afterLine` is standalone when that line is blank, is a fence marker, or is not
 *  there at all (the fence would open the document). Kept in step with `scanDrawBlocks`'s own
 *  `attachedToLine` computation — if the two disagree, ink is stored against one origin and
 *  painted against another. */
function insertsStandalone(lines: string[], afterLine: number): boolean {
    if (afterLine < 1) return true
    const above = lines[afterLine - 1]
    if (above === undefined) return true
    return above.trim() === '' || FENCE_MARKER.test(above)
}

/** Write one already-cut piece into the fence that owns its band, creating the fence if needed.
 *  Returns the new document text. */
function writePiece(
    text: string,
    band: number,
    piece: Stroke,
    seams: Seam[],
    pad: number,
): string {
    const lines = text.split('\n')
    const owner: Seam | undefined = seams[band]
    // Below the last seam there is no owning block: the ink landed in the blank space after
    // everything, so it becomes a new drawing at the end of the note. Its origin only matters
    // when the insert turns out ATTACHED (the note has no trailing blank line, so the fence
    // hangs off the final block) — in which case the final seam's y is exactly that block's
    // bottom, i.e. the widget top.
    const last = seams[seams.length - 1]
    const afterLine = owner ? owner.afterLine : lines.length
    const origin = owner ? (owner.origin ?? owner.y) : (last?.y ?? 0)

    const existing = scanDrawBlocks(text).find(
        b => b.fromLine === afterLine + 1,
    )
    if (existing) {
        return writeDrawBlock(text, existing, [
            ...existing.strokes,
            translateY(piece, -origin),
        ])
    }

    if (insertsStandalone(lines, afterLine)) {
        // The widget does not exist yet, so there is no top to measure. Normalize instead:
        // put the ink's own top `pad` below the (future) widget top, which is exactly the gap
        // standaloneHeight() reserves above it.
        return insertDrawBlock(text, afterLine, [
            translateY(piece, pad - minY(piece)),
        ])
    }
    return insertDrawBlock(text, afterLine, [translateY(piece, -origin)])
}

/**
 * Commit a whole drawing session's strokes into a note's markdown, in ONE pass.
 *
 * Every `stroke.pts` is in absolute ink-logical coordinates (the space InkOverlay's pointer
 * handlers capture in). `seams` must be ascending by `y` and describes the document as it is
 * NOW — which is why every stroke in one flush shares one table: nothing has been dispatched
 * between them, so nothing has moved. `pad` is the standalone padding the editor actually
 * reserves; pass `drawBlock.ts`'s `STANDALONE_PAD`.
 *
 * A stroke with fewer than two points contributes nothing, so a stray tap costs no document edit.
 */
export function planCommitStrokes(
    text: string,
    strokes: Stroke[],
    seams: Seam[],
    pad: number = DEFAULT_STANDALONE_PAD,
): string {
    const seamYs = seams.map(s => s.y)
    const pieces: { band: number; order: number; stroke: Stroke }[] = []
    let order = 0
    for (const stroke of strokes) {
        if (stroke.pts.length < 6) continue
        // Round BEFORE splitting: inkCodec's zigzag varint is integer-only (`n << 1` truncates),
        // so a fractional coordinate would round-trip to something else entirely. Doing it here
        // rather than at the call site means no caller can forget.
        const [rounded] = roundStrokes([stroke])
        for (const p of splitStrokeAtSeams(rounded, seamYs)) {
            pieces.push({ band: p.band, order: order++, stroke: p.stroke })
        }
    }
    // BOTTOM-UP, across every stroke at once. Inserting a fence adds three lines, which
    // invalidates the `afterLine` of every seam BELOW it — so the lowest band is written first
    // and no line number above it ever moves. Writing stroke-by-stroke top-down is exactly the
    // bug this ordering exists to prevent, and it is invisible for a single stroke in a single
    // block, which is why the multi-block cases are pinned in inkCommit.test.ts.
    // Within one band the original draw order is preserved.
    pieces.sort((a, b) => b.band - a.band || a.order - b.order)
    let out = text
    for (const p of pieces) out = writePiece(out, p.band, p.stroke, seams, pad)
    // A fence appended past the note's last line lands after the final newline, which would
    // otherwise leave the file un-terminated — a whole-file diff in the vault's git snapshots
    // for what the user experienced as drawing one line.
    if (text.endsWith('\n') && !out.endsWith('\n')) out += '\n'
    return out
}

/** One stroke's worth of {@link planCommitStrokes}. */
export function planCommit(
    text: string,
    stroke: Stroke,
    seams: Seam[],
    pad: number = DEFAULT_STANDALONE_PAD,
): string {
    return planCommitStrokes(text, [stroke], seams, pad)
}

/**
 * Remove one stroke from the ```draw fence that opens at `fromLine`, returning the new document
 * text. The eraser's half of the same text-to-text contract. A fence left with no strokes keeps
 * its (now empty) payload rather than being deleted — a standalone one then reserves no height,
 * which is the same shape a freshly-inserted fence has, and leaves the user's next stroke
 * somewhere to land. Out-of-range indices return `text` untouched.
 */
export function planErase(
    text: string,
    fromLine: number,
    strokeIndex: number,
): string {
    const block = scanDrawBlocks(text).find(b => b.fromLine === fromLine)
    if (!block) return text
    if (strokeIndex < 0 || strokeIndex >= block.strokes.length) return text
    const next = block.strokes.slice()
    next.splice(strokeIndex, 1)
    return writeDrawBlock(text, block, next)
}
