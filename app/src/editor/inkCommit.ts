// app/src/editor/inkCommit.ts
//
// The PURE half of "a stroke becomes markdown": given a note's text, the strokes of one drawing
// session in absolute ink-logical coordinates, and a table describing the note's blocks, produce
// the new note text with each stroke cut at every seam it crossed and each piece written into its
// owning block's ```draw fence (creating fences that do not exist yet).
//
// NO CodeMirror and NO DOM import, deliberately, for two reasons: it runs headless under
// `bun test` (see the comment at the top of blockRegions.ts for why that constraint exists here),
// and text-to-text is what lets InkOverlay apply a whole drawing session as ONE transaction.
//
// ── The coordinate contract ─────────────────────────────────────────────────────────────────
// The user asked for one thing: "if a drawing is drawn on text, it follows the text." Two edges
// of that are easy to get wrong, and both were, before this contract:
//
//   - ATTACHED (no blank line above the fence, so it decorates the block above it). Its ink is
//     stored relative to the TOP of that block, in UNSCALED PIXELS.
//       * TOP, not bottom, because markdown grows DOWNWARD. Typing into an annotated paragraph
//         moves its bottom by a full line pitch and leaves its top exactly where it was, so the
//         top is the zero-drift edge for the common direction. Bottom-anchoring maximises drift
//         (measured: an annotation slid 18px on one typed line).
//       * PIXELS, not the 680px logical column, because line heights do not rescale with pane
//         width but a logical offset does. Storing y scaled made ink walk away from its text
//         whenever the pane resized (measured: 37px at 55% width, with no text change at all).
//         x STAYS scaled, so the annotation keeps spanning the same words; a narrow pane
//         therefore squashes annotation ink horizontally, which is the accepted trade.
//   - STANDALONE (a blank line above): the widget reserves the ink's own height
//     (drawBlockGeometry.ts's `standaloneHeight`) and the ink paints inside it, in the uniform
//     logical space — a standalone drawing has no text to stay aligned with, so it should scale
//     as a whole. A fence created from scratch is normalized so the ink's top sits exactly `pad`
//     below the widget top, which is the space `standaloneHeight` reserves for it.
//
// `Seam.origin` and `Seam.scale` carry that per band: stored y = `y * scale - origin`. An
// attached band passes the live content scale and its block top in pixels; a standalone band
// passes scale 1 and its widget top in logical units.
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
 *  `scale` / `origin` — how this band's fence stores ink: `stored = y * scale - origin`. An
 *  attached band passes the live content scale and its block's TOP in unscaled pixels; a
 *  standalone band passes 1 and its widget top in logical units. Both default to the identity,
 *  which is only ever right for a test fixture that does not care where the ink lands. */
export interface Seam {
    y: number
    afterLine: number
    scale?: number
    origin?: number
}

/** Ink-logical padding reserved above and below a freshly-created standalone drawing. Must equal
 *  `drawBlock.ts`'s `STANDALONE_PAD`, which is what the widget actually reserves — a mismatch
 *  would park the ink outside its own box. Kept as a plain number rather than an import because
 *  this module must not pull in CodeMirror; `inkCommit.test.ts` pins the two together, and
 *  InkOverlay passes the real constant through explicitly. */
export const DEFAULT_STANDALONE_PAD = 24

const FENCE_MARKER = /^\s*(?:`{3,}|~{3,})/

/** Map a stroke's y through `y * scale - origin`, rounding to whole units. x is never touched —
 *  horizontal position inside the reading column is absolute and meaningful — and neither is the
 *  pressure byte. */
function rebaseY(stroke: Stroke, scale: number, origin: number): Stroke {
    return {
        ...stroke,
        pts: stroke.pts.map((n, i) =>
            i % 3 === 1 ? Math.round(n * scale - origin) : n,
        ),
    }
}

function minYOf(strokes: Stroke[]): number {
    let m = Infinity
    for (const s of strokes) {
        for (let i = 1; i < s.pts.length; i += 3) {
            if (s.pts[i] < m) m = s.pts[i]
        }
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

/** The 1-based line number of a note's frontmatter CLOSING delimiter, or 0 when it has none. */
function frontmatterCloseLine(lines: string[]): number {
    if (lines.length < 2 || lines[0].trim() !== '---') return 0
    for (let i = 1; i < lines.length; i++) {
        const t = lines[i].trim()
        if (t === '---' || t === '...') return i + 1
    }
    return 0
}

/** Never hang a fence off a frontmatter close.
 *
 *  A fence inserted directly after the closing `---` scans as ATTACHED, and then Editor.tsx's
 *  autosave runs `normalizeFrontmatterSpacing`, which inserts a blank line in exactly that spot —
 *  which is the single thing `scanDrawBlocks` uses to decide standalone. Within one autosave the
 *  fence flips mode with no user action: the paint origin changes, the widget starts reserving
 *  height so every line below jumps, and the stored y values (negative, drawn upward from a
 *  block bottom) paint outside the box. Frontmatter is standard in this vault, so this is a
 *  routine note, not an edge case.
 *
 *  So: move the insertion point below the separator, where the fence is standalone from the
 *  start and the normalizer has nothing left to change. When there is no separator yet, add the
 *  one the normalizer would add anyway, so the result is a fixed point instead of something the
 *  next save rewrites. */
function separateFromFrontmatter(
    text: string,
    afterLine: number,
): { text: string; afterLine: number } {
    const lines = text.split('\n')
    const close = frontmatterCloseLine(lines)
    if (!close || afterLine !== close) return { text, afterLine }
    if ((lines[close] ?? '').trim() === '') {
        return { text, afterLine: close + 1 }
    }
    lines.splice(close, 0, '')
    return { text: lines.join('\n'), afterLine: close + 1 }
}

/** Write every piece that landed in one band, as ONE fence.
 *
 *  Per BAND, not per piece. Writing piece-by-piece re-derived the trailing band's insertion point
 *  (`lines.length`) from the text the previous piece had just grown, so the fence that piece had
 *  created was never found again: a five-stroke sketch drawn in blank space came out as five
 *  separate standalone fences, each independently normalized to `pad`, reserving 500px of height
 *  for 160px of ink. Grouping first is what makes a multi-stroke drawing one drawing. */
function writeBand(
    text: string,
    band: number,
    pieces: Stroke[],
    seams: Seam[],
    pad: number,
): string {
    // Below the last seam there is no owning block: the ink landed in the blank space after
    // everything. It shares the LAST block's anchor, because the only way that band's fence ends
    // up attached rather than standalone is the note having no trailing blank line — in which
    // case the fence hangs off that very block.
    const owner: Seam | undefined = seams[band]
    const anchor = owner ?? seams[seams.length - 1]
    const scale = anchor?.scale ?? 1
    const origin = anchor?.origin ?? 0

    const moved = separateFromFrontmatter(
        text,
        owner ? owner.afterLine : text.split('\n').length,
    )
    const out = moved.text
    const afterLine = moved.afterLine
    const lines = out.split('\n')

    const existing = scanDrawBlocks(out).find(b => b.fromLine === afterLine + 1)
    if (existing) {
        return writeDrawBlock(out, existing, [
            ...existing.strokes,
            ...pieces.map(p => rebaseY(p, scale, origin)),
        ])
    }

    if (insertsStandalone(lines, afterLine)) {
        // The widget does not exist yet, so there is no top to measure. Normalize instead, and
        // normalize the GROUP rather than each piece: a sketch has to keep its own internal
        // geometry, and the whole drawing's top is what sits `pad` below the widget top.
        const dy = pad - minYOf(pieces)
        return insertDrawBlock(
            out,
            afterLine,
            pieces.map(p => rebaseY(p, 1, -dy)),
        )
    }
    return insertDrawBlock(
        out,
        afterLine,
        pieces.map(p => rebaseY(p, scale, origin)),
    )
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
    const byBand = new Map<number, Stroke[]>()
    for (const stroke of strokes) {
        if (stroke.pts.length < 6) continue
        // Round BEFORE splitting: inkCodec's zigzag varint is integer-only (`n << 1` truncates),
        // so a fractional coordinate would round-trip to something else entirely. Doing it here
        // rather than at the call site means no caller can forget.
        const [rounded] = roundStrokes([stroke])
        for (const p of splitStrokeAtSeams(rounded, seamYs)) {
            const list = byBand.get(p.band)
            if (list) list.push(p.stroke)
            else byBand.set(p.band, [p.stroke])
        }
    }

    let out = text
    // BOTTOM-UP over bands. Inserting a fence adds three lines, which invalidates the `afterLine`
    // of every seam BELOW it — so the lowest band is written first and no line number above it
    // ever moves. Within a band, draw order is preserved by construction.
    for (const band of [...byBand.keys()].sort((a, b) => b - a)) {
        out = writeBand(out, band, byBand.get(band)!, seams, pad)
    }
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
