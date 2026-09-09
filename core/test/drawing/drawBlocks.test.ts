import { describe, expect, test } from 'bun:test'
import {
    scanDrawBlocks,
    writeDrawBlock,
    insertDrawBlock,
    removeDrawBlock,
} from '../../src/drawing/drawBlocks'
import { encodeStrokes } from '../../src/drawing/inkCodec'
import type { Stroke } from '../../src/drawing/model'

const strokes: Stroke[] = [{ t: 'pen', c: 'fg', w: 5, pts: [1, 2, 180, 3, 4, 180] }]
const payload = encodeStrokes(strokes)

const attached = `Some paragraph.\n\`\`\`draw\n${payload}\n\`\`\`\n\nAfter.\n`
const standalone = `Some paragraph.\n\n\`\`\`draw\n${payload}\n\`\`\`\n\nAfter.\n`

describe('scanDrawBlocks', () => {
    test('finds a fence and decodes its strokes', () => {
        const [b] = scanDrawBlocks(attached)
        expect(b.strokes).toEqual(strokes)
    })

    test('marks a fence directly under text as attached to that line', () => {
        const [b] = scanDrawBlocks(attached)
        expect(b.attachedToLine).toBe(1)
    })

    test('marks a fence after a blank line as standalone', () => {
        const [b] = scanDrawBlocks(standalone)
        expect(b.attachedToLine).toBeNull()
    })

    test('marks a fence at the start of the document as standalone', () => {
        const doc = `\`\`\`draw\n${payload}\n\`\`\`\n\nAfter.\n`
        const [b] = scanDrawBlocks(doc)
        expect(b.attachedToLine).toBeNull()
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

    // Fix round, item 4. Two draw fences back to back with no blank line between them: the
    // second fence's "preceding line" is the first fence's own closing ``` marker, which is
    // not content it could decorate.
    test('a fence directly following another fence (no blank line) is standalone', () => {
        const doc = `\`\`\`draw\n${payload}\n\`\`\`\n\`\`\`draw\n${payload}\n\`\`\`\n\nAfter.\n`
        const blocks = scanDrawBlocks(doc)
        expect(blocks).toHaveLength(2)
        expect(blocks[1].attachedToLine).toBeNull()
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
})
