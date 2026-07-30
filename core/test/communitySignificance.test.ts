import { expect, test } from "bun:test";
import { modularity, significance } from "../src/communitySignificance";

/** Two 6-cliques joined by a single bridge — unambiguous community structure. */
function twoCliques(): { adj: number[][]; comm: number[] } {
  const adj: number[][] = Array.from({ length: 12 }, () => []);
  const link = (a: number, b: number) => { adj[a].push(b); adj[b].push(a); };
  for (const base of [0, 6]) {
    for (let i = base; i < base + 6; i++) for (let j = i + 1; j < base + 6; j++) link(i, j);
  }
  link(0, 6); // the bridge
  return { adj, comm: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] };
}

/** A ring — every node has degree 2 and there is no community structure to find. */
function ring(n: number, groups: number): { adj: number[][]; comm: number[] } {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; adj[i].push(j); adj[j].push(i); }
  return { adj, comm: Array.from({ length: n }, (_, i) => Math.floor(i / (n / groups))) };
}

test("modularity is high for two well-separated cliques", () => {
  const { adj, comm } = twoCliques();
  expect(modularity(adj, comm)).toBeGreaterThan(0.4);
});

test("two cliques are significant against the null model", () => {
  const { adj, comm } = twoCliques();
  const s = significance(adj, comm, 30);
  expect(s.significant).toBe(true);
  expect(s.z).toBeGreaterThan(2);
});

test("an arbitrary partition of a ring is NOT significant", () => {
  // A ring's partition has non-trivial raw Q, which is exactly the trap: it must still
  // fail the null-model test, because a random graph with this degree sequence does as well.
  const { adj, comm } = ring(60, 6);
  const s = significance(adj, comm, 30);
  expect(s.significant).toBe(false);
});

test("modularity is 0 when every node is in one community", () => {
  const { adj } = twoCliques();
  expect(modularity(adj, new Array(12).fill(0))).toBeCloseTo(0, 6);
});
