// Backend layout precompute + cache. Computes BOTH a 3D and a flat 2D layout for the graph
// (PivotMDS + force refine, see layout.ts) and attaches `position` / `position2d` to every node, so
// the browser renders both modes instantly and morphs smoothly between them — never running the
// expensive force settle on its main thread. The 2D layout is seeded from the flattened 3D one so
// the two stay aligned (a 2D↔3D morph flattens in place instead of scrambling).
//
// Caching is two-tier: an in-memory map (survives within a server run) and a JSON file on disk, keyed
// by a graph signature. IMPORTANT: the disk cache lives under a DURABLE app dir (~/.bismuth/layout-cache),
// NOT inside the vault/memory dirs — writing there would trip the fs watcher and trigger an infinite
// invalidate → rebuild → recompute → rewrite loop. It used to live in os.tmpdir(), but macOS purges
// /tmp periodically (and it's empty on every fresh process), so a meaningful fraction of cold boots
// recomputed the whole (multi-second) layout from scratch; a durable dir makes a normal close/reopen a
// reliable cache hit. Override with BISMUTH_LAYOUT_CACHE_DIR (used by tests to isolate/redirect the cache).
import {
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
    unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { computeLayoutAsync, type LayoutInput, type Positions } from './layout'
import {
    subgraphByKinds,
    type GraphData,
    type ViewLayout,
    SECOND_BRAIN_KINDS as SECOND_KINDS,
    THIRD_BRAIN_KINDS as THIRD_KINDS,
} from './graph'
import { noteId } from './pathUtils'

export type Layout = {
    pos3d: Positions
    pos2d: Positions
    /**
     * Seeds only (lastFullLayout / lastSecondLayout / lastThirdLayout and their on-disk copies): the
     * graph's sorted `from|to|kind` edge keys, the same strings graphSig hashes. They let the next build
     * diff EDGES as well as node ids, so a link edit moves only its two endpoints. Optional because a
     * seed written before seeds carried edges is still valid — for one build it just falls back to the
     * older rule (a pure add pins, anything else is a full warm settle).
     * Per-signature layout entries (memCache / `<sig>.json`) never carry it.
     */
    edges?: string[]
}

/** One layout computation, with no cache or seed bookkeeping: everything `computeLayoutPair` needs. */
export type LayoutJob = {
    input: LayoutInput
    refineTicks: number
    seed?: Layout
    fixedIds?: string[]
}

/** Drop the trailing z from a Positions triple — pos2d entries are [x,y,z] with z=0. */
const to2d = (p: number[]): [number, number] => [p[0], p[1]]

const CACHE_DIR =
    process.env.BISMUTH_LAYOUT_CACHE_DIR ||
    join(homedir(), '.bismuth', 'layout-cache')
// v20: LinLog energy model + degree-proportional repulsion now DEFAULT (layout.ts LayoutOptions
//      energyModel/degreeRepulsion, resolved in withDefaults) — attraction along links is ln(1+d)
//      instead of a Hooke spring, and many-body repulsion is scaled by (degree+1) per node. Task 4's
//      measurement on the reference vault (fingerprint 5558f545e13b163b), WITH both community forces
//      active: d3 NP-degree separation 0.0557→0.1242, d2 0.0398→0.1302, both clearly better than the
//      old spring default. BOTH community forces (gravity AND separation) stay — an initial pass
//      deleted community-level SEPARATION on a d3-only reading of Task 4's ablation ("~1.6%
//      contribution"), but fix round 1 found the d2 statistic loses 7.9% (not 1.6%) and a tag-hub-heavy
//      synthetic fixture regresses ~2x without it; both are now documented next to COMMUNITY_SEP_MULT
//      in layout.ts. The already-inactive grid-lattice placement, per-member containment, and disc-
//      flatten bias are genuinely dead code and stay removed (measured to move nothing). Every 2D AND
//      3D coordinate moves for every graph, purely from the energy-model + degree-repulsion default
//      flip (community forces were already the default pre-Task-5, unchanged in strength here).
//      MUST bump — same reasoning as v19/v18/.../v12 below: graphSig() and seedPath() are both
//      versioned, so the first build after the bump is a full cold settle under the new physics and no
//      node stays pinned at a v19 position.
// v19: ASCII redesign, part 2 — two changes, shipped together because the first doesn't work without
//      the second (an adversarial review caught this before it shipped: see both comments below):
//      (a) COMMUNITY_SEP_MULT (layout.ts) 1.6 → 2.4 ("things more separated and clustered": whole
//          communities push much further apart — see layout.ts's comment for the sweep, re-measured on
//          the real reference vault after the original single-level synthetic fixture's "intra spacing
//          untouched by construction" claim turned out to be an artifact of testing a flat partition —
//          on a real multi-level hierarchy intra spacing grows too, just more slowly than the
//          inter-community gap);
//      (b) REFINE_TICKS (this file) 120 → 240: at the wider (a) target, 120 ticks no longer converges
//          — measured on the reference vault (2121 nodes, 3-level hierarchy) through the exact
//          production pipeline (3D @ refineTicks, 2D seeded from it @ refineTicks), the coarsest-level
//          2D separation ratio (lower = better; same statistic as layout.test.ts's separation()) went
//          0.851 (1.6@120, pre-change) → 0.884 (2.4@120, WORSE — the regression an adversarial review
//          caught) → 0.700 (2.4@240, clearly better than the pre-change baseline). (a) alone, at the
//          old tick budget, was a net regression; shipping them together is what actually helps — see
//          REFINE_TICKS's own comment below for the full table.
//      Both change 3D AND 2D output for every graph whose nodes carry a `community` (every vault graph
//      — engine.ts stamps it), same scope as v13/v15.
//      MUST bump — same reasoning as v18/v17/.../v12 below: graphSig() and seedPath() are both
//      versioned, so the first build after the bump is a full cold settle at the new clearance/budget
//      and no node stays pinned at a v18 (tighter-lane, 120-tick) position.
// v18: ASCII redesign — LayoutOptions.clusterLayout's DEFAULT flips from "grid" (2D only) to
//      "organic" (both dimensions): every top-level cluster now finds its own place via the existing
//      community gravity + community-level collide forces instead of being anchored onto a lattice
//      cell. "grid" is unchanged and stays available as an explicit opt-in. Every 2D coordinate moves
//      (3D was already organic by default, so 3D output is untouched) — the hierarchy now reads
//      through the ASCII renderer's zoom-driven node color + labels instead of grid-cell islands (see
//      AsciiGraphRenderer.ts). MUST bump — same reasoning as v17/v16/v15/v13/v12 below: graphSig()
//      and seedPath() are both versioned, so the first build after the bump is a full cold settle
//      under the new default and no node stays pinned at a v17 (gridded) position.
// v17: GRID-ISLAND CONTAINMENT (layout.ts "CONTAINMENT" block) — a per-tick radial constraint now
//      holds every 2D node inside its island's disc, and island hosting for a too-small top-level
//      group is decided per GROUP instead of per node. Measured on the reference vault: nodes inside
//      their island 0.957 → 1.000 (riders 0.500 → 1.000), island pairs overlapping on their settled
//      p95 radii 42/105 → 0/105. Every 2D coordinate moves (3D is untouched, but the 2D layout is
//      seeded from it, so the entry is keyed as a whole).
//      MUST bump — same reasoning as v16/v15/v13/v12 below: graphSig() and seedPath() are both
//      versioned, so the first build after the bump is a full cold settle under the constraint and no
//      node stays pinned at a v16 position.
// v16: GRID ISLANDS (layout.ts "GRID ISLANDS" block) — the 2D layout now anchors every top-level
//      cluster onto a coarse lattice cell with provable empty lanes, instead of letting the community
//      forces negotiate cluster positions. Every 2D coordinate moves (3D is untouched, but the 2D
//      layout is seeded from it, so the entry is keyed as a whole). Also v16: the cluster EXEMPLAR
//      rule changed (community.ts pickExemplar — tag-preferred, shortest-name), which changes
//      `communityLabel`/`communityPathLabels`; those are not layout coordinates, but they are baked
//      into the same graph payload, so a bump keeps the two consistent.
//      MUST bump — same reasoning as v15/v13/v12 below: graphSig() and seedPath() are both versioned,
//      so the first build after the bump is a full cold settle under the new placement and no node
//      stays pinned at a v15 position.
// v15: HIERARCHICAL communities. Two changes, both of which move every node:
//      (a) the detector is now Louvain (community.ts), not label propagation, so the `community`
//          ids the finest-level forces key off are different values AND a different partition;
//      (b) a vault big enough for 2+ levels (>= ~360 nodes) gets extra gravity + separation forces
//          per ancestor level (layout.ts "Nesting"), so super-clusters clump and spread too.
//      MUST bump — same reasoning as v13/v12 below: graphSig() and seedPath() are both versioned,
//      so the first build after the bump is a full cold PivotMDS settle under the new forces and no
//      node stays pinned at a v14 position.
// v13: community-aware clustering forces (layout.ts COMMUNITY_* — anisotropic intra/inter-community
//      links, packing-floored centroid gravity, community-level collide) so communities read as
//      distinct blobs when zoomed out instead of one intermingled field. Changes 3D AND 2D output for
//      every graph whose nodes carry a `community` (i.e. every vault graph — engine.ts stamps it).
//      MUST bump, and the bump alone is sufficient to self-heal: BOTH keys that could otherwise pin
//      the old physics forever are versioned — graphSig() (the per-graph layout entry) and
//      seedPath() (the per-vault warm-start seed the incremental path pins nodes AT). A v12 seed is
//      therefore never read again, so no node is pinned at a v12 position; the first build after the
//      bump is a full cold PivotMDS settle under the new forces, and every later warm/incremental
//      rebuild seeds from THAT. (The in-memory lastFullLayout/lastSecondLayout/lastThirdLayout maps
//      only ever hold layouts produced in the current process — or renameLayoutIds' remapped copy of
//      the same versioned on-disk seed — so they carry no stale physics.)
// v12: repulsion -10→-7 and MODE_2D_COLLIDE_MULT 1.2→0.65 (layout.ts) — shorter 3D edges and a
//      less uniform 2D packing. MUST bump: graphSig() keys the cache on CACHE_VERSION alone, so
//      without it every existing user keeps their v11 layout and sees no change whatsoever —
//      and it would not self-heal, because attachLayout warm-starts from the stale seed and the
//      incremental path pins every pre-existing node.
// v11: discBias default reverted to 0 (the v10 flattening read as a squashed blob on real vaults,
//      not a planet) — bump so v10's flattened seeds don't pin the restored spherical shape.
// v10: 3D layout gets a degree-weighted disc-flatten bias (planet-with-rings shape; layout.ts
//      discFlattenForce) — changes 3D output for every graph. 2D output is untouched (discBias only
//      applies when dim===3).
// v9: incremental "add-only" rebuilds pin pre-existing nodes (layout.ts fixedIds) so only new nodes
//     settle — different output than the old whole-graph warm re-settle for newly-added structures.
// v8: reel disconnected components into the main mass via virtual tether links (layout.ts) — orphan
//     notes (no in-view links) no longer fling out to an empty direction; changes any >1-component graph.
// v7: stronger small-graph linkDist boost (400/n, cap 8) — much airier small graphs.
// v6: small-graph linkDist boost added (sqrt(500/n) factor in layout.ts) changes layout output.
// v5: collide iterations 3→6 + padding 1.25→1.55 (anti-overlap).
const CACHE_VERSION = 'v20' // v20: LinLog energy model + degree-proportional repulsion by default
// (community gravity + separation both unchanged); grid-islands,
// containment, and disc-flatten removed (see the comment above)
// 120 → 240 (2026-07-27, same pass as COMMUNITY_SEP_MULT above): at the raised multiplier, 120 ticks no
// longer fully settles the wider target before the budget runs out. Measured on the reference vault
// (2121 nodes / 4560-ish edges, 3-level hierarchy) through this EXACT production pipeline (3D @
// refineTicks, then 2D seeded from that 3D @ refineTicks — see layoutFor below), coarsest-level (L0) 2D
// separation ratio (lower = better, same statistic as layout.test.ts's separation()):
//   mult \ ticks    120     240
//   1.6             0.851   0.763
//   2.4             0.884   0.700
// 2.4@120 (0.884) is WORSE than the pre-change 1.6@120 baseline (0.851) — the sim simply hasn't reached
// the wider target inside the old budget (this is the regression an adversarial review caught before
// it shipped). 2.4@240 (0.700) is clearly the best of the four: an 18% improvement over the 1.6@120
// baseline, and better than just giving the OLD multiplier the same extra ticks (1.6@240 = 0.763) — so
// the win is the multiplier PLUS the budget, not the budget alone. Cost: ~2x a cold layout (~10.2s →
// ~20s for 2121 nodes, both dimensions combined) — paid once per structural graph change that the
// incremental diff can't absorb, and cached to disk (see CACHE_DIR above); REFINE_TICKS_INCREMENTAL (the
// pinned incremental path, below) is untouched.
export const REFINE_TICKS = 240 // exported so tests can assert AT the production budget by
// construction (see core/test/layout.test.ts) instead of a literal
// that can silently drift out of sync with what actually ships.
// Incremental (pinned) rebuild: every node the diff didn't mark movable — added nodes plus both
// endpoints of a changed edge between surviving nodes (see diffPlan) — is pinned, so far fewer ticks
// converge (the early-exit in computeLayoutAsync usually stops sooner). Cap the number of movable nodes
// that take this path — a large batch import is better re-optimized globally by a full warm rebuild.
const REFINE_TICKS_INCREMENTAL = 60
const INCREMENTAL_MAX_ADD = 25
const INCREMENTAL_MAX_FRAC = 0.1
// Per-signature layouts, bounded: each entry holds a whole graph's positions, and every structural edit
// mints new signatures (full + 2nd + 3rd brain), so an unbounded map grows for the life of the process.
// Least-recently-SET is evicted; a hit re-sets its entry (delete-then-set keeps Map insertion order as
// the recency order). A miss falls back to the `<sig>.json` disk entry, so eviction only costs a read.
const MEM_CACHE_MAX = 16
const memCache = new Map<string, Layout>()

function rememberLayout(sig: string, layout: Layout): void {
    memCache.delete(sig)
    memCache.set(sig, layout)
    while (memCache.size > MEM_CACHE_MAX) {
        const oldest = memCache.keys().next().value
        if (oldest === undefined) break
        memCache.delete(oldest)
    }
}

// --- Disk cache eviction -----------------------------------------------------------------------
// CACHE_DIR is uncapped by nature (a layout/seed file per graph signature, forever), so a long-lived
// machine accumulates one entry per structural edit ever made across every vault — measured at 3,174
// entries / 426MB on a real machine with no eviction at all. Bound it to a LRU-by-mtime cap, checked
// right after every write (the only place the dir can grow), rather than on every read.
const DEFAULT_MAX_CACHE_ENTRIES = 1000

/** Read lazily (not cached at module load, unlike CACHE_DIR) so tests can override
 *  BISMUTH_LAYOUT_CACHE_MAX_ENTRIES per-call without needing to control import order. */
function maxCacheEntries(): number {
    const raw = Number(process.env.BISMUTH_LAYOUT_CACHE_MAX_ENTRIES)
    return Number.isFinite(raw) && raw > 0
        ? Math.floor(raw)
        : DEFAULT_MAX_CACHE_ENTRIES
}

/**
 * Bound `dir` to at most `maxEntries` `.json` files, evicting the OLDEST (by mtime) first. Any name
 * in `protect` (bare filename, no directory) is never evicted regardless of age — callers pass the
 * file they just wrote (or are about to read later in the same call) so a write can never evict
 * itself. Best-effort and total: a missing or unwritable `dir` degrades to a silent no-op, matching
 * every other cache path in this module (the disk cache is a convenience, never load-bearing).
 */
export function pruneCacheDir(
    dir: string,
    maxEntries: number,
    protect: Set<string> = new Set(),
): void {
    let names: string[]
    try {
        names = readdirSync(dir).filter(n => n.endsWith('.json'))
    } catch {
        return // missing/unreadable dir — nothing to prune
    }
    const excess = names.length - maxEntries
    if (excess <= 0) return
    const stamped = names
        .filter(n => !protect.has(n))
        .map(n => {
            try {
                return { name: n, mtime: statSync(join(dir, n)).mtimeMs }
            } catch {
                return null // vanished between the readdir and the stat — nothing to evict
            }
        })
        .filter((e): e is { name: string; mtime: number } => e !== null)
        .sort((a, b) => a.mtime - b.mtime)
    for (const e of stamped.slice(0, excess)) {
        try {
            unlinkSync(join(dir, e.name))
        } catch {
            /* best-effort — already gone, or a race with another writer, is fine */
        }
    }
}
// -------------------------------------------------------------------------------------------------

// --- Per-graph-object memoization -------------------------------------------------------------
// graphSig() sorts every node id (O(n log n)) + every edge string (O(m log m)); subgraphByKinds()
// walks the whole node/edge list (O(n+m)). Both are pure functions of a GraphData's structure, and
// nothing downstream ever mutates a GraphData's nodes/edges in place (subgraphByKinds only reads
// `n.kind`/`e.from`/`e.to`; computeLayoutAsync's prepareLayout only reads `.id`/`.from`/`.to` off the
// nodes/edges it's given — see layout.ts). So for a given graph OBJECT, its signature and its 2nd/3rd
// brain subgraphs are safe to compute once and reuse for every later call that happens to receive the
// exact same reference — notably attachLayout's peek (below) followed by a computeViewLayouts call
// over the identical cached graph (e.g. GET /graph/views, or the background view-layout warm-up in
// server.ts, both of which operate on the same object graphCache.get() keeps returning until the next
// rebuild). WeakMap so entries vanish on their own once a graph is superseded by the next rebuild.
const sigCache = new WeakMap<GraphData, { vaultKey: string; sig: string }>()
function memoSig(graph: GraphData, vaultKey: string): string {
    const cached = sigCache.get(graph)
    if (cached && cached.vaultKey === vaultKey) return cached.sig
    const sig = graphSig(graph, vaultKey)
    sigCache.set(graph, { vaultKey, sig })
    return sig
}

const brainSubgraphCache = new WeakMap<
    GraphData,
    { second: GraphData; third: GraphData }
>()
/** The 2nd-brain (note+tag) and 3rd-brain (memory) subgraphs of `graph`, built once per graph object
 *  and reused by every later caller that passes the same reference. `subgraphByKinds` is pure and
 *  order-preserving, so a cached subgraph is structurally identical to a freshly-built one. */
function brainSubgraphs(graph: GraphData): {
    second: GraphData
    third: GraphData
} {
    let subgraphs = brainSubgraphCache.get(graph)
    if (!subgraphs) {
        subgraphs = {
            second: subgraphByKinds(graph, SECOND_KINDS),
            third: subgraphByKinds(graph, THIRD_KINDS),
        }
        brainSubgraphCache.set(graph, subgraphs)
    }
    return subgraphs
}

const edgeKeysCache = new WeakMap<GraphData, string[]>()
/** `graph`'s sorted edge keys (see edgeKey), built once per graph object — the same immutability
 *  argument as memoSig above. Stored on every seed and diffed by diffPlan. */
function edgeKeysOf(graph: GraphData): string[] {
    let keys = edgeKeysCache.get(graph)
    if (!keys) {
        keys = sortedEdgeKeys(graph)
        edgeKeysCache.set(graph, keys)
    }
    return keys
}
// -----------------------------------------------------------------------------------------------

// Last full-graph layout per vault, kept so a structural edit warm-starts the next build from where
// the graph already was instead of a cold PivotMDS, and lets diffPlan pin every node the edit didn't
// touch so only added nodes and changed-edge endpoints settle (or, for a pure removal or a rename that
// renameLayoutIds already remapped, nothing is computed at all). Persisted to disk (see read/writeSeed)
// so the warm-start survives a process restart — without it, the first structural edit after relaunch
// paid a cold PivotMDS. Only the FULL graph is seeded here (not subgraph/view layouts), keyed by vaultKey.
const lastFullLayout = new Map<string, Layout>()
// Per-view (2nd = note+tag, 3rd = memory) warm-start seeds, mirroring lastFullLayout. Without
// these, computeViewLayouts took the full COLD path (pivotMDS + all refine ticks) on every
// structural edit while in 2nd/3rd-brain mode — the seeds make view rebuilds incremental like
// the full graph's. Keyed with a suffix so the on-disk copies never collide with the full seed.
const lastSecondLayout = new Map<string, Layout>()
const lastThirdLayout = new Map<string, Layout>()

/** An edge's identity string, `from|to|kind` — hashed by graphSig and stored on seeds. */
function edgeKey(e: { from: string; to: string; kind: string }): string {
    return `${e.from}|${e.to}|${e.kind}`
}

function sortedEdgeKeys(graph: GraphData): string[] {
    return graph.edges.map(edgeKey).sort()
}

/**
 * Recover an edge key's endpoints. Note ids are file paths and may themselves contain `|`, so the key
 * is not split blindly: the kind is everything after the LAST `|` (no kind contains one), and the
 * from/to boundary is the first `|` whose two sides are both ids `known` accepts. Null when no
 * boundary qualifies — callers treat that edge as not touching any node they care about.
 */
function splitEdgeKey(
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

/** Stable signature of the graph's structure (node set + edge endpoints) — changes when the graph does.
 *  Edges are hashed by their sorted `from|to|kind` keys, not just their count, so retargeting a wikilink
 *  between two existing notes ([[A]] → [[B]]: same node set, same edge count) still busts the cache. */
export function graphSig(graph: GraphData, vaultKey: string): string {
    const ids = graph.nodes
        .map(n => n.id)
        .sort()
        .join('\n')
    const edges = sortedEdgeKeys(graph).join('\n')
    const h = createHash('sha1')
        .update(vaultKey)
        .update(' ')
        .update(ids)
        .update(' ')
        .update(edges)
        .digest('hex')
    return `${CACHE_VERSION}-${h.slice(0, 16)}`
}

function readDisk(sig: string): Layout | null {
    try {
        return JSON.parse(
            readFileSync(join(CACHE_DIR, `${sig}.json`), 'utf8'),
        ) as Layout
    } catch {
        return null
    }
}

async function writeDisk(sig: string, layout: Layout): Promise<void> {
    try {
        mkdirSync(CACHE_DIR, { recursive: true })
        const name = `${sig}.json`
        // Async write (Bun.write) instead of writeFileSync: the layout JSON can be
        // multi-MB for a large vault, and a sync write here blocks Bun's single thread
        // on the /graph path — stalling concurrent /file reads. JSON.stringify is still
        // sync, but the blocking syscall is the bigger offender; the await also lets the
        // event loop service other requests while the bytes flush.
        await Bun.write(join(CACHE_DIR, name), JSON.stringify(layout))
        // Protect the entry we just wrote — this call must never evict what it just created.
        pruneCacheDir(CACHE_DIR, maxCacheEntries(), new Set([name]))
    } catch {
        // cache dir unavailable — in-memory cache still applies for this run
    }
}

/** Disk path for a vault's persisted warm-start seed (the last full layout), keyed by vaultKey so
 *  the warm-start survives a restart. Versioned with CACHE_VERSION so a layout-algorithm change
 *  ignores stale seeds. */
function seedPath(vaultKey: string): string {
    const h = createHash('sha1').update(vaultKey).digest('hex').slice(0, 16)
    return join(CACHE_DIR, `seed-${CACHE_VERSION}-${h}.json`)
}

function readSeed(vaultKey: string): Layout | null {
    try {
        return JSON.parse(readFileSync(seedPath(vaultKey), 'utf8')) as Layout
    } catch {
        return null
    }
}

async function writeSeed(vaultKey: string, layout: Layout): Promise<void> {
    try {
        mkdirSync(CACHE_DIR, { recursive: true })
        const path = seedPath(vaultKey)
        await Bun.write(path, JSON.stringify(layout))
        // Protect the seed we just wrote — this call must never evict what it just created.
        pruneCacheDir(CACHE_DIR, maxCacheEntries(), new Set([basename(path)]))
    } catch {
        // cache dir unavailable — in-memory lastFullLayout still seeds this run
    }
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
 * A seed without `edges` (written before seeds carried them) can't diff edges, so it keeps the old
 * rule: a pure add only, anything else is null. Null — a full warm settle — also when the seed is
 * empty or `movable` exceeds the cap (a big batch is better re-optimized globally).
 */
function diffPlan(
    seed: Layout,
    graph: GraphData,
): { fixed: string[]; movable: string[]; removed: string[] } | null {
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

/** The zero-compute layout for a diff with nothing movable: every graph node keeps its seed position
 *  exactly, and the seed's removed ids are simply left out. */
function layoutFromSeed(seed: Layout, graph: GraphData): Layout {
    const pos3d: Positions = {}
    const pos2d: Positions = {}
    for (const n of graph.nodes) {
        const p3 = seed.pos3d[n.id]
        pos3d[n.id] = p3
        pos2d[n.id] = seed.pos2d[n.id] ?? [p3[0], p3[1], 0]
    }
    return { pos3d, pos2d }
}

/** 2D warm-start seed for an incremental rebuild: pinned (existing) nodes hold their PRIOR 2D position
 *  (so 2D stays as stable as 3D), while movable nodes start from their freshly-settled 3D position
 *  flattened (so the 2D layout stays aligned with 3D and the morph flattens in place). */
function incremental2dSeed(
    seed: Layout,
    pos3d: Positions,
    fixed: Set<string>,
): Positions {
    const out: Positions = {}
    for (const id of fixed) {
        const p2 = seed.pos2d[id]
        const p3 = seed.pos3d[id]
        out[id] = p2 ? [p2[0], p2[1], 0] : p3 ? [p3[0], p3[1], 0] : [0, 0, 0]
    }
    for (const id in pos3d) {
        if (fixed.has(id)) continue
        const p = pos3d[id]
        out[id] = [p[0], p[1], 0]
    }
    return out
}

/**
 * The pure 3D-then-2D compute for one job — no cache, no seeds, no shared state — so it can run
 * anywhere (a worker included) unchanged. With `fixedIds` + `seed` it is the pinned incremental
 * settle: every fixed node holds its seed position in both dimensions and only the rest settle. Without
 * them it is a full settle, warm-started from `seed.pos3d` when there is a seed, else cold PivotMDS.
 * Either way the 2D layout is seeded from the 3D one, so a 2D↔3D morph flattens in place.
 */
export async function computeLayoutPair(
    job: LayoutJob,
    signal?: AbortSignal,
): Promise<Layout> {
    const { input, refineTicks, seed, fixedIds } = job
    if (fixedIds && seed) {
        const fixed = new Set(fixedIds)
        const pos3d = await computeLayoutAsync(input, {
            dimensions: 3,
            refineTicks,
            initialPositions: seed.pos3d,
            fixedIds,
            signal,
        })
        const pos2d = await computeLayoutAsync(input, {
            dimensions: 2,
            refineTicks,
            initialPositions: incremental2dSeed(seed, pos3d, fixed),
            fixedIds,
            signal,
        })
        return { pos3d, pos2d }
    }
    const pos3d = await computeLayoutAsync(input, {
        dimensions: 3,
        refineTicks,
        initialPositions: seed?.pos3d,
        signal,
    })
    const pos2d = await computeLayoutAsync(input, {
        dimensions: 2,
        refineTicks,
        initialPositions: pos3d,
        signal,
    })
    return { pos3d, pos2d }
}

/** Compute the layout for one graph signature and cache it (memory + disk). A diff with nothing
 *  movable takes no compute at all; a small one pins everything else; anything else is a full settle. */
async function buildLayout(
    graph: GraphData,
    sig: string,
    seed: Layout | undefined,
    signal: AbortSignal,
): Promise<Layout> {
    const plan = seed ? diffPlan(seed, graph) : null
    let layout: Layout
    if (seed && plan && plan.movable.length === 0) {
        layout = layoutFromSeed(seed, graph)
    } else {
        const input: LayoutInput = {
            nodes: graph.nodes,
            edges: graph.edges.map(e => ({ from: e.from, to: e.to })),
        }
        layout = await computeLayoutPair(
            seed && plan
                ? {
                      input,
                      refineTicks: REFINE_TICKS_INCREMENTAL,
                      seed,
                      fixedIds: plan.fixed,
                  }
                : { input, refineTicks: REFINE_TICKS, seed },
            signal,
        )
    }
    await writeDisk(sig, layout)
    rememberLayout(sig, layout)
    return layout
}

// In-flight layout builds, keyed by graph signature, so concurrent callers for the same graph share ONE
// computation (first launch used to compute the view layouts twice at once: the boot warm-up and
// GET /graph/views both missed the cache). `waiters` counts the callers still interested; a caller
// with a signal stops waiting when it aborts, and the shared build is aborted only when the LAST
// waiter has gone. A caller without a signal holds its build to completion.
type InFlightLayout = {
    promise: Promise<Layout>
    controller: AbortController
    waiters: number
}
const inFlight = new Map<string, InFlightLayout>()

function joinBuild(
    sig: string,
    entry: InFlightLayout,
    signal: AbortSignal | undefined,
): Promise<Layout> {
    entry.waiters++
    if (!signal) return entry.promise
    return new Promise<Layout>((resolve, reject) => {
        const onAbort = () => {
            entry.waiters--
            if (entry.waiters === 0) {
                // Unlist it first, so a caller arriving now starts a fresh build instead of joining
                // this doomed one.
                if (inFlight.get(sig) === entry) inFlight.delete(sig)
                entry.controller.abort()
            }
            reject(signal.reason)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        entry.promise.then(
            value => {
                signal.removeEventListener('abort', onAbort)
                resolve(value)
            },
            err => {
                signal.removeEventListener('abort', onAbort)
                reject(err)
            },
        )
    })
}

/** Compute (or fetch from cache) the 3D + flat-2D layout for one graph. A full settle of a few thousand
 *  nodes takes seconds; a small incremental diff far less, and a removal or remapped rename nothing.
 *  Uses the event-loop-yielding layout so a big settle doesn't block concurrent requests. `seed` (the
 *  prior layout) skips PivotMDS on a miss and drives diffPlan. Aborting `signal` rejects this caller
 *  with its reason, and cancels the computation once no other caller is waiting on it. */
async function layoutFor(
    graph: GraphData,
    vaultKey: string,
    seed?: Layout,
    signal?: AbortSignal,
): Promise<Layout> {
    signal?.throwIfAborted()
    const sig = memoSig(graph, vaultKey)
    const hit = memCache.get(sig) ?? readDisk(sig)
    if (hit) {
        rememberLayout(sig, hit)
        return hit
    }
    let entry = inFlight.get(sig)
    if (!entry) {
        const controller = new AbortController()
        const created: InFlightLayout = {
            promise: buildLayout(graph, sig, seed, controller.signal),
            controller,
            waiters: 0,
        }
        const release = () => {
            if (inFlight.get(sig) === created) inFlight.delete(sig)
        }
        // Also the build's own rejection handler, so a build every waiter abandoned never surfaces
        // as an unhandled rejection.
        created.promise.then(release, release)
        inFlight.set(sig, created)
        entry = created
    }
    return joinBuild(sig, entry, signal)
}

/** The seed to keep after a build: the layout's positions plus the graph's edge keys, so the next build
 *  can diff edges. A new object — the positions are shared with the memCache entry, never mutated. */
function seedOf(layout: Layout, graph: GraphData): Layout {
    return {
        pos3d: layout.pos3d,
        pos2d: layout.pos2d,
        edges: edgeKeysOf(graph),
    }
}

/** A note file, as opposed to a folder: the graph's note nodes come only from `.md` files. */
const NOTE_FILE_RE = /\.md$/i

/**
 * Carry a rename or move over to the warm-start seeds, so the next build's diff is empty and the moved
 * notes keep their exact positions with zero compute (otherwise each moved note reads as a removal plus
 * an add, and re-settles from scratch). `fromRel`/`toRel` are vault-relative, as POST /move receives
 * them: a note file (`a/b.md`) renames the one id `noteId(fromRel)` to `noteId(toRel)`; a folder (`a/b`)
 * rewrites the prefix of every id under `a/b/`. The two are kept apart on purpose — a note `proj.md`
 * beside a folder `proj/` (the folder-note pattern) is untouched by a move of the folder and vice
 * versa. Ids inside `seed.edges` are rewritten the same way.
 *
 * Rewrites the in-memory seeds of all three layouts (full, 2nd, 3rd brain) for `vaultKey`, loading the
 * on-disk seed first when none is in memory; the disk copy itself is rewritten by the next build. Every
 * seed is copied, never edited in place: its positions are shared with the pre-rename graph's memCache
 * entry. Call it after the move succeeds and before invalidating the graph — an in-flight build that
 * predates the move is aborted by that invalidation and never writes its (pre-rename) seed back.
 */
export function renameLayoutIds(
    vaultKey: string,
    fromRel: string,
    toRel: string,
): void {
    const from = fromRel.replace(/\/+$/, '')
    const to = toRel.replace(/\/+$/, '')
    const rename: (id: string) => string | null = NOTE_FILE_RE.test(from)
        ? id => (id === noteId(from) ? noteId(to) : null)
        : id => (id.startsWith(`${from}/`) ? to + id.slice(from.length) : null)
    const seeds: [Map<string, Layout>, string][] = [
        [lastFullLayout, vaultKey],
        [lastSecondLayout, `${vaultKey}::second`],
        [lastThirdLayout, `${vaultKey}::third`],
    ]
    for (const [kept, diskKey] of seeds) {
        const seed = kept.get(vaultKey) ?? readSeed(diskKey)
        if (seed) kept.set(vaultKey, remapSeed(seed, rename))
    }
}

/** A copy of `seed` with every id `rename` maps (non-null) rewritten, in positions and edges alike. */
function remapSeed(
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

/**
 * Cached layout for a graph (in-memory or on-disk) WITHOUT computing it. Returns null when
 * absent. An empty graph has the trivial empty layout, so callers treat it as "cached"
 * (e.g. the 3rd-brain subgraph when there is no memory dir) instead of scheduling work.
 */
export function peekLayout(graph: GraphData, vaultKey: string): Layout | null {
    if (graph.nodes.length === 0) return { pos3d: {}, pos2d: {} }
    const sig = memoSig(graph, vaultKey)
    const hit = memCache.get(sig) ?? readDisk(sig)
    if (hit) rememberLayout(sig, hit)
    return hit ?? null
}

/**
 * Compute (and cache) BOTH brain-view layouts for a graph. Called on demand by the
 * /graph/views endpoint when the user switches to 2nd/3rd-brain mode — attachLayout omits
 * them from the cold /graph so first paint only pays for the full-graph layout. Aborting
 * `opts.signal` rejects with its reason and never writes either view seed.
 */
export async function computeViewLayouts(
    graph: GraphData,
    vaultKey: string,
    opts?: { signal?: AbortSignal },
): Promise<{ second: ViewLayout; third: ViewLayout }> {
    const signal = opts?.signal
    const { second: secondGraph, third: thirdGraph } = brainSubgraphs(graph)
    // Warm-start each view from its previous layout (in-memory, then on-disk) exactly like
    // attachLayout does for the full graph — a structural edit then pins every node the edit
    // didn't touch instead of re-running the whole cold pipeline.
    const secondSeed =
        lastSecondLayout.get(vaultKey) ??
        readSeed(`${vaultKey}::second`) ??
        undefined
    const thirdSeed =
        lastThirdLayout.get(vaultKey) ??
        readSeed(`${vaultKey}::third`) ??
        undefined
    // second and third are disjoint subgraphs with independent seeds/caches/disk files — nothing about
    // one depends on the other, and computeLayoutAsync yields the event loop, so run them concurrently.
    const [second, third] = await Promise.all([
        layoutFor(secondGraph, vaultKey, secondSeed, signal),
        layoutFor(thirdGraph, vaultKey, thirdSeed, signal),
    ])
    // An aborted build must never write a seed: POST /move remaps the seeds (renameLayoutIds) and then
    // aborts the build that predates it, and this build — already past its last tick, or on the
    // zero-compute path that never checks the signal — would otherwise put the pre-rename ids back.
    signal?.throwIfAborted()
    const secondNext = seedOf(second, secondGraph)
    const thirdNext = seedOf(third, thirdGraph)
    lastSecondLayout.set(vaultKey, secondNext)
    void writeSeed(`${vaultKey}::second`, secondNext)
    lastThirdLayout.set(vaultKey, thirdNext)
    void writeSeed(`${vaultKey}::third`, thirdNext)
    return { second: toViewLayout(second), third: toViewLayout(third) }
}

function toViewLayout(layout: Layout): ViewLayout {
    // Copy pos2d to drop the trailing z=0 that Positions always carries (it's a [x,y,z] triple even for 2D).
    const pos2d: ViewLayout['pos2d'] = {}
    for (const id in layout.pos2d) {
        pos2d[id] = to2d(layout.pos2d[id])
    }
    return { pos3d: layout.pos3d, pos2d }
}

/** Attach the full-graph layout (and the brain-view layouts when already cached) to `graph`. Aborting
 *  `opts.signal` rejects with its reason and never writes the seed. */
export async function attachLayout(
    graph: GraphData,
    vaultKey: string,
    opts?: { signal?: AbortSignal },
): Promise<GraphData> {
    if (graph.nodes.length === 0) return graph
    const signal = opts?.signal
    // Warm-start the full-graph layout from the previous one for this vault (skips cold PivotMDS on a
    // structural edit; diffPlan pins every node the edit didn't touch), then remember the result as the
    // seed for the next rebuild. The seed falls back to the on-disk copy so the warm-start survives a
    // process restart.
    const seed = lastFullLayout.get(vaultKey) ?? readSeed(vaultKey) ?? undefined
    const layout = await layoutFor(graph, vaultKey, seed, signal)
    // Never write a seed from an aborted build — see the same check in computeViewLayouts. For a cached
    // graph the layout above resolves at once, so this check is the only thing standing between a
    // superseded build and a seed that renameLayoutIds has already remapped.
    signal?.throwIfAborted()
    const nextSeed = seedOf(layout, graph)
    lastFullLayout.set(vaultKey, nextSeed)
    void writeSeed(vaultKey, nextSeed)
    // Brain-view layouts (2nd = note+tag, 3rd = memory) are only used in 2nd/3rd-brain
    // mode. Attach them only when ALREADY cached (a cheap peek) so the cold first /graph
    // pays for just the full-graph layout. When absent they're computed on demand via
    // GET /graph/views; the frontend falls back to full-graph positions until then.
    const { second: secondGraph, third: thirdGraph } = brainSubgraphs(graph)
    const second = peekLayout(secondGraph, vaultKey)
    const third = peekLayout(thirdGraph, vaultKey)
    const views =
        second && third
            ? { second: toViewLayout(second), third: toViewLayout(third) }
            : undefined

    return {
        edges: graph.edges,
        views,
        nodes: graph.nodes.map(n => {
            const p3 = layout.pos3d[n.id]
            const p2 = layout.pos2d[n.id]
            if (!p3 && !p2) return n
            const updates: Partial<typeof n> = {}
            if (p3) updates.position = p3
            if (p2) updates.position2d = to2d(p2)
            return { ...n, ...updates }
        }),
    }
}
