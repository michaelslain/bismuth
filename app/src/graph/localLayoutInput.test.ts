import { describe, expect, it } from 'bun:test'
import type { GraphData } from '../../../core/src/graph'
import { computeLayout } from '../../../core/src/layout'
import { localLayoutInput } from './localLayoutInput'

const local = (): GraphData => ({
    // Shaped like `localSubgraph()`'s output: no `community`/`communityPath` on the nodes.
    nodes: [
        { id: 'center', label: 'center', kind: 'note', folder: '' },
        { id: 'sibling', label: 'sibling', kind: 'note', folder: '' },
        { id: 'bridge', label: 'bridge', kind: 'note', folder: '' },
    ],
    edges: [
        { from: 'center', to: 'sibling', kind: 'link' },
        { from: 'center', to: 'bridge', kind: 'link' },
    ],
})

const fullGraph = (): GraphData => ({
    // The un-stripped source: same ids, WITH community data (as the real `graph()` signal carries).
    nodes: [
        {
            id: 'center',
            label: 'center',
            kind: 'note',
            folder: '',
            community: 1,
            communityPath: [0, 1],
        },
        {
            id: 'sibling',
            label: 'sibling',
            kind: 'note',
            folder: '',
            community: 1,
            communityPath: [0, 1],
        },
        {
            id: 'bridge',
            label: 'bridge',
            kind: 'note',
            folder: '',
            community: 2,
            communityPath: [0, 2],
        },
        {
            id: 'unrelated',
            label: 'unrelated',
            kind: 'note',
            folder: '',
            community: 3,
            communityPath: [1, 3],
        },
    ],
    edges: [],
})

describe('localLayoutInput', () => {
    it('without a source, produces the pre-Task-5 community-less shape (id-only)', () => {
        const input = localLayoutInput(local())
        expect(input.nodes).toEqual([
            { id: 'center', community: undefined, communityPath: undefined },
            { id: 'sibling', community: undefined, communityPath: undefined },
            { id: 'bridge', community: undefined, communityPath: undefined },
        ])
        expect(input.edges).toEqual([
            { from: 'center', to: 'sibling' },
            { from: 'center', to: 'bridge' },
        ])
    })

    it('with a source, looks up community/communityPath by id — never renders it, just carries it into the layout input', () => {
        const input = localLayoutInput(local(), fullGraph())
        expect(input.nodes).toEqual([
            { id: 'center', community: 1, communityPath: [0, 1] },
            { id: 'sibling', community: 1, communityPath: [0, 1] },
            { id: 'bridge', community: 2, communityPath: [0, 2] },
        ])
        // The source's extra "unrelated" node (not in the local neighbourhood) never leaks in.
        expect(input.nodes.length).toBe(3)
    })

    it("a local id missing from the source (e.g. a memory-only node the full graph doesn't carry) falls back to undefined, not a crash", () => {
        const g = local()
        const partialSource: GraphData = {
            nodes: fullGraph().nodes.filter(n => n.id !== 'bridge'),
            edges: [],
        }
        const input = localLayoutInput(g, partialSource)
        const bridge = input.nodes.find(n => n.id === 'bridge')!
        expect(bridge.community).toBeUndefined()
        expect(bridge.communityPath).toBeUndefined()
    })

    // End-to-end proof (per the Task 5 fix-round-2 review): a local-mode-shaped input built THIS way
    // actually engages computeLayout's community-aware gravity, not just carries inert fields.
    // `useCommunity` itself is a private implementation detail of core/src/layout.ts (never exported),
    // so this proves it indirectly the same way core/test/layout.test.ts does throughout: community-on
    // output must differ from community-off output on the identical input, on a fixture where the
    // community split is large enough for the effect to be measurable at a tiny (3-6 node) local scale.
    it('end-to-end: feeding the built input through computeLayout actually changes the settle (community gravity engages)', () => {
        // Bigger fixture: center's own community (5 members) vs. a same-size unrelated community, bridged
        // by one link — small tests elsewhere in core/test/layout.test.ts show ~10-40 node cliques can be
        // noisy at this scale, so this mirrors that file's smallest reliable planted-community shape.
        const g: GraphData = {
            nodes: [
                ...Array.from({ length: 5 }, (_, i) => ({
                    id: `c${i}`,
                    label: `c${i}`,
                    kind: 'note' as const,
                    folder: '',
                })),
                ...Array.from({ length: 5 }, (_, i) => ({
                    id: `o${i}`,
                    label: `o${i}`,
                    kind: 'note' as const,
                    folder: '',
                })),
            ],
            edges: [
                ...Array.from({ length: 4 }, (_, i) => ({
                    from: 'c0',
                    to: `c${i + 1}`,
                    kind: 'link' as const,
                })),
                ...Array.from({ length: 4 }, (_, i) => ({
                    from: 'o0',
                    to: `o${i + 1}`,
                    kind: 'link' as const,
                })),
                { from: 'c0', to: 'o0', kind: 'link' as const }, // the one cross-community bridge
            ],
        }
        const source: GraphData = {
            nodes: [
                ...g.nodes
                    .slice(0, 5)
                    .map(n => ({ ...n, community: 0, communityPath: [0] })),
                ...g.nodes
                    .slice(5)
                    .map(n => ({ ...n, community: 1, communityPath: [1] })),
            ],
            edges: [],
        }

        const withCommunity = localLayoutInput(g, source)
        const withoutCommunity = localLayoutInput(g) // no source — today's pre-fix shape

        const posOn = computeLayout(withCommunity, { refineTicks: 150 })
        const posOff = computeLayout(withoutCommunity, { refineTicks: 150 })
        expect(posOn).not.toEqual(posOff)
    })
})
