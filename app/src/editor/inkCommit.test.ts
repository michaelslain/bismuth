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
    type Seam,
} from './inkCommit'
import { STANDALONE_PAD } from './drawBlock'
import { standaloneHeight } from './drawBlockGeometry'
import {
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

    // The GROUP is normalized, not each stroke: the sketch keeps its internal geometry, and only
    // its topmost ink sits `pad` below the widget top. Normalizing per stroke stacks every
    // stroke at `pad` and destroys the drawing.
    test('keeps its internal geometry and normalizes the group once', () => {
        const [b] = scanDrawBlocks(planCommitStrokes(doc, sketch, seams))
        expect(b.strokes.map(ys)).toEqual([
            [DEFAULT_STANDALONE_PAD, DEFAULT_STANDALONE_PAD],
            [DEFAULT_STANDALONE_PAD + 80, DEFAULT_STANDALONE_PAD + 80],
            [DEFAULT_STANDALONE_PAD + 160, DEFAULT_STANDALONE_PAD + 160],
        ])
        expect(b.strokes.map(xs)).toEqual([
            [100, 200],
            [100, 200],
            [150, 250],
        ])
    })

    test('reserves the height of the whole sketch, once', () => {
        const [b] = scanDrawBlocks(planCommitStrokes(doc, sketch, seams))
        expect(standaloneHeight(b.strokes, DEFAULT_STANDALONE_PAD)).toBe(
            160 + DEFAULT_STANDALONE_PAD * 2,
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
                DEFAULT_STANDALONE_PAD,
                DEFAULT_STANDALONE_PAD,
            ])
        }
    })

    test('leaves the prose alone in both shapes', () => {
        expect(stripFences(planCommitStrokes(doc, sketch, seams))).toBe(doc)
        const tight = 'First paragraph.\n\nSecond paragraph.'
        expect(stripFences(planCommitStrokes(tight, sketch, seams))).toBe(tight)
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

    // A fence being created from nothing has no widget to measure, so the ink is normalized to
    // sit `pad` below the (future) widget top. `standaloneHeight` reserves `pad` on both sides,
    // so this is the assertion that the drawing lands INSIDE the box the editor draws for it.
    test('a new standalone fence is normalized to sit pad below its widget top', () => {
        const out = planCommit(doc, pen([10, 400, 180, 20, 430, 180]), seams)
        const [s] = scanDrawBlocks(out)[0].strokes
        expect(ys(s)).toEqual([
            DEFAULT_STANDALONE_PAD,
            DEFAULT_STANDALONE_PAD + 30,
        ])
        const h = standaloneHeight([s], DEFAULT_STANDALONE_PAD)
        expect(h).toBe(30 + DEFAULT_STANDALONE_PAD * 2)
        expect(Math.max(...ys(s)) + DEFAULT_STANDALONE_PAD).toBe(h)
    })

    test('the pad default matches what drawBlock actually reserves', () => {
        expect(DEFAULT_STANDALONE_PAD).toBe(STANDALONE_PAD)
    })

    test('a caller-supplied pad is honoured', () => {
        const out = planCommit(doc, pen([10, 400, 180, 20, 430, 180]), seams, 3)
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
// A fence directly after the closing `---` scans as ATTACHED. Editor.tsx's autosave then runs
// normalizeFrontmatterSpacing, which inserts a blank line in exactly that spot — the one thing
// scanDrawBlocks uses to decide standalone. Within one save the fence flips mode with no user
// action: the paint origin changes, the widget starts reserving height so every line below
// jumps, and the negative stored y values paint outside the box.
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
