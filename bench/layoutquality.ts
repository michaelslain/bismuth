// bench/layoutquality.ts
// Layout QUALITY measurement over a real vault, through the production cold path in
// layout-cache.ts layoutFor(): 3D at REFINE_TICKS, then 2D seeded from that 3D.
// READ-ONLY on the vault. Never point this at the user's real vault — use the sandbox copy.
//
// NaN handling: separationRatio/edgeCrossingRate (bench/layoutmetrics.ts) return NaN on an empty
// measurement pool (e.g. the graph collapsing to one community, or fewer than 2 edges). A raw
// JSON.stringify would silently turn that into `null`, and a downstream "NaN <= baseline" gate
// comparison is ALWAYS false — i.e. it would silently PASS a run that actually lost its data. So
// every metric value is sanitised to the literal string "NaN" before serialising, and any NaN
// triggers a loud stderr warning.
//
// Exact-vs-sampled path: separationRatio/edgeCrossingRate switch from exact pair enumeration to
// seeded sampling above EXACT_PAIR_LIMIT candidate pairs (imported from layoutmetrics.ts, never
// duplicated here). The switch is silent in the metrics themselves, so this harness recomputes the
// same threshold check and records which path each metric took — a future run on a bigger vault
// that silently falls into sampling must not be compared against an exact baseline unlabelled.
process.emitWarning = () => {};

import { buildGraph } from "../core/src/engine";
import { computeLayoutAsync, type Positions } from "../core/src/layout";
import { REFINE_TICKS } from "../core/src/layout-cache";
import {
  neighbourhoodPreservation, separationRatio, edgeCrossingRate, nearestNeighbourStats,
  stressCorrelation, EXACT_PAIR_LIMIT, type Pt,
} from "./layoutmetrics";

const argv = process.argv.slice(2);
const flag = (n: string, d = "") => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const VAULT = flag("vault");
if (!VAULT) { console.error("--vault <dir> is required"); process.exit(1); }
if (VAULT.includes("library of alexandria")) {
  console.error("refusing to run against the user's real vault — use the sandbox copy");
  process.exit(1);
}
const LABEL = flag("label", "current");
const OUT = flag("out");
const EXTRA = JSON.parse(flag("opts", "{}"));

const graph = await buildGraph(VAULT, `${VAULT}/.daemon/memory`);

const ids = graph.nodes.map((n) => n.id);
const idx = new Map(ids.map((id, i) => [id, i]));
const n = ids.length;
const adj: number[][] = Array.from({ length: n }, () => []);
const edges: { a: number; b: number }[] = [];
for (const e of graph.edges) {
  const a = idx.get(e.from), b = idx.get(e.to);
  if (a === undefined || b === undefined || a === b) continue;
  adj[a].push(b); adj[b].push(a);
  edges.push({ a, b });
}
const comm = graph.nodes.map((nd) => (typeof nd.community === "number" ? nd.community : -1));
const input = { nodes: graph.nodes, edges: graph.edges.map((e) => ({ from: e.from, to: e.to })) };

// Same "exact vs sampled" arithmetic as separationRatio/edgeCrossingRate themselves (layoutmetrics.ts),
// against the SAME imported constant — never a duplicated literal that could drift out of sync.
const separationPairs = (n * (n - 1)) / 2;
const crossingPairs = (edges.length * (edges.length - 1)) / 2;
const paths = {
  separation: { pairs: separationPairs, exact: separationPairs <= EXACT_PAIR_LIMIT },
  crossings: { pairs: crossingPairs, exact: crossingPairs <= EXACT_PAIR_LIMIT },
  exactPairLimit: EXACT_PAIR_LIMIT,
};

const t3 = performance.now();
const pos3d = await computeLayoutAsync(input, { dimensions: 3, refineTicks: REFINE_TICKS, ...EXTRA });
const ms3d = Math.round(performance.now() - t3);
const t2 = performance.now();
const pos2d = await computeLayoutAsync(input, { dimensions: 2, refineTicks: REFINE_TICKS, initialPositions: pos3d, ...EXTRA });
const ms2d = Math.round(performance.now() - t2);

// JSON.stringify silently turns NaN into `null` — indistinguishable from "field was never set" and
// invisible to a naive reader. Sanitise every metric to the literal string "NaN" instead, and warn
// loudly so it can never sail through unnoticed.
function sanitizeNaN(dimLabel: "d2" | "d3", obj: Record<string, number>): Record<string, number | "NaN"> {
  const out: Record<string, number | "NaN"> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Number.isNaN(v)) {
      console.error(`WARNING: ${dimLabel}.${k} is NaN — the measurement pool was empty (see bench/layoutmetrics.ts doc comments). This is NOT a valid "0" measurement.`);
      out[k] = "NaN";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function measure(pos: Positions, dim: 2 | 3, dimLabel: "d2" | "d3") {
  const P: Pt[] = ids.map((id) => (pos[id] ?? [0, 0, 0]) as Pt);
  const nn = nearestNeighbourStats(P, dim);
  return sanitizeNaN(dimLabel, {
    neighbourhoodPreservationDegree: neighbourhoodPreservation(P, adj, "degree"),
    neighbourhoodPreservationK10: neighbourhoodPreservation(P, adj, 10),
    separation: separationRatio(P, comm, dim),
    crossings: dim === 2 ? edgeCrossingRate(P, edges) : 0,
    nnCV: nn.cv,
    nnMin: nn.min,
    nnMedian: nn.median,
    stressCorrelation: stressCorrelation(P, adj, dim), // diagnostic, never a gate
  });
}

const report = {
  label: LABEL,
  opts: EXTRA,
  vault: { dir: VAULT, nodes: n, edges: edges.length, communities: new Set(comm.filter((c) => c >= 0)).size },
  timing: { layout3dMs: ms3d, layout2dMs: ms2d, totalMs: ms3d + ms2d },
  paths,
  d3: measure(pos3d, 3, "d3"),
  d2: measure(pos2d, 2, "d2"),
};
const json = JSON.stringify(report, null, 2);
console.log(json);
if (OUT) await Bun.write(OUT, json + "\n");
