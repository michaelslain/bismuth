import { describe, expect, test } from 'bun:test'
import {
    addBookmark,
    removeBookmark,
    renameBookmark,
    sortedBookmarks,
} from '../../src/drawing/pageBookmarks'
import { emptyDoc, type DrawingDoc } from '../../src/drawing/model'

const withMarks = (): DrawingDoc => ({
    ...emptyDoc(),
    bookmarks: [
        { id: 'a', page: 4, label: 'Four' },
        { id: 'b', page: 1, label: 'One' },
        { id: 'c', page: 4, label: 'Four again' },
    ],
})

describe('addBookmark', () => {
    test('appends with the default label and the given id, without mutating the input', () => {
        const doc = emptyDoc()
        const next = addBookmark(doc, 2, undefined, 'x')
        expect(next.bookmarks).toEqual([{ id: 'x', page: 2, label: 'Page 3' }])
        expect(doc.bookmarks).toBeUndefined()
        expect(next.pages).toBe(doc.pages) // everything else carried through by reference
    })

    test('keeps a caller label and generates distinct ids when none is given', () => {
        const one = addBookmark(emptyDoc(), 0, 'Start')
        const two = addBookmark(one, 0)
        expect(two.bookmarks!.map(b => b.label)).toEqual(['Start', 'Page 1'])
        const [i, j] = two.bookmarks!.map(b => b.id)
        expect(typeof i).toBe('string')
        expect(i!.length).toBeGreaterThan(0)
        expect(i).not.toBe(j)
    })
})

describe('renameBookmark / removeBookmark', () => {
    test('rename touches only the matching id', () => {
        const next = renameBookmark(withMarks(), 'b', 'Opening')
        expect(next.bookmarks!.map(b => b.label)).toEqual([
            'Four',
            'Opening',
            'Four again',
        ])
    })

    test('an unknown id is a no-op for both', () => {
        const doc = withMarks()
        expect(renameBookmark(doc, 'zzz', 'Q').bookmarks).toEqual(doc.bookmarks)
        expect(removeBookmark(doc, 'zzz').bookmarks).toEqual(doc.bookmarks)
    })

    test('remove drops the matching id and leaves the input untouched', () => {
        const doc = withMarks()
        const next = removeBookmark(doc, 'a')
        expect(next.bookmarks!.map(b => b.id)).toEqual(['b', 'c'])
        expect(doc.bookmarks!.length).toBe(3)
    })

    test('a doc with no bookmarks at all survives both', () => {
        expect(renameBookmark(emptyDoc(), 'a', 'x').bookmarks ?? []).toEqual([])
        expect(removeBookmark(emptyDoc(), 'a').bookmarks ?? []).toEqual([])
    })
})

describe('sortedBookmarks', () => {
    test('by page, then insertion order within a page', () => {
        expect(sortedBookmarks(withMarks()).map(b => b.id)).toEqual([
            'b',
            'a',
            'c',
        ])
    })

    test('null doc and a doc without bookmarks are both empty', () => {
        expect(sortedBookmarks(null)).toEqual([])
        expect(sortedBookmarks(emptyDoc())).toEqual([])
    })

    test('does not reorder the stored array', () => {
        const doc = withMarks()
        sortedBookmarks(doc)
        expect(doc.bookmarks!.map(b => b.id)).toEqual(['a', 'b', 'c'])
    })
})
