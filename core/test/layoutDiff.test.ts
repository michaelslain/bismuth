import { test, expect } from 'bun:test'
import {
    diffPlan,
    idRenamer,
    remapSeed,
    sortedEdgeKeys,
    splitEdgeKey,
    type Layout,
} from '../src/layoutDiff'
import type { GraphData } from '../src/graph'
import type { Positions } from '../src/layout'

// Pure diff over hand-built seeds: no layout is computed, so every expectation is exact.

function graph(ids: string[], edges: [string, string][]): GraphData {
    return {
        nodes: ids.map(id => ({ id, label: id, kind: 'note' as const })),
        edges: edges.map(([from, to]) => ({ from, to, kind: 'link' as const })),
    }
}

function positions(ids: string[]): Positions {
    return Object.fromEntries(ids.map((id, i) => [id, [i, i * 2, i * 3]]))
}

/** The seed a build of `g` leaves behind: a position per node plus the graph's edge keys. */
function seedOf(g: GraphData): Layout {
    const ids = g.nodes.map(n => n.id)
    return {
        pos3d: positions(ids),
        pos2d: positions(ids),
        edges: sortedEdgeKeys(g),
    }
}

const base = () =>
    graph(
        ['A', 'B', 'C'],
        [
            ['A', 'B'],
            ['B', 'C'],
        ],
    )

test('a pure add makes exactly the added node movable', () => {
    const next = graph(
        ['A', 'B', 'C', 'D'],
        [
            ['A', 'B'],
            ['B', 'C'],
        ],
    )
    expect(diffPlan(seedOf(base()), next)).toEqual({
        movable: ['D'],
        fixed: ['A', 'B', 'C'],
        removed: [],
    })
})

test('removing a node makes nobody movable', () => {
    const next = graph(['A', 'B'], [['A', 'B']]) // C and its edge B→C are gone
    expect(diffPlan(seedOf(base()), next)).toEqual({
        movable: [],
        fixed: ['A', 'B'],
        removed: ['C'],
    })
})

test('an edge added between survivors makes exactly its two endpoints movable', () => {
    const next = graph(
        ['A', 'B', 'C'],
        [
            ['A', 'B'],
            ['B', 'C'],
            ['A', 'C'],
        ],
    )
    expect(diffPlan(seedOf(base()), next)).toEqual({
        movable: ['A', 'C'],
        fixed: ['B'],
        removed: [],
    })
})

test('an edge removed between survivors makes exactly its two endpoints movable', () => {
    const next = graph(['A', 'B', 'C'], [['B', 'C']]) // A→B is gone
    expect(diffPlan(seedOf(base()), next)).toEqual({
        movable: ['A', 'B'],
        fixed: ['C'],
        removed: [],
    })
})

test('an edge touching an added node moves only the added node', () => {
    const next = graph(
        ['A', 'B', 'C', 'D'],
        [
            ['A', 'B'],
            ['B', 'C'],
            ['A', 'D'],
            ['D', 'C'],
        ],
    )
    expect(diffPlan(seedOf(base()), next)).toEqual({
        movable: ['D'],
        fixed: ['A', 'B', 'C'],
        removed: [],
    })
})

test('an edge kind change counts as a changed edge between its endpoints', () => {
    const next = base()
    next.edges[0] = { from: 'A', to: 'B', kind: 'tag' }
    expect(diffPlan(seedOf(base()), next)?.movable).toEqual(['A', 'B'])
})

test('a seed without edges only fast-paths a pure add', () => {
    const current = seedOf(base())
    const legacy: Layout = { pos3d: current.pos3d, pos2d: current.pos2d }
    const added = graph(
        ['A', 'B', 'C', 'D'],
        [
            ['A', 'B'],
            ['B', 'C'],
        ],
    )
    expect(diffPlan(legacy, added)?.movable).toEqual(['D'])
    const edgeOnly = graph(
        ['A', 'B', 'C'],
        [
            ['A', 'B'],
            ['A', 'C'],
        ],
    )
    expect(diffPlan(legacy, edgeOnly)).toBeNull()
    expect(diffPlan(legacy, graph(['A', 'B'], [['A', 'B']]))).toBeNull()
})

test('more movable nodes than the cap, or an empty seed, is a full settle', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `n${i}`)
    const seed = seedOf(graph(ids, []))
    const next = graph([...ids, ...ids.map(id => `${id}-new`)], []) // 30 added > max(25, 6)
    expect(diffPlan(seed, next)).toBeNull()
    expect(
        diffPlan({ pos3d: {}, pos2d: {}, edges: [] }, graph(['A'], [])),
    ).toBeNull()
})

test('splitEdgeKey recovers endpoints whose ids contain a pipe', () => {
    const ids = new Set(['a|b', 'c'])
    expect(splitEdgeKey('a|b|c|link', id => ids.has(id))).toEqual({
        from: 'a|b',
        to: 'c',
        kind: 'link',
    })
    expect(splitEdgeKey('x|y|link', id => ids.has(id))).toBeNull()
})

test('idRenamer renames one note for a .md path and a prefix for a folder path', () => {
    const file = idRenamer('proj.md', 'plan.md')
    expect(file('proj')).toBe('plan')
    expect(file('proj/x')).toBeNull() // a sibling folder's note is not the renamed file
    const folder = idRenamer('proj/', 'work')
    expect(folder('proj/x')).toBe('work/x')
    expect(folder('proj')).toBeNull() // a same-named sibling note is not in the folder
    expect(folder('project/x')).toBeNull()
})

test('remapSeed rewrites positions and edges into a copy, leaving the seed untouched', () => {
    const seed = seedOf(
        graph(
            ['a/x', 'b', 'c'],
            [
                ['a/x', 'b'],
                ['c', 'a/x'],
            ],
        ),
    )
    const snapshot = structuredClone(seed)
    const out = remapSeed(seed, idRenamer('a', 'z'))
    expect(out.pos3d).toEqual({
        'z/x': seed.pos3d['a/x'],
        b: seed.pos3d['b'],
        c: seed.pos3d['c'],
    })
    expect(out.pos2d['z/x']).toEqual(seed.pos2d['a/x'])
    expect(out.edges).toEqual(['c|z/x|link', 'z/x|b|link'])
    expect(seed).toEqual(snapshot)
})
