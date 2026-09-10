// app/src/editor/inkRemap.ts
//
// Carrying a PENDING ink op across somebody else's edit.
//
// A drawing session's ops are recorded when the user's hand moves and spent up to COMMIT_DELAY
// (500ms) later, so between the two anything else may have written the note: the daemon, the
// `bismuth` CLI, a second window, an external editor arriving over SSE, or Editor.tsx's own
// autosave normalizer. Every op holds line numbers, and a foreign edit that SHIFTS LINES makes
// every one of them name the wrong place. The measured consequence was an erase that evaporated
// — planErase found no fence at the recorded line, returned the text untouched, and the stroke
// came back on the next repaint.
//
// The change set is the only thing that knows where a line went, and it exists only inside
// CodeMirror's update listener. So the mapping is done there — but the RULES live here, in a
// module that imports `@codemirror/state` and nothing else. No `@codemirror/view`, no DOM, no
// Solid: that is what lets `bun test` pin them (see blockRegions.ts's header for why that
// constraint is real in this codebase) instead of leaving them as an untestable closure inside a
// 1300-line component.
//
// ── The two policies, and why they differ ───────────────────────────────────────────────────
//
// An op that DESTROYS is dropped when its target cannot be resolved. An op that only ADDS is
// placed on the best surviving anchor.
//
// That asymmetry is the whole design. A wrong erase removes ink the user never pointed at, and
// nothing looks wrong afterwards, so there is no report and no way back. A stroke committed into
// a neighbouring block is visible the instant it lands and undoable. Dropping an add would throw
// away the user's stroke to avoid a cosmetic misplacement, which trades a small visible cost for
// a large invisible one.
//
// So: erase references map through {@link remapAnchorLine} and are dropped when it returns null
// (and again, at plan time, when the stroke itself is not in the fence they land on). Seam
// tables map through {@link remapSeams}, which always returns a table.
import { MapMode, type ChangeDesc, type Text } from '@codemirror/state'
import type { Seam } from './inkCommit'

/** Clamp a document position into `doc` before asking which line it is on. `mapPos` cannot
 *  return an out-of-range position for a well-formed change set, but a caller passing a stale
 *  `before` would, and `lineAt` throws rather than saturating. */
const lineAt = (doc: Text, pos: number): number =>
    doc.lineAt(Math.max(0, Math.min(pos, doc.length))).number

/**
 * Where the 1-based `line` went — the fence's own opening line, for an op that names a fence.
 * `null` when the change deleted across it, or when it was never a line of `before` at all.
 *
 * Associates FORWARD (`assoc: 1`), so text inserted exactly at the line's start pushes the
 * reference past it and it keeps pointing at the fence rather than at the newcomer.
 *
 * **This is a mapping, not a proof.** It can hand back a line that now opens a DIFFERENT fence —
 * the change set knows where characters went, not what they mean. What makes that safe is the
 * second half of the address: `planErase` resolves the stroke by its own content inside whatever
 * fence it finds there, so a mapping that lands on the wrong fence reports `stroke-gone` and the
 * op is dropped. Neither half is sufficient alone; the line survives the shift and the stroke
 * survives the rewrite.
 */
export function remapAnchorLine(
    changes: ChangeDesc,
    before: Text,
    after: Text,
    line: number,
): number | null {
    if (line < 1 || line > before.lines) return null
    const pos = changes.mapPos(before.line(line).from, 1, MapMode.TrackDel)
    if (pos === null) return null
    return lineAt(after, pos)
}

/**
 * The same table, with every `afterLine` moved to where that line is now.
 *
 * **Only `afterLine` is remapped, and that is not an omission.** A seam's `origin` is the block's
 * TOP and the pending stroke's y was captured in the SAME layout, so a pure line shift moves both
 * rigidly and the offset the fence stores — `y * scale - origin` — is unchanged. The address
 * moves; the geometry does not. Rewriting `origin` would introduce exactly the drift this
 * contract exists to prevent. `y` is likewise left alone: it is a band boundary in the layout the
 * strokes were captured in, and it is compared only against those strokes, so remapping one
 * without the other is what would break band assignment.
 *
 * (A REFLOW — a foreign edit that rewrites the block's own text rather than shifting it — does
 * move the ink relative to its words, and no line mapping can fix that. It is the same limit the
 * coordinate contract in inkCommit.ts already carries for a late web-font load.)
 *
 * Associates BACKWARD (`assoc: -1`) off the line's END, so text somebody else appended after the
 * block is not swallowed into it. The cost is that a fence can land inside a paragraph that grew
 * downward in the window, splitting it in two — accepted, because the ink's anchor is that
 * block's top either way (`blockFirstLine` walks up to the same line), so the drawing still
 * paints over the words it was drawn on. The alternative hands the user's ink to a paragraph
 * they never drew over, which is the milder cousin of erasing the wrong stroke.
 *
 * Never drops a seam: a table with a hole in it would silently re-band every stroke below it.
 * A line the change deleted collapses to wherever the deletion left it, which is the closest
 * surviving edge and is what `writeBand`'s own last-content guard then sanity-checks.
 */
export function remapSeams(
    changes: ChangeDesc,
    before: Text,
    after: Text,
    seams: Seam[],
): Seam[] {
    return seams.map(seam => {
        // 0 means "the very top of the note" rather than a line, and the top does not move.
        if (seam.afterLine <= 0) return seam
        if (seam.afterLine > before.lines) return seam
        const pos = changes.mapPos(before.line(seam.afterLine).to, -1)
        const afterLine = lineAt(after, pos)
        return afterLine === seam.afterLine ? seam : { ...seam, afterLine }
    })
}
