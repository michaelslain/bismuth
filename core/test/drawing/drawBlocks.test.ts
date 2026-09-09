import { describe, expect, test } from 'bun:test'
import {
    drawFenceKind,
    scanDrawBlocks,
    writeDrawBlock,
    insertDrawBlock,
    removeDrawBlock,
} from '../../src/drawing/drawBlocks'
import { encodeStrokes } from '../../src/drawing/inkCodec'
import type { Stroke } from '../../src/drawing/model'

const strokes: Stroke[] = [{ t: 'pen', c: 'fg', w: 5, pts: [1, 2, 180, 3, 4, 180] }]
const payload = encodeStrokes(strokes)

// A fence's MODE is its info string, never its surroundings: ```draw is attached, ```draw block
// is standalone. The blank line in `standalone` below is now incidental formatting — the marker
// is what decides, and the tests below pin that a blank line changes nothing.
const attached = `Some paragraph.\n\`\`\`draw\n${payload}\n\`\`\`\n\nAfter.\n`
const standalone = `Some paragraph.\n\n\`\`\`draw block\n${payload}\n\`\`\`\n\nAfter.\n`

describe('scanDrawBlocks', () => {
    test('finds a fence and decodes its strokes', () => {
        const [b] = scanDrawBlocks(attached)
        expect(b.strokes).toEqual(strokes)
    })

    test('marks a fence directly under text as attached to that line', () => {
        const [b] = scanDrawBlocks(attached)
        expect(b.attachedToLine).toBe(1)
    })

    test('marks a ```draw block fence standalone', () => {
        const [b] = scanDrawBlocks(standalone)
        expect(b.standalone).toBe(true)
        expect(b.attachedToLine).toBeNull()
    })

    // THE WHOLE POINT OF THE MARKER. A blank line above a fence used to be the only thing that
    // decided its mode, so pressing Enter once at the end of an annotated paragraph detached its
    // annotation and threw it 78px down the page into a newly reserved box. The mode now travels
    // in the fence, and a blank line decides nothing.
    test('a blank line above a ```draw fence does NOT make it standalone', () => {
        const spaced = `Some paragraph.\n\n\`\`\`draw\n${payload}\n\`\`\`\n\nAfter.\n`
        const [b] = scanDrawBlocks(spaced)
        expect(b.standalone).toBe(false)
        // …and it still knows which block it belongs to, across the blank line.
        expect(b.attachedToLine).toBe(1)
    })

    test('attachedToLine skips any number of blank lines above the fence', () => {
        const spaced = `Some paragraph.\n\n\n\n\`\`\`draw\n${payload}\n\`\`\`\n`
        expect(scanDrawBlocks(spaced)[0].attachedToLine).toBe(1)
    })

    test('an attached fence with nothing above it has no block to attach to', () => {
        const doc = `\`\`\`draw\n${payload}\n\`\`\`\n\nAfter.\n`
        const [b] = scanDrawBlocks(doc)
        expect(b.standalone).toBe(false)
        expect(b.attachedToLine).toBeNull()
    })

    test('an unrecognised draw-ish info string is an ordinary code fence', () => {
        expect(drawFenceKind('draw')).toBe('attached')
        expect(drawFenceKind('draw block')).toBe('standalone')
        expect(drawFenceKind('  draw   block ')).toBe('standalone')
        expect(drawFenceKind('drawing')).toBeNull()
        expect(drawFenceKind('draw blocks')).toBeNull()
        expect(
            scanDrawBlocks(`\`\`\`drawing\n${payload}\n\`\`\`\n`),
        ).toEqual([])
    })

    test('ignores a fence that is not a draw fence', () => {
        expect(scanDrawBlocks('```ts\nconst x = 1\n```\n')).toEqual([])
    })

    test('finds several fences in one document', () => {
        expect(scanDrawBlocks(attached + standalone)).toHaveLength(2)
    })

    test('reports fromLine/toLine as the 1-based inclusive fence range', () => {
        const [b] = scanDrawBlocks(attached)
        // line 1: "Some paragraph.", line 2: "```draw", line 3: payload, line 4: "```"
        expect(b.fromLine).toBe(2)
        expect(b.toLine).toBe(4)
    })

    // The plan's own test here only asserted `not.toThrow()`, which would pass even if the
    // function silently swallowed the fence and returned []. Strengthened to assert the fence
    // is actually found and its strokes decoded, since "survives" should mean "recovers usable
    // data", not merely "doesn't crash".
    test('survives an unterminated fence without throwing, and still recovers it', () => {
        const doc = 'Some paragraph.\n```draw\n' + payload + '\n'
        let result: ReturnType<typeof scanDrawBlocks> = []
        expect(() => {
            result = scanDrawBlocks(doc)
        }).not.toThrow()
        expect(result).toHaveLength(1)
        expect(result[0].strokes).toEqual(strokes)
        // the fence runs to the end of the document since it never closes
        expect(result[0].toLine).toBe(doc.split('\n').length)
    })

    // Not in the plan's test list. The plan's implementation notes explicitly require that a
    // corrupt base64 payload yields `strokes: []` for that one block rather than throwing and
    // aborting the whole scan — otherwise one bad blob makes an entire note unreadable. This is
    // load-bearing for user data and was previously untested.
    test('a corrupt payload decodes to an empty stroke list instead of throwing', () => {
        const corrupt = `Some paragraph.\n\`\`\`draw\nnot-valid-base64!!!\n\`\`\`\n\nAfter.\n`
        let result: ReturnType<typeof scanDrawBlocks> = []
        expect(() => {
            result = scanDrawBlocks(corrupt)
        }).not.toThrow()
        expect(result).toHaveLength(1)
        expect(result[0].strokes).toEqual([])
    })

    // A second corruption shape: syntactically valid base64 that decodes to bytes too short /
    // structurally wrong for the codec (decodeStrokes throws "drawing payload too short" or an
    // unknown-version error). Same contract should hold.
    test('a structurally invalid payload also decodes to an empty stroke list', () => {
        const corrupt = `Some paragraph.\n\`\`\`draw\nQQ==\n\`\`\`\n\nAfter.\n`
        const result = scanDrawBlocks(corrupt)
        expect(result).toHaveLength(1)
        expect(result[0].strokes).toEqual([])
    })

    // Fix round, item 1 (BLOCKING). A draw-shaped fence nested inside a WIDER outer fence
    // (opened with 4+ backticks, per CommonMark) is legal markdown that never actually opens a
    // draw fence — it is quoted example text. The naive line-by-line scanner treated every
    // ```draw-looking line as live, which would let the editor rewrite content inside a user's
    // code sample. A note documenting this very feature is the obvious way to hit it.
    test('a draw fence nested inside a wider backtick fence is not detected', () => {
        const doc =
            'Some paragraph.\n\n' +
            '````markdown\n' +
            'Example:\n' +
            '```draw\n' +
            payload +
            '\n```\n' +
            '````\n\n' +
            'After.\n'
        expect(scanDrawBlocks(doc)).toEqual([])
    })

    // Same case with a tilde-delimited outer fence, which CommonMark also allows and which
    // cannot be closed by a backtick run (different fence characters never match).
    test('a draw fence nested inside a tilde-delimited fence is not detected', () => {
        const doc =
            'Some paragraph.\n\n' +
            '~~~markdown\n' +
            'Example:\n' +
            '```draw\n' +
            payload +
            '\n```\n' +
            '~~~\n\n' +
            'After.\n'
        expect(scanDrawBlocks(doc)).toEqual([])
    })

    // Two draw fences back to back. Each carries its own mode, so neither can be flipped by
    // where the other happens to end.
    test('back-to-back fences each keep their own declared mode', () => {
        const doc = `\`\`\`draw block\n${payload}\n\`\`\`\n\`\`\`draw\n${payload}\n\`\`\`\n\nAfter.\n`
        const blocks = scanDrawBlocks(doc)
        expect(blocks).toHaveLength(2)
        expect(blocks.map(b => b.standalone)).toEqual([true, false])
    })
})

describe('writeDrawBlock', () => {
    test('replaces only the payload and leaves surrounding text byte-identical', () => {
        const [b] = scanDrawBlocks(attached)
        const next: Stroke[] = [{ t: 'pen', c: 'fg', w: 9, pts: [7, 8, 200, 9, 10, 200] }]
        const out = writeDrawBlock(attached, b, next)
        expect(out.startsWith('Some paragraph.\n')).toBe(true)
        expect(out.endsWith('\nAfter.\n')).toBe(true)
        expect(scanDrawBlocks(out)[0].strokes).toEqual(next)
    })

    // Fix round, item 3 (fold in). A CRLF document should stay CRLF around the rewritten
    // payload line too — writing a bare "\n"-only payload line into an otherwise-CRLF file
    // would leave one LF-only line the module was never asked to touch.
    test('preserves CRLF line endings around the rewritten payload', () => {
        const crlf = `Some paragraph.\r\n\`\`\`draw\r\n${payload}\r\n\`\`\`\r\n\r\nAfter.\r\n`
        const [b] = scanDrawBlocks(crlf)
        const next: Stroke[] = [{ t: 'pen', c: 'fg', w: 9, pts: [7, 8, 200, 9, 10, 200] }]
        const out = writeDrawBlock(crlf, b, next)
        expect(out).toBe(
            `Some paragraph.\r\n\`\`\`draw\r\n${encodeStrokes(next)}\r\n\`\`\`\r\n\r\nAfter.\r\n`,
        )
    })

    // Fix round, item 3 (fold in). A fence indented inside a list item keeps its payload line
    // indented the same way as the fence markers, rather than losing it on rewrite.
    test('preserves the payload line indentation', () => {
        const indented = `- item\n\t\`\`\`draw\n\t${payload}\n\t\`\`\`\n`
        const [b] = scanDrawBlocks(indented)
        const next: Stroke[] = [{ t: 'pen', c: 'fg', w: 9, pts: [7, 8, 200, 9, 10, 200] }]
        const out = writeDrawBlock(indented, b, next)
        expect(out).toBe(`- item\n\t\`\`\`draw\n\t${encodeStrokes(next)}\n\t\`\`\`\n`)
    })
})

describe('insertDrawBlock', () => {
    test('inserts a fence after the named line and round-trips', () => {
        const out = insertDrawBlock('One.\n\nTwo.\n', 1, strokes)
        const [b] = scanDrawBlocks(out)
        expect(b.strokes).toEqual(strokes)
        expect(b.attachedToLine).toBe(1)
    })

    // writeDrawBlock already matches the document's line ending when it replaces a payload;
    // inserting has the same obligation. A bare-LF fence dropped into a CRLF note leaves three
    // mixed-ending lines mid-file — invisible until something normalizes the file and the whole
    // note shows up as a diff.
    test('matches a CRLF document line ending', () => {
        const out = insertDrawBlock('One.\r\n\r\nTwo.\r\n', 1, strokes)
        expect(out.split('\n').every(l => l === '' || l.endsWith('\r'))).toBe(
            true,
        )
        expect(out).not.toMatch(/[^\r]\n/)
        const [b] = scanDrawBlocks(out)
        expect(b.strokes).toEqual(strokes)
        expect(b.attachedToLine).toBe(1)
    })

    test('writes the standalone marker only when asked', () => {
        const attachedOut = insertDrawBlock('One.\n\nTwo.\n', 1, strokes)
        expect(attachedOut).toContain('```draw\n')
        expect(scanDrawBlocks(attachedOut)[0].standalone).toBe(false)
        const standaloneOut = insertDrawBlock('One.\n\nTwo.\n', 1, strokes, true)
        expect(standaloneOut).toContain('```draw block\n')
        expect(scanDrawBlocks(standaloneOut)[0].standalone).toBe(true)
    })

    test('leaves an LF document on LF', () => {
        const out = insertDrawBlock('One.\n\nTwo.\n', 1, strokes)
        expect(out).not.toContain('\r')
    })
})

describe('removeDrawBlock', () => {
    test('removes an attached fence and leaves the prose intact', () => {
        const [b] = scanDrawBlocks(attached)
        expect(removeDrawBlock(attached, b)).toBe('Some paragraph.\n\nAfter.\n')
    })

    // Fix round, item 2 (BLOCKING). A standalone fence is sandwiched between two blank lines
    // (one separating it from the paragraph above, one from the paragraph below). Removing
    // just the fence lines left both blank lines behind, doubling the separator. This test
    // covers exactly the standalone case the plan's original test never exercised — the
    // attached case above happens to collapse correctly on its own, which is why the gap was
    // invisible.
    test('removes a standalone fence without leaving a doubled blank line', () => {
        const [b] = scanDrawBlocks(standalone)
        expect(removeDrawBlock(standalone, b)).toBe('Some paragraph.\n\nAfter.\n')
    })

    // The blank-line swallow keys on the fence's declared mode, not on what precedes it: an
    // ATTACHED fence that happens to sit under a blank line must keep that blank line, because
    // it is the user's paragraph break and not a separator this module put there.
    test('keeps the blank line above an attached fence', () => {
        const spaced = `Some paragraph.\n\n\`\`\`draw\n${payload}\n\`\`\`\n\nAfter.\n`
        const [b] = scanDrawBlocks(spaced)
        expect(removeDrawBlock(spaced, b)).toBe(
            'Some paragraph.\n\n\nAfter.\n',
        )
    })
})
