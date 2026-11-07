// core/src/graphExclude.ts
// The `graph.exclude` setting: a plain list of notes and folders to leave out of the knowledge graph.
// PURE (no Bun / node:fs), so the in-process mobile backend runs it through engine.ts as-is.
//
// Matching mirrors a wikilink: a bare name (`user-profile`) matches every note, vault or memory,
// with that basename; a path-qualified one (`folder/Note`) matches only the note at that path; a
// path ending in `/` (`journal/`) matches every note under that folder. A memory note's path is its
// path inside the memory dir, and its vault path (`.daemon/memory/…`) matches too. A trailing `.md`
// is ignored. An image's or PDF's node is its companion note (`photo.png.md`), so `photo.png` names
// it. Display-only: the graph drops the node and every edge touching it; the notes, their links,
// search and recall are untouched.
import type { GraphData, GraphNode } from './graph'

const MEMORY_PREFIX = 'mem:'
const MEMORY_VAULT_DIR = '.daemon/memory/'

type Entry =
    | { kind: 'name'; v: string }
    | { kind: 'path'; v: string }
    | { kind: 'folder'; v: string }

function parseEntry(raw: string): Entry | null {
    const t = raw.trim().replace(/^\/+/, '')
    if (t.endsWith('/')) {
        const v = t.replace(/\/+$/, '')
        return v ? { kind: 'folder', v } : null
    }
    const v = t.endsWith('.md') ? t.slice(0, -3) : t
    if (!v) return null
    return v.includes('/') ? { kind: 'path', v } : { kind: 'name', v }
}

/** Whether `entry` hides a note answering to `paths` (the first is its own path). */
function entryHides(entry: Entry, paths: string[]): boolean {
    if (entry.kind === 'name') return entry.v === basenameOf(paths[0])
    if (entry.kind === 'path') return paths.includes(entry.v)
    return paths.some(p => p.startsWith(entry.v + '/'))
}

/** The `graph.exclude` value from parsed `.settings` data, keeping only non-empty strings. */
export function graphExcludeFrom(data: Record<string, unknown>): string[] {
    const graph = data.graph
    if (!graph || typeof graph !== 'object') return []
    const list = (graph as { exclude?: unknown }).exclude
    if (!Array.isArray(list)) return []
    return list.filter(
        (e): e is string => typeof e === 'string' && e.trim() !== '',
    )
}

/** The paths a note node answers to, or null for a node that is not a note. */
function notePaths(n: GraphNode): string[] | null {
    if (n.kind === 'note') return [n.id]
    if (n.kind === 'memory' && n.id.startsWith(MEMORY_PREFIX)) {
        const rid = n.id.slice(MEMORY_PREFIX.length)
        return [rid, MEMORY_VAULT_DIR + rid]
    }
    return null
}

function basenameOf(path: string): string {
    const i = path.lastIndexOf('/')
    return i === -1 ? path : path.slice(i + 1)
}

/**
 * Drop every note the exclude list names, every edge touching one, and every tag node left with
 * no edges because of it. An empty list returns `g` unchanged.
 */
export function excludeFromGraph(g: GraphData, exclude: string[]): GraphData {
    const entries = exclude.map(parseEntry).filter((e): e is Entry => !!e)
    if (entries.length === 0) return g

    const dropped = new Set<string>()
    for (const n of g.nodes) {
        const own = notePaths(n)
        if (own && entries.some(e => entryHides(e, own))) dropped.add(n.id)
    }
    if (dropped.size === 0) return g

    const edges = g.edges.filter(
        e => !dropped.has(e.from) && !dropped.has(e.to),
    )
    // A tag node exists only because a note carries the tag; one whose every note was excluded
    // would float alone, so it goes too. A tag that still has a note keeps its node.
    const lostEdge = new Set<string>()
    for (const e of g.edges)
        if (dropped.has(e.from) || dropped.has(e.to)) {
            lostEdge.add(e.from)
            lostEdge.add(e.to)
        }
    const touched = new Set<string>()
    for (const e of edges) {
        touched.add(e.from)
        touched.add(e.to)
    }
    const nodes = g.nodes.filter(
        n =>
            !dropped.has(n.id) &&
            !(n.kind === 'tag' && lostEdge.has(n.id) && !touched.has(n.id)),
    )
    return { ...g, nodes, edges }
}

/** A vault path as the graph names it: no leading slash, no trailing slash or `.md`. */
function asNotePath(path: string): string {
    const p = path.replace(/^\/+|\/+$/g, '')
    return p.endsWith('.md') ? p.slice(0, -3) : p
}

/** Whether `raw` is an entry of the file or folder at `path` itself (not of an ancestor). */
function isOwnEntry(raw: string, path: string, isDir: boolean): boolean {
    const e = parseEntry(raw)
    if (!e) return false
    const p = asNotePath(path)
    if (isDir) return e.kind === 'folder' && e.v === p
    return e.kind !== 'folder' && entryHides(e, [p])
}

export type GraphHidden = {
    /** An entry names this file or folder itself; `showInGraph` removes it. */
    own: boolean
    /** The folder entry (`journal/`) of an ancestor that hides it, when one does. */
    byFolder: string | null
}

/** How the exclude list treats the vault file or folder at `path`, for the file menu. */
export function graphHidden(
    exclude: string[],
    path: string,
    isDir: boolean,
): GraphHidden {
    const p = asNotePath(path)
    const own = exclude.some(e => isOwnEntry(e, path, isDir))
    let byFolder: string | null = null
    for (const raw of exclude) {
        const e = parseEntry(raw)
        if (e?.kind === 'folder' && p.startsWith(e.v + '/')) {
            byFolder = e.v + '/'
            break
        }
    }
    return { own, byFolder }
}

/** The list with the file or folder at `path` hidden: a file's path (minus `.md`), so only that
 *  file goes, or a folder's path with a trailing `/`. Unchanged when it already has its own entry. */
export function hideInGraph(
    exclude: string[],
    path: string,
    isDir: boolean,
): string[] {
    if (exclude.some(e => isOwnEntry(e, path, isDir))) return exclude
    const p = asNotePath(path)
    return [...exclude, isDir ? p + '/' : p]
}

/** The list with every entry of the file or folder at `path` itself removed, a bare name included.
 *  An ancestor folder's entry stays: it is that folder's, not this one's. */
export function showInGraph(
    exclude: string[],
    path: string,
    isDir: boolean,
): string[] {
    return exclude.filter(e => !isOwnEntry(e, path, isDir))
}
