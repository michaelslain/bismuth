import { test, expect } from "bun:test";
import { computeLayout, pivotMDS } from "../src/layout";

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

test("pivotMDS is deterministic", () => {
  const g = ring(40);
  const index = new Map(g.nodes.map((n, i) => [n.id, i] as const));
  const adj: number[][] = Array.from({ length: 40 }, () => []);
  for (const e of g.edges) { const a = index.get(e.from)!, b = index.get(e.to)!; adj[a].push(b); adj[b].push(a); }
  const a = pivotMDS(adj, 40, 3, 20);
  const b = pivotMDS(adj, 40, 3, 20);
  expect(a).toEqual(b);
});
