// app/src/graph/displayGraph.ts
// Pure per-mode graph selection for the Knowledge Graph tab (App.tsx's `displayGraph` memo).
// Extracted so the "which graph does mode X render" decision — notably that NO mode carries a
// "you"/self node — is unit-testable without mounting the whole App.
//
// The self node used to be injected here for "2nd"/"3rd"/"both" too (via a `withYouNode()`
// helper in the now-deleted app/src/graph/youNode.ts). It was removed: floating at the graph's
// origin with only a handful of "open" edges to the user's current tabs, it read as frontend
// noise rather than real vault/memory/daemon structure. The "agents" mode that once had its own
// self node (the literal root of the session tree) was removed too — ephemeral tooling state,
// not knowledge.
import type { GraphData, ViewLayout } from '../../../core/src/graph'
import {
    subgraphByKinds,
    localSubgraph,
    SECOND_BRAIN_KINDS,
    THIRD_BRAIN_KINDS,
} from '../../../core/src/graph'
import type { GraphMode } from '../commands'

/**
 * Apply brain-view layout to a subgraph. Overwrites node positions with the view's
 * precomputed layout (for 2nd/3rd brain views) instead of using full-graph positions
 * which would strand cross-brain-linked nodes.
 */
export function applyView(
    graph: GraphData,
    view: ViewLayout | undefined,
): GraphData {
    if (!view) return graph
    return {
        edges: graph.edges,
        nodes: graph.nodes.map(node => ({
            ...node,
            position: view.pos3d[node.id] ?? node.position,
            position2d: view.pos2d[node.id] ?? node.position2d,
        })),
    }
}

/** Everything `selectDisplayGraph` needs, sourced from App.tsx's reactive signals. */
export interface DisplayGraphSources {
    /** The full "both"-mode graph (vault + memory), with `views.second`/`views.third` if cached. */
    graph: GraphData
    /** The "daemon" graph (hub + crons/processes) — never has a self node. */
    daemon: GraphData
    /** The focused note's graph node id (its path minus ".md"), or null. Only "local" mode reads it. */
    activeId?: string | null
}

/**
 * Picks and shapes the graph for the active mode. NEVER adds a "you"/self node — no mode carries
 * one any more.
 */
export function selectDisplayGraph(
    mode: GraphMode,
    sources: DisplayGraphSources,
): GraphData {
    switch (mode) {
        case '2nd':
            return applyView(
                subgraphByKinds(sources.graph, SECOND_BRAIN_KINDS),
                sources.graph.views?.second,
            )
        case '3rd':
            return applyView(
                subgraphByKinds(sources.graph, THIRD_BRAIN_KINDS),
                sources.graph.views?.third,
            )
        case 'daemon':
            return sources.daemon // daemon mode centers on the daemon hub node — no "you" injection
        case 'both':
            return sources.graph // full brain, no "you" hub
        case 'local':
            // Just what the open note touches: it, its neighbours in BOTH directions (outbound links and
            // backlinks alike), and the edges among them. `localSubgraph` strips the hierarchy fields, so
            // the renderers fall back to one flat level — a local neighbourhood has no super-clusters to
            // read, and colouring a dozen notes by the whole vault's community structure said nothing.
            // Positions come from a whole-vault layout and are meaningless at this scale; GraphView re-lays
            // the subgraph out for this mode.
            return localSubgraph(
                subgraphByKinds(sources.graph, SECOND_BRAIN_KINDS),
                sources.activeId ?? '',
            )
    }
}
