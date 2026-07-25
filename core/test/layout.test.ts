import { test, expect } from "bun:test";
import { computeLayout, computeLayoutAsync, pivotMDS, type Positions } from "../src/layout";

function ring(n: number) {
  return {
    nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}` })),
    edges: Array.from({ length: n }, (_, i) => ({ from: `n${i}`, to: `n${(i + 1) % n}` })),
  };
}

function dist(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test("computeLayout returns a finite position for every node", () => {
  const pos = computeLayout(ring(60), { refineTicks: 40 });
  expect(Object.keys(pos).length).toBe(60);
  for (const id in pos) {
    const [x, y, z] = pos[id];
    expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
  }
});

test("empty and single-node graphs are handled", () => {
  expect(computeLayout({ nodes: [], edges: [] })).toEqual({});
  const one = computeLayout({ nodes: [{ id: "a" }], edges: [] }, { refineTicks: 5 });
  expect(Object.keys(one)).toEqual(["a"]);
  expect(one.a.every((c) => Number.isFinite(c))).toBe(true);
});

test("2D layout is flat (z = 0)", () => {
  const pos = computeLayout(ring(30), { dimensions: 2, refineTicks: 20 });
  for (const id in pos) expect(pos[id][2]).toBe(0);
});

test("discBias flattens the 3D layout into a disc when explicitly enabled", () => {
  const n = 80;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: "n0", to: `n${i + 1}` }));
  const pos = computeLayout({ nodes, edges }, { refineTicks: 150, discBias: 0.7 });
  let sy2 = 0, sxz2 = 0;
  for (const id in pos) { const [x, y, z] = pos[id]; sy2 += y * y; sxz2 += x * x + z * z; }
  const rmsY = Math.sqrt(sy2 / n), rmsXZ = Math.sqrt(sxz2 / (2 * n));
  expect(rmsY).toBeLessThan(rmsXZ * 0.8);
});

test("the DEFAULT 3D shape is roughly spherical (discBias ships off — the flattened default read badly on real vaults)", () => {
  const n = 80;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: "n0", to: `n${i + 1}` }));
  const pos = computeLayout({ nodes, edges }, { refineTicks: 150 });
  let sy2 = 0, sxz2 = 0;
  for (const id in pos) { const [x, y, z] = pos[id]; sy2 += y * y; sxz2 += x * x + z * z; }
  expect(Math.sqrt(sy2 / n)).toBeGreaterThan(Math.sqrt(sxz2 / (2 * n)) * 0.85);
});

// --- "edges extend too far out" regression (bug report: 3D edges too long, 2D honeycomb) ---------
// Measured against a real 2246-node/4957-edge vault via `curl :PORT/graph` (see layout.ts's DEFAULTS
// comment): linked-pair distance ran ~5× the local nearest-neighbour spacing in 3D (most edges
// crossed past several other nodes rather than connecting adjacent-looking dots), and 2D nearest-
// neighbour spacing had a coefficient of variation of just ~0.25 (near-uniform "honeycomb" packing).
// These two fixtures reproduce the same qualitative shapes (a high-degree hub + many degree-1
// leaves; a note/tag vault with a handful of hub tags) at a size small enough to stay a fast test.

test("softer repulsion shrinks hub-to-leaf edges vs. the pre-fix default (a mega-tag's edges were the longest in the real vault)", () => {
  // A single hub with 600 degree-1 leaves — the same shape as the real vault's heaviest tag node
  // (one tag referenced by hundreds of notes). `repulsion` is a LayoutOptions field, so the OLD
  // default (-10) is reconstructed here via an explicit override for a same-fixture comparison,
  // rather than needing to touch the module's own DEFAULTS.
  const hubDeg = 600;
  const nodes = [{ id: "hub" }, ...Array.from({ length: hubDeg }, (_, i) => ({ id: `leaf${i}` }))];
  const edges = Array.from({ length: hubDeg }, (_, i) => ({ from: "hub", to: `leaf${i}` }));
  const g = { nodes, edges };

  const edgeLenP = (pos: Positions, p: number) => {
    const lens = edges.map((e) => dist(pos[e.from], pos[e.to])).sort((a, b) => a - b);
    return lens[Math.floor(p * (lens.length - 1))];
  };

  const old = computeLayout(g, { refineTicks: 150, repulsion: -10 }); // pre-fix default
  const now = computeLayout(g, { refineTicks: 150 }); // current default (-7)
  expect(edgeLenP(now, 0.5)).toBeLessThan(edgeLenP(old, 0.5) * 0.92); // >8% shorter, typical edge
  expect(edgeLenP(now, 0.9)).toBeLessThan(edgeLenP(old, 0.9) * 0.92); // >8% shorter, near-worst edge
});

test("2D layout of a hub-and-leaf vault-like graph keeps real spacing variation, not a uniform honeycomb grid", () => {
  // A handful of hub "tags" with lopsided membership sizes (power-law-ish, like real vault tags)
  // plus some note-to-note links so it isn't purely bipartite.
  const numNotes = 400, numTags = 8;
  const nodes: { id: string }[] = [];
  const edges: { from: string; to: string }[] = [];
  for (let i = 0; i < numNotes; i++) nodes.push({ id: `note${i}` });
  for (let t = 0; t < numTags; t++) nodes.push({ id: `tag${t}` });
  for (let i = 0; i < numNotes; i++) {
    const t1 = i % numTags;
    edges.push({ from: `note${i}`, to: `tag${t1}` });
    const t2 = (i * 7) % numTags;
    if (i % 3 === 0 && t2 !== t1) edges.push({ from: `note${i}`, to: `tag${t2}` });
    if (i % 5 === 0 && i + 1 < numNotes) edges.push({ from: `note${i}`, to: `note${i + 1}` });
  }
  const g = { nodes, edges };
  const ids = nodes.map((n) => n.id);

  const pos3 = computeLayout(g, { dimensions: 3, refineTicks: 150 });
  const pos2 = computeLayout(g, { dimensions: 2, refineTicks: 150, initialPositions: pos3 });

  // Nearest-neighbour distance per node in 2D — a uniform honeycomb grid has a tiny coefficient of
  // variation (every node equidistant from its neighbours); real cluster structure does not.
  const n = ids.length;
  const nn = ids.map((id, i) => {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = Math.hypot(pos2[id][0] - pos2[ids[j]][0], pos2[id][1] - pos2[ids[j]][1]);
      if (d < best) best = d;
    }
    return best;
  });
  const mean = nn.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(nn.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  // The pre-fix MODE_2D_COLLIDE_MULT (1.2) measures ~0.01 on this exact fixture (a near-perfect
  // grid); the fix measures ~0.08. 0.05 sits safely between the two.
  expect(std / mean).toBeGreaterThan(0.05);
});

test("two clusters joined by a bridge separate spatially", () => {
  // Two 6-cliques A0..A5 and B0..B5, joined by a single A0-B0 bridge.
  const nodes = [...Array(6)].map((_, i) => ({ id: `A${i}` })).concat([...Array(6)].map((_, i) => ({ id: `B${i}` })));
  const edges: { from: string; to: string }[] = [];
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) { edges.push({ from: `A${i}`, to: `A${j}` }); edges.push({ from: `B${i}`, to: `B${j}` }); }
  edges.push({ from: "A0", to: "B0" });
  const pos = computeLayout({ nodes, edges }, { refineTicks: 120 });

  const centroid = (prefix: string): [number, number, number] => {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < 6; i++) { const p = pos[`${prefix}${i}`]; x += p[0]; y += p[1]; z += p[2]; }
    return [x / 6, y / 6, z / 6];
  };
  const cA = centroid("A"), cB = centroid("B");
  // mean intra-cluster spread (A nodes to A centroid)
  let spread = 0;
  for (let i = 0; i < 6; i++) spread += dist(pos[`A${i}`], cA);
  spread /= 6;
  // the two clusters' centroids should be clearly farther apart than a cluster's own radius
  expect(dist(cA, cB)).toBeGreaterThan(spread);
});

test("warm-start nodes missing from the seed are deterministic across runs", () => {
  const g = ring(40);
  // A warm-start seed that OMITS one node id ("n7") — it must fall back to a deterministic,
  // hash-seeded position, NOT Math.random(), so both runs place the missing node identically.
  const full = computeLayout(g, { refineTicks: 30 });
  const seed = { ...full };
  delete seed.n7;

  const a = computeLayout(g, { refineTicks: 30, initialPositions: seed });
  const b = computeLayout(g, { refineTicks: 30, initialPositions: seed });
  expect(a.n7).toEqual(b.n7);
});

// A dense `N`-node main component (each node linked to its next `deg` neighbours — enough aggregate
// many-body repulsion to fling unconnected nodes out, like the real 138-node 3rd-brain mass) plus
// `sing` fully-isolated singletons (their own degree-0 components — the orphan memory notes).
function denseMainWithSingletons(N: number, deg: number, sing: number) {
  const nodes = [...Array(N)].map((_, i) => ({ id: `n${i}` })).concat([...Array(sing)].map((_, i) => ({ id: `s${i}` })));
  const edges: { from: string; to: string }[] = [];
  for (let i = 0; i < N; i++) for (let k = 1; k <= deg; k++) edges.push({ from: `n${i}`, to: `n${(i + k) % N}` });
  return { nodes, edges };
}
function mainCentroidRms(pos: Record<string, [number, number, number]>, N: number): { c: [number, number, number]; rms: number } {
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < N; i++) { const p = pos[`n${i}`]; c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= N; c[1] /= N; c[2] /= N;
  let r = 0;
  for (let i = 0; i < N; i++) { const p = pos[`n${i}`]; r += (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; }
  return { c, rms: Math.sqrt(r / N) };
}
const maxSingletonNorm = (pos: Record<string, [number, number, number]>, N: number, sing: number) => {
  const { c, rms } = mainCentroidRms(pos, N);
  return Math.max(...[...Array(sing)].map((_, i) => dist(pos[`s${i}`], c) / rms));
};
// Collide floor (uniform spacing minimum) for a graph of `n` nodes in the given mode — mirrors layout.ts.
const collideFloorFor = (n: number, dim: 2 | 3) => 5 * Math.min(8, Math.max(1, 400 / n)) * (dim === 2 ? 1.8 : 1) * 1.25;

test("disconnected singletons are reeled into the main cloud, not stranded off to the side", () => {
  // Regression for the 3rd-brain "lone node off to the side" bug: orphan notes (no in-view links) used
  // to fly to ~1.3-1.6× the cloud radius into empty space. The reel-in must pull them to the rim (~1×).
  const N = 80, SING = 5;
  const g = denseMainWithSingletons(N, 5, SING);

  // Without the fix (reel-in disabled) the fixture reproduces the bug: a singleton is stranded past the cloud.
  const off3 = computeLayout(g, { dimensions: 3, refineTicks: 120, virtualAnchors: 0 });
  const off2 = computeLayout(g, { dimensions: 2, refineTicks: 120, initialPositions: off3, virtualAnchors: 0 });
  expect(Math.max(maxSingletonNorm(off3, N, SING), maxSingletonNorm(off2, N, SING))).toBeGreaterThan(1.3);

  // With the fix (defaults) every singleton sits at/inside the cloud rim in BOTH modes.
  const on3 = computeLayout(g, { dimensions: 3, refineTicks: 120 });
  const on2 = computeLayout(g, { dimensions: 2, refineTicks: 120, initialPositions: on3 });
  expect(maxSingletonNorm(on3, N, SING)).toBeLessThan(1.2);
  expect(maxSingletonNorm(on2, N, SING)).toBeLessThan(1.1);
});

test("reeled layout emits no overlapping node pairs (the warm renderer can't fix overlaps)", () => {
  // Strays are reeled in by virtual links fed to the SAME sim, so the existing collide force spaces them.
  const N = 80, SING = 5, n = N + SING;
  const g = denseMainWithSingletons(N, 5, SING);
  for (const dim of [3, 2] as const) {
    const seed = dim === 2 ? computeLayout(g, { dimensions: 3, refineTicks: 120 }) : undefined;
    const pos = computeLayout(g, { dimensions: dim, refineTicks: 120, initialPositions: seed });
    const ids = Object.keys(pos);
    let minPair = Infinity;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) minPair = Math.min(minPair, dist(pos[ids[i]], pos[ids[j]]));
    expect(minPair).toBeGreaterThan(collideFloorFor(n, dim) * 0.9);
  }
});

test("reel-in is deterministic across runs (no RNG / wall-clock)", () => {
  const g = denseMainWithSingletons(80, 5, 5);
  const a3 = computeLayout(g, { dimensions: 3, refineTicks: 120 });
  const b3 = computeLayout(g, { dimensions: 3, refineTicks: 120 });
  expect(a3).toEqual(b3);
  expect(computeLayout(g, { dimensions: 2, refineTicks: 80, initialPositions: a3 }))
    .toEqual(computeLayout(g, { dimensions: 2, refineTicks: 80, initialPositions: b3 }));
});

test("components above the size gate are left untouched (genuine islands aren't merged)", () => {
  // Two equal-size disconnected clusters: both exceed the gate (max(4, 0.25·main)), so NO virtual links
  // are added and the output must be byte-identical to reel-in-disabled — distinct islands stay distinct.
  const nodes = [...Array(40)].map((_, i) => ({ id: `a${i}` })).concat([...Array(40)].map((_, i) => ({ id: `b${i}` })));
  const edges: { from: string; to: string }[] = [];
  for (let i = 0; i < 40; i++) { edges.push({ from: `a${i}`, to: `a${(i + 1) % 40}` }); edges.push({ from: `b${i}`, to: `b${(i + 1) % 40}` }); }
  const g = { nodes, edges };
  expect(computeLayout(g, { dimensions: 3, refineTicks: 100 })).toEqual(computeLayout(g, { dimensions: 3, refineTicks: 100, virtualAnchors: 0 }));

  // But add a single orphan and the gate DOES reel it (output now differs from the untouched baseline).
  const withOrphan = { nodes: [...nodes, { id: "lonely" }], edges };
  expect(computeLayout(withOrphan, { dimensions: 3, refineTicks: 100 }))
    .not.toEqual(computeLayout(withOrphan, { dimensions: 3, refineTicks: 100, virtualAnchors: 0 }));
});

test("pivotMDS is deterministic", () => {
  const g = ring(40);
  const index = new Map(g.nodes.map((n, i) => [n.id, i] as const));
  const adj: number[][] = Array.from({ length: 40 }, () => []);
  for (const e of g.edges) { const a = index.get(e.from)!, b = index.get(e.to)!; adj[a].push(b); adj[b].push(a); }
  const a = pivotMDS(adj, 40, 3, 20);
  const b = pivotMDS(adj, 40, 3, 20);
  expect(a).toEqual(b);
});

// --- Incremental "add-only" pinning (fixedIds) -----------------------------------------------------
// Used by layout-cache's incremental rebuild: a created note must not scramble the existing layout.

test("fixedIds pins nodes at their initialPositions; only the new node settles", () => {
  const seed: Positions = { a: [10, 20, 30], b: [-40, 5, 12], c: [100, -100, 50] };
  const input = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], edges: [{ from: "a", to: "d" }] };
  const pos = computeLayout(input, { refineTicks: 60, initialPositions: { ...seed }, fixedIds: ["a", "b", "c"] });
  // Pinned nodes are EXACTLY where they were seeded (no drift).
  expect(pos.a).toEqual([10, 20, 30]);
  expect(pos.b).toEqual([-40, 5, 12]);
  expect(pos.c).toEqual([100, -100, 50]);
  // The new (free) node is placed at a finite position.
  expect(pos.d.every((n) => Number.isFinite(n))).toBe(true);
});

test("computeLayoutAsync keeps fixedIds pinned (early-exit path)", async () => {
  const seed: Positions = { a: [10, 20, 30], b: [-40, 5, 0] };
  const input = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [{ from: "a", to: "c" }, { from: "b", to: "c" }] };
  const pos = await computeLayoutAsync(input, { refineTicks: 80, initialPositions: { ...seed }, fixedIds: ["a", "b"] });
  expect(pos.a).toEqual([10, 20, 30]);
  expect(pos.b).toEqual([-40, 5, 0]);
  expect(pos.c.every((n) => Number.isFinite(n))).toBe(true);
});

test("a 2D pinned settle keeps z=0 for the free node", async () => {
  const seed: Positions = { a: [10, 20, 0], b: [-30, 8, 0] };
  const input = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [{ from: "a", to: "c" }] };
  const pos = await computeLayoutAsync(input, { dimensions: 2, refineTicks: 60, initialPositions: { ...seed }, fixedIds: ["a", "b"] });
  expect(pos.a).toEqual([10, 20, 0]);
  expect(pos.c[2]).toBe(0);
});
