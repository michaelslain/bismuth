// The pure half of the layout cache: diffing a warm-start seed against a new graph, and remapping a
// seed's ids across a rename. No fs, no cache state, no layout compute — layout-cache.ts owns all of
// that and calls in here, so this module is exactly as testable as its inputs are hand-buildable.
import type { GraphData } from './graph'
import type { Positions } from './layout'
import { noteId } from './pathUtils'

export type Layout = {
    pos3d: Positions
    pos2d: Positions
    /**
     * Seeds only (layout-cache.ts's lastFullLayout / lastSecondLayout / lastThirdLayout and their on-disk
     * copies): the graph's sorted `from|to|kind` edge keys, the same strings graphSig hashes. They let the
     * next build diff EDGES as well as node ids, so a link edit moves only its two endpoints. Optional
     * because a seed written before seeds carried edges is still valid — for one build it just falls back
     * to the older rule (a pure add pins, anything else is a full warm settle).
     * Per-signature layout entries (memCache / `<sig>.json`) never carry it.
     */
    edges?: string[]
}

// Cap on the pinned incremental path: when more nodes than max(INCREMENTAL_MAX_ADD, INCREMENTAL_MAX_FRAC
// of the graph) would have to move, a large batch is better re-optimized globally by a full warm rebuild.
export const INCREMENTAL_MAX_ADD = 25
export const INCREMENTAL_MAX_FRAC = 0.1

export type DiffPlan = { fixed: string[]; movable: string[]; removed: string[] }

/** An edge's identity string, `from|to|kind` — hashed by graphSig and stored on seeds. */
export function edgeKey(e: { from: string; to: string; kind: string }): string {
    return `${e.from}|${e.to}|${e.kind}`
}

export function sortedEdgeKeys(graph: GraphData): string[] {
    return graph.edges.map(edgeKey).sort()
}

const edgeKeysCache = new WeakMap<GraphData, string[]>()
/** `graph`'s sorted edge keys, built once per graph object. Safe because nothing mutates a GraphData's
 *  nodes/edges in place once built (the same argument as layout-cache.ts's memoSig). */
export function edgeKeysOf(graph: GraphData): string[] {
    let keys = edgeKeysCache.get(graph)
    if (!keys) {
        keys = sortedEdgeKeys(graph)
        edgeKeysCache.set(graph, keys)
    }
    return keys
}

/**
 * Recover an edge key's endpoints. Note ids are file paths and may themselves contain `|`, so the key
 * is not split blindly: the kind is everything after the LAST `|` (no kind contains one), and the
 * from/to boundary is the first `|` whose two sides are both ids `known` accepts. Null when no
 * boundary qualifies — callers treat that edge as not touching any node they care about.
 */
export function splitEdgeKey(
    key: string,
    known: (id: string) => boolean,
): { from: string; to: string; kind: string } | null {
    const k = key.lastIndexOf('|')
    for (
        let i = key.indexOf('|');
        i >= 0 && i < k;
        i = key.indexOf('|', i + 1)
    ) {
        const from = key.slice(0, i)
        const to = key.slice(i + 1, k)
        if (known(from) && known(to))
            return { from, to, kind: key.slice(k + 1) }
    }
    return null
}

/**
 * What the next build must actually compute, given the previous seed and the new graph:
 *   - `removed` — seed ids no longer in the graph (simply dropped; they never cost a tick).
 *   - `movable` — nodes that must settle: every ADDED node, plus both endpoints of every edge in the
 *     symmetric difference of the seed's edges and the graph's whose two endpoints are both SURVIVORS
 *     (in the seed and the graph). An edge touching an added or removed node never counts — it
 *     appeared or vanished only because its node did. So removing a note moves nobody, a pure add
 *     moves only the added nodes, and a link edited between two existing notes moves exactly those two.
 *   - `fixed` — every other graph id, pinned exactly where the seed has it.
 * Both lists follow the graph's node order. A seed without `edges` (written before seeds carried them)
 * can't diff edges, so it keeps the old rule: a pure add only, anything else is null. Null — a full warm
 * settle — also when the seed is empty or `movable` exceeds the cap.
 */
export function diffPlan(seed: Layout, graph: GraphData): DiffPlan | null {
    const seedIds = Object.keys(seed.pos3d)
    if (seedIds.length === 0) return null
    const seedSet = new Set(seedIds)
    const newSet = new Set(graph.nodes.map(n => n.id))
    const removed = seedIds.filter(id => !newSet.has(id))
    const movableSet = new Set<string>()
    for (const id of newSet) if (!seedSet.has(id)) movableSet.add(id) // added
    if (!seed.edges) {
        if (removed.length > 0 || movableSet.size === 0) return null
    } else {
        const survivor = (id: string) => seedSet.has(id) && newSet.has(id)
        const seedEdges = new Set(seed.edges)
        const newEdges = new Set(edgeKeysOf(graph))
        for (const e of graph.edges) {
            if (seedEdges.has(edgeKey(e))) continue
            if (!survivor(e.from) || !survivor(e.to)) continue
            movableSet.add(e.from)
            movableSet.add(e.to)
        }
        for (const key of seed.edges) {
            if (newEdges.has(key)) continue
            const e = splitEdgeKey(key, survivor)
            if (!e) continue
            movableSet.add(e.from)
            movableSet.add(e.to)
        }
    }
    const cap = Math.max(
        INCREMENTAL_MAX_ADD,
        Math.floor(graph.nodes.length * INCREMENTAL_MAX_FRAC),
    )
    if (movableSet.size > cap) return null
    const fixed: string[] = []
    const movable: string[] = []
    for (const id of newSet) (movableSet.has(id) ? movable : fixed).push(id)
    return { fixed, movable, removed }
}

/** A note file, as opposed to a folder: the graph's note nodes come only from `.md` files. */
const NOTE_FILE_RE = /\.md$/i

/**
 * The id rewrite for a rename or move from `fromRel` to `toRel` (vault-relative paths, in the shape
 * `POST /move` receives): null for an id the move does not touch. A note file (`a/b.md`) renames the
 * one id `noteId(fromRel)` to `noteId(toRel)`; a folder (`a/b`, trailing slashes ignored) rewrites the
 * prefix of every id under `a/b/`. The two are kept apart on purpose — a note `proj.md` beside a folder
 * `proj/` (the folder-note pattern) is untouched by a move of the folder and vice versa.
 */
export function idRenamer(
    fromRel: string,
    toRel: string,
): (id: string) => string | null {
    const from = fromRel.replace(/\/+$/, '')
    const to = toRel.replace(/\/+$/, '')
    if (NOTE_FILE_RE.test(from)) {
        const fromId = noteId(from)
        const toId = noteId(to)
        return id => (id === fromId ? toId : null)
    }
    return id => (id.startsWith(`${from}/`) ? to + id.slice(from.length) : null)
}

/** A copy of `seed` with every id `rename` maps (non-null) rewritten, in positions and edges alike. Never
 *  edits `seed`: a seed's position maps are shared with the pre-rename graph's cached layout. */
export function remapSeed(
    seed: Layout,
    rename: (id: string) => string | null,
): Layout {
    // The pre-rename ids, captured before anything is rewritten: edge keys are split against these.
    const ids = new Set(Object.keys(seed.pos3d))
    const remap = (pos: Positions): Positions => {
        const out: Positions = {}
        const moved: [string, Positions[string]][] = []
        for (const id in pos) {
            const next = rename(id)
            if (next === null) out[id] = pos[id]
            else moved.push([next, pos[id]])
        }
        // A moved entry wins over a stale id already sitting at its destination.
        for (const [id, p] of moved) out[id] = p
        return out
    }
    const out: Layout = { pos3d: remap(seed.pos3d), pos2d: remap(seed.pos2d) }
    if (seed.edges) {
        const edges = new Set<string>()
        for (const key of seed.edges) {
            const e = splitEdgeKey(key, id => ids.has(id))
            edges.add(
                e
                    ? edgeKey({
                          from: rename(e.from) ?? e.from,
                          to: rename(e.to) ?? e.to,
                          kind: e.kind,
                      })
                    : key,
            )
        }
        out.edges = [...edges].sort()
    }
    return out
}
