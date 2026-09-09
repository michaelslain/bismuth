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
//   - ATTACHED (` ```draw `, decorating the block above it). Its ink is stored relative to the
//     TOP of that block, in UNSCALED PIXELS.
//       * TOP, not bottom, because markdown grows DOWNWARD. Typing into an annotated paragraph
//         moves its bottom by a full line pitch and leaves its top exactly where it was, so the
//         top is the zero-drift edge for the common direction. Bottom-anchoring maximises drift
//         (measured: an annotation slid 18px on one typed line).
//       * PIXELS, not the 680px logical column, because line heights do not rescale with pane
//         width but a logical offset does. Storing y scaled made ink walk away from its text
//         whenever the pane resized (measured: 37px at 55% width, with no text change at all).
//         x STAYS scaled, so the annotation keeps spanning the same words; a narrow pane
//         therefore squashes annotation ink horizontally, which is the accepted trade.
//   - STANDALONE (` ```draw block `): the widget reserves the ink's own height
//     (drawBlockGeometry.ts's `standaloneHeight`) and the ink paints inside it, in the uniform
//     logical space — a standalone drawing has no text to stay aligned with, so it should scale
//     as a whole. A fence created from scratch is normalized so the ink's top sits exactly `pad`
//     below the widget top, which is the space `standaloneHeight` reserves for it.
//
// `Seam.origin` and `Seam.scale` carry that per band: stored y = `y * scale - origin`. An
// attached band passes the live content scale and its block top in pixels; a standalone band
// passes scale 1 and its widget top in logical units.
//
// A band also says which KIND of fence it wants (`Seam.standalone`), and that is written into
// the fence's info string. Nothing here reads a blank line to decide a mode any more: that
// inference let an edit elsewhere in the note reinterpret already-stored geometry under the
// other rule, which is a whole class of defect rather than one bug.
import { splitStrokeAtSeams } from '../../../core/src/drawing/splitStroke'
import {
    insertDrawBlock,
    scanDrawBlocks,
    writeDrawBlock,
    type DrawBlock,
} from '../../../core/src/drawing/drawBlocks'
import { roundStrokes, type Stroke } from '../../../core/src/drawing/model'
import { frontmatterCloseLine } from './frontmatterUtils'

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
 *  `standalone` — the kind of fence this band wants when one has to be created: a drawing of
 *  its own (` ```draw block `) rather than an annotation on the block above (` ```draw `).
 *  Defaults to attached.
 *
 *  `scale` / `origin` — how this band's fence stores ink: `stored = y * scale - origin`. An
 *  attached band passes the live content scale and its block's TOP in unscaled pixels; a
 *  standalone band passes 1 and its widget top in logical units. Both default to the identity,
 *  which is only ever right for a test fixture that does not care where the ink lands. */
export interface Seam {
    y: number
    afterLine: number
    standalone?: boolean
    scale?: number
    origin?: number
}

/** Ink-logical padding reserved above and below a freshly-created standalone drawing. Must equal
 *  `drawBlock.ts`'s `STANDALONE_PAD`, which is what the widget actually reserves — a mismatch
 *  would park the ink outside its own box. Kept as a plain number rather than an import because
 *  this module must not pull in CodeMirror; `inkCommit.test.ts` pins the two together, and
 *  InkOverlay passes the real constant through explicitly. */
export const DEFAULT_STANDALONE_PAD = 24

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

/** Never hang a fence off a frontmatter close.
 *
 *  The ORIGINAL reason for this guard is gone: back when a fence's mode was inferred from a
 *  blank line above it, a fence inserted directly after the closing `---` scanned as ATTACHED
 *  until Editor.tsx's autosave ran `normalizeFrontmatterSpacing`, which inserts a blank line in
 *  exactly that spot — flipping the fence's mode with no user action at all. The mode now lives
 *  in the fence's own info string (core/src/drawing/drawBlocks.ts), so nothing outside a fence
 *  can reinterpret its contents and that flip cannot happen.
 *
 *  Two reasons to keep it survive that change:
 *
 *  - **The normalizer still rewrites that exact slot.** It inserts a blank line directly after
 *    the close on the next save, so a fence written there gets a line spliced in above it by an
 *    edit the user did not make. Adding the separator up front makes the result a FIXED POINT of
 *    the normalizer rather than something it rewrites a moment later.
 *  - **Nothing may be stored against the frontmatter.** A fence hung off the close is owned by
 *    the note's METADATA block: `scanDrawBlocks` reports `attachedToLine` = the closing `---`.
 *    But `buildSeams` deliberately gives the frontmatter no band at all (`fromLine <=
 *    frontmatterClose` flushes the run), so the paint would anchor to an edge the commit path
 *    can never produce again. Below the separator the ink belongs to the body, which is the only
 *    place this model has anchors for.
 *
 *  Frontmatter is standard in this vault, so this is a routine note, not an edge case. */
function separateFromFrontmatter(
    text: string,
    afterLine: number,
): { text: string; afterLine: number } {
    const lines = text.split('\n')
    // The SHARED boundary helper, not a private one. A private copy here also accepted YAML's
    // `...` terminator, which neither core/src/frontmatter.ts's parser nor the normalizer this
    // function exists to stay ahead of recognises — so on a `...`-closed note it inserted a
    // separator in a place the normalizer neither wanted nor would ever produce.
    const close = frontmatterCloseLine(text)
    if (!close || afterLine !== close) return { text, afterLine }
    if ((lines[close] ?? '').trim() === '') {
        return { text, afterLine: close + 1 }
    }
    // A bare-LF blank line spliced into a CRLF note is the exact defect insertDrawBlock was
    // fixed for; do not reintroduce it one function away.
    const eol = lines.some(l => l.endsWith('\r')) ? '\r' : ''
    lines.splice(close, 0, eol)
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
    // everything, which is a DRAWING. It is stored in the uniform logical space like every other
    // standalone fence, not against some neighbouring block's pixel anchor.
    const owner: Seam | undefined = seams[band]
    const standalone = owner ? owner.standalone === true : true
    const scale = owner?.scale ?? 1
    const origin = owner?.origin ?? 0

    const moved = separateFromFrontmatter(
        text,
        owner ? owner.afterLine : text.split('\n').length,
    )
    const out = moved.text
    const afterLine = moved.afterLine

    const existing = scanDrawBlocks(out).find(b => b.fromLine === afterLine + 1)
    if (existing) {
        return writeDrawBlock(out, existing, [
            ...existing.strokes,
            ...pieces.map(p => rebaseY(p, scale, origin)),
        ])
    }

    if (standalone) {
        // The widget does not exist yet, so there is no top to measure. Normalize instead, and
        // normalize the GROUP rather than each piece: a sketch has to keep its own internal
        // geometry, and the whole drawing's top is what sits `pad` below the widget top.
        const dy = pad - minYOf(pieces)
        return insertDrawBlock(
            out,
            afterLine,
            pieces.map(p => rebaseY(p, 1, -dy)),
            true,
        )
    }
    return insertDrawBlock(
        out,
        afterLine,
        pieces.map(p => rebaseY(p, scale, origin)),
        false,
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

/**
 * Rewrite SOME of one fence's strokes in place — the lasso's half of the same text-to-text
 * contract `planCommitStrokes` and `planErase` already hold. `edit` receives exactly the
 * selected strokes, in the order `indices` names them, and must return the same number back.
 *
 * Two things it does that a caller would otherwise have to remember, and one of which is
 * invisible when forgotten:
 *
 *  - **It ROUNDS.** `inkCodec`'s zigzag varint is integer-only (`n << 1` truncates through
 *    ToInt32), so a fractional coordinate does not round-trip — it comes back TRUNCATED, which
 *    for a drag of half a pixel per frame accumulates into visible drift and for a negative
 *    coordinate rounds the wrong way. Every drag and every resize produces fractions.
 *  - **It keeps a STANDALONE fence's ink inside its own box.** That box is sized from the ink
 *    (`standaloneHeight` = span + 2·pad), so the ink fits exactly when `0 ≤ minY ≤ 2·pad` — and
 *    an edit can leave it outside, most obviously a shrink about the ink's BOTTOM edge, which
 *    shortens the box while the lowest point stays put. So minY is CLAMPED into that range, not
 *    normalized back to `pad`: a normalize would undo every vertical drag the user just made and
 *    the ink would snap out from under the pointer on commit. Inside the range nothing moves at
 *    all. An ATTACHED fence is untouched either way — its y is an absolute pixel offset from the
 *    block it decorates, and re-seating it would be the drift the whole contract exists to
 *    prevent.
 *
 * Returns `text` unchanged when the fence is gone, the indices are empty or out of range, or
 * `edit` breaks its contract — never a partially applied document.
 */
export function planStrokeEdit(
    text: string,
    fromLine: number,
    indices: number[],
    edit: (strokes: Stroke[]) => Stroke[],
    pad: number = DEFAULT_STANDALONE_PAD,
): string {
    const block = scanDrawBlocks(text).find(b => b.fromLine === fromLine)
    if (!block) return text
    const picked = indices.filter(i => i >= 0 && i < block.strokes.length)
    if (!picked.length) return text

    const replaced = edit(picked.map(i => block.strokes[i]))
    if (replaced.length !== picked.length) return text

    const next = block.strokes.slice()
    picked.forEach((i, k) => {
        next[i] = replaced[k]
    })

    // Hoisted: minYOf walks every point, and reading it inside the map would walk them once per
    // point rather than once per edit.
    const minY = minYOf(next)
    const reseat = block.standalone
        ? Math.min(Math.max(minY, 0), pad * 2) - minY
        : 0
    const seated = reseat
        ? next.map(s => ({
              ...s,
              pts: s.pts.map((n, i) => (i % 3 === 1 ? n + reseat : n)),
          }))
        : next
    return writeDrawBlock(text, block, roundStrokes(seated))
}

const isBlank = (line: string) => line.trim() === ''

/**
 * Move a whole ```draw fence to a new place in the note — the block-drag half of "select it and
 * move it around". `afterLine` is the 1-based line the fence should follow in the document AS
 * IT IS NOW (0 = the very top); the shift caused by lifting the fence out is worked out here so
 * the caller can hand over a line number it read off the screen.
 *
 * Written for a STANDALONE fence, which is the only kind that gets a drag handle: an attached
 * fence is owned by the block above it and moving it alone would hand its ink to a different
 * paragraph, which is the one thing the whole ownership model forbids.
 *
 * Separator hygiene is the part worth stating, because a naive splice gets it wrong in both
 * directions at once: lifting the fence out leaves the blank line that used to separate it
 * stacked against the next one, and dropping it back in against a paragraph leaves no separator
 * at all. So the seam is collapsed to a single blank line on removal, and exactly one blank line
 * is added on each side of the landing spot when the neighbour there is not already blank.
 *
 * A drop inside the fence's own line range is a no-op and returns `text` by identity.
 */
export function planReorder(
    text: string,
    block: DrawBlock,
    afterLine: number,
): string {
    const lines = text.split('\n')
    const from = block.fromLine - 1
    const to = Math.min(block.toLine, lines.length)
    if (from < 0 || to <= from) return text
    // `afterLine` is 1-based and `from`/`to` are 0-based indices, so this range reads as
    // "the slot directly above the fence (block.fromLine - 1) through the slot directly below
    // it (block.toLine)" — every drop that would put the fence back exactly where it is.
    if (afterLine >= from && afterLine <= to) return text

    const fence = lines.slice(from, to)
    const rest = [...lines.slice(0, from), ...lines.slice(to)]
    // A landing spot BELOW the fence loses the fence's own lines from its line count.
    let target = afterLine <= from ? afterLine : afterLine - (to - from)

    // The gap the fence left behind: two blank lines where there was one block boundary.
    if (
        from > 0 &&
        from < rest.length &&
        isBlank(rest[from - 1]) &&
        isBlank(rest[from])
    ) {
        rest.splice(from, 1)
        if (target > from) target -= 1
    }

    target = Math.max(0, Math.min(target, rest.length))
    // Match the document's line endings rather than splicing a bare LF into a CRLF note — the
    // same trap insertDrawBlock was fixed for.
    const blank = lines.some(l => l.endsWith('\r')) ? '\r' : ''
    const landing: string[] = []
    if (target > 0 && !isBlank(rest[target - 1])) landing.push(blank)
    landing.push(...fence)
    if (target < rest.length && !isBlank(rest[target])) landing.push(blank)
    rest.splice(target, 0, ...landing)

    let out = rest.join('\n')
    // Same trailing-newline guard planCommitStrokes carries: a fence dropped at the very end
    // lands after the file's final newline and would otherwise leave the note unterminated,
    // which shows up as a whole-file diff in the vault's git snapshots.
    if (text.endsWith('\n') && !out.endsWith('\n')) out += '\n'
    return out
}
