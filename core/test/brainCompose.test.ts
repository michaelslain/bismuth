import { expect, test } from "bun:test";
import { applyOrientation, boundingRadius, composeBrains, bestOrientation } from "../src/brainCompose";
import type { Positions } from "../src/layout";

test("applyOrientation preserves every pairwise distance (it is an isometry)", () => {
  const pos: Positions = { a: [1, 0, 0], b: [0, 2, 0], c: [-3, 1, 0] };
  const before = Math.hypot(pos.a[0] - pos.c[0], pos.a[1] - pos.c[1]);
  const out = applyOrientation(pos, ["a", "b", "c"], Math.PI / 3, true);
  const after = Math.hypot(out.a[0] - out.c[0], out.a[1] - out.c[1]);
  expect(after).toBeCloseTo(before, 9);
});

test("bestOrientation turns cross-linked nodes toward the neighbouring brain", () => {
  // Node "x" sits at angle 180 (left). The neighbour brain is far to the RIGHT at x=100.
  // The best rotation should bring "x" round to the right-hand side.
  const pos: Positions = { x: [-10, 0, 0], y: [0, 0, 0] };
  const { angle, flip } = bestOrientation(pos, ["x", "y"], [{ own: "x", otherX: 100, otherY: 0 }], 72);
  const out = applyOrientation(pos, ["x", "y"], angle, flip);
  expect(out.x[0]).toBeGreaterThan(0);
});

test("boundingRadius measures the furthest node from the centroid", () => {
  const pos: Positions = { a: [3, 4, 0], b: [0, 0, 0] };
  expect(boundingRadius(pos, ["a", "b"])).toBeCloseTo(2.5, 6);
});

test("composeBrains lays brains out left to right without overlapping", () => {
  const A: Positions = { a1: [0, 0, 0], a2: [1, 0, 0] };
  const B: Positions = { b1: [0, 0, 0], b2: [1, 0, 0] };
  const out = composeBrains([{ ids: ["a1", "a2"], pos: A }, { ids: ["b1", "b2"], pos: B }]);
  const aMax = Math.max(out.a1[0], out.a2[0]);
  const bMin = Math.min(out.b1[0], out.b2[0]);
  expect(bMin).toBeGreaterThan(aMax);
});

test("composeBrains is a no-op for a single brain", () => {
  const A: Positions = { a1: [0, 0, 0], a2: [1, 2, 3] };
  const out = composeBrains([{ ids: ["a1", "a2"], pos: A }]);
  expect(out.a1).toEqual([0, 0, 0]);
  expect(out.a2).toEqual([1, 2, 3]);
});
