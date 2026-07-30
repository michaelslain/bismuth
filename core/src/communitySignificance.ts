// Is a detected partition REAL, or would a random graph with the same degree sequence score just
// as well? Modularity maximisation finds "communities" in Erdos-Renyi graphs too, and Bismuth's
// Louvain searches the resolution parameter to hit a TARGET group count derived from node count —
// so it always returns groups whether or not the vault has any. Anything the renderer asserts from
// communities (a territory, a NAME) is a claim about the user's vault, so it needs this gate.

/** Newman-Girvan modularity Q of `comm` on the undirected graph `adj`. */
export function modularity(adj: number[][], comm: number[]): number {
  const n = adj.length;
  const deg = adj.map((l) => l.length);
  const m2 = deg.reduce((s, d) => s + d, 0); // 2m
  if (m2 === 0) return 0;
  const inside = new Map<number, number>();  // intra-community edge ends
  const total = new Map<number, number>();   // summed degree per community
  for (let i = 0; i < n; i++) {
    const c = comm[i];
    total.set(c, (total.get(c) ?? 0) + deg[i]);
    for (const j of adj[i]) if (comm[j] === c) inside.set(c, (inside.get(c) ?? 0) + 1);
  }
  let q = 0;
  for (const [c, tot] of total) q += (inside.get(c) ?? 0) / m2 - (tot / m2) ** 2;
  return q;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * Self-contained multi-level Louvain (phase 1 local-moving + phase 2 aggregation, gamma=1, no
 * resolution search or output hierarchy — this module cannot depend on community.ts, which does
 * all of that for the real, production detection) used ONLY to find the BEST modularity a null
 * graph can offer.
 *
 * WHY the null model needs this at all, rather than just `modularity(nullGraph, comm)`: a fixed
 * partition (the caller's `comm`, defined by node INDEX) evaluated against a degree-preserving
 * rewiring is the wrong comparison. Rewiring destroys any relationship between node index and
 * edges, so a partition built around the REAL graph's structure (e.g. contiguous blocks of a ring)
 * reads as near-random noise on the rewired graph — that makes almost ANY structured graph look
 * "significant" against its own null, including a plain ring, which has no real community
 * structure (the brief's ring test catches exactly this: a ring's blocked partition has high raw Q
 * purely because sparse/regular graphs are artificially modularity-friendly for ANY contiguous
 * grouping, not because that particular grouping is meaningful — every rotation of the same blocks
 * scores identically, which is the tell).
 *
 * The question that actually matters is: "would a RANDOM graph with this degree sequence ALSO
 * support a similarly high-modularity partition, if optimised for on its own terms?" — e.g. a
 * degree-preserving rewiring of a ring commonly fragments into several disconnected cycles (2m
 * edges preserved, connectivity is not), and modularity maximisation finds that split (plus
 * whatever further structure a sparse, near-regular graph spuriously offers) just as readily as it
 * "finds" the ring's own blocks. So the null distribution is built from each rewired graph's OWN
 * best-effort partition, not the original `comm` — matching the standard technique (compare the
 * real network's found Q to the best achievable Q on degree-matched random graphs).
 *
 * Aggregation (not just one local-moving pass) matters here specifically: a single flat pass gets
 * stuck well short of the true optimum on regular/near-regular graphs (measured: single-level
 * local-moving on a scrambled 60-node ring plateaus at ~28 communities no matter how low gamma
 * goes), because it can only move ORIGINAL nodes one at a time. Contracting each level's result
 * into super-nodes and repeating lets whole clusters merge as a unit, which is what actually lets
 * the null graph's fragments (or a plain cycle's lack of structure) collapse the way they would
 * under any real Louvain run.
 */
interface WEdge { a: number; b: number; w: number; }

function localMoveLevel(n: number, edges: WEdge[]): Int32Array {
  const adjTo: number[][] = Array.from({ length: n }, () => []);
  const adjW: number[][] = Array.from({ length: n }, () => []);
  const k = new Float64Array(n); // weighted degree (self-loops count twice)
  let m2 = 0;
  for (const e of edges) {
    if (e.a === e.b) { k[e.a] += 2 * e.w; m2 += 2 * e.w; continue; }
    adjTo[e.a].push(e.b); adjW[e.a].push(e.w);
    adjTo[e.b].push(e.a); adjW[e.b].push(e.w);
    k[e.a] += e.w; k[e.b] += e.w; m2 += 2 * e.w;
  }
  const comm = new Int32Array(n);
  for (let i = 0; i < n; i++) comm[i] = i;
  if (m2 > 0) {
    const tot = Float64Array.from(k);
    const MAX_PASSES = 20;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const ci = comm[i];
        tot[ci] -= k[i];
        const wTo = new Map<number, number>();
        wTo.set(ci, 0);
        for (let e = 0; e < adjTo[i].length; e++) {
          const c = comm[adjTo[i][e]];
          wTo.set(c, (wTo.get(c) ?? 0) + adjW[i][e]);
        }
        let best = ci;
        let bestGain = (wTo.get(ci) ?? 0) - (tot[ci] * k[i]) / m2;
        for (const [c, w] of wTo) {
          if (c === ci) continue;
          const gain = w - (tot[c] * k[i]) / m2;
          if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
        }
        tot[best] += k[i];
        if (best !== ci) { comm[i] = best; moved = true; }
      }
      if (!moved) break;
    }
  }
  const dense = new Map<number, number>();
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let d = dense.get(comm[i]);
    if (d === undefined) { d = dense.size; dense.set(comm[i], d); }
    out[i] = d;
  }
  return out;
}

/** Best-effort (unconstrained, gamma=1) modularity partition of `adj`, lifted back onto the
 *  original nodes through however many aggregation levels it took to converge. */
function louvainBest(adj: number[][]): number[] {
  const n0 = adj.length;
  const baseEdges: WEdge[] = [];
  for (let i = 0; i < n0; i++) for (const j of adj[i]) if (i < j) baseEdges.push({ a: i, b: j, w: 1 });
  const mapping = Array.from({ length: n0 }, (_, i) => i); // original node -> current-level community
  let curN = n0;
  let curEdges = baseEdges;
  const MAX_LEVELS = 10;
  for (let level = 0; level < MAX_LEVELS; level++) {
    const part = localMoveLevel(curN, curEdges);
    const newN = new Set(part).size;
    for (let i = 0; i < n0; i++) mapping[i] = part[mapping[i]];
    if (newN === curN) break; // converged: no further merging possible
    const w = new Map<number, number>();
    for (const e of curEdges) {
      const a = part[e.a], b = part[e.b];
      const key = a <= b ? a * newN + b : b * newN + a;
      w.set(key, (w.get(key) ?? 0) + e.w);
    }
    curEdges = [...w.entries()].map(([key, ww]) => ({ a: Math.floor(key / newN), b: key % newN, w: ww }));
    curN = newN;
  }
  return mapping;
}

/** Degree-preserving rewiring (double-edge swap), so the null keeps the real degree sequence. */
function rewire(adj: number[][], rnd: () => number): number[][] {
  const edges: [number, number][] = [];
  for (let i = 0; i < adj.length; i++) for (const j of adj[i]) if (i < j) edges.push([i, j]);
  const swaps = edges.length * 10;
  for (let s = 0; s < swaps; s++) {
    const x = (rnd() * edges.length) | 0, y = (rnd() * edges.length) | 0;
    if (x === y) continue;
    const [a, b] = edges[x], [c, d] = edges[y];
    if (a === c || a === d || b === c || b === d) continue;
    edges[x] = [a, d];
    edges[y] = [c, b];
  }
  const out: number[][] = Array.from({ length: adj.length }, () => []);
  for (const [a, b] of edges) { out[a].push(b); out[b].push(a); }
  return out;
}

/**
 * Mean + sd of the BEST modularity achievable over degree-preserving random graphs — i.e. for each
 * rewired graph, its own best-effort partition (`louvainBest`). Depends ONLY on `adj`: the null is a
 * property of the graph's DEGREE SEQUENCE, not of any particular partition (see the `void comm` note
 * on `nullModelModularity` below). Exported standalone so a caller gating SEVERAL partitions of the
 * SAME graph (e.g. every level of a community hierarchy) can compute this ONCE and reuse it, instead
 * of paying for it per level via `nullModelModularity`/`significance` — measured gating a 3-level
 * hierarchy: ~1.7s recomputing per level vs ~0.6s computed once and shared.
 *
 * PRECONDITION: `adj` must contain no self-loops (no `adj[i]` listing `i`) — `rewire`'s double-edge
 * swap assumes every edge joins two distinct nodes. Not defended here (deliberately: the current
 * caller, `engine.ts`'s graph builder, already excludes self-edges before this module ever sees the
 * adjacency, so the condition is unreachable today); a future caller feeding in raw/untrusted edges
 * would need to filter self-loops first.
 */
export function nullModelForGraph(
  adj: number[][], trials = 30, seed = 4242,
): { mean: number; sd: number } {
  // trials <= 1 cannot estimate a spread at all: `reduce` over 0-1 samples silently produced
  // mean=0, sd=0, which made `significance` treat EVERY graph with Q > 0 as significant without
  // running a single real trial (the `sd === 0` branch below then divides-by-zero to Infinity, i.e.
  // the gate was always open). Clamp toward MORE evidence, never toward none — this is what makes a
  // `trials` perf knob exposed to a caller safe to turn down aggressively.
  const t = Math.max(2, trials | 0);
  const rnd = lcg(seed);
  const qs: number[] = [];
  for (let i = 0; i < t; i++) {
    const nullAdj = rewire(adj, rnd);
    qs.push(modularity(nullAdj, louvainBest(nullAdj)));
  }
  const mean = qs.reduce((s, v) => s + v, 0) / qs.length;
  const sd = Math.sqrt(qs.reduce((s, v) => s + (v - mean) ** 2, 0) / qs.length);
  return { mean, sd };
}

/**
 * Mean + sd of Q for the same partition over degree-preserving random graphs — kept for interface
 * compatibility; delegates entirely to `nullModelForGraph`, which is what actually runs.
 *
 * `comm` IS ACCEPTED BUT DELIBERATELY IGNORED. Do not "fix" this by wiring it back in: re-scoring
 * `comm` against a rewired graph is the EXACT semantics this module exists to reject (see
 * `louvainBest`'s doc comment above) — a fixed, index-defined partition evaluated against scrambled
 * edges reads as near-zero regardless of whether the source graph has real structure, which makes
 * the significance test always pass. Measured on the naive design this module replaced: null mean
 * ≈ -0.014 for a ring, ≈ -0.029 for two cliques, ≈ -0.005 for the reference vault — every one of
 * those collapses the test to "is Q > 0?", which any Louvain output satisfies by construction, real
 * structure or not. The test file pins this invariance directly (`nullModelModularity is invariant
 * to comm`) — if that test starts failing because `comm` got wired back in, the test is correct and
 * the change is the regression.
 */
export function nullModelModularity(
  adj: number[][], comm: number[], trials = 30, seed = 4242,
): { mean: number; sd: number } {
  void comm;
  return nullModelForGraph(adj, trials, seed);
}

/**
 * `significant` = the partition's Q is at least 2 sd above the degree-preserving null.
 *
 * Two things this number does NOT mean — read before wiring it into any downstream decision:
 *
 *  - **`z` is not comparable across graph sizes, or between vaults/levels.** Textbook-perfect,
 *    fully-separated cliques still under-report on small graphs: two cliques of 3 nodes measure
 *    z≈0.42 (a false negative against the z>=2 gate); of 4, z≈1.84 (still a false negative); of 6,
 *    z≈3.55; ten cliques of 6, z≈26.6. A small vault can fail this test with perfect community
 *    structure simply for being small. Never rank levels, or compare vaults, by z magnitude — it
 *    only answers yes/no for THIS partition of THIS graph.
 *  - **A large z is margin ÷ a very small null spread, not a Gaussian tail probability.** On the
 *    2262-node reference vault, sd(Q_null) ≈ 0.0024 (a coefficient of variation of ~0.55% on a
 *    null mean of ~0.44), so z≈102 reads as "102 null-standard-deviations", not a sigma count with
 *    a meaningful tail probability behind it — the null model has no probability mass out there to
 *    speak of. If a downstream decision needs to explain itself to a person, report the raw margin
 *    (Q minus nullMean — 0.26 / 0.18 / 0.04 across that vault's three levels, against a spread of
 *    0.0024) rather than "z=102".
 */
export function significance(
  adj: number[][], comm: number[], trials = 30,
): { q: number; nullMean: number; nullSd: number; z: number; significant: boolean } {
  const q = modularity(adj, comm);
  const { mean, sd } = nullModelModularity(adj, comm, trials);
  // Fail CLOSED when the null has no measured spread: a zero-variance null carries no evidence
  // either way (with trials clamped to >= 2 in `nullModelForGraph`, this is now a rare residual
  // case — e.g. two sampled null graphs coincidentally tying in Q — rather than the guaranteed
  // empty-array case trials<=1 used to produce), so `q > mean` alone must never read as
  // "significant". The old `q > mean ? Infinity : 0` did exactly that.
  const z = sd === 0 ? 0 : (q - mean) / sd;
  return { q, nullMean: mean, nullSd: sd, z, significant: z >= 2 };
}
