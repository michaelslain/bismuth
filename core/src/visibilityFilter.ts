// core/src/visibilityFilter.ts
// The ONE place a command or route turns "which notes is this caller not allowed to see" into a
// filtered result. server.ts (per request) and the `bismuth` CLI's filtered commands (per process)
// both go through here, so the two surfaces cannot drift: a leak fixed in one is fixed in both.
//
// Three layers, each pure except the first:
//  - `agentChannel` / `agentDenyEntries` — who is this process, and what is denied to them.
//  - `filterByPath` / `filterGraph` / `filterTree` — drop denied items from a LIST at its source.
//    Callers filter BEFORE aggregating (counting, grouping, summarising, limiting): filtering a
//    final output leaves restricted notes inside every total.
//  - `folderRestricted` — the one folder-level question the tree needs that a per-file deny list
//    cannot answer (an empty hidden folder has no file to deny).
//
// FAIL CLOSED: `agentDenyEntries` THROWS when visibility cannot be determined (an unparseable
// `.settings`, an unreadable subtree). Callers let it propagate; nobody catches it to print
// unfiltered output.
import { join } from 'node:path'
import { stampCommunities } from './engine'
import type { GraphData, GraphNode } from './graph'
import {
    buildDenyPaths,
    isDeniedPath,
    isVisibleToChat,
    isVisibleToDaemon,
    resolveFolderVisibility,
    VisibilityUndeterminedError,
    type DenyEntry,
    type VisibilityChannel,
} from './visibility'
import { readFolderVisibilityResult } from './settings'
import { cliGateChannel } from './visibilityCliGate'
import { realpathLoose } from './realPath'

export { isDeniedPath, type DenyEntry, type VisibilityChannel } from './visibility'

/**
 * The agent channel this process runs as, or null for the owner's own hand.
 *
 * `BISMUTH_AGENT_CHANNEL` (a directly-spawned agent's shell) wins; else `BISMUTH_MCP_CHANNEL` (the
 * MCP server spawned this CLI — it gates and filters as an agent, never as the owner); else null:
 * neither var set is the owner's own hand, ungated. Same derivation as cli/src/commands/doctor.ts.
 */
export function agentChannel(
    env: Record<string, string | undefined> = process.env,
): VisibilityChannel | null {
    return cliGateChannel(env)
}

// Deny lists memoised per (vault, channel) for the life of the process: a CLI invocation is one
// short-lived process, so a visibility edit made while it runs is not something it needs to see.
// The PROMISE is memoised so concurrent callers share one walk; a rejected walk is evicted so the
// next call retries instead of replaying a failure forever.
const denyMemo = new Map<string, Promise<DenyEntry[]>>()

/**
 * `[]` for the owner (the vault is never read). For an agent: `buildDenyPaths(vault, channel)`.
 * THROWS (VisibilityUndeterminedError or the underlying error) when it cannot be determined —
 * callers let it propagate.
 *
 * CLI-only: never call from a long-lived process (the memo never invalidates).
 */
export async function agentDenyEntries(
    vault: string,
    env: Record<string, string | undefined> = process.env,
): Promise<DenyEntry[]> {
    const channel = agentChannel(env)
    if (!channel) return []
    const key = `${channel}\0${vault}`
    const cached = denyMemo.get(key)
    if (cached) return cached
    const walk: Promise<DenyEntry[]> = buildDenyPaths(vault, channel).catch(
        err => {
            if (denyMemo.get(key) === walk) denyMemo.delete(key)
            throw err
        },
    )
    denyMemo.set(key, walk)
    return walk
}

/** Items whose path is not denied. Returns `items` itself when `entries` is empty. */
export function filterByPath<T>(
    items: T[],
    entries: DenyEntry[],
    pathOf: (item: T) => string,
): T[] {
    return entries.length === 0
        ? items
        : items.filter(item => !isDeniedPath(entries, pathOf(item)))
}

/**
 * The vault-relative path a graph node's content lives at, for the two node kinds that carry note
 * bodies (note ids are the path minus ".md" — see vault.ts's noteId; memory ids are
 * "mem:<path-under-.daemon/memory-minus-.md>" — see memory.ts). Every other kind (tag/agent/self/
 * daemon/cron/process) carries no note content, so it is never subject to this filter.
 */
export function graphContentPath(node: GraphNode): string | null {
    if (node.kind === 'note') return `${node.id}.md`
    if (node.kind === 'memory')
        return `.daemon/memory/${node.id.slice('mem:'.length)}.md`
    return null
}

/** Community fields `stampCommunities` writes; cleared before re-stamping so a node the stamp
 *  skips (graph now below its minimum size) cannot keep a label computed WITH the dropped notes. */
const COMMUNITY_FIELDS = [
    'community',
    'communityLabel',
    'communityPath',
    'communityPathLabels',
] as const

/**
 * Drop denied note/memory nodes and every edge touching them; then drop tag nodes the drop left
 * with no edges at all (a tag only the hidden note carried — its mere existence would name what the
 * note was about); then RE-STAMP communities on what remains, so no `communityLabel` is a dropped
 * node's title (the label is the highest-degree member's label, and the hidden note is often it).
 *
 * Never mutates the input: graphCache.get() returns the SAME object across every request (and
 * GET /graph/views mutates its `.views` in place), so an in-place filter would corrupt the OWNER's
 * next /graph too. Surviving nodes are cloned before re-stamping. Returns the input unchanged when
 * `entries` is empty or nothing is dropped.
 */
export function filterGraph(graph: GraphData, entries: DenyEntry[]): GraphData {
    if (entries.length === 0) return graph
    const dropped = new Set<string>()
    for (const n of graph.nodes) {
        const rel = graphContentPath(n)
        if (rel && isDeniedPath(entries, rel)) dropped.add(n.id)
    }
    if (dropped.size === 0) return graph

    // Tags that were reachable through a dropped node, and so may now be orphans.
    const touched = new Set<string>()
    for (const e of graph.edges) {
        if (dropped.has(e.from)) touched.add(e.to)
        if (dropped.has(e.to)) touched.add(e.from)
    }
    const edges = graph.edges.filter(
        e => !dropped.has(e.from) && !dropped.has(e.to),
    )
    const connected = new Set<string>()
    for (const e of edges) {
        connected.add(e.from)
        connected.add(e.to)
    }
    const nodes: GraphNode[] = []
    for (const n of graph.nodes) {
        if (dropped.has(n.id)) continue
        if (n.kind === 'tag' && touched.has(n.id) && !connected.has(n.id))
            continue
        const clone: GraphNode = { ...n }
        for (const f of COMMUNITY_FIELDS) delete clone[f]
        nodes.push(clone)
    }

    // Per-view layouts are keyed by node id: a dropped id left in them still names the note.
    let views = graph.views
    if (views) {
        const kept = new Set(nodes.map(n => n.id))
        const strip = <V>(pos: Record<string, V>): Record<string, V> =>
            Object.fromEntries(
                Object.entries(pos).filter(([id]) => kept.has(id)),
            )
        const next: NonNullable<GraphData['views']> = {}
        for (const k of ['second', 'third'] as const) {
            const v = views[k]
            if (v) next[k] = { pos3d: strip(v.pos3d), pos2d: strip(v.pos2d) }
        }
        views = next
    }

    const filtered: GraphData = { ...graph, nodes, edges }
    if (views) filtered.views = views
    return stampCommunities(filtered)
}

/**
 * A tree listing minus denied files and minus directories that would only advertise them. A dir is
 * kept when a kept file sits beneath it. Otherwise it is dropped when it is itself restricted
 * (`restrictedFolder`), OR a denied file sat beneath it (an empty `Private/` whose only note is
 * frontmatter-hidden would name the hidden note's folder), OR any ancestor dir is dropped (so
 * `Vault Hidden/sub/` cannot outlive `Vault Hidden/`). A restricted folder that still holds a
 * visible file (an explicit `visibility: all` override) stays, because the path to that file runs
 * through it. An unrestricted dir that never held a denied file stays even when empty.
 *
 * Keeps `listTree`'s shape (`TreeEntry`: `path` + `kind: 'file' | 'dir'`).
 */
export function filterTree<T extends { path: string; kind: 'file' | 'dir' }>(
    entries: T[],
    deny: DenyEntry[],
    restrictedFolder: (dirRel: string) => boolean,
): T[] {
    if (
        deny.length === 0 &&
        !entries.some(e => e.kind === 'dir' && restrictedFolder(e.path))
    )
        return entries
    const withKept = new Set<string>()
    const withDenied = new Set<string>()
    for (const f of entries) {
        if (f.kind === 'dir') continue
        const target = isDeniedPath(deny, f.path) ? withDenied : withKept
        const segs = f.path.split('/')
        for (let i = 1; i < segs.length; i++)
            target.add(segs.slice(0, i).join('/'))
    }
    // A dir that fails on its own account; descendants of one follow it.
    const selfDropped = (dir: string): boolean =>
        !withKept.has(dir) && (restrictedFolder(dir) || withDenied.has(dir))
    return entries.filter(e => {
        if (e.kind !== 'dir') return !isDeniedPath(deny, e.path)
        const segs = e.path.split('/')
        for (let i = 1; i <= segs.length; i++)
            if (selfDropped(segs.slice(0, i).join('/'))) return false
        return true
    })
}

/**
 * Is `dir` exactly the vault's own memory dir (`<vault>/.daemon/memory`), after `resolve` and
 * `realpath`? An agent's memory dir must be exactly that: memory node ids are relative to the dir
 * passed in, so only the exact dir maps ids onto the vault-relative paths the deny list is keyed
 * by (a subdirectory would put `sub/x.md` at `.daemon/memory/x.md`, matching nothing), and any
 * other dir holds notes the per-note check cannot see. Exact equality is the stricter of the two
 * checks this replaced (graph: exact; memory: exact or beneath). Anything unresolvable is false.
 */
export function agentMemoryDirAllowed(vault: string, dir: string): boolean {
    try {
        return (
            realpathLoose(dir) ===
            realpathLoose(join(vault, '.daemon', 'memory'))
        )
    } catch {
        return false
    }
}

/**
 * Whether a FOLDER is itself restricted for `channel`, from the vault's `folderVisibility` map
 * (`resolveFolderVisibility`: own entry, else nearest ancestor) and the channel rule in
 * visibility.ts (chat sees everything but hidden; daemon only unrestricted). THROWS when
 * `.settings` is unparseable — undetermined is not "nothing is restricted".
 */
export async function folderRestricted(
    vault: string,
    channel: VisibilityChannel,
): Promise<(dirRel: string) => boolean> {
    const res = await readFolderVisibilityResult(vault)
    if (!res.ok) throw new VisibilityUndeterminedError(res.reason)
    const visible = channel === 'chat' ? isVisibleToChat : isVisibleToDaemon
    return dirRel => !visible(resolveFolderVisibility(dirRel, res.map))
}
