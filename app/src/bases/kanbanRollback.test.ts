import { describe, expect, test } from 'bun:test'
import {
    groupUpdatesByPath,
    rollbackPending,
    rollbackRemoved,
} from './kanbanRollback'

describe('groupUpdatesByPath', () => {
    test('groups items by path, insertion-ordered', () => {
        const items = [
            { path: 'b.md', v: 1 },
            { path: 'a.md', v: 2 },
            { path: 'b.md', v: 3 },
        ]
        const out = groupUpdatesByPath(items)
        expect([...out.keys()]).toEqual(['b.md', 'a.md'])
        expect(out.get('b.md')).toEqual([
            { path: 'b.md', v: 1 },
            { path: 'b.md', v: 3 },
        ])
        expect(out.get('a.md')).toEqual([{ path: 'a.md', v: 2 }])
    })

    test('empty input yields empty map', () => {
        expect(groupUpdatesByPath([]).size).toBe(0)
    })
})

describe('rollbackPending', () => {
    test('removes keys whose value is still the one this call wrote', () => {
        const mineA = { key: 'a', order: 0 }
        const mineB = { key: 'b', order: 1 }
        const written = { x: mineA, y: mineB }
        const current = { x: mineA, y: mineB, z: { key: 'c', order: 2 } }
        const out = rollbackPending(current, written)
        expect(out).toEqual({ z: { key: 'c', order: 2 } })
    })

    test('keeps a key another call overwrote since (not === anymore)', () => {
        const mineA = { key: 'a', order: 0 }
        const written = { x: mineA }
        const overwritten = { key: 'a-overwritten', order: 5 }
        const current = { x: overwritten }
        const out = rollbackPending(current, written)
        expect(out).toEqual({ x: overwritten })
    })

    test('keeps a key another call deleted since (missing from current)', () => {
        const mineA = { key: 'a', order: 0 }
        const written = { x: mineA }
        const current = {}
        const out = rollbackPending(current, written)
        expect(out).toEqual({})
    })

    test('does not mutate current', () => {
        const mineA = { key: 'a', order: 0 }
        const written = { x: mineA }
        const current = { x: mineA, y: { key: 'b', order: 1 } }
        rollbackPending(current, written)
        expect(current).toEqual({ x: mineA, y: { key: 'b', order: 1 } })
    })
})

describe('rollbackRemoved', () => {
    test('removes the added key, returns a new Set', () => {
        const current = new Set(['a', 'b'])
        const out = rollbackRemoved(current, 'a')
        expect(out).toEqual(new Set(['b']))
        expect(out).not.toBe(current)
    })

    test('added null returns current itself (no-op)', () => {
        const current = new Set(['a', 'b'])
        const out = rollbackRemoved(current, null)
        expect(out).toBe(current)
    })

    test('added key not present in current is a no-op removal', () => {
        const current = new Set(['a'])
        const out = rollbackRemoved(current, 'z')
        expect(out).toEqual(new Set(['a']))
    })
})
