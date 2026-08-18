// bench/layoutquality.ts
// Layout QUALITY measurement over a real vault, through the production cold path in
// layout-cache.ts layoutFor(): 3D at REFINE_TICKS, then 2D seeded from that 3D.
// READ-ONLY on the vault. Never point this at the user's real vault — use the sandbox copy.
//
// NaN/non-finite handling: separationRatio/edgeCrossingRate (bench/layoutmetrics.ts) return NaN on
// an empty measurement pool (e.g. the graph collapsing to one community, or fewer than 2 edges).
// JSON.stringify silently turns a non-finite number into `null` — indistinguishable from a field
// that was simply never set — so every metric is checked with `Number.isFinite` and, if it fails,
// (a) serialised as its own `String(v)` (e.g. the literal `"NaN"`) instead of a bare `null`, (b)
// named in a top-level `nanFields` list, (c) logged as a loud stderr warning, and (d) forces
// `process.exitCode = 2` so a wrapper gating on exit status can't mistake a data-loss run for a
// clean pass. (`!Number.isFinite` rather than `Number.isNaN` so a future metric returning
// ±Infinity — also silently `null`-ed by JSON.stringify — is caught the same way.)
//
// Exact-vs-sampled path: separationRatio/edgeCrossingRate switch from exact pair enumeration to
// seeded sampling above EXACT_PAIR_LIMIT candidate pairs (imported from layoutmetrics.ts, never
// duplicated here). The switch is silent in the metrics themselves, so this harness recomputes the
// same threshold check and records which path each metric took — a future run on a bigger vault
// that silently falls into sampling must not be compared against an exact baseline unlabelled.
//
// Fingerprint: node/edge counts alone under-detect structural drift (e.g. a wikilink retarget
// changes which nodes connect without changing any count). `vault.fingerprint` is a sha256 (first
// 16 hex chars) over sorted node ids then sorted `from|to|kind` edge keys, so any structural change
// is caught even when nodes/edges/communities counts hold steady. Deliberately NOT layout-cache.ts's
// `graphSig` — that includes `CACHE_VERSION`, which is expected to change across this plan's later
// tasks, and would make an unchanged graph look different run to run. Exact construction (must match
// byte-for-byte for an independent reimplementation to reproduce this value — see `fingerprint()`
// below): sort node ids ascending (default JS string sort); hash each id followed by `"\n"`, in
// order; then sort `${e.from}|${e.to}|${e.kind}` edge keys ascending over the RAW `graph.edges`
// (before this file's own self-loop/dangling filtering — see the incident note below); hash each
// edge key followed by `"\n"`, in order, onto the SAME running hasher (one continuous byte stream:
// all sorted ids, each `\n`-terminated, immediately followed by all sorted edge keys, each
// `\n`-terminated — no separator marks the boundary between the two groups). Take the first 16 hex
// characters of the resulting digest.
//
// Incident note (2026-07-30): a reviewer's scratch script counted raw `graph.edges.length` (5078)
// and compared it against this harness's REPORTED `vault.edges` (5077, post self-loop-filter — this
// graph has exactly one self-loop edge), and read the gap as baseline drift from a daemon write that
// had actually landed before, not after, the original capture. It hadn't drifted; the two counts
// were just never comparable. `vault.edgesRaw`/`vault.selfLoops` below exist so that mistake can't
// recur: the filtered and unfiltered counts, and their difference, are now both always visible in
// the same report instead of one having to be reconstructed by reading source.
process.emitWarning = () => {}

import { realpathSync } from 'node:fs'
import { buildGraph } from '../core/src/engine'
import { computeLayoutAsync, type Positions } from '../core/src/layout'
import { REFINE_TICKS } from '../core/src/layout-cache'
import {
    neighbourhoodPreservation,
    separationRatio,
    edgeCrossingRate,
    nearestNeighbourStats,
    stressCorrelation,
    EXACT_PAIR_LIMIT,
    type Pt,
} from './layoutmetrics'

const argv = process.argv.slice(2)
const flag = (n: string, d = '') => {
    const i = argv.indexOf(`--${n}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const VAULT = flag('vault')
if (!VAULT) {
    console.error('--vault <dir> is required')
    process.exit(1)
}
// Resolve symlinks + relativity before the guard: a raw substring test on the unresolved argument
// is bypassable by case (macOS filesystems are typically case-insensitive), a relative path
// (`--vault .` from inside the real vault), or a symlink that only points there indirectly.
let resolvedVault: string
try {
    resolvedVault = realpathSync(VAULT)
} catch (err) {
    console.error(
        `--vault ${VAULT} does not exist or is not accessible: ${(err as Error).message}`,
    )
    process.exit(1)
}
if (resolvedVault.toLowerCase().includes('library of alexandria')) {
    console.error(
        "refusing to run against the user's real vault — use the sandbox copy",
    )
    process.exit(1)
}
const LABEL = flag('label', 'current')
const OUT = flag('out')
const EXTRA = JSON.parse(flag('opts', '{}'))

// --opts may only ADD forces (e.g. a Task-4 sweep tuning a new linlog parameter); it must never be
// able to redefine the harness's own fixed contract — production cold-path replication depends on
// EXACTLY these four staying at their harness-chosen values (dimensions/refineTicks pinned to
// REFINE_TICKS; initialPositions seeding 2D from 3D). Letting `--opts` silently override, say,
// `refineTicks` would let a fast sweep compare a 120-tick run against a 240-tick baseline with no
// signal anything had changed.
const RESERVED_OPT_KEYS = [
    'dimensions',
    'refineTicks',
    'initialPositions',
    'fixedIds',
] as const
for (const k of RESERVED_OPT_KEYS) {
    if (k in EXTRA) {
        console.error(
            `--opts may not set "${k}" — it is part of the harness's fixed cold-path contract. --opts may only ADD forces, never redefine dimensions/refineTicks/initialPositions/fixedIds.`,
        )
        process.exit(1)
    }
}

const graph = await buildGraph(VAULT, `${VAULT}/.daemon/memory`)

const ids = graph.nodes.map(n => n.id)
const idx = new Map(ids.map((id, i) => [id, i]))
const n = ids.length
const adj: number[][] = Array.from({ length: n }, () => [])
const edges: { a: number; b: number }[] = []
for (const e of graph.edges) {
    const a = idx.get(e.from),
        b = idx.get(e.to)
    if (a === undefined || b === undefined || a === b) continue
    adj[a].push(b)
    adj[b].push(a)
    edges.push({ a, b })
}
const comm = graph.nodes.map(nd =>
    typeof nd.community === 'number' ? nd.community : -1,
)
const input = {
    nodes: graph.nodes,
    edges: graph.edges.map(e => ({ from: e.from, to: e.to })),
}

// See the file-header "Fingerprint" comment for the exact byte-level construction this must
// reproduce — this is the canonical implementation of that spec, not a second source of truth.
function fingerprint(
    nodeIds: string[],
    graphEdges: { from: string; to: string; kind: string }[],
): string {
    const hasher = new Bun.CryptoHasher('sha256')
    for (const id of [...nodeIds].sort()) hasher.update(id + '\n')
    const edgeKeys = graphEdges.map(e => `${e.from}|${e.to}|${e.kind}`).sort()
    for (const key of edgeKeys) hasher.update(key + '\n')
    return hasher.digest('hex').slice(0, 16)
}
const vaultFingerprint = fingerprint(ids, graph.edges)

// Same "exact vs sampled" arithmetic as separationRatio/edgeCrossingRate themselves (layoutmetrics.ts),
// against the SAME imported constant — never a duplicated literal that could drift out of sync.
const separationPairs = (n * (n - 1)) / 2
const crossingPairs = (edges.length * (edges.length - 1)) / 2
const paths = {
    separation: {
        pairs: separationPairs,
        exact: separationPairs <= EXACT_PAIR_LIMIT,
    },
    crossings: {
        pairs: crossingPairs,
        exact: crossingPairs <= EXACT_PAIR_LIMIT,
    },
    exactPairLimit: EXACT_PAIR_LIMIT,
}

const t3 = performance.now()
const pos3d = await computeLayoutAsync(input, {
    dimensions: 3,
    refineTicks: REFINE_TICKS,
    ...EXTRA,
})
const ms3d = Math.round(performance.now() - t3)
const t2 = performance.now()
const pos2d = await computeLayoutAsync(input, {
    dimensions: 2,
    refineTicks: REFINE_TICKS,
    initialPositions: pos3d,
    ...EXTRA,
})
const ms2d = Math.round(performance.now() - t2)

// JSON.stringify silently turns a non-finite number into `null` — indistinguishable from "field
// was never set" and invisible to a naive reader. Sanitise every metric to its own `String(v)`
// (e.g. the literal "NaN") instead, collect its dotted path into `nanFields`, and warn loudly so it
// can never sail through unnoticed.
const nanFields: string[] = []
function sanitizeNaN(
    dimLabel: 'd2' | 'd3',
    obj: Record<string, number>,
): Record<string, number | string> {
    const out: Record<string, number | string> = {}
    for (const [k, v] of Object.entries(obj)) {
        if (!Number.isFinite(v)) {
            const path = `${dimLabel}.${k}`
            console.error(
                `WARNING: ${path} is ${v} — the measurement pool was empty (see bench/layoutmetrics.ts doc comments). This is NOT a valid "0" measurement.`,
            )
            nanFields.push(path)
            out[k] = String(v)
        } else {
            out[k] = v
        }
    }
    return out
}

function measure(pos: Positions, dim: 2 | 3, dimLabel: 'd2' | 'd3') {
    const P: Pt[] = ids.map(id => (pos[id] ?? [0, 0, 0]) as Pt)
    const nn = nearestNeighbourStats(P, dim)
    return sanitizeNaN(dimLabel, {
        neighbourhoodPreservationDegree: neighbourhoodPreservation(
            P,
            adj,
            'degree',
        ),
        neighbourhoodPreservationK10: neighbourhoodPreservation(P, adj, 10),
        separation: separationRatio(P, comm, dim),
        crossings: dim === 2 ? edgeCrossingRate(P, edges) : 0,
        nnCV: nn.cv,
        nnMin: nn.min,
        nnMedian: nn.median,
        stressCorrelation: stressCorrelation(P, adj, dim), // diagnostic, never a gate
    })
}

const d3metrics = measure(pos3d, 3, 'd3')
const d2metrics = measure(pos2d, 2, 'd2')

const report = {
    label: LABEL,
    opts: EXTRA,
    vault: {
        dir: VAULT,
        edges: edges.length, // filtered: self-loops + dangling refs dropped, same set the metrics run over
        edgesRaw: graph.edges.length, // unfiltered graph.edges.length — compare like-for-like against this, not `edges`
        // edgesRaw - edges: self-loop edges PLUS any dangling-ref edges (both dropped by the same filter
        // loop above); named `selfLoops` because that's the only contributor ever observed in this vault
        // (exactly 1) — NOT itself drift, see the incident note above.
        selfLoops: graph.edges.length - edges.length,
        nodes: n,
        communities: new Set(comm.filter(c => c >= 0)).size,
        fingerprint: vaultFingerprint,
    },
    timing: { layout3dMs: ms3d, layout2dMs: ms2d, totalMs: ms3d + ms2d },
    paths,
    nanFields,
    d3: d3metrics,
    d2: d2metrics,
}
if (nanFields.length > 0) process.exitCode = 2
const json = JSON.stringify(report, null, 2)
console.log(json)
if (OUT) await Bun.write(OUT, json + '\n')
