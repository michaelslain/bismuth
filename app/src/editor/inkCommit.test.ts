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
const seams: Seam[] = [
    { y: 100, afterLine: 1 },
    { y: 200, afterLine: 3 },
]

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
    // time top-down is the shipped bug this exists to prevent: the first fence adds three lines,
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
        expect(ys(blocks[0].strokes[0])).toEqual([20 - 100, 40 - 100])
        expect(ys(blocks[1].strokes[0])).toEqual([150 - 200, 170 - 200])
    })

    test('several strokes into one block keep the order they were drawn', () => {
        const out = planCommitStrokes(
            doc,
            [pen([10, 20, 180, 20, 40, 180]), pen([30, 20, 180, 40, 40, 180])],
            seams,
        )
        const [b] = scanDrawBlocks(out)
        expect(b.strokes.map(xs)).toEqual([
            [10, 20],
            [30, 40],
        ])
    })
})

describe('planCommit — where inside the fence the ink lands', () => {
    // An attached fence's widget top IS the owning block's bottom, so the ink is stored as an
    // offset from that seam: negative for ink drawn over the paragraph. Get this wrong and the
    // drawing paints hundreds of pixels away from the words it annotates.
    test('rebases y against the owning block bottom and leaves x absolute', () => {
        const out = planCommit(doc, pen([10, 20, 180, 20, 40, 180]), seams)
        const [s] = scanDrawBlocks(out)[0].strokes
        expect(ys(s)).toEqual([20 - 100, 40 - 100])
        expect(xs(s)).toEqual([10, 20])
    })

    test('an explicit origin overrides the default of the seam y', () => {
        const withOrigin: Seam[] = [{ y: 100, afterLine: 1, origin: 60 }]
        const out = planCommit(doc, pen([10, 20, 180, 20, 40, 180]), withOrigin)
        const [s] = scanDrawBlocks(out)[0].strokes
        expect(ys(s)).toEqual([20 - 60, 40 - 60])
    })

    // The two halves of a cut stroke must still MEET on screen. Each is stored against its own
    // fence's origin, so the seam point reads as `100 - origin` in one frame and `100 - origin`
    // in the other — different numbers, same absolute y. That is the invariant, and it is the
    // thing a naive "store absolute in both" implementation gets wrong.
    test('the two halves of a cut stroke meet at the seam once re-based', () => {
        const out = planCommit(doc, pen([10, 50, 180, 10, 150, 180]), seams)
        const [top, bottom] = scanDrawBlocks(out).map(b => b.strokes[0])
        const lastOfTop = ys(top)[ys(top).length - 1] + 100 // + origin of seam 0
        const firstOfBottom = ys(bottom)[0] + 200 // + origin of seam 1
        expect(lastOfTop).toBe(100)
        expect(firstOfBottom).toBe(100)
    })

    test('appending into an existing standalone fence uses that fence own origin', () => {
        // Build a standalone fence first, from a stroke in the trailing band…
        const first = planCommit(doc, pen([10, 400, 180, 20, 430, 180]), seams)
        const block = scanDrawBlocks(first)[0]
        // …then describe it as its own band: the blank line above it is where its fence lives,
        // its widget top is 300 and its widget bottom (the cut) is 400.
        const withDrawing: Seam[] = [
            ...seams,
            { y: 400, afterLine: block.fromLine - 1, origin: 300 },
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

    // A fence being created from nothing has no widget to measure, so the ink is normalized to
    // sit `pad` below the (future) widget top. `standaloneHeight` reserves `pad` on both sides,
    // so this is the assertion that the drawing lands INSIDE the box the editor draws for it.
    test('a new standalone fence is normalized to sit pad below its widget top', () => {
        const stroke = pen([10, 400, 180, 20, 430, 180])
        const out = planCommit(doc, stroke, seams)
        const [s] = scanDrawBlocks(out)[0].strokes
        expect(ys(s)).toEqual([
            DEFAULT_STANDALONE_PAD,
            DEFAULT_STANDALONE_PAD + 30,
        ])
        // …and the reserved height covers it with the same pad left underneath.
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
        // Rounded to [10, 21, 180, 21, 41, 180], then re-based by the seam origin of 100.
        expect(s.pts).toEqual([10, -79, 180, 21, -59, 180])
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

    test('a fence inserted under a code block is standalone, not glued to its close marker', () => {
        // The line above the insertion point is a ``` marker, which scanDrawBlocks reads as
        // standalone. planCommit must agree, or it stores ink against an origin the editor
        // never uses.
        const withCode = 'Intro.\n\n```ts\nconst x = 1\n```\n'
        const codeSeams: Seam[] = [
            { y: 50, afterLine: 1 },
            { y: 200, afterLine: 5 },
        ]
        const out = planCommit(
            withCode,
            pen([10, 120, 180, 20, 150, 180]),
            codeSeams,
        )
        const [b] = scanDrawBlocks(out)
        expect(b.attachedToLine).toBeNull()
        expect(ys(b.strokes[0])).toEqual([
            DEFAULT_STANDALONE_PAD,
            DEFAULT_STANDALONE_PAD + 30,
        ])
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
