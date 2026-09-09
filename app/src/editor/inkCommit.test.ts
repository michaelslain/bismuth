// app/src/editor/inkCommit.test.ts
//
// planCommit is the whole "a stroke becomes markdown" step, and it is pure text-to-text, so
// everything that matters about it can be pinned headlessly: which fence a piece lands in,
// WHERE inside that fence it lands (the coordinate rebasing that makes ink follow its text),
// and that the prose comes back byte-identical when the fences are stripped again.
//
// The geometry assertions are the point. Fence COUNTS pass for a commit that stores every
// stroke at the wrong offset, which is exactly the failure a user would see as "my drawing is
// nowhere near the words" — so most tests below read the decoded stroke back and check numbers.
import { describe, expect, test } from 'bun:test'
import {
    DEFAULT_STANDALONE_PAD,
    planCommit,
    planCommitStrokes,
    planErase,
    planReorder,
    planStrokeEdit,
    type Seam,
} from './inkCommit'
import { scaleStrokes, translateStrokes } from '../drawing/lasso'
import { STANDALONE_PAD } from './drawBlock'
import { standaloneHeight } from './drawBlockGeometry'
import {
    insertDrawBlock,
    removeDrawBlock,
    scanDrawBlocks,
} from '../../../core/src/drawing/drawBlocks'
import type { Stroke } from '../../../core/src/drawing/model'

const doc = 'First paragraph.\n\nSecond paragraph.\n'

// The two paragraphs, described the way InkOverlay's seam table describes them: each block ends
// at `y` (ink-logical, the cut line) and stores its attached ink against its own TOP in unscaled
// pixels (`origin`), reached by multiplying a logical y by the live content `scale`. SCALE 2 is
// chosen so every expected number below can be read off by hand.
const SCALE = 2
const seams: Seam[] = [
    { y: 100, afterLine: 1, origin: 10, scale: SCALE, standalone: false },
    { y: 200, afterLine: 3, origin: 150, scale: SCALE, standalone: false },
]
/** What an attached band stores for a logical y, per the contract. */
const stored = (yLogical: number, seam: Seam) =>
    Math.round(yLogical * seam.scale! - seam.origin!)

const pen = (pts: number[]): Stroke => ({ t: 'pen', c: 'fg', w: 5, pts })

/** Every y in a decoded stroke, in the order they were drawn. */
const ys = (s: Stroke): number[] => s.pts.filter((_, i) => i % 3 === 1)
const xs = (s: Stroke): number[] => s.pts.filter((_, i) => i % 3 === 0)

/** Strip every ```draw fence back out, bottom-up so earlier line numbers stay valid. What
 *  survives is what planCommit promised not to touch. */
function stripFences(text: string): string {
    let out = text
    for (;;) {
        const blocks = scanDrawBlocks(out)
        if (!blocks.length) return out
        out = removeDrawBlock(out, blocks[blocks.length - 1])
    }
}

describe('planCommit — which fence a piece lands in', () => {
    test('a stroke inside one block creates one fence attached to it', () => {
        const out = planCommit(doc, pen([10, 20, 180, 20, 40, 180]), seams)
        const blocks = scanDrawBlocks(out)
        expect(blocks).toHaveLength(1)
        expect(blocks[0].attachedToLine).toBe(1)
    })

    test('a stroke crossing a seam writes two fences', () => {
        const out = planCommit(doc, pen([10, 50, 180, 10, 150, 180]), seams)
        expect(scanDrawBlocks(out)).toHaveLength(2)
    })

    // The line-shift trap: inserting a fence for the FIRST block adds three lines, so the second
    // block's `afterLine` of 3 no longer points at "Second paragraph." planCommit writes
    // bottom-up for exactly this reason. Checking only the fence COUNT is not enough here — this
    // pins that each fence hangs off the right prose line.
    test('both fences attach to the prose line they belong to, not a shifted one', () => {
        const out = planCommit(doc, pen([10, 50, 180, 10, 150, 180]), seams)
        const lines = out.split('\n')
        const blocks = scanDrawBlocks(out)
        expect(blocks.map(b => b.attachedToLine)).toEqual([1, 6])
        expect(lines[blocks[0].attachedToLine! - 1]).toBe('First paragraph.')
        expect(lines[blocks[1].attachedToLine! - 1]).toBe('Second paragraph.')
    })

    test('committing twice into the same block appends rather than replaces', () => {
        const a = pen([10, 20, 180, 20, 40, 180])
        const b = pen([30, 20, 180, 40, 40, 180])
        const out = planCommit(planCommit(doc, a, seams), b, seams)
        const blocks = scanDrawBlocks(out)
        expect(blocks).toHaveLength(1)
        expect(blocks[0].strokes).toHaveLength(2)
        // …and the FIRST stroke survives the append intact, which "length 2" alone would not say.
        expect(xs(blocks[0].strokes[0])).toEqual([10, 20])
        expect(xs(blocks[0].strokes[1])).toEqual([30, 40])
    })

    test('a stroke below every seam lands in a standalone fence at the end', () => {
        const out = planCommit(doc, pen([10, 400, 180, 20, 430, 180]), seams)
        const blocks = scanDrawBlocks(out)
        expect(blocks).toHaveLength(1)
        expect(blocks[0].attachedToLine).toBeNull()
        expect(blocks[0].fromLine).toBeGreaterThan(3)
    })

    test('with no seams at all everything is the trailing band', () => {
        const out = planCommit(doc, pen([10, 20, 180, 20, 40, 180]), [])
        expect(scanDrawBlocks(out)).toHaveLength(1)
    })

    // A composed contract rather than a single branch: planCommit's own length guard is an early
    // out, and splitStrokeAtSeams independently drops any piece left with fewer than two points.
    // Removing EITHER leaves this passing; removing both does not. Pinned anyway, because "a
    // stray tap must not edit the note" is the behaviour, not the branch.
    test('a stroke with fewer than two points writes nothing', () => {
        expect(planCommit(doc, pen([10, 20, 180]), seams)).toBe(doc)
        expect(planCommit(doc, pen([]), seams)).toBe(doc)
    })

    // A whole debounced drawing session goes in as ONE call, and every stroke in it was measured
    // against the SAME seam table (nothing was dispatched between them). Writing them one at a
    // time top-down is a shipped bug this exists to prevent: the first fence adds three lines,
    // and the second stroke's `afterLine: 3` then points at the payload of the first fence
    // instead of at "Second paragraph."
    test('several strokes in one flush each land in their own block', () => {
        const out = planCommitStrokes(
            doc,
            [
                pen([10, 20, 180, 20, 40, 180]),
                pen([10, 150, 180, 20, 170, 180]),
            ],
            seams,
        )
        const lines = out.split('\n')
        const blocks = scanDrawBlocks(out)
        expect(blocks).toHaveLength(2)
        expect(lines[blocks[0].attachedToLine! - 1]).toBe('First paragraph.')
        expect(lines[blocks[1].attachedToLine! - 1]).toBe('Second paragraph.')
        expect(ys(blocks[0].strokes[0])).toEqual([
            stored(20, seams[0]),
            stored(40, seams[0]),
        ])
        expect(ys(blocks[1].strokes[0])).toEqual([
            stored(150, seams[1]),
            stored(170, seams[1]),
        ])
    })

    test('several strokes into one block keep the order they were drawn', () => {
        const out = planCommitStrokes(
            doc,
            [
                pen([10, 20, 180, 20, 40, 180]),
                pen([30, 20, 180, 40, 40, 180]),
            ],
            seams,
        )
        const [b] = scanDrawBlocks(out)
        expect(b.strokes.map(xs)).toEqual([
            [10, 20],
            [30, 40],
        ])
    })
})

// ── The trailing band, which is where a whole SKETCH goes ────────────────────────────────────
// Drawing several strokes in blank space is the feature's headline case: "a block with ink and
// no text is a drawing." It is also the one place where writing piece-by-piece re-derived the
// insertion point from an already-mutated document, so each stroke created a fence of its own
// and was independently re-normalized. Five strokes forming a house came out as five drawings
// reserving 500px for 160px of ink. Everything below is that case.
describe('planCommit — a multi-stroke drawing in blank space', () => {
    const sketch = [
        pen([100, 400, 180, 200, 400, 180]),
        pen([100, 480, 180, 200, 480, 180]),
        pen([150, 560, 180, 250, 560, 180]),
    ]

    test('becomes ONE standalone fence, not one per stroke', () => {
        const out = planCommitStrokes(doc, sketch, seams)
        const blocks = scanDrawBlocks(out)
        expect(blocks).toHaveLength(1)
        expect(blocks[0].attachedToLine).toBeNull()
        expect(blocks[0].strokes).toHaveLength(3)
    })

    // The GROUP is anchored, not each stroke: the sketch keeps its internal geometry, and the
    // whole of it keeps its real distance below the block boundary above (seams[1], at y=200).
    // Anchoring per stroke would flatten every stroke onto that boundary and destroy the drawing.
    test('keeps its internal geometry and anchors the group once', () => {
        const [b] = scanDrawBlocks(planCommitStrokes(doc, sketch, seams))
        expect(b.strokes.map(ys)).toEqual([
            [400 - seams[1].y, 400 - seams[1].y],
            [480 - seams[1].y, 480 - seams[1].y],
            [560 - seams[1].y, 560 - seams[1].y],
        ])
        expect(b.strokes.map(xs)).toEqual([
            [100, 200],
            [100, 200],
            [150, 250],
        ])
    })

    // The widget top is the boundary, so the box has to reach from there all the way past the
    // ink — not just around it. Reserving only the sketch's own span would leave the drawing
    // hanging 200px below its own box, and the text after it would ride up over the ink.
    test('reserves from the boundary above down to a pad past the ink', () => {
        const [b] = scanDrawBlocks(planCommitStrokes(doc, sketch, seams))
        expect(standaloneHeight(b.strokes, DEFAULT_STANDALONE_PAD)).toBe(
            560 - seams[1].y + DEFAULT_STANDALONE_PAD,
        )
    })

    // Whether the note ends with a newline no longer changes anything: the trailing band is a
    // DRAWING because that is what the band says, not because of what whitespace happens to
    // precede the insertion point. The bug shape here was the first piece inserting one way and
    // every later one then re-deriving the insertion point from the grown text and going the
    // other, so a sketch came apart into differently-moded fences.
    test('is one standalone drawing whether or not the note ends with a newline', () => {
        const tight = 'First paragraph.\n\nSecond paragraph.'
        for (const text of [doc, tight]) {
            const blocks = scanDrawBlocks(planCommitStrokes(text, sketch, seams))
            expect(blocks).toHaveLength(1)
            expect(blocks[0].standalone).toBe(true)
            expect(blocks[0].strokes).toHaveLength(3)
            expect(ys(blocks[0].strokes[0])).toEqual([
                400 - seams[1].y,
                400 - seams[1].y,
            ])
        }
    })

    test('leaves the prose alone in both shapes', () => {
        expect(stripFences(planCommitStrokes(doc, sketch, seams))).toBe(doc)
        const tight = 'First paragraph.\n\nSecond paragraph.'
        expect(stripFences(planCommitStrokes(tight, sketch, seams))).toBe(tight)
    })
})

// ── "the block transition is not seamless, and blocks are visible" ───────────────────────────
// The user's own words, drawing freely across a real note. Two separate arithmetic faults, both
// of them normalization applied to ink that had a real edge to measure against:
//
//   - a stroke crossing out of a paragraph came apart at the seam, because the lower half was
//     re-seated `pad` below a widget top instead of continuing from the seam it was cut at;
//   - a sketch made of several sessions stacked into consecutive drawings, each normalized to
//     its own pad and each reserving another pad below its ink.
//
// One paragraph, ending at CUT_Y. `origin`/`scale` are non-trivial on purpose: an assertion that
// only holds when both halves of the attached transform are applied is the assertion that
// catches a half-done fix.
const CUT_Y = 60
const cutDoc = 'A paragraph.\n'
const cutSeams: Seam[] = [
    { y: CUT_Y, afterLine: 1, origin: 10, scale: SCALE, standalone: false },
]

/** A vertical stroke from `from` to `to` in absolute capture coordinates, a point every 10. */
const vert = (from: number, to: number, x = 100): Stroke => {
    const pts: number[] = []
    for (let y = from; y <= to; y += 10) pts.push(x, y, 180)
    return pen(pts)
}

const top = (s: Stroke) => Math.min(...ys(s))
const bottom = (s: Stroke) => Math.max(...ys(s))

/** Undo an attached band's transform: `stored = y * scale - origin`, so this reads a stored y
 *  back as the absolute ink-logical coordinate it was captured at. */
const absolute = (stored: number, seam: Seam) =>
    (stored + seam.origin!) / seam.scale!

describe('planCommit — a stroke cut at a seam stays contiguous', () => {
    const cut = () => planCommitStrokes(cutDoc, [vert(5, 205)], cutSeams)

    test('the continuation stores its offset from the SEAM, not from a pad', () => {
        const drawing = scanDrawBlocks(cut()).find(b => b.standalone)!
        // The cut point is at CUT_Y and the widget's top IS the seam, so the piece starts at 0
        // and every later point keeps its own distance below it.
        expect(ys(drawing.strokes[0])).toEqual([
            0, 5, 15, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115, 125, 135, 145,
        ])
    })

    test('the two halves meet: the same absolute y, read out of both frames', () => {
        const blocks = scanDrawBlocks(cut())
        const attached = blocks.find(b => !b.standalone)!
        const drawing = blocks.find(b => b.standalone)!
        // Each half is stored against its own band's anchor, so the seam point reads as a
        // different NUMBER in each fence. Undoing each transform has to land on the same y:
        // the attached half in pixels below its block top, the drawing in logical units below
        // its widget top — which is the seam itself.
        expect(absolute(bottom(attached.strokes[0]), cutSeams[0])).toBe(CUT_Y)
        expect(top(drawing.strokes[0]) + CUT_Y).toBe(CUT_Y)
    })

    // The arithmetic above only holds if the widget really does begin at the seam, and that is a
    // question about WHERE THE FENCE WAS WRITTEN. Appended at the end of the note instead, the
    // drawing starts a blank line's height lower and the halves are torn by exactly that much.
    test('the drawing fence follows its block directly, with no blank line between', () => {
        const out = cut()
        const lines = out.split('\n')
        const drawing = scanDrawBlocks(out).find(b => b.standalone)!
        const between = lines.slice(1, drawing.fromLine - 1)
        expect(between.some(l => l.trim() === '')).toBe(false)
        expect(lines[0]).toBe('A paragraph.')
    })

    // WAS: "ink drawn wholly in blank space IS still normalized to the pad". That was the
    // design's original rule and it is the defect this test now pins the fix for — normalizing
    // re-seated the drawing under a widget that lands wherever the fence's lines fall, which is
    // not where the pen was (measured in the running app: drawn at 105, reappeared at 146).
    // Ink that originates in empty space is anchored to the boundary above it, exactly the way
    // a cut continuation is, and the two cases now differ only in the offset they store.
    test('ink drawn wholly in blank space keeps its distance from the boundary above', () => {
        const out = planCommitStrokes(cutDoc, [vert(300, 400)], cutSeams)
        const drawing = scanDrawBlocks(out).find(b => b.standalone)!
        expect(top(drawing.strokes[0])).toBe(300 - CUT_Y)
        expect(bottom(drawing.strokes[0])).toBe(400 - CUT_Y)
    })

    // The offset above is only worth anything if the widget really starts at the boundary, which
    // is a question about WHERE THE FENCE WAS WRITTEN — the same pairing the cut case needs. The
    // widget top IS the seam, so this reads as "the ink paints back at the absolute y it was
    // drawn at", which is the whole of "seamless" for a drawing made in empty space.
    test('the drawing paints back at the absolute y the pen drew it at', () => {
        const out = planCommitStrokes(cutDoc, [vert(300, 400)], cutSeams)
        const lines = out.split('\n')
        const drawing = scanDrawBlocks(out).find(b => b.standalone)!
        const between = lines.slice(1, drawing.fromLine - 1)
        expect(between.some(l => l.trim() === '')).toBe(false)
        // widget top (= the seam) + stored y === the y the pen was at.
        expect(CUT_Y + top(drawing.strokes[0])).toBe(300)
    })

    // The last resort, and the only place a pad is still invented: with no band above at all
    // there is no edge in the document to measure against.
    test('ink in a note with no blocks above it is still normalized', () => {
        const out = planCommitStrokes(cutDoc, [vert(300, 400)], [])
        const drawing = scanDrawBlocks(out).find(b => b.standalone)!
        expect(top(drawing.strokes[0])).toBe(DEFAULT_STANDALONE_PAD)
    })

    // The block is usually already annotated by the time a stroke runs out of it — the same
    // gesture writes both fences, and a later session writes a second continuation past the
    // first fence. The drawing has to clear that fence and still start at the seam, which it
    // does because an ATTACHED widget reserves zero height.
    test('a continuation is written after the fence the block already carries', () => {
        const first = planCommitStrokes(
            cutDoc,
            [pen([10, 20, 180, 20, 40, 180])],
            cutSeams,
        )
        const out = planCommitStrokes(first, [vert(5, 205)], cutSeams)
        const blocks = scanDrawBlocks(out)
        const attached = blocks.filter(b => !b.standalone)
        const drawing = blocks.find(b => b.standalone)!
        // ONE annotation fence, carrying both sessions' ink — not a second one, and not the
        // paragraph's pixel-anchored ink appended into the drawing's logical-space payload.
        expect(attached).toHaveLength(1)
        expect(attached[0].strokes).toHaveLength(2)
        expect(drawing.fromLine).toBe(attached[0].toLine + 1)
        expect(top(drawing.strokes[0])).toBe(0)
        expect(stripFences(out)).toBe(cutDoc)
    })

    // A flush can carry both kinds at once. The GROUP is anchored, not each piece: the sketch
    // keeps its internal geometry and the continuation is what fixes the group to the seam.
    test('a group holding one continuation anchors the whole group to the seam', () => {
        const out = planCommitStrokes(
            cutDoc,
            [vert(5, 205), vert(300, 320, 200)],
            cutSeams,
        )
        const drawing = scanDrawBlocks(out).find(b => b.standalone)!
        expect(top(drawing.strokes[0])).toBe(0)
        expect(ys(drawing.strokes[1])).toEqual([240, 250, 260])
    })

    // planStrokeEdit clamps a standalone fence's topmost ink into [0, 2*pad] so a lasso edit
    // cannot leave ink outside its own box. Ink seated at 0 is already inside that range, so a
    // continuation is not yanked off its seam the first time the user drags something.
    test('a seam-anchored drawing survives a lasso edit unmoved', () => {
        const out = cut()
        const drawing = scanDrawBlocks(out).find(b => b.standalone)!
        const same = planStrokeEdit(out, drawing.fromLine, [0], s => s)
        expect(scanDrawBlocks(same).find(b => b.standalone)!.strokes).toEqual(
            drawing.strokes,
        )
    })
})

// ── A second session extends the drawing already there ───────────────────────────────────────
// The user's real note carried three consecutive ```draw block fences from one sketch. Each new
// session's ink fell below the previous drawing's box, and `writeBand` only ever looked for a
// fence at `afterLine + 1` — which for the trailing band is the end of the note, never the fence
// the last session wrote.

/** The seam table InkOverlay builds once a note's last block is a standalone drawing: the
 *  drawing is a band of its own, running from its widget top down to `standaloneHeight` below
 *  it, and everything past that is the trailing band. Mirrors buildSeams (InkOverlay.tsx):
 *  `{ y: yOf(blk.bottom), afterLine: draw.fromLine - 1, origin: yOf(blk.top), scale: 1 }`.
 *
 *  THIS TABLE IS REBUILT PER SESSION, which is the thing a hand-written fixture gets wrong:
 *  the real app calls buildSeams on every pointerdown, so an existing standalone fence has a
 *  band of its own from the second session onward. Reusing one stale table across three
 *  sessions reports three fences where the code produces one.
 *
 *  Only the live height map knows where the widget landed, so `widgetTop` is given here. */
function withDrawingBand(
    text: string,
    base: Seam[],
    widgetTop: number,
): Seam[] {
    const drawing = scanDrawBlocks(text)
        .filter(b => b.standalone)
        .pop()
    if (!drawing) return base
    return [
        ...base,
        {
            y:
                widgetTop +
                standaloneHeight(drawing.strokes, DEFAULT_STANDALONE_PAD),
            afterLine: drawing.fromLine - 1,
            origin: widgetTop,
            scale: 1,
            standalone: true,
        },
    ]
}

describe('planCommit — a second session extends the drawing already there', () => {
    // Where the widget lands: the first session is ANCHORED to the paragraph's own bottom edge
    // and its fence is written directly after that paragraph with no blank line between, so the
    // widget top IS the seam. `the first fence really does start at the seam` below pins that,
    // so this constant cannot quietly drift away from what the code produces.
    const WIDGET_TOP = CUT_Y
    const boxBottom = (table: Seam[]) => table[table.length - 1].y

    /** One session of one stroke, then the seam table the NEXT session would be built against. */
    const session = (text: string, stroke: Stroke, table: Seam[]) => {
        const out = planCommitStrokes(text, [stroke], table)
        return { out, next: withDrawingBand(out, cutSeams, WIDGET_TOP) }
    }

    // The fixture's own premise, asserted rather than assumed.
    test('the first fence really does start at the seam', () => {
        const a = session(cutDoc, vert(300, 320), cutSeams)
        const drawing = scanDrawBlocks(a.out).find(d => d.standalone)!
        expect(drawing.fromLine).toBe(2)
        expect(a.out.split('\n')[0]).toBe('A paragraph.')
        expect(WIDGET_TOP + top(drawing.strokes[0])).toBe(300)
    })

    // The property that makes stacking IMPOSSIBLE rather than merely unlikely: the ink never
    // moves, so the pen is still over the drawing on the next stroke however many sessions go
    // by. Three sessions at the IDENTICAL pen position used to produce three fences, because
    // each one was relocated further from the hand than the last.
    test('three sessions at the SAME pen position stay one fence, unmoved', () => {
        let cur = session(cutDoc, vert(300, 340), cutSeams)
        for (const x of [140, 180]) {
            cur = session(cur.out, vert(300, 340, x), cur.next)
        }
        const drawings = scanDrawBlocks(cur.out).filter(d => d.standalone)
        expect(drawings).toHaveLength(1)
        expect(drawings[0].strokes).toHaveLength(3)
        // Every stroke came back to the same absolute y, which is the y all three were drawn at.
        for (const st of drawings[0].strokes) {
            expect(WIDGET_TOP + top(st)).toBe(300)
        }
    })

    test('three sessions of one sketch make ONE fence holding three strokes', () => {
        const a = session(cutDoc, vert(300, 320), cutSeams)
        const b = session(a.out, vert(boxBottom(a.next) + 4, boxBottom(a.next) + 40), a.next)
        const c = session(b.out, vert(boxBottom(b.next) + 10, boxBottom(b.next) + 50), b.next)
        const drawings = scanDrawBlocks(c.out).filter(d => d.standalone)
        expect(drawings).toHaveLength(1)
        expect(drawings[0].strokes).toHaveLength(3)
        // One fence, so exactly one pair of markers — and the prose it grew around is untouched.
        expect(c.out.split('\n').filter(l => l.startsWith('```'))).toHaveLength(2)
        expect(stripFences(c.out)).toBe(cutDoc)
    })

    test('extending stores the new ink where it was drawn, and moves none of the old', () => {
        const a = session(cutDoc, vert(300, 320), cutSeams)
        const before = ys(scanDrawBlocks(a.out).find(d => d.standalone)!.strokes[0])
        const start = boxBottom(a.next) + 4
        const b = session(a.out, vert(start, start + 40), a.next)
        const strokes = scanDrawBlocks(b.out).find(d => d.standalone)!.strokes
        // The first stroke is untouched…
        expect(ys(strokes[0])).toEqual(before)
        // …and the second is stored against the SAME widget top, so it lands where the pen was
        // rather than being re-normalized to the pad on top of the ink already there.
        expect(top(strokes[1])).toBe(start - WIDGET_TOP)
    })

    // The zero-distance case, and the one that ties both defects together: a stroke drawn out of
    // the BOTTOM of a drawing is cut at the box edge, so its lower half is a continuation. It
    // must extend the same drawing rather than open a sibling fence underneath it.
    test('a stroke drawn out of the bottom of a drawing extends it, contiguously', () => {
        const a = session(cutDoc, vert(300, 320), cutSeams)
        const edge = boxBottom(a.next)
        const out = planCommitStrokes(a.out, [vert(edge - 30, edge + 30)], a.next)
        const drawings = scanDrawBlocks(out).filter(d => d.standalone)
        expect(drawings).toHaveLength(1)
        expect(drawings[0].strokes).toHaveLength(3)
        const [upper, lower] = drawings[0].strokes
            .slice(1)
            .sort((x, y) => top(x) - top(y))
        expect(bottom(upper)).toBe(top(lower))
        expect(bottom(upper)).toBe(edge - WIDGET_TOP)
    })

    test('ink well clear of an existing drawing starts a new one', () => {
        const a = session(cutDoc, vert(300, 320), cutSeams)
        const edge = boxBottom(a.next)
        const far = edge + 200
        const out = planCommitStrokes(a.out, [vert(far, far + 40)], a.next)
        const drawings = scanDrawBlocks(out).filter(d => d.standalone)
        expect(drawings).toHaveLength(2)
        // …and it is a drawing of its OWN — a second fence, with its own box and its own drag
        // handle — but it is still ANCHORED, to the bottom edge of the drawing above it, so the
        // 200px of blank space the user deliberately left between the two sketches survives.
        // Normalizing here would have slid it up to `pad` below that edge and closed the gap.
        expect(top(drawings[1].strokes[0])).toBe(far - edge)
        expect(edge + top(drawings[1].strokes[0])).toBe(far)
        // Directly after the first fence, with no separator: a blank line between them would put
        // a whole line pitch between the two boxes and tear the second one off its anchor.
        expect(drawings[1].fromLine).toBe(drawings[0].toLine + 1)
        expect(stripFences(out)).toBe(cutDoc)
    })
})

describe('planCommit — where inside the fence the ink lands', () => {
    // An attached fence stores its ink against the TOP of the block it decorates, in unscaled
    // pixels: `y * scale - origin`. Get either half wrong and the annotation walks away from its
    // words — down a line pitch every time the paragraph is typed into, or 37px every time the
    // pane is resized.
    test('scales y into pixels and re-bases against the block top', () => {
        const out = planCommit(doc, pen([10, 20, 180, 20, 40, 180]), seams)
        const [s] = scanDrawBlocks(out)[0].strokes
        expect(ys(s)).toEqual([20 * SCALE - 10, 40 * SCALE - 10])
    })

    test('leaves x in the logical column, unscaled by the anchor', () => {
        const out = planCommit(doc, pen([10, 20, 180, 20, 40, 180]), seams)
        expect(xs(scanDrawBlocks(out)[0].strokes[0])).toEqual([10, 20])
    })

    // A standalone band is on the uniform logical scale — a drawing with no text under it has
    // nothing to stay aligned with, so it should scale as a whole.
    test('an existing standalone fence stores in logical units against its widget top', () => {
        const first = planCommit(doc, pen([10, 400, 180, 20, 430, 180]), seams)
        const block = scanDrawBlocks(first)[0]
        const withDrawing: Seam[] = [
            ...seams,
            {
                y: 400,
                afterLine: block.fromLine - 1,
                origin: 300,
                scale: 1,
                standalone: true,
            },
        ]
        const out = planCommit(
            first,
            pen([50, 350, 180, 60, 360, 180]),
            withDrawing,
        )
        const blocks = scanDrawBlocks(out)
        expect(blocks).toHaveLength(1)
        expect(blocks[0].strokes).toHaveLength(2)
        expect(ys(blocks[0].strokes[1])).toEqual([50, 60])
    })

    // The two halves of a cut stroke must still MEET on screen. Each is stored against its own
    // band's anchor, so the seam point reads as a different NUMBER in each fence — undoing each
    // band's own transform has to land both on the same absolute y.
    test('the two halves of a cut stroke meet at the seam once re-based', () => {
        const out = planCommit(doc, pen([10, 50, 180, 10, 150, 180]), seams)
        const [top, bottom] = scanDrawBlocks(out).map(b => b.strokes[0])
        const undo = (v: number, seam: Seam) =>
            (v + seam.origin!) / seam.scale!
        const lastOfTop = ys(top)[ys(top).length - 1]
        expect(undo(lastOfTop, seams[0])).toBe(100)
        expect(undo(ys(bottom)[0], seams[1])).toBe(100)
    })

    // A new standalone fence anchors to the boundary above it and stores its true offset below
    // that edge, and `standaloneHeight` reaches from the same edge to a pad past the ink — so
    // this is the assertion that the drawing lands INSIDE the box the editor draws for it AND
    // at the y it was drawn at, which are two different ways to be wrong.
    test('a new standalone fence stores its offset below the boundary above', () => {
        const out = planCommit(doc, pen([10, 400, 180, 20, 430, 180]), seams)
        const [s] = scanDrawBlocks(out)[0].strokes
        expect(ys(s)).toEqual([400 - seams[1].y, 430 - seams[1].y])
        const h = standaloneHeight([s], DEFAULT_STANDALONE_PAD)
        expect(h).toBe(430 - seams[1].y + DEFAULT_STANDALONE_PAD)
        expect(Math.min(...ys(s))).toBeGreaterThanOrEqual(0)
        expect(Math.max(...ys(s)) + DEFAULT_STANDALONE_PAD).toBe(h)
    })

    test('the pad default matches what drawBlock actually reserves', () => {
        expect(DEFAULT_STANDALONE_PAD).toBe(STANDALONE_PAD)
    })

    // `pad` now reaches exactly two decisions: the offset a NORMALIZED fence gets (the empty
    // table below, the one case with no boundary to anchor to), and how far below a drawing a
    // new stroke still counts as part of it. Passing a different one has to move both.
    test('a caller-supplied pad is honoured where a pad is still used', () => {
        const out = planCommit(doc, pen([10, 400, 180, 20, 430, 180]), [], 3)
        expect(ys(scanDrawBlocks(out)[0].strokes[0])).toEqual([3, 33])
    })

    // inkCodec's zigzag varint is integer-only, so a fractional coordinate would round-trip to
    // something else entirely. planCommit rounds before encoding so no caller can forget.
    test('fractional capture coordinates round-trip losslessly', () => {
        const out = planCommit(
            doc,
            pen([10.4, 20.6, 180.2, 20.5, 40.9, 179.7]),
            seams,
        )
        const [s] = scanDrawBlocks(out)[0].strokes
        // Rounded to [10, 21, 180, 21, 41, 180], then y * 2 - 10.
        expect(s.pts).toEqual([10, 32, 180, 21, 72, 180])
    })

    test('tool, colour, width and straightness survive the commit', () => {
        const hl: Stroke = {
            t: 'hl',
            c: '#f2b705',
            w: 18,
            straight: true,
            pts: [10, 20, 255, 300, 40, 255],
        }
        const [s] = scanDrawBlocks(planCommit(doc, hl, seams))[0].strokes
        expect(s.t).toBe('hl')
        expect(s.c).toBe('#f2b705')
        expect(s.w).toBe(18)
        expect(s.straight).toBe(true)
    })
})

// ── Frontmatter ─────────────────────────────────────────────────────────────────────────────
// A fence directly after the closing `---` is owned by the note's METADATA block —
// scanDrawBlocks reports attachedToLine = the closing `---` — but InkOverlay's buildSeams
// deliberately gives the frontmatter no band at all, so ink stored there anchors to an edge the
// commit path can never produce again. Editor.tsx's autosave also rewrites that exact slot
// (normalizeFrontmatterSpacing inserts a blank line there), so a fence written into it gets a
// line spliced in above it by an edit the user did not make. (This guard originally existed for
// a third reason, now gone: back when a fence's mode was inferred from a blank line above it,
// that same insertion flipped the fence's mode mid-save. The mode is in the info string now.)
describe('planCommit — never hangs a fence off a frontmatter close', () => {
    const fm = '---\ntitle: Note\n---\n\nFirst paragraph.\n'
    const fmSeams: Seam[] = [
        { y: 100, afterLine: 3, origin: 10, scale: SCALE },
        { y: 200, afterLine: 5, origin: 150, scale: SCALE },
    ]

    test('puts the fence below the separator, not against the ---', () => {
        const out = planCommit(fm, pen([10, 20, 180, 20, 40, 180]), fmSeams)
        const [b] = scanDrawBlocks(out)
        // The line above the fence is the frontmatter's blank separator, not the `---` itself.
        const lines = out.split('\n')
        expect(lines[b.fromLine - 2]).toBe('')
        expect(lines[b.fromLine - 3]).toBe('---')
    })

    // The shape that would otherwise flip a second time: no separator yet, so the normalizer is
    // about to insert one. Insert it here instead and the result is a fixed point.
    test('adds the separator the normalizer would have added', () => {
        const tight = '---\ntitle: Note\n---\nFirst paragraph.\n'
        const out = planCommit(
            tight,
            pen([10, 20, 180, 20, 40, 180]),
            [{ y: 100, afterLine: 3, origin: 10, scale: SCALE }],
        )
        const [b] = scanDrawBlocks(out)
        const lines = out.split('\n')
        expect(lines.slice(0, 4)).toEqual(['---', 'title: Note', '---', ''])
        expect(b.fromLine).toBe(5)
        // …and the prose that used to butt against the frontmatter is still there, in order.
        expect(out).toContain('First paragraph.')
    })

    // The blank line the guard adds must match the document's line endings — a bare LF spliced
    // into a CRLF note is the same defect insertDrawBlock was fixed for, one function away.
    test('the separator it adds matches a CRLF note', () => {
        const tight = '---\r\ntitle: Note\r\n---\r\nFirst paragraph.\r\n'
        const out = planCommit(
            tight,
            pen([10, 20, 180, 20, 40, 180]),
            [{ y: 100, afterLine: 3, origin: 10, scale: SCALE }],
        )
        expect(out).not.toMatch(/[^\r]\n/)
        expect(scanDrawBlocks(out)).toHaveLength(1)
    })

    // The guard uses the SHARED frontmatter boundary (frontmatterUtils.ts), which closes on
    // `---` alone — the same rule core/src/frontmatter.ts's parser and normalizeFrontmatter.ts
    // use. A private copy here also accepted YAML's `...` terminator, so on a note like this one
    // it inserted a separator the parser did not want and the normalizer would never produce.
    test('a `...`-terminated block is ordinary prose, not frontmatter', () => {
        const dots = '---\ntitle: Note\n...\nFirst paragraph.\n'
        const out = planCommit(
            dots,
            pen([10, 20, 180, 20, 40, 180]),
            [{ y: 100, afterLine: 3, origin: 10, scale: SCALE }],
        )
        const [b] = scanDrawBlocks(out)
        // The fence follows the `...` line directly: no blank line spliced in above it.
        expect(b.fromLine).toBe(4)
        expect(out.split('\n').slice(0, 3)).toEqual(['---', 'title: Note', '...'])
    })

    test('a fence for a block BELOW the frontmatter is untouched by the guard', () => {
        const out = planCommit(fm, pen([10, 150, 180, 20, 170, 180]), fmSeams)
        const [b] = scanDrawBlocks(out)
        expect(b.attachedToLine).toBe(5)
        expect(out.split('\n')[4]).toBe('First paragraph.')
    })
})

describe('planCommit — the prose', () => {
    test('leaves the prose untouched', () => {
        const out = planCommit(doc, pen([10, 20, 180, 20, 40, 180]), seams)
        expect(out).toContain('First paragraph.')
        expect(out).toContain('Second paragraph.')
    })

    // Stronger than `toContain`: strip every fence back out and the document must be byte-
    // identical to what went in — no reordered lines, no lost or gained blank lines.
    test('stripping the fences again returns the original document byte for byte', () => {
        const one = planCommit(doc, pen([10, 20, 180, 20, 40, 180]), seams)
        expect(stripFences(one)).toBe(doc)
        const two = planCommit(doc, pen([10, 50, 180, 10, 150, 180]), seams)
        expect(stripFences(two)).toBe(doc)
        // A fence appended past the last line: the note keeps its trailing newline (planCommit
        // restores it) and removeDrawBlock's blank-line swallow gives the terminator back, so
        // this round-trips exactly too.
        const tail = planCommit(doc, pen([10, 400, 180, 20, 430, 180]), seams)
        expect(tail.endsWith('\n')).toBe(true)
        expect(stripFences(tail)).toBe(doc)
    })

    // A code block is a block like any other, and ink drawn over it annotates it. What used to
    // happen instead: the line above the insertion point is a ``` marker, the old inference read
    // that as "standalone", and the ink was normalized into a drawing box of its own.
    test('ink over a code block annotates it rather than becoming a drawing', () => {
        const withCode = 'Intro.\n\n```ts\nconst x = 1\n```\n'
        const codeSeams: Seam[] = [
            { y: 50, afterLine: 1, origin: 0, scale: SCALE, standalone: false },
            { y: 200, afterLine: 5, origin: 60, scale: SCALE, standalone: false },
        ]
        const out = planCommit(
            withCode,
            pen([10, 120, 180, 20, 150, 180]),
            codeSeams,
        )
        const [b] = scanDrawBlocks(out)
        expect(b.standalone).toBe(false)
        expect(b.attachedToLine).toBe(5)
        expect(ys(b.strokes[0])).toEqual([
            stored(120, codeSeams[1]),
            stored(150, codeSeams[1]),
        ])
    })

    // The marker, not the whitespace. A band that says "attached" gets an attached fence even
    // when a blank line sits directly above the insertion point, which the old rule read as
    // standalone — and that reading is what an Enter keypress could later flip.
    test('a blank line above the insertion point does not force a drawing', () => {
        const spaced = 'Intro.\n\nBody.\n'
        const out = planCommit(
            spaced,
            pen([10, 20, 180, 20, 40, 180]),
            [{ y: 100, afterLine: 2, origin: 10, scale: SCALE, standalone: false }],
        )
        const [b] = scanDrawBlocks(out)
        expect(b.standalone).toBe(false)
        expect(ys(b.strokes[0])).toEqual([20 * SCALE - 10, 40 * SCALE - 10])
    })
})

// ── "when i finish drawing, things jump around, spacing is made" ─────────────────────────────
// The user's third report on the same complaint, and the last of its three causes. A STANDALONE
// fence is a block widget with real height; an ATTACHED one reserves nothing and paints over the
// text it decorates. So every pixel a standalone fence gains above the prose is a pixel the whole
// rest of the note moves down, the instant the pen lifts.
//
// Measured in the running component (a heading, a standalone drawing, then two paragraphs): one
// stroke drawn across the drawing's lower edge grew its reserved height by exactly one `pad` and
// pushed both paragraphs down 45.2 CSS px — and it does that again on every stroke, cumulatively,
// which is the "spacing is made" the user is describing.
//
// THE RULE: a drawing never displaces text.
//   - ink inside the span the document already occupies attaches, reserves ZERO height, paints over
//   - ink past the last line of content becomes ONE standalone block AT THE END, where there is
//     nothing left to displace — and text typed afterwards still flows below it
//   - no fence with a non-zero reserved height is ever written above existing content
//
// The assertions below are about DISPLACEMENT, not about fence counts: a count stays green while
// the text still moves.

/** The 1-based last line a READER sees — the last non-blank line that is not part of a ```draw
 *  fence. Written out here rather than imported so the tests and the module cannot agree with each
 *  other about a wrong answer. */
function lastContent(text: string): number {
    const lines = text.split('\n')
    const inFence = new Set<number>()
    for (const b of scanDrawBlocks(text)) {
        for (let n = b.fromLine; n <= b.toLine; n++) inFence.add(n)
    }
    for (let n = lines.length; n >= 1; n--) {
        if (!inFence.has(n) && lines[n - 1].trim() !== '') return n
    }
    return 0
}

/** How many units of document a note's drawings reserve ABOVE its last line of content — the
 *  number every line below them is pushed down by. An attached fence contributes nothing by
 *  construction (drawBlock.ts reserves no height for one); a standalone one contributes its
 *  whole box.
 *
 *  This is the displacement itself, not a proxy for it. A fence COUNT stays green while a
 *  drawing quietly grows and the prose slides down. */
function reservedAboveText(text: string): number {
    const last = lastContent(text)
    let total = 0
    for (const b of scanDrawBlocks(text)) {
        if (b.standalone && b.fromLine < last) {
            total += standaloneHeight(b.strokes, DEFAULT_STANDALONE_PAD)
        }
    }
    return total
}

/** THE invariant: committing ink adds not one unit of reserved height above the prose. A drawing
 *  ALREADY sitting above text is allowed to stay — it got there legitimately, drawn at the end
 *  of a shorter note with text typed after it, which is the feature this whole surface exists
 *  for. What it may not do is grow, and no new one may appear above the text either. */
function expectNoHeightAddedAboveText(before: string, after: string) {
    expect(reservedAboveText(after)).toBe(reservedAboveText(before))
}

const lineNumberOf = (text: string, needle: string) =>
    text.split('\n').findIndex(l => l.includes(needle)) + 1

describe('planCommit — a drawing never displaces text', () => {
    // The user's own note shape: a standalone drawing ABOVE all the prose. It gets there
    // legitimately — drawn at the end of a note that was only a heading, then text typed after
    // it, which is the feature this whole surface exists for — and from then on it is a
    // height-reserving block with paragraphs underneath.
    const WIDGET_TOP = 30
    const INK_TOP = 40
    const INK_BOTTOM = 260
    // The widget runs from its top down to one pad past its lowest ink (standaloneHeight).
    const BOX_BOTTOM = INK_BOTTOM + DEFAULT_STANDALONE_PAD
    const aboveDoc = insertDrawBlock(
        '# Draw Test\n\nAlpha paragraph.\n\nBeta paragraph.\n',
        1,
        [vert(INK_TOP - WIDGET_TOP, INK_BOTTOM - WIDGET_TOP)],
        true,
    )
    const drawingLine = scanDrawBlocks(aboveDoc)[0].fromLine
    const alphaLine = lineNumberOf(aboveDoc, 'Alpha paragraph.')
    const betaLine = lineNumberOf(aboveDoc, 'Beta paragraph.')

    // Mirrors buildSeams over that layout: the heading's run, the drawing's own band (widget top
    // to widget bottom, in logical units), then the two paragraphs, each storing pixels against
    // its own top.
    const ALPHA_TOP = BOX_BOTTOM + 10
    const BETA_TOP = ALPHA_TOP + 30
    const aboveSeams: Seam[] = [
        { y: 20, afterLine: 1, origin: 0, scale: SCALE, standalone: false },
        {
            y: BOX_BOTTOM,
            afterLine: drawingLine - 1,
            origin: WIDGET_TOP,
            scale: 1,
            standalone: true,
        },
        {
            y: ALPHA_TOP + 20,
            afterLine: alphaLine,
            origin: ALPHA_TOP * SCALE,
            scale: SCALE,
            standalone: false,
        },
        {
            y: BETA_TOP + 20,
            afterLine: betaLine,
            origin: BETA_TOP * SCALE,
            scale: SCALE,
            standalone: false,
        },
    ]
    const boxHeight = (text: string) => {
        const d = scanDrawBlocks(text).find(b => b.standalone)!
        return standaloneHeight(d.strokes, DEFAULT_STANDALONE_PAD)
    }

    // The fixture's own premise, asserted rather than assumed: the drawing really is above the
    // prose and really does reserve height.
    test('the fixture really is a height-reserving drawing above the prose', () => {
        expect(drawingLine).toBeLessThan(alphaLine)
        expect(boxHeight(aboveDoc)).toBeGreaterThan(0)
        expect(BOX_BOTTOM).toBe(
            WIDGET_TOP + boxHeight(aboveDoc),
        )
    })

    // THE measured defect. A stroke drawn across the drawing's lower edge is cut there, and the
    // upper piece used to be appended into the drawing at exactly the box's bottom — one `pad`
    // below its lowest ink — so standaloneHeight grew by a pad and both paragraphs moved down.
    test('a stroke across the drawing lower edge does not grow the box', () => {
        const before = boxHeight(aboveDoc)
        const out = planCommitStrokes(
            aboveDoc,
            [vert(BOX_BOTTOM - 30, BOX_BOTTOM + 20)],
            aboveSeams,
        )
        expect(boxHeight(out)).toBe(before)
    })

    // …and again, and again. The growth was cumulative — every stroke another pad — which is
    // exactly what "spacing is made" describes. One call cannot see that; three can.
    test('three strokes across that edge still do not grow it', () => {
        let out = aboveDoc
        for (let i = 0; i < 3; i++) {
            out = planCommitStrokes(
                out,
                [vert(BOX_BOTTOM - 30, BOX_BOTTOM + 20, 100 + i * 40)],
                aboveSeams,
            )
        }
        expect(boxHeight(out)).toBe(boxHeight(aboveDoc))
    })

    test('ink drawn inside that drawing does not grow it either', () => {
        const before = boxHeight(aboveDoc)
        const out = planCommitStrokes(
            aboveDoc,
            [vert(INK_BOTTOM - 20, BOX_BOTTOM - 1)],
            aboveSeams,
        )
        expect(boxHeight(out)).toBe(before)
    })

    // Where that ink goes instead, and the reason it is allowed to go there: an ATTACHED fence
    // reserves nothing, so the block it hangs off can be anywhere. Reading the stored y back
    // through the attached transform has to give the absolute y the pen was at — the ink stays
    // exactly where it was drawn, it just stops being able to push the note around.
    test('it attaches instead, and paints back at the y it was drawn at', () => {
        const out = planCommitStrokes(
            aboveDoc,
            [vert(INK_BOTTOM - 20, INK_BOTTOM)],
            aboveSeams,
        )
        const added = scanDrawBlocks(out).filter(b => !b.standalone)
        expect(added).toHaveLength(1)
        const seam = aboveSeams[2]
        expect(absolute(top(added[0].strokes[0]), seam)).toBe(INK_BOTTOM - 20)
        expect(absolute(bottom(added[0].strokes[0]), seam)).toBe(INK_BOTTOM)
    })

    // A cut stroke must not come apart, which is the defect an earlier round of this same
    // complaint fixed. Both halves now land in ONE attached fence, so they are stored in one
    // frame and meet exactly.
    test('a stroke cut at that edge stays contiguous, in one fence', () => {
        const out = planCommitStrokes(
            aboveDoc,
            [vert(BOX_BOTTOM - 30, BOX_BOTTOM + 20)],
            aboveSeams,
        )
        const attached = scanDrawBlocks(out).filter(b => !b.standalone)
        expect(attached).toHaveLength(1)
        const seam = aboveSeams[2]
        const ends = attached[0].strokes
            .map(s => [absolute(top(s), seam), absolute(bottom(s), seam)])
            .sort((a, b) => a[0] - b[0])
        expect(ends[0][0]).toBe(BOX_BOTTOM - 30)
        expect(ends[ends.length - 1][1]).toBe(BOX_BOTTOM + 20)
        // the pieces meet at the seam rather than leaving a gap
        for (let i = 1; i < ends.length; i++) expect(ends[i][0]).toBe(ends[i - 1][1])
    })

    test('the invariant holds wherever the ink lands in that note', () => {
        const ys = [
            10,
            60,
            200,
            BOX_BOTTOM - 5,
            BOX_BOTTOM + 5,
            ALPHA_TOP + 5,
            BETA_TOP + 40,
        ]
        for (const y of ys) {
            const out = planCommitStrokes(aboveDoc, [vert(y, y + 20)], aboveSeams)
            expectNoHeightAddedAboveText(aboveDoc, out)
        }
        // …and one stroke down the whole note, which lands a piece in every band at once.
        expectNoHeightAddedAboveText(
            aboveDoc,
            planCommitStrokes(aboveDoc, [vert(10, BETA_TOP + 60)], aboveSeams),
        )
    })

    // A SEAM TABLE GOES STALE. It is captured at pointerdown and spent up to COMMIT_DELAY later,
    // so anything appended to the note in between — an external edit arriving over SSE, the
    // autosave's own normalizer, the user typing at the end — leaves the table's last band no
    // longer the last block. The trailing band's fence used to be written directly after that
    // band, which puts a height-reserving drawing above everything that arrived: the 314px
    // displacement the user measured. There is nothing in the stale table to anchor against, so
    // it falls back to the end of the note.
    test('a stale seam table cannot put a drawing above the text that arrived', () => {
        const grown = doc + '\nA third paragraph that arrived after pen-down.\n'
        const out = planCommitStrokes(grown, [vert(400, 480)], seams)
        expectNoHeightAddedAboveText(grown, out)
        const drawing = scanDrawBlocks(out).find(b => b.standalone)!
        expect(drawing.fromLine).toBeGreaterThan(
            lineNumberOf(out, 'A third paragraph'),
        )
    })

    // The other half of a stale table: the band above is the DRAWING, and a piece landing within
    // a pad of its box joins it — which is right when nothing is under it, and grows it into the
    // prose when something now is.
    test('a stale seam table cannot grow the drawing above the text that arrived', () => {
        // The note as it stood at pen-down: a heading and a drawing, nothing under it.
        const penDown = insertDrawBlock(
            '# Draw Test\n',
            1,
            [vert(INK_TOP - WIDGET_TOP, INK_BOTTOM - WIDGET_TOP)],
            true,
        )
        const stale: Seam[] = [
            { y: 20, afterLine: 1, origin: 0, scale: SCALE, standalone: false },
            {
                y: BOX_BOTTOM,
                afterLine: scanDrawBlocks(penDown)[0].fromLine - 1,
                origin: WIDGET_TOP,
                scale: 1,
                standalone: true,
            },
        ]
        // …and as it stands by the time the debounce fires.
        const arrived = penDown + '\nA paragraph that arrived after pen-down.\n'
        const out = planCommitStrokes(
            arrived,
            [vert(BOX_BOTTOM + 4, BOX_BOTTOM + 40)],
            stale,
        )
        expectNoHeightAddedAboveText(arrived, out)
    })

    // ── The two behaviours that must NOT regress ────────────────────────────────────────────
    test('ink in the gap between two paragraphs still attaches, reserving nothing', () => {
        const out = planCommit(doc, pen([10, 150, 180, 20, 170, 180]), seams)
        const [b] = scanDrawBlocks(out)
        expect(b.standalone).toBe(false)
        expect(b.attachedToLine).toBe(3)
        expectNoHeightAddedAboveText(doc, out)
    })

    test('ink past the last paragraph is still ONE standalone drawing at the end', () => {
        const out = planCommitStrokes(doc, [vert(400, 440), vert(450, 490, 200)], seams)
        const drawings = scanDrawBlocks(out).filter(b => b.standalone)
        expect(drawings).toHaveLength(1)
        expect(drawings[0].fromLine).toBeGreaterThan(
            lineNumberOf(out, 'Second paragraph.'),
        )
        expect(stripFences(out)).toBe(doc)
    })

    // The user's ORIGINAL request, and the thing this rule must not take away: a drawing at the
    // end still reserves its height, so text typed afterwards flows BELOW it rather than through
    // it. Nothing is displaced because nothing is under it yet.
    test('a drawing at the end still reserves height for text to flow after', () => {
        const out = planCommitStrokes(doc, [vert(400, 440)], seams)
        const drawing = scanDrawBlocks(out).find(b => b.standalone)!
        expect(standaloneHeight(drawing.strokes, DEFAULT_STANDALONE_PAD)).toBeGreaterThan(0)
        const typed = out + 'Typed after the drawing.\n'
        expect(lineNumberOf(typed, 'Typed after the drawing.')).toBeGreaterThan(
            drawing.toLine,
        )
    })

    test('a note whose only content is a heading gets its drawing below the heading', () => {
        const headingOnly = '# Just a heading\n'
        const out = planCommitStrokes(
            headingOnly,
            [vert(200, 260)],
            [{ y: 20, afterLine: 1, origin: 0, scale: SCALE, standalone: false }],
        )
        expectNoHeightAddedAboveText(headingOnly, out)
        const drawing = scanDrawBlocks(out).find(b => b.standalone)!
        expect(drawing.fromLine).toBeGreaterThan(1)
        expect(stripFences(out)).toBe(headingOnly)
    })

    test('a note with frontmatter keeps its drawing below the body, not above it', () => {
        const fm = '---\ntitle: Draw Test\n---\n\nBody paragraph.\n'
        const bodyLine = lineNumberOf(fm, 'Body paragraph.')
        const out = planCommitStrokes(
            fm,
            [vert(300, 360)],
            [
                {
                    y: 60,
                    afterLine: bodyLine,
                    origin: 40 * SCALE,
                    scale: SCALE,
                    standalone: false,
                },
            ],
        )
        expectNoHeightAddedAboveText(fm, out)
        expect(
            scanDrawBlocks(out).find(b => b.standalone)!.fromLine,
        ).toBeGreaterThan(lineNumberOf(out, 'Body paragraph.'))
    })
})

describe('planErase', () => {
    const twoStrokes = (): string => {
        const a = planCommit(doc, pen([10, 20, 180, 20, 40, 180]), seams)
        return planCommit(a, pen([30, 20, 180, 40, 40, 180]), seams)
    }

    // BOTH indices, deliberately: erasing only index 0 would pass for an implementation that
    // ignores `strokeIndex` and always drops the first stroke.
    test('removes exactly the named stroke, first or last', () => {
        const text = twoStrokes()
        const from = scanDrawBlocks(text)[0].fromLine
        const withoutFirst = scanDrawBlocks(planErase(text, from, 0))[0].strokes
        expect(withoutFirst).toHaveLength(1)
        expect(xs(withoutFirst[0])).toEqual([30, 40])
        const withoutLast = scanDrawBlocks(planErase(text, from, 1))[0].strokes
        expect(withoutLast).toHaveLength(1)
        expect(xs(withoutLast[0])).toEqual([10, 20])
    })

    test('erasing the last stroke leaves an empty fence rather than deleting it', () => {
        const text = planCommit(doc, pen([10, 20, 180, 20, 40, 180]), seams)
        const out = planErase(text, scanDrawBlocks(text)[0].fromLine, 0)
        const blocks = scanDrawBlocks(out)
        expect(blocks).toHaveLength(1)
        expect(blocks[0].strokes).toEqual([])
    })

    test('an unknown fence or out-of-range index changes nothing', () => {
        const text = twoStrokes()
        expect(planErase(text, 999, 0)).toBe(text)
        expect(planErase(text, scanDrawBlocks(text)[0].fromLine, 7)).toBe(text)
        expect(planErase(text, scanDrawBlocks(text)[0].fromLine, -1)).toBe(text)
    })

    test('leaves the prose byte-identical', () => {
        const text = twoStrokes()
        const out = planErase(text, scanDrawBlocks(text)[0].fromLine, 0)
        expect(stripFences(out)).toBe(doc)
    })
})

// ── planStrokeEdit: the lasso's text-to-text half ───────────────────────────────────────────
// Same discipline as the planCommit block above: assertions read the decoded strokes back and
// check NUMBERS. A count of strokes in a fence is identical whether the move landed where the
// user dragged it or 300px away.

/** A note whose ATTACHED fence carries two strokes at known coordinates. */
function attachedPair(): string {
    return insertDrawBlock(
        'Annotated paragraph.\n\nSecond paragraph.\n',
        1,
        [pen([10, 20, 180, 30, 40, 180]), pen([100, 60, 180, 120, 80, 180])],
        false,
    )
}

/** A standalone drawing whose ink is seated at STANDALONE_PAD, the shape planCommit creates. */
function standaloneSketch(): string {
    return insertDrawBlock(
        'Heading.\n\nText after the drawing.\n',
        2,
        [
            pen([10, STANDALONE_PAD, 180, 50, STANDALONE_PAD + 100, 180]),
            pen([60, STANDALONE_PAD + 20, 180, 90, STANDALONE_PAD + 60, 180]),
        ],
        true,
    )
}

describe('planStrokeEdit', () => {
    test('moves only the selected strokes, by exactly the delta asked for', () => {
        const text = attachedPair()
        const from = scanDrawBlocks(text)[0].fromLine
        const out = planStrokeEdit(text, from, [1], s =>
            translateStrokes(s, 7, 13),
        )
        const [a, b] = scanDrawBlocks(out)[0].strokes
        expect(xs(a)).toEqual([10, 30])
        expect(ys(a)).toEqual([20, 40])
        expect(xs(b)).toEqual([107, 127])
        expect(ys(b)).toEqual([73, 93])
    })

    // The codec's zigzag varint is integer-only, so a fractional coordinate comes back
    // TRUNCATED rather than rounded. Every drag produces fractions, and the difference between
    // 20.6 → 21 and 20.6 → 20 is a stroke that creeps upward one pixel per drag.
    test('rounds a fractional move rather than letting the codec truncate it', () => {
        const text = attachedPair()
        const from = scanDrawBlocks(text)[0].fromLine
        const out = planStrokeEdit(text, from, [0], s =>
            translateStrokes(s, 0.4, 0.6),
        )
        const [a] = scanDrawBlocks(out)[0].strokes
        expect(xs(a)).toEqual([10, 30])
        expect(ys(a)).toEqual([21, 41])
    })

    test('a resize scales the stored stroke width along with the geometry', () => {
        const text = attachedPair()
        const from = scanDrawBlocks(text)[0].fromLine
        const out = planStrokeEdit(text, from, [0, 1], s =>
            scaleStrokes(s, 10, 20, 2),
        )
        const [a, b] = scanDrawBlocks(out)[0].strokes
        expect(a.w).toBe(10)
        expect(b.w).toBe(10)
        expect(xs(a)).toEqual([10, 50])
        expect(ys(a)).toEqual([20, 60])
    })

    test('an ATTACHED fence is never re-seated — its y is an offset from real text', () => {
        const text = attachedPair()
        const from = scanDrawBlocks(text)[0].fromLine
        const out = planStrokeEdit(text, from, [0, 1], s =>
            translateStrokes(s, 0, 40),
        )
        // Every y moved by the full 40. Re-seating would have pulled the pair back so the
        // topmost stroke sat at the standalone padding, silently undoing the drag.
        expect(ys(scanDrawBlocks(out)[0].strokes[0])).toEqual([60, 80])
    })

    // A shrink about the ink's BOTTOM edge leaves the lowest point exactly where it was, so the
    // box does not move at all and nothing needs re-seating. The assertion is that the resize is
    // honoured EXACTLY — the floor must not fire here and drag the drawing somewhere it was not
    // put. (Note what is NOT asserted: "maxY <= standaloneHeight" cannot fail now that the height
    // is `maxY + pad`, so it would be a test that passes for any implementation at all.)
    test('a resize about the ink bottom is honoured exactly, with no re-seating', () => {
        const text = standaloneSketch()
        const from = scanDrawBlocks(text)[0].fromLine
        const bottom = STANDALONE_PAD + 100
        const before = scanDrawBlocks(text)[0].strokes
        const out = planStrokeEdit(text, from, [0, 1], s =>
            scaleStrokes(s, 0, bottom, 0.5),
        )
        const strokes = scanDrawBlocks(out)[0].strokes
        expect(strokes.flatMap(ys)).toEqual(
            before.flatMap(ys).map(y => Math.round(bottom + (y - bottom) * 0.5)),
        )
        expect(Math.min(...strokes.flatMap(ys))).toBeGreaterThanOrEqual(0)
    })

    // The clamp is a CLAMP, not a normalize: inside the box nothing is moved, so a drag lands
    // where the pointer left it. A normalize back to `pad` would undo every vertical drag and
    // the ink would snap out from under the cursor the moment the commit fired.
    test('a small move inside a standalone box is honoured exactly', () => {
        const text = standaloneSketch()
        const from = scanDrawBlocks(text)[0].fromLine
        const before = scanDrawBlocks(text)[0].strokes.flatMap(ys)
        const out = planStrokeEdit(text, from, [0, 1], s =>
            translateStrokes(s, 0, 10),
        )
        expect(scanDrawBlocks(out)[0].strokes.flatMap(ys)).toEqual(
            before.map(y => y + 10),
        )
    })

    // The clamp is a FLOOR, not a range. The old ceiling sat at `2 * pad`, which was the box's
    // bottom edge back when the height was `span + 2*pad`; the box now grows down with its ink
    // (InkOverlay's `growsDown` already let a resize run past that ceiling), and an anchored
    // drawing legitimately stores a minY of hundreds — the gap between the block boundary above
    // it and where the pen was. A `2 * pad` ceiling would have teleported one to the top of its
    // own box on the first lasso edit, which is the jump this whole contract exists to stop.
    test('a move DOWN is honoured in full and the box grows to hold it', () => {
        const text = standaloneSketch()
        const from = scanDrawBlocks(text)[0].fromLine
        const before = scanDrawBlocks(text)[0].strokes.flatMap(ys)
        const down = planStrokeEdit(text, from, [0, 1], s =>
            translateStrokes(s, 0, 400),
        )
        const strokes = scanDrawBlocks(down)[0].strokes
        expect(strokes.flatMap(ys)).toEqual(before.map(y => y + 400))
        // …and the ink is still inside its own box, because the box grew with it by the full
        // drag. A height measured from the ink's own SPAN would not have moved at all.
        expect(
            standaloneHeight(strokes, STANDALONE_PAD) -
                standaloneHeight(scanDrawBlocks(text)[0].strokes, STANDALONE_PAD),
        ).toBe(400)
    })

    test('a move UP past the widget top is floored at the boundary', () => {
        const text = standaloneSketch()
        const from = scanDrawBlocks(text)[0].fromLine
        const up = planStrokeEdit(text, from, [0, 1], s =>
            translateStrokes(s, 0, -400),
        )
        expect(Math.min(...scanDrawBlocks(up)[0].strokes.flatMap(ys))).toBe(0)
    })

    test('re-seating a standalone fence keeps the strokes RELATIVE positions', () => {
        const text = standaloneSketch()
        const from = scanDrawBlocks(text)[0].fromLine
        // Move only the second stroke down. Re-seating shifts the pair as a whole, so the gap
        // between them must have grown by exactly the drag.
        const before = scanDrawBlocks(text)[0].strokes
        const gapBefore = Math.min(...ys(before[1])) - Math.min(...ys(before[0]))
        const out = planStrokeEdit(text, from, [1], s =>
            translateStrokes(s, 0, 30),
        )
        const after = scanDrawBlocks(out)[0].strokes
        expect(Math.min(...ys(after[1])) - Math.min(...ys(after[0]))).toBe(
            gapBefore + 30,
        )
        expect(Math.min(...after.flatMap(ys))).toBe(STANDALONE_PAD)
    })

    test('leaves the prose byte-identical', () => {
        const text = attachedPair()
        const out = planStrokeEdit(text, scanDrawBlocks(text)[0].fromLine, [0], s =>
            translateStrokes(s, 5, 5),
        )
        expect(stripFences(out)).toBe('Annotated paragraph.\n\nSecond paragraph.\n')
    })

    test('an unknown fence, an empty selection or a broken edit changes nothing', () => {
        const text = attachedPair()
        const from = scanDrawBlocks(text)[0].fromLine
        expect(planStrokeEdit(text, 999, [0], s => s)).toBe(text)
        expect(planStrokeEdit(text, from, [], s => s)).toBe(text)
        expect(planStrokeEdit(text, from, [9], s => s)).toBe(text)
        // An `edit` that returns the wrong number of strokes would otherwise leave the fence
        // half-rewritten.
        expect(planStrokeEdit(text, from, [0, 1], s => s.slice(0, 1))).toBe(text)
    })
})

// ── planReorder: dragging a drawing block to a new place ────────────────────────────────────

const REORDER_INK = [pen([10, STANDALONE_PAD, 180, 90, STANDALONE_PAD + 60, 180])]

/** Heading / drawing / paragraph / paragraph, with the drawing standalone at the top. */
function reorderNote(): string {
    return insertDrawBlock(
        'Alpha paragraph.\n\nBravo paragraph.\n\nCharlie paragraph.\n',
        2,
        REORDER_INK,
        true,
    )
}

describe('planReorder', () => {
    test('moves the fence down the note and carries its ink with it byte-for-byte', () => {
        const text = reorderNote()
        const block = scanDrawBlocks(text)[0]
        const lines = text.split('\n')
        const charlie = lines.findIndex(l => l.startsWith('Charlie')) + 1
        const out = planReorder(text, block, charlie)

        const moved = scanDrawBlocks(out)
        expect(moved).toHaveLength(1)
        expect(moved[0].standalone).toBe(true)
        // The ink survived the move unchanged — a reorder is line surgery, not a re-encode.
        expect(moved[0].strokes).toEqual(REORDER_INK)
        // …and it really is below Charlie now, not merely still present.
        const outLines = out.split('\n')
        expect(moved[0].fromLine).toBeGreaterThan(
            outLines.findIndex(l => l.startsWith('Charlie')) + 1,
        )
    })

    test('the prose keeps its own order and content', () => {
        const text = reorderNote()
        const lines = text.split('\n')
        const charlie = lines.findIndex(l => l.startsWith('Charlie')) + 1
        const out = planReorder(text, scanDrawBlocks(text)[0], charlie)
        expect(out).not.toBe(text)
        expect(stripFences(out).trim().split('\n').filter(l => l.trim())).toEqual([
            'Alpha paragraph.',
            'Bravo paragraph.',
            'Charlie paragraph.',
        ])
    })

    // The failure a naive splice leaves behind: the blank line that separated the fence from the
    // block above stays put, stacks against the one below, and the note grows a blank line every
    // time the user drags the drawing.
    test('leaves no doubled blank line where the fence used to be', () => {
        const text = reorderNote()
        let out = text
        for (let i = 0; i < 3; i++) {
            const block = scanDrawBlocks(out)[0]
            const lines = out.split('\n')
            const bravo = lines.findIndex(l => l.startsWith('Bravo')) + 1
            out = planReorder(out, block, bravo)
        }
        expect(out).not.toContain('\n\n\n')
    })

    test('adds the separator a landing spot lacks', () => {
        const text = reorderNote()
        // Dropped immediately after Bravo's own line, which carries no blank of its own on
        // that side: the fence must not end up welded to the paragraph above it.
        const lines = text.split('\n')
        const bravo = lines.findIndex(l => l.startsWith('Bravo')) + 1
        const out = planReorder(text, scanDrawBlocks(text)[0], bravo)
        const outLines = out.split('\n')
        const fenceIdx = scanDrawBlocks(out)[0].fromLine - 1
        expect(outLines[fenceIdx - 1].trim()).toBe('')
        expect(outLines[fenceIdx - 2]).toContain('Bravo')
    })

    test('a drop on the fence itself is a no-op', () => {
        const text = reorderNote()
        const block = scanDrawBlocks(text)[0]
        expect(planReorder(text, block, block.fromLine)).toBe(text)
        expect(planReorder(text, block, block.toLine - 1)).toBe(text)
        // Both boundary slots too: directly above the fence and directly below it are the
        // place it already occupies.
        expect(planReorder(text, block, block.fromLine - 1)).toBe(text)
        expect(planReorder(text, block, block.toLine)).toBe(text)
    })

    test('moving to the very top keeps the note terminated', () => {
        const text = reorderNote()
        const block = scanDrawBlocks(text)[0]
        const lines = text.split('\n')
        const charlie = lines.findIndex(l => l.startsWith('Charlie')) + 1
        const moved = planReorder(text, block, charlie)
        const back = planReorder(moved, scanDrawBlocks(moved)[0], 0)
        expect(scanDrawBlocks(back)[0].fromLine).toBe(1)
        expect(back.endsWith('\n')).toBe(true)
        expect(scanDrawBlocks(back)[0].strokes).toEqual(REORDER_INK)
    })

    test('a fence dropped past the last line still terminates the file', () => {
        const text = reorderNote()
        const out = planReorder(text, scanDrawBlocks(text)[0], 999)
        expect(out.endsWith('\n')).toBe(true)
        expect(scanDrawBlocks(out)).toHaveLength(1)
    })
})
