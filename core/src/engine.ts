import { buildVaultGraph, resolveLinkTarget } from './vault'
import { buildMemoryGraph } from './memory'
import { mergeGraphs, type GraphData, type GraphEdge } from './graph'
import { detectCommunityHierarchy } from './community'
import { getFileAccess } from './fileAccess'
import { parseSettingsText } from './settingsSerialize'
import { excludeFromGraph, graphExcludeFrom } from './graphExclude'

/** The vault's `graph.exclude` list, read through FileAccess so the mobile path can run it. A
 *  missing or unreadable `.settings` is an empty list. */
export async function readGraphExclude(vaultDir: string): Promise<string[]> {
    try {
        const raw = await (
            await getFileAccess()
        ).readNote(vaultDir, '.settings')
        return graphExcludeFrom(parseSettingsText(raw).data)
    } catch {
        return []
    }
}

/**
 * Stamp `community` / `communityLabel` / `communityPath` / `communityPathLabels` onto each node from
 * the structural edge set. Uses only edges whose endpoints are both present (the same set used for
 * layout/degree). Mutates and returns `g`.
 *
 * The hierarchy's depth is a function of the graph's node count (community.ts
 * `communityLevelsFor`), so a small vault gets one flat level exactly as before and a big one gets
 * clusters nested up to 4 deep. `community`/`communityLabel` are always the FINEST level, so every
 * existing consumer is unaffected by the extra levels.
 *
 * Below `MIN_NODES_FOR_CLUSTERING`, skips detection entirely and leaves nodes unstamped: at that
 * size Louvain only ever finds a handful of near-empty groups, so the grouping is visual noise
 * rather than a useful organization of the graph.
 */
const MIN_NODES_FOR_CLUSTERING = 30

export function stampCommunities(g: GraphData): GraphData {
    if (g.nodes.length < MIN_NODES_FOR_CLUSTERING) return g
    const present = new Set(g.nodes.map(n => n.id))
    const structural = g.edges.filter(
        e => present.has(e.from) && present.has(e.to),
    )
    const assignments = detectCommunityHierarchy(
        // `kind` feeds the exemplar picker's tag preference (community.ts pickExemplar): a cluster whose
        // top-degree members include a tag is named "#school", not by a note's whole title.
        g.nodes.map(n => ({ id: n.id, label: n.label, kind: n.kind })),
        structural.map(e => ({ from: e.from, to: e.to })),
    )
    for (const n of g.nodes) {
        const a = assignments.get(n.id)
        if (a) {
            n.community = a.community
            n.communityLabel = a.label
            n.communityPath = a.path
            n.communityPathLabels = a.labels
        }
    }
    return g
}

/**
 * The knowledge graph: the vault's notes and tags, plus the 3rd brain's memory notes and their
 * `about` edges when `memoryDir` is given. Notes named in `graph.exclude` are dropped before
 * communities are stamped, so they shape neither clusters nor layout; `opts.exclude` overrides the
 * list read from the vault's `.settings`.
 */
export async function buildGraph(
    vaultDir: string,
    memoryDir?: string,
    opts: { exclude?: string[] } = {},
): Promise<GraphData> {
    const exclude = opts.exclude ?? (await readGraphExclude(vaultDir))
    const {
        graph: vault,
        byBase: vaultByBase,
        byPath: vaultByPath,
    } = await buildVaultGraph(vaultDir)
    if (!memoryDir) return stampCommunities(excludeFromGraph(vault, exclude))

    const memory = await buildMemoryGraph(memoryDir)
    const about: GraphEdge[] = []
    for (const [rid, targets] of memory.links) {
        for (const t of targets) {
            // Resolve memory→vault "about" links by full path first, then basename, so a
            // path-qualified [[folder/Note]] reference in a memory note still links across.
            // `rid` is the memory note's full relative id, so subfolder notes reconstruct
            // their real `mem:` node id (a basename key produced dangling edges).
            const toId = resolveLinkTarget(t, vaultByBase, vaultByPath)
            if (toId)
                about.push({ from: `mem:${rid}`, to: toId, kind: 'about' })
        }
    }
    const merged = mergeGraphs([
        vault,
        { nodes: memory.nodes, edges: [...memory.edges, ...about] },
    ])
    return stampCommunities(excludeFromGraph(merged, exclude))
}
