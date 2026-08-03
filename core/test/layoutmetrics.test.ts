import { expect, test } from "bun:test";
import {
  neighbourhoodPreservation, separationRatio, edgeCrossingRate, nearestNeighbourStats,
  stressCorrelation, type Pt,
} from "../../bench/layoutmetrics";

test("neighbourhoodPreservation is 1 when graph neighbours are the nearest drawn nodes", () => {
  // Path 0-1-2 laid out in the same order on a line: each node's graph neighbours
  // are exactly its nearest drawn neighbours.
  const pos: Pt[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
  const adj = [[1], [0, 2], [1]];
  expect(neighbourhoodPreservation(pos, adj, "degree")).toBeCloseTo(1, 6);
});

test("neighbourhoodPreservation is 0 when the drawing inverts adjacency", () => {
  // 0 and 2 are adjacent in the graph but drawn far apart, with non-neighbour 1 between them.
  const pos: Pt[] = [[0, 0, 0], [1, 0, 0], [100, 0, 0]];
  const adj = [[2], [], [0]];
  expect(neighbourhoodPreservation(pos, adj, "degree")).toBeCloseTo(0, 6);
});

test("separationRatio is lower when communities are further apart", () => {
  const comm = [0, 0, 1, 1];
  const near: Pt[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
  const far: Pt[] = [[0, 0, 0], [1, 0, 0], [50, 0, 0], [51, 0, 0]];
  expect(separationRatio(far, comm, 3, 20000)).toBeLessThan(separationRatio(near, comm, 3, 20000));
});

test("edgeCrossingRate detects a crossing and its absence", () => {
  // Crossing X: edge 0-1 and edge 2-3 intersect.
  const crossed: Pt[] = [[0, 0, 0], [10, 10, 0], [0, 10, 0], [10, 0, 0]];
  // Parallel: no intersection.
  const parallel: Pt[] = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0]];
  const edges = [{ a: 0, b: 1 }, { a: 2, b: 3 }];
  expect(edgeCrossingRate(crossed, edges, 5000)).toBeGreaterThan(0);
  expect(edgeCrossingRate(parallel, edges, 5000)).toBe(0);
});

test("nearestNeighbourStats reports a zero CV for evenly spaced points", () => {
  const pos: Pt[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
  const s = nearestNeighbourStats(pos, 3);
  expect(s.cv).toBeCloseTo(0, 6);
  expect(s.min).toBeCloseTo(1, 6);
});

test("stressCorrelation is high when drawn distance tracks hop distance", () => {
  // A path drawn as a straight line: hop distance and drawn distance agree exactly.
  const pos: Pt[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]];
  const adj = [[1], [0, 2], [1, 3], [2, 4], [3]];
  expect(stressCorrelation(pos, adj, 3, 5)).toBeGreaterThan(0.9);
});

// ── Fix round 1: C1 — reciprocal-link adjacency must not push the score above 1.0 ──────────

test("C1a: neighbourhoodPreservation never exceeds 1.0 when adjacency has duplicate (reciprocal-link) entries", () => {
  // Same 3-node line as the first test, but every adjacency entry is duplicated — the normal
  // shape of a vault where a wikilink is reciprocated (A->B and B->A both emit an edge, with no
  // cross-note dedup). Raw adj[i].length would count each neighbour twice.
  const pos: Pt[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
  const adj = [[1, 1], [0, 0, 2, 2], [1, 1]];
  const score = neighbourhoodPreservation(pos, adj, "degree");
  expect(score).toBeLessThanOrEqual(1);
  expect(score).toBeCloseTo(1, 6);
});

test("C1b: a self-loop doesn't reduce a perfect neighbourhoodPreservation score", () => {
  // Same graph as the "is 1" test, plus a self-loop on node 0 (adj[0] lists itself). A self-loop
  // isn't a real neighbour to preserve and must not count against the score.
  const pos: Pt[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
  const adj = [[0, 1], [0, 2], [1]];
  expect(neighbourhoodPreservation(pos, adj, "degree")).toBeCloseTo(1, 6);
});

// ── Fix round 1: I1 — fixed-k path, node degree exceeding k, denominator coverage ──────────

test("I1: at a fixed k below a node's degree, a perfectly-drawn hub still scores 1.0 (not capped by raw degree)", () => {
  // Star: center (index 0) has 5 neighbours, each placed at distance 1 on a different axis so no
  // leaf is ever closer to another leaf than to the center. At k=2, the center's 2 nearest drawn
  // nodes are still both real graph neighbours, so hit/min(deg,kk) = 2/min(5,2) = 1.0. A
  // wrong-denominator mutant (hit/deg) would instead compute 2/5 = 0.4 for the center, and since
  // every leaf scores 1.0 under both formulas (their degree is 1, below k), the only way the
  // aggregate mean can land at 1.0 rather than dragged down is if the center itself scores 1.0.
  const pos: Pt[] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0],
  ];
  const adj = [[1, 2, 3, 4, 5], [0], [0], [0], [0], [0]];
  expect(neighbourhoodPreservation(pos, adj, 2)).toBeCloseTo(1, 6);
});

// ── Fix round 1: I2 — edgeCrossingRate structural mutants (straddle direction, shared endpoint) ──

test("I2a: edgeCrossingRate rejects a near-miss where the underlying LINES cross but the SEGMENTS do not", () => {
  // Segment (0,0)-(1,0) only spans x in [0,1]; segment (5,-5)-(5,5) is a vertical line at x=5.
  // Extended infinitely, the two lines cross at (5,0) — but that point is nowhere near the first
  // segment, so the SEGMENTS never touch. A one-sided straddle test (the "&&" between the two
  // half-plane checks turned into "||") would wrongly call this a crossing.
  const nearMiss: Pt[] = [[0, 0, 0], [1, 0, 0], [5, -5, 0], [5, 5, 0]];
  const edges = [{ a: 0, b: 1 }, { a: 2, b: 3 }];
  expect(edgeCrossingRate(nearMiss, edges, 5000)).toBe(0);
});

test("I2b: edges sharing an endpoint are excluded from the pool, so they can't dilute the crossing rate", () => {
  // A 3-ray star at the origin (all sharing vertex 0) plus one separate, genuinely-crossing pair
  // of edges far away. Of the 5 edges there are C(5,2)=10 unordered pairs; 3 of them (every pair
  // of star rays) share vertex 0 and must be excluded, leaving 7 eligible pairs of which exactly
  // 1 crosses -> 1/7. Without the shared-endpoint filter all 10 pairs would count (the star pairs
  // never register as a crossing themselves, since a shared endpoint always zeroes one of
  // segIntersect's side values) -> 1/10, an understated rate purely from denominator dilution.
  const pos: Pt[] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0],
    [100, 100, 0], [110, 110, 0], [100, 110, 0], [110, 100, 0],
  ];
  const edges = [
    { a: 0, b: 1 }, { a: 0, b: 2 }, { a: 0, b: 3 }, // star rays, all sharing vertex 0
    { a: 4, b: 5 }, { a: 6, b: 7 }, // a genuinely crossing pair, far from the star
  ];
  expect(edgeCrossingRate(pos, edges)).toBeCloseTo(1 / 7, 10);
});

// ── Fix round 1: I3 — singleton communities must not move separationRatio ──────────────────

test("I3: adding orphan (singleton-community) nodes doesn't move separationRatio", () => {
  const comm = [0, 0, 1, 1];
  const pos: Pt[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
  const baseline = separationRatio(pos, comm, 3);
  // Two orphans, each the sole member of its own community id, placed at extreme distance —
  // if they were counted (as before the fix, singleton communities were never excluded), they'd
  // only ever contribute huge inter-community distances and swing the ratio hard.
  const withOrphans: Pt[] = [...pos, [1000, 0, 0], [-1000, 0, 0]];
  const commWithOrphans = [...comm, 2, 3];
  expect(separationRatio(withOrphans, commWithOrphans, 3)).toBeCloseTo(baseline, 10);
});

// ── Fix round 1: I4 — "no data" must read as NaN, not as a perfect score ───────────────────

test("I4a: separationRatio is NaN when no community has 2+ members (no valid data, not 'perfectly separated')", () => {
  const pos: Pt[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
  expect(separationRatio(pos, [-1, -1, -1, -1], 3, 20000)).toBeNaN();
});

test("I4b: edgeCrossingRate is NaN when every edge pair shares an endpoint (no eligible pair, not 'zero crossings')", () => {
  const pos: Pt[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0]];
  const edges = [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 0, b: 3 }];
  expect(edgeCrossingRate(pos, edges)).toBeNaN();
});

// ── Fix round 1: M4 — gated metrics must be exact (sample-count-independent) at small scale ──

test("M4a: separationRatio gives identical results across different samples arguments at small scale", () => {
  const comm = [0, 0, 1, 1];
  const pos: Pt[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
  expect(separationRatio(pos, comm, 3, 10)).toBe(separationRatio(pos, comm, 3, 999_999));
});

test("M4b: edgeCrossingRate gives identical results across different samples arguments at small scale", () => {
  const pos: Pt[] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0],
    [100, 100, 0], [110, 110, 0], [100, 110, 0], [110, 100, 0],
  ];
  const edges = [
    { a: 0, b: 1 }, { a: 0, b: 2 }, { a: 0, b: 3 },
    { a: 4, b: 5 }, { a: 6, b: 7 },
  ];
  expect(edgeCrossingRate(pos, edges, 10)).toBe(edgeCrossingRate(pos, edges, 999_999));
});
