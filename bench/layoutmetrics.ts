// Pure layout-quality metrics. No vault, no I/O — so they are unit-testable and reusable by
// both the bench harness and any regression test.
export type Pt = [number, number, number];

const dist = (a: Pt, b: Pt, dim: 2 | 3 = 3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], dim === 3 ? a[2] - b[2] : 0);

/** Deterministic PRNG so sampled metrics are reproducible run to run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Below this many candidate pairs, enumerate exactly instead of Monte-Carlo sampling, so gated
 * metrics (`separationRatio`, `edgeCrossingRate`) are deterministic and independent of the
 * `samples` argument at the graph sizes this tool actually runs on. */
const EXACT_PAIR_LIMIT = 20_000_000;

/**
 * PRIMARY METRIC. For each node, the fraction of its graph neighbours that appear among its
 * k nearest DRAWN neighbours; averaged over all nodes with at least one neighbour.
 * k = "degree" uses each node's own degree (the strictest reading: a node's drawn neighbourhood
 * should BE its graph neighbourhood). A fixed k measures the looser "are they nearby at all".
 * 1 = the drawing tells the truth about adjacency; 0 = it inverts it.
 *
 * `adj[i]` is deduplicated and self-loops are dropped before scoring: Bismuth's vault graph
 * emits one edge per wikilink with no cross-note dedup, so a reciprocal link (A->B and B->A)
 * puts B in adj[A] twice — treating raw entry count as degree would let a reciprocally-linked
 * node score above 1.0 on a perfect drawing.
 */
export function neighbourhoodPreservation(pos: Pt[], adj: number[][], k: number | "degree"): number {
  const n = pos.length;
  const scores: number[] = [];
  for (let i = 0; i < n; i++) {
    const nbs = new Set(adj[i]);
    nbs.delete(i); // self-loops aren't a neighbour to preserve
    const deg = nbs.size;
    if (deg === 0) continue;
    const kk = Math.min(n - 1, k === "degree" ? deg : k);
    if (kk <= 0) continue;
    // k nearest drawn neighbours of i, by partial selection.
    const order = Array.from({ length: n }, (_, j) => j)
      .filter((j) => j !== i)
      .sort((x, y) => dist(pos[i], pos[x]) - dist(pos[i], pos[y]))
      .slice(0, kk);
    const drawn = new Set(order);
    let hit = 0;
    for (const nb of nbs) if (drawn.has(nb)) hit++;
    scores.push(hit / Math.min(deg, kk));
  }
  return mean(scores);
}

/**
 * Mean intra-community distance / mean inter-community distance. LOWER = better separated.
 * Both pools are restricted to communities of size >= 2: community detection leaves isolated
 * nodes in their own singleton community forever, and a singleton can never contribute an intra
 * pair — counting it only feeds the inter pool, so its distance to everything else drags the
 * ratio around by orphan placement alone, with no relation to how well real communities are
 * separated. Enumerates all pairs exactly under EXACT_PAIR_LIMIT so the metric is deterministic
 * at the graph sizes this tool is gated on; falls back to seeded sampling above that.
 * Returns NaN when neither pool has data (e.g. no community of size >= 2 exists) — 0 would read
 * as "perfectly separated", which is indistinguishable from "there was nothing to measure".
 */
export function separationRatio(pos: Pt[], comm: number[], dim: 2 | 3, samples = 400_000): number {
  const n = pos.length;
  if (n < 2) return NaN;
  const counts = new Map<number, number>();
  for (const c of comm) if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
  const valid = (i: number) => comm[i] >= 0 && (counts.get(comm[i]) ?? 0) >= 2;
  const intra: number[] = [], inter: number[] = [];
  const totalPairs = (n * (n - 1)) / 2;
  if (totalPairs <= EXACT_PAIR_LIMIT) {
    for (let i = 0; i < n; i++) {
      if (!valid(i)) continue;
      for (let j = i + 1; j < n; j++) {
        if (!valid(j)) continue;
        const d = dist(pos[i], pos[j], dim);
        if (comm[i] === comm[j]) intra.push(d); else inter.push(d);
      }
    }
  } else {
    const rnd = lcg(12345);
    for (let s = 0; s < samples; s++) {
      const i = (rnd() * n) | 0, j = (rnd() * n) | 0;
      if (i === j || !valid(i) || !valid(j)) continue;
      const d = dist(pos[i], pos[j], dim);
      if (comm[i] === comm[j]) intra.push(d); else inter.push(d);
    }
  }
  if (intra.length === 0 || inter.length === 0) return NaN;
  const mi = mean(inter);
  return mi === 0 ? NaN : mean(intra) / mi;
}

function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const side = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = side(p3, p4, p1), d2 = side(p3, p4, p2);
  const d3 = side(p1, p2, p3), d4 = side(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Fraction of sampled non-adjacent edge PAIRS that cross, in the XY plane. Edge pairs sharing an
 * endpoint are always excluded — not just because a shared endpoint is a degenerate "crossing",
 * but because they can NEVER register as one under `segIntersect`'s strict side test (the shared
 * point always zeroes one of the four side values), so leaving them in the pool only inflates the
 * denominator and dilutes the rate. Hub-heavy vault graphs (a popular tag touching hundreds of
 * notes) make this dilution large. Enumerates all edge pairs exactly under EXACT_PAIR_LIMIT;
 * falls back to seeded sampling above that. Returns NaN when no eligible pair exists (fewer than
 * 2 edges, or every pair shares an endpoint) — 0 would be indistinguishable from "measured zero
 * crossings".
 */
export function edgeCrossingRate(pos: Pt[], edges: { a: number; b: number }[], samples = 300_000): number {
  if (edges.length < 2) return NaN;
  const m = edges.length;
  const totalPairs = (m * (m - 1)) / 2;
  let crossings = 0, tried = 0;
  const consider = (e1: { a: number; b: number }, e2: { a: number; b: number }) => {
    if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) return;
    tried++;
    if (segIntersect(pos[e1.a], pos[e1.b], pos[e2.a], pos[e2.b])) crossings++;
  };
  if (totalPairs <= EXACT_PAIR_LIMIT) {
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) consider(edges[i], edges[j]);
  } else {
    const rnd = lcg(777);
    for (let s = 0; s < samples; s++) {
      const e1 = edges[(rnd() * m) | 0], e2 = edges[(rnd() * m) | 0];
      if (e1 === e2) continue;
      consider(e1, e2);
    }
  }
  return tried === 0 ? NaN : crossings / tried;
}

/** Nearest-neighbour distance distribution: CV (organic vs grid-like), min (overlap), median. */
export function nearestNeighbourStats(pos: Pt[], dim: 2 | 3): { cv: number; min: number; median: number } {
  const n = pos.length;
  if (n < 2) return { cv: 0, min: 0, median: 0 };
  const nn: number[] = [];
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = dist(pos[i], pos[j], dim);
      if (d < best) best = d;
    }
    if (Number.isFinite(best)) nn.push(best);
  }
  const m = mean(nn);
  const cv = m === 0 ? 0 : Math.sqrt(mean(nn.map((v) => (v - m) ** 2))) / m;
  const sorted = [...nn].sort((a, b) => a - b);
  return { cv, min: sorted[0] ?? 0, median: sorted[Math.floor(sorted.length / 2)] ?? 0 };
}

/**
 * DIAGNOSTIC ONLY — never a gate. Correlation between graph-hop distance and drawn distance,
 * from `sources` BFS roots. Measures GLOBAL metric fidelity, which LinLog deliberately trades
 * away for cluster fidelity, so this is expected to fall and that is acceptable. Reported so the
 * trade is visible rather than silent.
 */
export function stressCorrelation(pos: Pt[], adj: number[][], dim: 2 | 3, sources = 40): number {
  const n = pos.length;
  if (n < 2) return 0;
  const rnd = lcg(999);
  const hops: number[] = [], drawn: number[] = [];
  for (let s = 0; s < sources; s++) {
    const src = (rnd() * n) | 0;
    // BFS from src
    const d = new Float64Array(n).fill(Infinity);
    d[src] = 0;
    const q = [src];
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const v of adj[u]) if (!Number.isFinite(d[v])) { d[v] = d[u] + 1; q.push(v); }
    }
    for (let t = 0; t < 200; t++) {
      const j = (rnd() * n) | 0;
      if (j === src || !Number.isFinite(d[j]) || d[j] === 0) continue;
      hops.push(d[j]);
      drawn.push(dist(pos[src], pos[j], dim));
    }
  }
  if (hops.length < 2) return 0;
  const mh = mean(hops), md = mean(drawn);
  let num = 0, dh = 0, dd = 0;
  for (let i = 0; i < hops.length; i++) {
    const x = hops[i] - mh, y = drawn[i] - md;
    num += x * y; dh += x * x; dd += y * y;
  }
  const den = Math.sqrt(dh * dd);
  return den === 0 ? 0 : num / den;
}
