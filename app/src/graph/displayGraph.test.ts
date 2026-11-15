import { describe, expect, it } from 'bun:test'
import type { GraphData } from '../../../core/src/graph'
import { SELF_NODE_ID } from '../../../core/src/graph'
import { applyView, selectDisplayGraph } from './displayGraph'

const fullGraph = (): GraphData => ({
    nodes: [
        { id: 'a', label: 'a', kind: 'note', folder: '' },
        { id: 'b', label: 'b', kind: 'note', folder: '' },
        { id: '#tag', label: '#tag', kind: 'tag' },
        { id: 'mem:x', label: 'x', kind: 'memory' },
    ],
    edges: [
        { from: 'a', to: 'b', kind: 'link' },
        { from: 'a', to: '#tag', kind: 'tag' },
    ],
})

const hasSelf = (g: GraphData) =>
    g.nodes.some(n => n.kind === 'self' || n.id === SELF_NODE_ID)

describe('selectDisplayGraph', () => {
    const sources = () => ({ graph: fullGraph() })

    it("never adds a 'you' hub in 2nd-brain mode", () => {
        const g = selectDisplayGraph('2nd', sources())
        expect(hasSelf(g)).toBe(false)
        expect(g.nodes.map(n => n.kind).sort()).toEqual(['note', 'note', 'tag'])
    })

    it("never adds a 'you' hub in 3rd-brain mode", () => {
        const g = selectDisplayGraph('3rd', sources())
        expect(hasSelf(g)).toBe(false)
        expect(g.nodes.map(n => n.kind)).toEqual(['memory'])
    })

    it("never adds a 'you' hub in 'both' mode", () => {
        const g = selectDisplayGraph('both', sources())
        expect(hasSelf(g)).toBe(false)
        expect(g.nodes).toHaveLength(4) // exactly the input graph, untouched
    })

    it('applies the cached sub-view layout in 2nd/3rd mode when present', () => {
        const withViews: GraphData = {
            ...fullGraph(),
            views: {
                second: { pos3d: { a: [1, 2, 3] }, pos2d: { a: [4, 5] } },
            },
        }
        const g = selectDisplayGraph('2nd', { graph: withViews })
        const a = g.nodes.find(n => n.id === 'a')!
        expect(a.position).toEqual([1, 2, 3])
        expect(a.position2d).toEqual([4, 5])
    })
})

describe('selectDisplayGraph with the local lens', () => {
    // b and c are a's neighbours (a link out and a backlink); d is two hops away; mem:x remembers a,
    // mem:y remembers only d.
    const graph = (): GraphData => ({
        nodes: [
            { id: 'a', label: 'a', kind: 'note', folder: '' },
            { id: 'b', label: 'b', kind: 'note', folder: '' },
            { id: 'c', label: 'c', kind: 'note', folder: '' },
            { id: 'd', label: 'd', kind: 'note', folder: '' },
            { id: 'mem:x', label: 'x', kind: 'memory' },
            { id: 'mem:y', label: 'y', kind: 'memory' },
        ],
        edges: [
            { from: 'a', to: 'b', kind: 'link' },
            { from: 'c', to: 'a', kind: 'link' },
            { from: 'b', to: 'd', kind: 'link' },
            { from: 'mem:x', to: 'a', kind: 'about' },
            { from: 'mem:y', to: 'd', kind: 'about' },
        ],
    })
    const ids = (g: GraphData) => g.nodes.map(n => n.id).sort()
    const local = (mode: '2nd' | '3rd' | 'both') =>
        selectDisplayGraph(mode, { graph: graph(), activeId: 'a', local: true })

    it('narrows the 2nd brain to the open note and its notes one link away, both directions', () => {
        expect(ids(local('2nd'))).toEqual(['a', 'b', 'c'])
    })

    it('narrows the 3rd brain to the open note and the memories that touch it', () => {
        expect(ids(local('3rd'))).toEqual(['a', 'mem:x'])
    })

    it('narrows both brains to every neighbour of either kind', () => {
        expect(ids(local('both'))).toEqual(['a', 'b', 'c', 'mem:x'])
    })

    it('shows nothing with no note open, rather than the whole graph', () => {
        const g = selectDisplayGraph('2nd', { graph: graph(), activeId: null, local: true })
        expect(g.nodes).toHaveLength(0)
    })

    it('leaves the mode alone when the lens is off', () => {
        const g = selectDisplayGraph('2nd', { graph: graph(), activeId: 'a', local: false })
        expect(ids(g)).toEqual(['a', 'b', 'c', 'd'])
    })
})

describe('applyView', () => {
    it('returns the graph untouched when no view is cached yet', () => {
        const g = fullGraph()
        expect(applyView(g, undefined)).toBe(g)
    })

    it("overwrites positions from the view, falling back to the node's own for ids missing from it", () => {
        const g = fullGraph()
        const out = applyView(g, { pos3d: { a: [9, 9, 9] }, pos2d: {} })
        expect(out.nodes.find(n => n.id === 'a')!.position).toEqual([9, 9, 9])
        expect(out.nodes.find(n => n.id === 'b')!.position).toBeUndefined() // "b" had none to begin with
    })
})
