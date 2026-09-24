// Sample GraphNode/GraphData for knowledge-graph stories (dev-only, Storybook). NOT a story
// file itself — the `*.stories.*` glob (see `.storybook/main.ts`) skips underscore-prefixed
// files. Positions are pre-computed with the SAME pure layout the app uses (core/src/layout.ts
// `computeLayout`) — it's DOM-free, so it runs fine client-side (app/src/graph/EmbeddedGraph.tsx
// already does client-side layout in production via layoutGraphData/embeddedGraphRender.ts) —
// never hand-place nodes; that's exactly the kind of fabricated stand-in a story must not show.
import type { GraphData, GraphEdge, GraphNode } from '../../../core/src/graph'
import { computeLayout } from '../../../core/src/layout'
import { detectCommunityHierarchy } from '../../../core/src/community'

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

/** The id of `sampleGraphData`'s hub note — an index note linking every other note, so it settles
 *  at the layout's centroid (the HudBadges story hovers the canvas centre and relies on that). A
 *  real note, not the retired `self`/"You" node: no live graph mode carries that any more
 *  (displayGraph.ts), so a fixture showing it would picture a graph the app never draws. */
export const SAMPLE_HUB_ID = 'index'

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
 * A small realistic GraphData: an index note linking every other note (`SAMPLE_HUB_ID`),
 * `noteCount` notes wikilink-chained together, and a handful of tags fanning out from them — laid out with the production layout pipeline (3D
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
        { id: SAMPLE_HUB_ID, label: 'Index', kind: 'note', folder: '' },
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
    for (const id of noteIds)
        edges.push({ from: SAMPLE_HUB_ID, to: id, kind: 'link' })
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

/**
 * A GraphData WITH a community hierarchy — `groups` tight rings of `perGroup` notes (each note
 * linked to the next two in its ring), one bridge link between consecutive groups, and no
 * index hub — the rings' own structure is what the clusters summarise. `community`/
 * `communityPath` are stamped by the SAME
 * `detectCommunityHierarchy` core/src/engine.ts's stampCommunities uses, so GraphView's LOD
 * masses (showLodMasses) have something to aggregate. `sampleGraphData` carries no hierarchy,
 * which is why no story before this one ever drew a cluster mass.
 */
export function sampleClusteredGraphData(groups = 6, perGroup = 12): GraphData {
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const idOf = (g: number, i: number) => `g${g}-${slug(NOTE_TITLES[(g * perGroup + i) % NOTE_TITLES.length])}-${i}`
    for (let g = 0; g < groups; g++) {
        for (let i = 0; i < perGroup; i++)
            nodes.push({
                id: idOf(g, i),
                label: NOTE_TITLES[(g * perGroup + i) % NOTE_TITLES.length],
                kind: 'note',
                folder: '',
            })
        for (let i = 0; i < perGroup; i++) {
            edges.push({ from: idOf(g, i), to: idOf(g, (i + 1) % perGroup), kind: 'link' })
            edges.push({ from: idOf(g, i), to: idOf(g, (i + 2) % perGroup), kind: 'link' })
        }
        if (g > 0) edges.push({ from: idOf(g - 1, 0), to: idOf(g, perGroup >> 1), kind: 'link' })
    }
    const assignments = detectCommunityHierarchy(
        nodes.map(n => ({ id: n.id, label: n.label, kind: n.kind })),
        edges.map(e => ({ from: e.from, to: e.to })),
    )
    for (const n of nodes) {
        const a = assignments.get(n.id)
        if (a) {
            n.community = a.community
            n.communityLabel = a.label
            n.communityPath = a.path
            n.communityPathLabels = a.labels
        }
    }
    // Layout: exactly the sampleGraphData pipeline — 3D first, 2D warm-started from it. The
    // community/communityPath fields are passed into the layout INPUT too (not just onto the
    // rendered nodes) so computeLayout's community-aware gravity (on by default — layout.ts) pulls
    // each ring together and pushes the rings apart, instead of settling as one undifferentiated
    // blob that only *colouring* would distinguish.
    const input = {
        nodes: nodes.map(nd => ({
            id: nd.id,
            community: nd.community,
            communityPath: nd.communityPath,
        })),
        edges: edges.map(e => ({ from: e.from, to: e.to })),
    }
    const pos3d = computeLayout(input, { dimensions: 3 })
    const pos2d = computeLayout(input, { dimensions: 2, initialPositions: pos3d })
    return {
        nodes: nodes.map(nd => ({
            ...nd,
            position: pos3d[nd.id],
            position2d: pos2d[nd.id] ? ([pos2d[nd.id][0], pos2d[nd.id][1]] as [number, number]) : undefined,
        })),
        edges,
    }
}
