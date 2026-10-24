// Which trees count as passed (scripts/passCache.ts).
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isGreen, readPasses, recordPass, type PassRecord } from './passCache'

const rec = (r: Partial<PassRecord> & { tree: string }): PassRecord => ({
    tier: 'fast',
    bun: '1.0.0',
    at: '2026-01-01T00:00:00Z',
    ...r,
})

describe('isGreen', () => {
    test('a full pass makes its tree green', () => {
        expect(isGreen('t1', 'fast', [rec({ tree: 't1' })], '1.0.0')).toBe(true)
        expect(isGreen('t2', 'fast', [rec({ tree: 't1' })], '1.0.0')).toBe(
            false,
        )
    })

    test('a selection pass counts only when its base is green, through any length of chain', () => {
        const chain = [
            rec({ tree: 't3', base: 't2' }),
            rec({ tree: 't2', base: 't1' }),
        ]
        expect(isGreen('t3', 'fast', chain, '1.0.0')).toBe(false)
        expect(
            isGreen('t3', 'fast', [...chain, rec({ tree: 't1' })], '1.0.0'),
        ).toBe(true)
    })

    test('a full-tier pass covers the fast tier, not the other way round', () => {
        expect(
            isGreen('t1', 'fast', [rec({ tree: 't1', tier: 'full' })], '1.0.0'),
        ).toBe(true)
        expect(isGreen('t1', 'full', [rec({ tree: 't1' })], '1.0.0')).toBe(
            false,
        )
    })

    test('a record from another Bun version does not count', () => {
        expect(isGreen('t1', 'fast', [rec({ tree: 't1' })], '2.0.0')).toBe(
            false,
        )
    })

    test('a cycle of selection passes is not green', () => {
        const cycle = [
            rec({ tree: 'a', base: 'b' }),
            rec({ tree: 'b', base: 'a' }),
        ]
        expect(isGreen('a', 'fast', cycle, '1.0.0')).toBe(false)
    })
})

test('recordPass appends a line readPasses returns, stamped with the Bun version', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'bismuth-passes-')), 'p.jsonl')
    recordPass({ tree: 'abc', tier: 'fast', base: 'def' }, file)
    recordPass({ tree: 'ghi', tier: 'full' }, file)
    const all = readPasses(file)
    expect(all.map(p => [p.tree, p.tier, p.base])).toEqual([
        ['abc', 'fast', 'def'],
        ['ghi', 'full', undefined],
    ])
    expect(all[0].bun).toBe(Bun.version)
})
