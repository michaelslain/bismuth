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
