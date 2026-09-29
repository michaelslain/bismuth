import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { Row } from '../../../core/src/bases/types'
import { api } from '../api'
import {
    groupUpdatesByPath,
    rollbackPending,
    rollbackRemoved,
    writeStatus,
} from './kanbanRollback'

// Spies on the real `api` (restored after each test) — never `mock.module`, which is process-wide
// in Bun and would leak a fake `../api` into every other test file.
const calls: Array<[string, ...unknown[]]> = []
const spies: Array<{ mockRestore: () => void }> = []
beforeEach(() => {
    calls.length = 0
    const rec = (k: string) => async (...a: unknown[]) => void calls.push([k, ...a])
    spies.push(
        spyOn(api, 'rowUpdateMany').mockImplementation(rec('many') as never),
        spyOn(api, 'setProperties').mockImplementation(rec('set') as never),
        spyOn(api, 'deleteProperty').mockImplementation(rec('del') as never),
    )
})
afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore()
})

const stored = (path: string, index: number, note: object) =>
    ({ file: { path }, index, note, stored: true }) as unknown as Row
const noteRow = (path: string) =>
    ({ file: { path }, note: { status: 'a' } }) as unknown as Row

describe('writeStatus', () => {
    test('stored rows grouped per file, note rows via setProperties', async () => {
        calls.length = 0
        const rows = [stored('a.md', 0, { x: 1 }), stored('b.md', 2, {}), stored('a.md', 1, {}), noteRow('n.md')]
        await writeStatus(rows, 'status', 'done')
        const many = calls.filter(c => c[0] === 'many')
        const set = calls.filter(c => c[0] === 'set')
        expect(many).toHaveLength(2)
        expect(many.map(c => c[1]).sort()).toEqual(['a.md', 'b.md'])
        expect(many.find(c => c[1] === 'a.md')![2]).toEqual([
            { index: 0, note: { x: 1, status: 'done' } },
            { index: 1, note: { status: 'done' } },
        ])
        expect(set).toHaveLength(1)
        expect(set[0][1]).toEqual([{ path: 'n.md', key: 'status', value: 'done' }])
    })

    test('undefined deletes the key per note row and strips it from stored notes', async () => {
        calls.length = 0
        await writeStatus([noteRow('n.md'), noteRow('m.md')], 'status', undefined)
        expect(calls.filter(c => c[0] === 'del')).toEqual([
            ['del', 'n.md', 'status'],
            ['del', 'm.md', 'status'],
        ])
        expect(calls.some(c => c[0] === 'set')).toBe(false)
    })
})

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
