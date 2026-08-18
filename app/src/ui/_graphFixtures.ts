// Sample GraphNode/GraphData for knowledge-graph stories (dev-only, Storybook). NOT a story
// file itself — the `*.stories.*` glob (see `.storybook/main.ts`) skips underscore-prefixed
// files. Positions are pre-computed with the SAME pure layout the app uses (core/src/layout.ts
// `computeLayout`) — it's DOM-free, so it runs fine client-side (app/src/graph/EmbeddedGraph.tsx
// already does client-side layout in production via layoutGraphData/embeddedGraphRender.ts) —
// never hand-place nodes; that's exactly the kind of fabricated stand-in a story must not show.
import {
    SELF_NODE_ID,
    type GraphData,
    type GraphEdge,
    type GraphNode,
} from '../../../core/src/graph'
import { computeLayout } from '../../../core/src/layout'

const NOTE_TITLES = [
    'Housing',
    'Internship',
    'Essay',
    'Reading List',
    'Project Roadmap',
    'Meeting Notes',
    'Weekly Review',
    'Ideas',
    'Budget',
    'Travel Plan',
]
const TAG_NAMES = ['project', 'logistics', 'reading']

function slug(title: string): string {
    return title.toLowerCase().replace(/\s+/g, '-')
}

/** One GraphNode, defaulted to an unpositioned "note" — for stories that render a single
 *  node/label/badge component rather than a whole graph. */
export function sampleGraphNode(overrides: Partial<GraphNode> = {}): GraphNode {
    return {
        id: 'sample-note',
        label: 'Sample Note',
        kind: 'note',
        folder: '',
        ...overrides,
    }
}

/**
 * A small realistic GraphData: a self node, `noteCount` notes wikilink-chained together, and
 * a handful of tags fanning out from them — laid out with the production layout pipeline (3D
 * first, then 2D warm-started from the 3D result, exactly like core/src/layout-cache.ts's
 * `attachLayout`), so `position`/`position2d` are real coordinates, not stand-ins.
 */
export function sampleGraphData(noteCount = 8): GraphData {
    const n = Math.max(1, noteCount)
    const titles = Array.from(
        { length: n },
        (_, i) => NOTE_TITLES[i % NOTE_TITLES.length],
    )
    const noteIds = titles.map((t, i) => `${slug(t)}-${i}`)

    const nodes: GraphNode[] = [
        { id: SELF_NODE_ID, label: 'You', kind: 'self' },
        ...titles.map((t, i): GraphNode => ({
            id: noteIds[i],
            label: t,
            kind: 'note',
            folder: '',
        })),
        ...TAG_NAMES.map((t): GraphNode => ({
            id: `tag:${t}`,
            label: `#${t}`,
            kind: 'tag',
        })),
    ]

    const edges: GraphEdge[] = []
    for (let i = 0; i < noteIds.length - 1; i++)
        edges.push({ from: noteIds[i], to: noteIds[i + 1], kind: 'link' })
    noteIds.forEach((id, i) =>
        edges.push({
            from: id,
            to: `tag:${TAG_NAMES[i % TAG_NAMES.length]}`,
            kind: 'tag',
        }),
    )

    const input = {
        nodes: nodes.map(nd => ({ id: nd.id })),
        edges: edges.map(e => ({ from: e.from, to: e.to })),
    }
    const pos3d = computeLayout(input, { dimensions: 3 })
    const pos2d = computeLayout(input, {
        dimensions: 2,
        initialPositions: pos3d,
    })

    const positioned = nodes.map(nd => ({
        ...nd,
        position: pos3d[nd.id],
        position2d: pos2d[nd.id]
            ? ([pos2d[nd.id][0], pos2d[nd.id][1]] as [number, number])
            : undefined,
    }))

    return { nodes: positioned, edges }
}
