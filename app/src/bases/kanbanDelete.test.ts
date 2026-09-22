import { expect, test, describe } from 'bun:test'
import { markDeleted, unmarkDeleted, pruneDeleted, isRowHidden } from './kanbanDelete'

describe('markDeleted', () => {
    test('adds an id (no snapshot — a note row) and returns a fresh map', () => {
        const prev = new Map<string, string | undefined>([['a.md', undefined]])
        const next = markDeleted(prev, 'b.md')
        expect(next).not.toBe(prev)
        expect([...next.keys()].sort()).toEqual(['a.md', 'b.md'])
        expect(next.get('b.md')).toBeUndefined()
        expect([...prev.keys()]).toEqual(['a.md']) // prev untouched
    })
    test('adds an id WITH a snapshot (a stored row)', () => {
        const prev = new Map<string, string | undefined>()
        const next = markDeleted(prev, 'b.md#0', '{"title":"card"}')
        expect(next.get('b.md#0')).toBe('{"title":"card"}')
    })
    test('re-adding an already-hidden id overwrites its entry', () => {
        const prev = new Map<string, string | undefined>([['a.md#0', 'old']])
        expect(markDeleted(prev, 'a.md#0', 'new').get('a.md#0')).toBe('new')
    })
})

describe('unmarkDeleted', () => {
    test('removes an id and returns a fresh map', () => {
        const prev = new Map<string, string | undefined>([
            ['a.md', undefined],
            ['b.md', undefined],
        ])
        const next = unmarkDeleted(prev, 'a.md')
        expect(next).not.toBe(prev)
        expect([...next.keys()]).toEqual(['b.md'])
    })
    test("returns the SAME reference when the id wasn't hidden (no needless re-render)", () => {
        const prev = new Map<string, string | undefined>([['a.md', undefined]])
        expect(unmarkDeleted(prev, 'z.md')).toBe(prev)
    })
})

describe('isRowHidden', () => {
    test('a note-row entry (no snapshot) hides by id alone', () => {
        const map = new Map<string, string | undefined>([['a.md', undefined]])
        expect(isRowHidden(map, 'a.md', undefined)).toBe(true)
    })
    test('an id not in the overlay is never hidden', () => {
        const map = new Map<string, string | undefined>()
        expect(isRowHidden(map, 'a.md', undefined)).toBe(false)
    })
    test('a stored-row entry hides only while the CURRENT snapshot at that id still matches', () => {
        const map = new Map<string, string | undefined>([['b.md#0', '{"title":"x"}']])
        expect(isRowHidden(map, 'b.md#0', '{"title":"x"}')).toBe(true)
    })
    test('a stored-row entry does NOT hide a different row shifted into the same id', () => {
        // This is the delete-shifts-indexes bug: row #1 becomes row #0 after an earlier delete.
        // Its content differs from the snapshot of the row that was actually deleted, so it must
        // stay visible instead of being permanently swallowed by the stale id.
        const map = new Map<string, string | undefined>([['b.md#0', '{"title":"deleted"}']])
        expect(isRowHidden(map, 'b.md#0', '{"title":"shifted-in"}')).toBe(false)
    })
})

describe('pruneDeleted', () => {
    test('drops a note-row entry once the server no longer has its id (delete confirmed)', () => {
        const prev = new Map<string, string | undefined>([
            ['gone.md', undefined],
            ['still.md', undefined],
        ])
        const present = new Map<string, string | undefined>([
            ['still.md', undefined],
            ['other.md', undefined],
        ])
        const next = pruneDeleted(prev, present)
        expect(next).not.toBe(prev)
        expect([...next.keys()]).toEqual(['still.md'])
    })
    test('keeps a note-row entry still present in server data (delete not yet confirmed)', () => {
        const prev = new Map<string, string | undefined>([['pending.md', undefined]])
        const present = new Map<string, string | undefined>([['pending.md', undefined]])
        expect(pruneDeleted(prev, present)).toBe(prev) // unchanged → same reference
    })
    test('empty map is a no-op returning the same reference', () => {
        const prev = new Map<string, string | undefined>()
        expect(pruneDeleted(prev, new Map([['x.md', undefined]]))).toBe(prev)
    })
    test('keeps a stored-row entry while the id still carries the deleted row\'s exact snapshot', () => {
        const prev = new Map<string, string | undefined>([['b.md#0', '{"title":"x"}']])
        const present = new Map<string, string | undefined>([['b.md#0', '{"title":"x"}']])
        expect(pruneDeleted(prev, present)).toBe(prev)
    })
    test('THE BUG: prunes a stored-row entry once a shifted sibling lands at its id, even though the id is still present', () => {
        // Deleting row #0 splices the array: what was row #1 refetches as row #0, carrying its
        // OWN content, not the deleted row's. A bare id-presence check would wrongly keep hiding
        // it forever; comparing the snapshot is what lets the shifted survivor show.
        const prev = new Map<string, string | undefined>([['b.md#0', '{"title":"deleted"}']])
        const present = new Map<string, string | undefined>([['b.md#0', '{"title":"shifted-in"}']])
        const next = pruneDeleted(prev, present)
        expect(next).not.toBe(prev)
        expect(next.has('b.md#0')).toBe(false)
    })
    test('prunes a stored-row entry once its id disappears entirely (last row deleted, nothing shifted in)', () => {
        const prev = new Map<string, string | undefined>([['b.md#2', '{"title":"x"}']])
        const present = new Map<string, string | undefined>()
        expect(pruneDeleted(prev, present).has('b.md#2')).toBe(false)
    })
    test('prunes every stale entry at once', () => {
        const prev = new Map<string, string | undefined>([
            ['a', undefined],
            ['b', undefined],
            ['c', undefined],
        ])
        const present = new Map<string, string | undefined>([['b', undefined]])
        expect([...pruneDeleted(prev, present).keys()]).toEqual(['b'])
    })
})
