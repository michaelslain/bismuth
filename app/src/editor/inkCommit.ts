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
//   - STANDALONE (` ```draw block `): the widget runs from its own top down to one `pad` past
//     the ink (drawBlockGeometry.ts's `standaloneHeight`) and the ink paints inside it, in the
//     uniform logical space — a standalone drawing has no text to stay aligned with, so it
//     should scale as a whole. Its widget top is THE BLOCK BOUNDARY ABOVE IT, and the ink keeps
//     the real distance below that boundary it was drawn at. Only ink with no boundary above it
//     at all has nothing to measure against, and only that is normalized to `pad`.
//
// `Seam.origin` and `Seam.scale` carry that per band: stored y = `y * scale - origin`. An
// attached band passes the live content scale and its block top in pixels; a standalone band
// passes scale 1 and its widget top in logical units.
//
// ── NORMALIZATION IS THE LAST RESORT, NOT THE DEFAULT ───────────────────────────────────────
// Normalizing exists because a fence being created from nothing has no widget yet, so there is
// no top to measure an offset against. When there IS a real edge to measure against, using it
// beats inventing one, and every way of getting that wrong is something the user reported as
// "the block transition is not seamless, and blocks are visible":
//
//   - A CUT CONTINUATION keeps its offset from the seam it was cut at. One stroke from y=5 to
//     y=205 over a paragraph ending at y=60 used to commit as `5..60` attached and `24..169`
//     standalone: the halves met when they were drawn and no longer did afterwards, because the
//     lower half had been re-seated against a pad it never had. Now the group is rebased against
//     the seam (its topmost ink stores 0) and the fence goes DIRECTLY after the block that ends
//     at that seam, so the widget's top IS the seam and the halves are contiguous again. Both
//     halves are needed: rebasing without moving the fence leaves the trailing blank lines'
//     height between them.
//   - INK NEAR THE DRAWING ABOVE IT joins that drawing instead of stacking a second fence under
//     it. Three sessions of one sketch produced three consecutive ` ```draw block ` fences, each
//     independently normalized to `pad` and each reserving `pad` again below its ink — which is
//     exactly the "visible blocks" the user saw. The trailing band now extends the standalone
//     fence directly above it when its ink starts within `pad` of that fence's own box, storing
//     against the same widget top, so the new strokes land where they were drawn. Ink well clear
//     of it still starts a drawing of its own.
//   - INK DRAWN IN GENUINELY EMPTY SPACE keeps its distance from the boundary above it, exactly
//     the way a cut continuation keeps its distance from the seam. This REVERSES the design's
//     original "a fence created from scratch is normalized", because normalizing had nothing to
//     normalize AGAINST: the widget lands wherever the fence's three lines fall in the document,
//     which is not where the pen was. Measured in the running app, driving real pointer events:
//     ink drawn 90px below the prose reappeared 68px higher the moment the pen lifted, and ink
//     drawn 380px below it reappeared 358px higher — the further into blank space, the further
//     it jumped, because the fence's widget lands right under the prose either way. (An earlier
//     measurement on a longer note had it move the other way, 105 down to 146; the direction is
//     whichever side of the pen the fence's lines happen to fall on.) That jump is the rest of
//     the user's "not seamless", and it is NOT merely cosmetic — the ink moves and THE HAND DOES
//     NOT, so the next stroke
//     can start more than a `pad` below the box the first one was relocated into and open a
//     SECOND drawing. Anchoring deletes the relocation, so there is no drift left for a distance
//     gate to have to catch: the widget top IS the boundary above, the ink stores its true
//     offset below it, and the box grows down to hold it.
//
// ── A DRAWING NEVER DISPLACES TEXT ──────────────────────────────────────────────────────────
// The rule that outranks all of the above when they conflict, and the third and last cause of
// the user's "when i finish drawing, things jump around, spacing is made": a STANDALONE fence
// reserves real height, so writing one above prose — creating it, or growing one already there
// — moves every line below it, and unlike the two causes above the ink is exactly where it was
// drawn while the DOCUMENT slides out from under it. Measured in the running app, one stroke
// across an existing drawing's lower edge moved all three paragraphs below it down 41.9px, and
// did it again on every stroke. `undisplacingOwner` and `trailingAnchor`'s last-content guard
// hold the invariant; `lastContentLine` is what both ask.
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

/** The 1-based last line of `text` a READER sees: the last non-blank line that is not part of a
 *  ```draw fence. 0 for a note with nothing in it.
 *
 *  A fence's own three lines are INK, not content — they are exactly what this is used to keep
 *  off the top of a note, so counting them as content would make the rule vacuous. */
function lastContentLine(text: string): number {
    const lines = text.split('\n')
    const inFence = new Set<number>()
    for (const b of scanDrawBlocks(text)) {
        for (let n = b.fromLine; n <= b.toLine; n++) inFence.add(n)
    }
    for (let n = lines.length; n >= 1; n--) {
        if (!inFence.has(n) && (lines[n - 1] ?? '').trim() !== '') return n
    }
    return 0
}

/** Does the ```draw fence opening at `fromLine` have text UNDER it? */
function fenceHasTextAfter(text: string, fromLine: number): boolean {
    const fence = scanDrawBlocks(text).find(b => b.fromLine === fromLine)
    return !!fence && lastContentLine(text) > fence.toLine
}

/** A DRAWING NEVER DISPLACES TEXT.
 *
 *  A standalone fence is a block widget with real height (`standaloneHeight` = its lowest ink
 *  plus a pad); an attached one reserves nothing and paints over the block it decorates. So a
 *  standalone fence with prose under it turns every pixel it gains into a pixel the whole rest
 *  of the note moves down, the instant the pen lifts. That is the last of the three causes
 *  behind "when i finish drawing, things jump around, spacing is made", and unlike the other
 *  two it is not a coordinate bug at all — the ink lands exactly where it was drawn, and the
 *  DOCUMENT moves out from under it.
 *
 *  Measured in the running component on the user's own note shape (heading, a standalone
 *  drawing, then two paragraphs): one stroke drawn across the drawing's lower edge is cut at the
 *  box edge, the upper piece is stored at exactly the box bottom — one pad past the drawing's
 *  lowest ink — so the box grew by a pad and both paragraphs moved down 45.2 CSS px. Every
 *  further stroke across that edge does it again, cumulatively.
 *
 *  So ink that lands in a standalone band whose fence has text under it is written into the next
 *  ATTACHED band instead: zero height, and the attached frame paints it back at the same
 *  absolute y, so nothing moves and the ink does not budge. It stops being part of that drawing
 *  — a later lasso of the drawing will not pick it up — which is the price of the note not
 *  jumping, and the user has now reported the jumping three times.
 *
 *  Returns `undefined` when the table has no attached band below, which leaves the caller with
 *  what it had rather than inventing an anchor. */
function undisplacingOwner(seams: Seam[], band: number): Seam | undefined {
    for (let i = band + 1; i < seams.length; i++) {
        if (!seams[i].standalone) return seams[i]
    }
    return undefined
}

/** Where one band's ink is written, and in which frame.
 *
 *  `anchored` is the interesting field: it says the origin below was measured off an edge that
 *  really exists in the document — a block's own anchor, a live widget's top, or the seam a
 *  stroke was cut at — as opposed to a fence being conjured out of nothing, whose ink has no top
 *  to measure against and is normalized to `pad` instead. */
interface Anchor {
    afterLine: number
    scale: number
    origin: number
    standalone: boolean
    anchored: boolean
}

/** The line a new fence has to follow if its widget is to START at the bottom edge of the band
 *  `above` — the edge everything in the trailing band is measured against. `null` when no line
 *  in this document would put a widget top there, and the caller then falls back to a
 *  normalized drawing.
 *
 *  Two shapes, because "the bottom edge of the band above" is two different edges:
 *
 *  - A TEXT band ends at its own last line, so the fence follows that line — or the ATTACHED
 *    fence already decorating it, since an attached widget reserves zero height and the seam is
 *    therefore still the top of whatever comes next. A STANDALONE fence sitting in that slot
 *    DOES reserve height, so nothing placed after it begins at the seam: `null`.
 *  - A DRAWING band ends at the bottom of its own widget, so the fence follows that fence's last
 *    line with NO blank line between the two. A separator would put a whole line pitch between
 *    the two boxes and the second drawing would paint that far below where it was drawn — the
 *    same tear the cut-continuation case exists to prevent. */
function seamInsertPoint(text: string, above: Seam): number | null {
    const blocks = scanDrawBlocks(text)
    if (above.standalone) {
        const drawing = blocks.find(
            b => b.fromLine === above.afterLine + 1 && b.standalone,
        )
        return drawing ? drawing.toLine : null
    }
    const at = blocks.find(b => b.fromLine === above.afterLine + 1)
    if (!at) return above.afterLine
    return at.standalone ? null : at.toLine
}

/** Where the TRAILING band's ink goes — the one band with no owning block, because it landed in
 *  the blank space after everything. Three cases, in order:
 *
 *  1. It joins the standalone drawing directly above when it starts within `pad` of that
 *     drawing's own box, extending that drawing rather than spawning a sibling fence under it.
 *     The zero-distance case is a stroke drawn out of the BOTTOM of a drawing: it is cut exactly
 *     at the box edge, so its continuation belongs to the same drawing.
 *  2. Otherwise it starts a drawing of its own ANCHORED to the bottom edge of the band above —
 *     a paragraph's last line, or the bottom of the drawing it is well clear of — storing its
 *     true offset below that edge, so it paints exactly where the pen left it. This is one case
 *     covering both the continuation of a stroke cut at that edge (offset 0) and ink drawn in
 *     empty space below it (offset > 0); they were two cases only while the second normalized.
 *  3. There is no band above at all, or no line in this document that would put a widget top at
 *     its edge. Only then is there nothing to measure against, and only then is ink normalized.
 *
 *  `top` is the group's topmost ink in absolute ink-logical units. */
function trailingAnchor(
    text: string,
    above: Seam | undefined,
    top: number,
    pad: number,
): Anchor {
    const atEnd: Anchor = {
        afterLine: text.split('\n').length,
        scale: 1,
        origin: 0,
        standalone: true,
        anchored: false,
    }
    if (!above) return atEnd

    if (above.standalone) {
        const drawing = scanDrawBlocks(text).find(
            b => b.fromLine === above.afterLine + 1 && b.standalone,
        )
        // `above.y` IS that widget's bottom edge (buildSeams reads it off the height map), so
        // this reads as "on it, or within one pad below it". Anything further down is a second
        // drawing, which is what "drawing well clear of it starts another" means — and that
        // second drawing is anchored to this one's bottom by the fall-through below, so "well
        // clear" decides HOW MANY fences there are and never where the ink lands.
        //
        // …unless that drawing has TEXT under it, in which case extending it grows its reserved
        // height and shoves that text down — see `undisplacingOwner`. Then it is not a drawing
        // to join; the fall-through and the last-content guard below take it from here.
        if (
            drawing &&
            top <= above.y + pad &&
            !fenceHasTextAfter(text, drawing.fromLine)
        ) {
            return {
                afterLine: above.afterLine,
                scale: above.scale ?? 1,
                origin: above.origin ?? 0,
                standalone: true,
                anchored: true,
            }
        }
    }

    // Every point in this band is at or below `above.y` — splitStrokeAtSeams puts a point exactly
    // ON a seam when it cuts there — so the offset stored here is never negative: 0 for a cut
    // continuation, and the gap the user deliberately left for ink drawn in empty space.
    const at = seamInsertPoint(text, above)
    // A DRAWING NEVER DISPLACES TEXT, and this is the half of that rule the trailing band owns:
    // whatever the table says, a fence that reserves height may not be written above the note's
    // last line of content.
    //
    // The table can say otherwise because it GOES STALE. It is captured at pointerdown and spent
    // up to COMMIT_DELAY later, so anything appended in between — an external edit arriving over
    // SSE, the autosave's frontmatter normalizer, the user typing at the end — leaves `above` no
    // longer the last block, and `seamInsertPoint` then names a line with prose under it. A
    // 314px drawing landing there moves every paragraph below it by 314px, which is the
    // displacement measured in the user's own note.
    //
    // There is nothing in a stale table to anchor against, so this falls back to the same
    // last-resort the no-band-above case uses: normalized, at the end of the note. Normalizing
    // moves the ink, which is a real cost — but it is the ink moving instead of the whole note,
    // and only in the window where the document changed under the pen.
    if (at === null || at < lastContentLine(text)) return atEnd
    return {
        afterLine: at,
        scale: 1,
        origin: above.y,
        standalone: true,
        anchored: true,
    }
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
    let owner: Seam | undefined = seams[band]
    // A drawing with text under it may not grow — see `undisplacingOwner` for the measurement.
    // Unconditional, not "only when the box would actually grow": a stroke that straddles the
    // drawing's lowest ink would otherwise land in one fence or the other depending on where it
    // happened to end, and the invariant would hold only sometimes. Bands are written bottom-up,
    // so the band redirected to has already written its own fence and this ink appends to it —
    // one attached fence, one frame, pieces still contiguous.
    if (
        owner?.standalone === true &&
        fenceHasTextAfter(text, owner.afterLine + 1)
    ) {
        owner = undisplacingOwner(seams, band) ?? owner
    }
    const anchor: Anchor = owner
        ? {
              afterLine: owner.afterLine,
              scale: owner.scale ?? 1,
              origin: owner.origin ?? 0,
              standalone: owner.standalone === true,
              anchored: false,
          }
        : trailingAnchor(
              text,
              // The band's TOP edge — the seam a piece would have been cut at on its way in.
              // Band 0 has none; the trailing band's is the last entry in the table.
              band > 0 ? seams[band - 1] : undefined,
              minYOf(pieces),
              pad,
          )

    const moved = separateFromFrontmatter(text, anchor.afterLine)
    const out = moved.text
    const afterLine = moved.afterLine

    // The fence below the anchor line, and of the SAME KIND. Kind matters because a seam-anchored
    // continuation now writes its standalone fence directly after the block it was cut from, so
    // the attached band's own `afterLine + 1` can hold a ` ```draw block ` — and appending pixel-
    // anchored ink into a logical-space payload would put two coordinate frames in one fence.
    const existing = scanDrawBlocks(out).find(
        b => b.fromLine === afterLine + 1 && b.standalone === anchor.standalone,
    )
    if (existing) {
        return writeDrawBlock(out, existing, [
            ...existing.strokes,
            ...pieces.map(p => rebaseY(p, anchor.scale, anchor.origin)),
        ])
    }

    if (anchor.standalone && !anchor.anchored) {
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
        pieces.map(p => rebaseY(p, anchor.scale, anchor.origin)),
        anchor.standalone,
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
 *  - **It keeps a STANDALONE fence's ink inside its own box.** That box runs from the widget top
 *    down to a pad past the ink (`standaloneHeight` = maxY + pad), so the only way out of it is
 *    UPWARD, past the widget's own top — a move or a resize that carries ink above y=0 paints it
 *    over the block above. minY is therefore FLOORED at 0, not normalized back to `pad`: a
 *    normalize would undo every vertical drag the user just made and the ink would snap out from
 *    under the pointer on commit. Below the floor nothing moves at all.
 *
 *    **There is deliberately no ceiling.** One used to sit at `2*pad`, which was the box's bottom
 *    edge back when the height was `span + 2*pad` and the whole drawing was selected. It is wrong
 *    twice over now: the box grows down with its ink (InkOverlay's `growsDown` already lets a
 *    resize run past it), and ink anchored to the block boundary above legitimately stores a minY
 *    of hundreds — the distance the user left between that boundary and their pen. A `2*pad`
 *    ceiling would have teleported such a drawing to the top of its own box on the first lasso
 *    edit, which is the same jump this whole contract exists to stop.
 *
 *    An ATTACHED fence is untouched either way — its y is an absolute pixel offset from the block
 *    it decorates, and re-seating it would be the drift the whole contract exists to prevent.
 *
 * Returns `text` unchanged when the fence is gone, the indices are empty or out of range, or
 * `edit` breaks its contract — never a partially applied document.
 */
export function planStrokeEdit(
    text: string,
    fromLine: number,
    indices: number[],
    edit: (strokes: Stroke[]) => Stroke[],
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
    const reseat = block.standalone ? Math.max(minY, 0) - minY : 0
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
