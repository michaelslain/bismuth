import { describe, expect, it } from 'bun:test'
import { firstLeafId, paneGrid, type GridNode } from './paneGrid'

const run = (...flags: string[]) =>
    Bun.spawnSync(['bun', 'run', `${import.meta.dir}/manyPanes.ts`, ...flags], { stderr: 'pipe', stdout: 'pipe' })

const leaves = (n: GridNode): string[] => (n.kind === 'leaf' ? [n.content] : [...leaves(n.a), ...leaves(n.b)])
const depth = (n: GridNode): number => (n.kind === 'leaf' ? 0 : 1 + Math.max(depth(n.a), depth(n.b)))

describe('manyPanes flags', () => {
    it('exits non-zero naming the missing --base and --api rather than defaulting to :6006', () => {
        const r = run('--layout', 'mix')
        expect(r.exitCode).toBe(2)
        const err = new TextDecoder().decode(r.stderr)
        expect(err).toContain('--base')
        expect(err).toContain('--api')
    })

    it('refuses an unknown layout instead of measuring a different one', () => {
        const r = run('--base', 'http://localhost:1', '--api', 'http://localhost:2', '--layout', 'nope')
        expect(r.exitCode).toBe(2)
        expect(new TextDecoder().decode(r.stderr)).toContain('--layout')
    })
})

describe('paneGrid', () => {
    it('keeps every pane, in order, in a balanced tree of alternating splits', () => {
        const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
        const g = paneGrid(items)
        expect(leaves(g)).toEqual(items)
        expect(depth(g)).toBe(3)
        expect(g.kind === 'split' && g.dir).toBe('row')
        expect(g.kind === 'split' && g.a.kind === 'split' && g.a.dir).toBe('col')
    })

    it('sizes each split by how many panes each side holds, and ids are unique', () => {
        const g = paneGrid(['a', 'b', 'c'])
        expect(g.kind === 'split' && g.ratio).toBeCloseTo(2 / 3)
        const ids: string[] = []
        const walk = (n: GridNode) => (ids.push(n.id), n.kind === 'split' && (walk(n.a), walk(n.b)))
        walk(g)
        expect(new Set(ids).size).toBe(ids.length)
        expect(firstLeafId(g)).toBe(ids.find(i => i.startsWith('l')))
    })

    it('makes one pane a lone leaf', () => {
        expect(paneGrid(['x'])).toEqual({ kind: 'leaf', id: 'l0', content: 'x' })
    })
})
