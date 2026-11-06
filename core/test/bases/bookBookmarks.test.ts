import { describe, expect, test } from 'bun:test'
import { bookBookmarks, leafBookmarkTarget } from '../../src/bases/bookBookmarks'
import { expandLeaves, type BookPageRef } from '../../src/bases/bookPages'
import type { DrawingDoc } from '../../src/drawing/model'

const refs: BookPageRef[] = [
    { file: 'a.jpg', kind: 'image', rowIndex: 0 },
    { file: 'b.jpg', kind: 'image', rowIndex: 1 },
    { file: 'c.pdf', kind: 'pdf', rowIndex: 2 },
]
const leaves = expandLeaves(refs, new Map([['c.pdf', 3]]))
const doc = (bookmarks: { id: string; page: number; label: string }[]) =>
    ({ bookmarks }) as unknown as DrawingDoc

describe('bookBookmarks', () => {
    test('maps sidecar bookmarks to leaves in book order', () => {
        const sidecars = new Map<string, DrawingDoc | null>([
            ['c.pdf', doc([{ id: 'p', page: 1, label: 'pdf mark' }])],
            ['b.jpg', doc([{ id: 'i', page: 0, label: 'img mark' }])],
            ['a.jpg', null],
        ])
        const got = bookBookmarks(sidecars, leaves)
        expect(got.map(b => [b.id, b.leaf, b.file, b.page])).toEqual([
            ['i', 1, 'b.jpg', 0],
            ['p', 3, 'c.pdf', 1],
        ])
        expect(got[0]!.label).toBe('img mark')
    })

    test('drops a bookmark on a page the book does not show', () => {
        const sidecars = new Map<string, DrawingDoc | null>([
            ['c.pdf', doc([{ id: 'x', page: 9, label: 'gone' }])],
        ])
        expect(bookBookmarks(sidecars, leaves)).toEqual([])
    })

    test('null or missing sidecar contributes none', () => {
        expect(bookBookmarks(new Map([['a.jpg', null]]), leaves)).toEqual([])
        expect(bookBookmarks(new Map(), leaves)).toEqual([])
    })

    test('leafBookmarkTarget', () => {
        expect(leafBookmarkTarget(leaves[0]!)).toEqual({ file: 'a.jpg', page: 0 })
        expect(leafBookmarkTarget(leaves[4]!)).toEqual({ file: 'c.pdf', page: 2 })
    })
})
