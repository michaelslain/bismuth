import { describe, expect, test } from 'bun:test'
import { markSpanAt, quotesFromSelection, type SelectionLine } from './bookSelection'

const line = (page: number, text: string, runs?: { length: number; mark: boolean }[], file = 'a.png'): SelectionLine => ({
    file,
    page,
    text,
    runs,
})

describe('quotesFromSelection', () => {
    const lines = [
        line(1, 'I went to the woods because'),
        line(1, 'I wished to live deliberately,'),
        line(1, 'to front only the essential'),
        line(1, 'facts of life', undefined, 'b.png'),
    ]

    test('a selection inside one line is one quote', () => {
        expect(quotesFromSelection(lines, { line: 0, offset: 2 }, { line: 0, offset: 6 })).toEqual([
            { file: 'a.png', page: 1, quote: 'went' },
        ])
    })

    test('a selection over two lines of a page joins them with a space', () => {
        expect(quotesFromSelection(lines, { line: 0, offset: 20 }, { line: 1, offset: 8 })).toEqual([
            { file: 'a.png', page: 1, quote: 'because I wished' },
        ])
    })

    test('a selection across two notebook pages is one quote each', () => {
        expect(quotesFromSelection(lines, { line: 2, offset: 14 }, { line: 3, offset: 5 })).toEqual([
            { file: 'a.png', page: 1, quote: 'the essential' },
            { file: 'b.png', page: 1, quote: 'facts' },
        ])
    })

    test('the end points may come in either order and an empty selection gives nothing', () => {
        expect(quotesFromSelection(lines, { line: 0, offset: 6 }, { line: 0, offset: 2 })).toEqual([
            { file: 'a.png', page: 1, quote: 'went' },
        ])
        expect(quotesFromSelection(lines, { line: 1, offset: 3 }, { line: 1, offset: 3 })).toEqual([])
    })
})

describe('quotesFromSelection over marks', () => {
    const l = [line(1, 'plain marked more', [{ length: 6, mark: false }, { length: 6, mark: true }, { length: 5, mark: false }])]

    test('a selection over a mark gives a quote each side', () => {
        expect(quotesFromSelection(l, { line: 0, offset: 0 }, { line: 0, offset: 17 }).map(q => q.quote)).toEqual(['plain', 'more'])
    })

    test('a selection inside a mark gives nothing', () => {
        expect(quotesFromSelection(l, { line: 0, offset: 7 }, { line: 0, offset: 11 })).toEqual([])
    })

    test('a selection starting in a mark gives only the part after', () => {
        expect(quotesFromSelection(l, { line: 0, offset: 8 }, { line: 0, offset: 17 }).map(q => q.quote)).toEqual(['more'])
    })
})

describe('markSpanAt', () => {
    const marked = [
        line(1, 'plain words here', [{ length: 12, mark: false }, { length: 4, mark: true }]),
        line(1, 'and more plain', [{ length: 8, mark: true }, { length: 6, mark: false }]),
    ]

    test('a click on a marked run gives the whole span, followed across the line break', () => {
        expect(markSpanAt(marked, 0, 13)).toEqual({ file: 'a.png', page: 1, quote: 'here and more' })
        expect(markSpanAt(marked, 1, 2)).toEqual({ file: 'a.png', page: 1, quote: 'here and more' })
    })

    test('a click on an unmarked character gives nothing', () => {
        expect(markSpanAt(marked, 0, 3)).toBeNull()
        expect(markSpanAt(marked, 1, 12)).toBeNull()
    })
})
