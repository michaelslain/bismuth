import type { GraphNode, GraphEdge } from './graph'
import { getFileAccess } from './fileAccess'
import { getParsedNotes, type ParsedNote } from './parsedNotes'
import { noteId } from './pathUtils'
import { preferId } from './linkTarget'

/**
 * Shared graph builder for vault and memory notes.
 * Handles the common pattern: list files → read each through the parsed-note cache → extract
 * nodes/edges.
 *
 * @param root - Directory to scan for markdown files
 * @param nodeBuilder - Function to create a GraphNode from rel path
 * @param edgeExtractor - Function to extract edges from a node id and its parsed note; receives byBase/byPath for link resolution
 * @returns nodes, edges, and index maps (byBase, byPath)
 */
export async function buildGraphFromNotes(
    root: string,
    nodeBuilder: (relPath: string) => GraphNode,
    edgeExtractor: (
        nodeId: string,
        note: ParsedNote,
        byBase: Map<string, string>,
        byPath: Map<string, string>,
    ) => GraphEdge[],
): Promise<{
    nodes: GraphNode[]
    edges: GraphEdge[]
    byBase: Map<string, string>
    byPath: Map<string, string>
}> {
    const { listMarkdown } = await getFileAccess()
    // A note that vanished since the listing is skipped entirely (no node, no edges).
    const notes = await getParsedNotes(root, await listMarkdown(root))
    const nodes: GraphNode[] = []
    const byBase = new Map<string, string>()
    const byPath = new Map<string, string>()

    // Build nodes in a first pass to establish index maps
    const nodeMap = new Map<string, GraphNode>()
    for (const { rel } of notes) {
        const node = nodeBuilder(rel)
        nodes.push(node)
        nodeMap.set(rel, node)

        // Index by basename and full path for wikilink resolution
        const lastSlash = rel.lastIndexOf('/')
        const filename = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel
        const basename = noteId(filename)
        const pathKey = noteId(rel)

        const existing = byBase.get(basename)
        byBase.set(
            basename,
            existing === undefined ? node.id : preferId(existing, node.id),
        )
        byPath.set(pathKey, node.id)
    }

    // Extract edges in a single pass, with access to index maps for link resolution
    const edges: GraphEdge[] = []
    for (const note of notes) {
        const node = nodeMap.get(note.rel)!
        edges.push(...edgeExtractor(node.id, note, byBase, byPath))
    }

    return { nodes, edges, byBase, byPath }
}
