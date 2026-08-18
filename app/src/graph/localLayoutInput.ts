// Builds core/src/layout.ts's `computeLayout` input for GraphView's LOCAL-mode client-side settle.
// Extracted from GraphView.tsx (Task 5, fix round 2) so the community-lookup wiring is directly
// unit-testable without mounting the Solid component.
//
// Local mode's own graph (`g` below — `displayGraph.ts`'s `selectDisplayGraph` "local" case, built
// via `core/src/graph.ts`'s `localSubgraph`) deliberately STRIPS `community`/`communityPath` before
// the renderer ever sees them: colouring a dozen notes by the whole vault's community structure said
// nothing at that scale (see `localSubgraph`'s own doc comment). But the underlying ids are still
// useful to `computeLayout`'s community-aware gravity even when there's nothing sensible to draw from
// them — a neighbour that shares the focused note's community should settle closer than a neighbour
// that's only a cross-community bridge. `source` (the full, un-mode-filtered graph — GraphView's
// `communitySource` prop, App.tsx's own `graph()` signal) still has the fields; this looks them up by
// id and re-attaches them ONLY to the layout INPUT, never to anything rendered.
import type { GraphData } from '../../../core/src/graph'
import type { LayoutInput } from '../../../core/src/layout'

export function localLayoutInput(
    g: GraphData,
    source?: GraphData,
): LayoutInput {
    const byId = new Map(source?.nodes.map(n => [n.id, n]))
    return {
        nodes: g.nodes.map(n => {
            const src = byId.get(n.id)
            return {
                id: n.id,
                community: src?.community,
                communityPath: src?.communityPath,
            }
        }),
        edges: g.edges.map(e => ({ from: e.from, to: e.to })),
    }
}
