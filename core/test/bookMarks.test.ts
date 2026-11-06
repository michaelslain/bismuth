import { describe, expect, test } from 'bun:test'
import { addMarks, linesInRegion, marksOnPage, removeMarks, stripMarks } from '../src/bookMarks'
import { mergeTranscript } from '../src/transcript'

const NOW = new Date('2026-10-31T12:00:00.000Z')
const pdf = () =>
    mergeTranscript(
        '---\ntags: [milk]\n---\nmilk in my note\n',
        [
            { page: 1, text: 'buy milk\nand eggs' },
            { page: 2, text: 'milk again\nmilk twice' },
        ],
        'on-device',
        'pdf',
        NOW,
    )

describe('addMarks', () => {
    test('wraps the first occurrence on that page only', () => {
        const out = addMarks(pdf(), 2, ['milk'])
        expect(out).toContain('==milk== again\nmilk twice')
        expect(out).toContain('buy milk\nand eggs')
        expect(out).toContain('tags: [milk]')
        expect(out).toContain('milk in my note')
        expect(out.match(/==/g)!.length).toBe(2)
    })
    test('skips a missing quote and does not double-wrap', () => {
        const once = addMarks(pdf(), 1, ['eggs', 'nope'])
        expect(once).toContain('and ==eggs==')
        expect(addMarks(once, 1, ['eggs'])).toBe(once)
    })
    test('a second quote on the same words marks the next unmarked occurrence', () => {
        const out = addMarks(addMarks(pdf(), 2, ['milk']), 2, ['milk'])
        expect(out).toContain('==milk== again\n==milk== twice')
    })
    test('a quote spanning a laid-out newline marks each line and removes cleanly', () => {
        const base = pdf()
        const out = addMarks(base, 1, ['milk and'])
        expect(out).toContain('buy ==milk==\n==and== eggs')
        expect(marksOnPage(out, 1)).toEqual(['milk', 'and'])
        expect(removeMarks(out, 1, ['milk and'])).toBe(base)
    })
    test('a quote with regex metacharacters matches literally', () => {
        const md = mergeTranscript('', [{ page: 1, text: 'a (b) c' }], 'on-device', 'image', NOW)
        expect(addMarks(md, 1, ['(b)'])).toContain('a ==(b)== c')
    })
    test('a lone image page has no heading', () => {
        const md = mergeTranscript('', [{ page: 1, text: 'one two' }], 'on-device', 'image', NOW)
        expect(addMarks(md, 1, ['two'])).toContain('one ==two==')
        expect(addMarks(md, 2, ['two'])).toBe(md)
    })
})

describe('removeMarks and marksOnPage', () => {
    test('removeMarks restores the exact prior text', () => {
        const base = pdf()
        const marked = addMarks(base, 1, ['milk', 'eggs'])
        expect(marksOnPage(marked, 1)).toEqual(['milk', 'eggs'])
        expect(marksOnPage(marked, 2)).toEqual([])
        expect(removeMarks(marked, 1, ['milk', 'eggs'])).toBe(base)
    })
})

describe('mark edge cases', () => {
    test('a highlight with a double space inside can be removed by the collapsed quote', () => {
        const base = pdf().replace('buy milk', 'buy oat  milk')
        const marked = addMarks(base, 1, ['oat milk'])
        expect(marked).toContain('==oat  milk==')
        expect(removeMarks(marked, 1, ['oat milk'])).toBe(base)
    })

    test('a stray == in text is not a mark', () => {
        const base = pdf().replace('buy milk', 'a == b and c == d')
        expect(marksOnPage(base, 1)).toEqual([])
        expect(stripMarks('a == b and ==x== c ==')).toBe('a == b and x c ==')
    })
})

describe('linesInRegion', () => {
    const lines = [
        { text: 'low', x: 0.1, y: 0.6, w: 0.5, h: 0.1 },
        { text: 'top', x: 0.1, y: 0.1, w: 0.5, h: 0.1 },
        { text: 'graze', x: 0.1, y: 0.28, w: 0.5, h: 0.1 },
        { text: 'half', x: 0.1, y: 0.25, w: 0.5, h: 0.1 },
    ]
    test('keeps lines overlapping 30% of their height, top to bottom', () => {
        const got = linesInRegion(lines, { x: 0, y: 0, w: 1, h: 0.3 })
        expect(got).toEqual(['top', 'half'])
    })
    test('a line outside sideways is dropped', () => {
        expect(linesInRegion(lines, { x: 0.8, y: 0, w: 0.2, h: 1 })).toEqual([])
    })
})
