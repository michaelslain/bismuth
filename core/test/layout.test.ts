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

// --- Community-aware clustering (layout.ts COMMUNITY_*) --------------------------------------------
// The complaint: zoomed out, a real vault's communities intermingled into one blob. The forces are
// measured with the same statistic used to tune them — mean intra-community spread divided by mean
// nearest-other-community-centroid distance, weighted by community size. LOWER = clusters read as
// distinct blobs. On the reference 2248-node vault this goes 1.675 → 0.952 in 3D and 2.999 → 1.058
// in 2D; the fixture below reproduces the same shape (heterogeneous hub-and-leaf communities, sparse
// cross-links) small enough to stay a fast test.

/** `sizes.length` planted communities of hub-and-leaf notes, plus ~`cross` cross-community links
 *  per node. Deterministic (fixed LCG) so the assertions below are stable. */
function plantedCommunities(sizes: number[], cross: number) {
  const nodes: { id: string; community: number }[] = [];
  const edges: { from: string; to: string }[] = [];
  let s = 12345 >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  sizes.forEach((size, c) => {
    for (let i = 0; i < size; i++) nodes.push({ id: `c${c}n${i}`, community: c });
  });
  sizes.forEach((size, c) => {
    const hubs = Math.max(2, Math.round(size / 25));
    for (let h = 1; h < hubs; h++) edges.push({ from: `c${c}n0`, to: `c${c}n${h}` });
    for (let i = hubs; i < size; i++) {
      edges.push({ from: `c${c}n${i}`, to: `c${c}n${Math.floor(rnd() * hubs)}` });
      if (rnd() < 0.45) {
        const j = hubs + Math.floor(rnd() * (size - hubs));
        if (j !== i) edges.push({ from: `c${c}n${i}`, to: `c${c}n${j}` });
      }
    }
  });
  sizes.forEach((size, c) => {
    for (let i = 0; i < size; i++) {
      if (rnd() >= cross) continue;
      let other = Math.floor(rnd() * (sizes.length - 1));
      if (other >= c) other++;
      edges.push({ from: `c${c}n${i}`, to: `c${other}n${Math.floor(rnd() * sizes[other])}` });
    }
  });
  return { nodes, edges };
}

/** Size-weighted (mean intra-community spread) / (mean nearest-other-community-centroid distance),
 *  plus the raw intra spread so a test can also assert the clusters did not collapse to points. */
function separation(nodes: { id: string; community: number }[], pos: Positions) {
  const byComm = new Map<number, string[]>();
  for (const n of nodes) byComm.set(n.community, [...(byComm.get(n.community) ?? []), n.id]);
  const cents = [...byComm.entries()]
    .filter(([, ids]) => ids.length >= 3)
    .map(([c, ids]) => {
      const sum = ids.reduce((a, id) => [a[0] + pos[id][0], a[1] + pos[id][1], a[2] + pos[id][2]], [0, 0, 0]);
      return { c, ids, centroid: sum.map((v) => v / ids.length) as [number, number, number] };
    });
  let wIntra = 0, wNear = 0, w = 0;
  for (const a of cents) {
    const intra = a.ids.reduce((s, id) => s + dist(pos[id], a.centroid), 0) / a.ids.length;
    const near = Math.min(...cents.filter((b) => b.c !== a.c).map((b) => dist(a.centroid, b.centroid)));
    if (!Number.isFinite(near)) continue;
    wIntra += intra * a.ids.length;
    wNear += near * a.ids.length;
    w += a.ids.length;
  }
  return { ratio: wIntra / wNear, intra: wIntra / w };
}

test("community-aware forces separate communities far better, without collapsing them", () => {
  const g = plantedCommunities([80, 70, 60, 40, 30, 20], 0.25);
  for (const dim of [3, 2] as const) {
    const seedOff = dim === 2 ? computeLayout(g, { refineTicks: 120, communityForces: false }) : undefined;
    const seedOn = dim === 2 ? computeLayout(g, { refineTicks: 120 }) : undefined;
    const off = separation(g.nodes, computeLayout(g, { dimensions: dim, refineTicks: 120, initialPositions: seedOff, communityForces: false }));
    const on = separation(g.nodes, computeLayout(g, { dimensions: dim, refineTicks: 120, initialPositions: seedOn }));
    // Measures ~0.33 vs 0.52 (3D) and ~0.27 vs 0.46 (2D); 25% is the bar the change was held to.
    expect(on.ratio).toBeLessThan(off.ratio * 0.75);
    // ...and NOT by crushing each community into a point (the degenerate way to win this metric).
    expect(on.intra).toBeGreaterThan(off.intra * 0.5);
  }
});

test("community forces keep the layout overlap-free (they must not fight forceCollide)", () => {
  // Regression for the ordering bug: registered AFTER "collide", the community pull lands unchecked
  // (forceCollide resolves against x+vx and only sees forces that ran before it) and the settle ends
  // with permanently overlapping nodes. Asserted in 2D, where the collide budget is tightest.
  const g = plantedCommunities([80, 70, 60, 40, 30, 20], 0.25);
  const n = g.nodes.length;
  const pos3 = computeLayout(g, { refineTicks: 120 });
  const pos = computeLayout(g, { dimensions: 2, refineTicks: 120, initialPositions: pos3 });
  const ids = g.nodes.map((x) => x.id);
  let minPair = Infinity;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) minPair = Math.min(minPair, dist(pos[ids[i]], pos[ids[j]]));
  expect(minPair).toBeGreaterThan(collideFloorFor(n, 2) * 0.9);
});

test("a graph with no community ids is laid out exactly as before (opt-in by data)", () => {
  // Embedded graph blocks, the daemon graph and every pre-existing caller pass nodes without
  // `community` — those must be bit-identical to the community-unaware layout.
  const g = ring(60);
  expect(computeLayout(g, { refineTicks: 60 })).toEqual(computeLayout(g, { refineTicks: 60, communityForces: false }));
  // Same when every node shares ONE community: there is nothing to separate, so nothing changes.
  const one = { nodes: g.nodes.map((n) => ({ ...n, community: 0 })), edges: g.edges };
  expect(computeLayout(one, { refineTicks: 60 })).toEqual(computeLayout(g, { refineTicks: 60, communityForces: false }));
});

test("community-aware layout is deterministic across runs", () => {
  const g = plantedCommunities([30, 25, 20], 0.25);
  const a = computeLayout(g, { refineTicks: 80 });
  expect(a).toEqual(computeLayout(g, { refineTicks: 80 }));
  expect(computeLayout(g, { dimensions: 2, refineTicks: 80, initialPositions: a }))
    .toEqual(computeLayout(g, { dimensions: 2, refineTicks: 80, initialPositions: a }));
});

// --- Hierarchical (nested) communities -------------------------------------------------------------
// `communityPath` (coarsest → finest) adds one gravity + separation pair per ancestor level at
// COMMUNITY_LEVEL_DECAY^a strength, so super-clusters clump and spread the way clusters do. Measured
// on the reference 2251-node vault (3 levels, 120 ticks) as per-level separation ratio, nested vs
// finest-level-only: L0 1.985 → 0.926, L1 1.668 → 0.869, L2 1.090 → 0.926 (3D).

/** `supers.length` super-clusters, each holding several sub-clusters: dense inside a sub-cluster,
 *  moderate between sub-clusters of the same super, sparse across supers. Emits a 2-level
 *  `communityPath` matching the planted structure, so the test measures the LAYOUT not the detector. */
function plantedHierarchy(supers: number[][], cross = 0.02) {
  const nodes: { id: string; community: number; communityPath: number[] }[] = [];
  const edges: { from: string; to: string }[] = [];
  let s = 24680 >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const key = (S: number, c: number, i: number) => `s${S}c${c}n${i}`;
  let sub = 0;
  const subOf: number[][] = supers.map((subs) => subs.map(() => sub++));
  supers.forEach((subs, S) => subs.forEach((size, c) => {
    for (let i = 0; i < size; i++) nodes.push({ id: key(S, c, i), community: subOf[S][c], communityPath: [S, subOf[S][c]] });
  }));
  supers.forEach((subs, S) => subs.forEach((size, c) => {
    const hubs = Math.max(2, Math.round(size / 25));
    for (let h = 1; h < hubs; h++) edges.push({ from: key(S, c, 0), to: key(S, c, h) });
    for (let i = hubs; i < size; i++) {
      edges.push({ from: key(S, c, i), to: key(S, c, Math.floor(rnd() * hubs)) });
      if (rnd() < 0.45) {
        const j = hubs + Math.floor(rnd() * (size - hubs));
        if (j !== i) edges.push({ from: key(S, c, i), to: key(S, c, j) });
      }
    }
    for (let i = 0; i < size; i++) {
      if (subs.length > 1 && rnd() < 0.2) {
        let o = Math.floor(rnd() * (subs.length - 1)); if (o >= c) o++;
        edges.push({ from: key(S, c, i), to: key(S, o, Math.floor(rnd() * subs[o])) });
      }
      if (rnd() < cross) {
        let oS = Math.floor(rnd() * (supers.length - 1)); if (oS >= S) oS++;
        const oc = Math.floor(rnd() * supers[oS].length);
        edges.push({ from: key(S, c, i), to: key(oS, oc, Math.floor(rnd() * supers[oS][oc])) });
      }
    }
  }));
  return { nodes, edges };
}

/** `separation`, but grouping by a given level of `communityPath` instead of the flat `community`. */
function separationAtLevel(nodes: { id: string; communityPath: number[] }[], pos: Positions, level: number) {
  return separation(nodes.map((n) => ({ id: n.id, community: n.communityPath[level] })), pos);
}

const HIER = [[70, 55, 45], [65, 50, 40], [60, 50, 45]];

test("nesting separates the COARSE level too, without undoing the fine level", () => {
  const g = plantedHierarchy(HIER);
  for (const dim of [3, 2] as const) {
    const seedFlat = dim === 2 ? computeLayout(g, { refineTicks: 120, communityLevelDecay: 0 }) : undefined;
    const seedNest = dim === 2 ? computeLayout(g, { refineTicks: 120 }) : undefined;
    const flat = computeLayout(g, { dimensions: dim, refineTicks: 120, initialPositions: seedFlat, communityLevelDecay: 0 });
    const nest = computeLayout(g, { dimensions: dim, refineTicks: 120, initialPositions: seedNest });
    // The super-clusters (level 0) read as distinct groups only once the coarse forces are on.
    expect(separationAtLevel(g.nodes, nest, 0).ratio).toBeLessThan(separationAtLevel(g.nodes, flat, 0).ratio * 0.75);
    // ...and the finest level is not sacrificed for it (it stays at least as separated as flat).
    expect(separationAtLevel(g.nodes, nest, 1).ratio).toBeLessThan(separationAtLevel(g.nodes, flat, 1).ratio * 1.15);
    // No level collapses: each keeps real spatial extent (the degenerate way to win the ratio).
    for (const level of [0, 1]) {
      expect(separationAtLevel(g.nodes, nest, level).intra)
        .toBeGreaterThan(separationAtLevel(g.nodes, flat, level).intra * 0.15);
    }
  }
}, 30000); // four full 120-tick settles over a ~480-node fixture

test("coarse levels sit at a LARGER spatial scale than fine ones", () => {
  // The point of a hierarchy: a super-cluster is a bigger thing than a cluster. If the two levels
  // settled at the same spread they would be the same picture drawn twice.
  const g = plantedHierarchy(HIER);
  const pos = computeLayout(g, { refineTicks: 120 });
  const coarse = separationAtLevel(g.nodes, pos, 0);
  const fine = separationAtLevel(g.nodes, pos, 1);
  expect(coarse.intra).toBeGreaterThan(fine.intra * 1.3);
});

test("a 1-level communityPath is byte-identical to no path at all", () => {
  // The finest level is the tuned baseline; hierarchies must be pure opt-in BY DATA. A single-level
  // path (small vault) and a communityLevelDecay of 0 both have to reproduce it exactly.
  const g = plantedCommunities([80, 70, 60, 40, 30, 20], 0.25);
  const flat = computeLayout(g, { refineTicks: 80 });
  const oneLevel = { nodes: g.nodes.map((n) => ({ ...n, communityPath: [n.community] })), edges: g.edges };
  expect(computeLayout(oneLevel, { refineTicks: 80 })).toEqual(flat);
  const withPath = { nodes: g.nodes.map((n) => ({ ...n, communityPath: [n.community % 2, n.community] })), edges: g.edges };
  expect(computeLayout(withPath, { refineTicks: 80, communityLevelDecay: 0 })).toEqual(flat);
});

test("an ancestor level that is a copy of its child is skipped, not applied twice", () => {
  // Strict nesting means an equal group COUNT implies an identical partition. Re-applying it would
  // silently scale the finest level's tuned constants up, changing the layout for no reason.
  const g = plantedCommunities([80, 70, 60, 40, 30, 20], 0.25);
  const flat = computeLayout(g, { refineTicks: 80 });
  const dup = { nodes: g.nodes.map((n) => ({ ...n, communityPath: [n.community, n.community] })), edges: g.edges };
  expect(computeLayout(dup, { refineTicks: 80 })).toEqual(flat);
});

test("nested community forces keep the layout overlap-free (one speed cap for the whole stack)", () => {
  // Regression for the per-level speed cap: capping each level separately lets L levels contribute
  // up to L x COMMUNITY_MAX_STEP, outrunning the collide relaxation. Asserted in 2D (tightest budget).
  const g = plantedHierarchy(HIER);
  const pos3 = computeLayout(g, { refineTicks: 120 });
  const pos = computeLayout(g, { dimensions: 2, refineTicks: 120, initialPositions: pos3 });
  const ids = g.nodes.map((x) => x.id);
  let minPair = Infinity;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) minPair = Math.min(minPair, dist(pos[ids[i]], pos[ids[j]]));
  expect(minPair).toBeGreaterThan(collideFloorFor(ids.length, 2) * 0.9);
});

test("nested layout is deterministic across runs", () => {
  const g = plantedHierarchy([[30, 25], [28, 22], [26, 20]]);
  const a = computeLayout(g, { refineTicks: 80 });
  expect(a).toEqual(computeLayout(g, { refineTicks: 80 }));
  expect(computeLayout(g, { dimensions: 2, refineTicks: 80, initialPositions: a }))
    .toEqual(computeLayout(g, { dimensions: 2, refineTicks: 80, initialPositions: a }));
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
