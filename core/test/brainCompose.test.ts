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

test("applyOrientation rotates counter-clockwise for a positive angle (pins the sign of sin directly, independent of any search)", () => {
  // p and q straddle the centroid (0,0) on the X axis. A +90 degree rotation must swing p from
  // (1,0) to (0,1) — if the rotation direction were ever reversed (sin -> -sin), p would land at
  // (0,-1) instead. This is the only test that catches that in isolation: bestOrientation's search
  // explores the full circle, so it can independently relabel its way to a "correct-looking"
  // answer even under a globally reversed convention — only a direct check of applyOrientation's
  // own direction pins the sign.
  const pos: Positions = { p: [1, 0, 0], q: [-1, 0, 0] };
  const out = applyOrientation(pos, ["p", "q"], Math.PI / 2, false);
  expect(out.p[0]).toBeCloseTo(0, 9);
  expect(out.p[1]).toBeCloseTo(1, 9);
});

test("bestOrientation turns cross-linked nodes toward the neighbouring brain (facing measured from the centroid)", () => {
  // Node "x" sits at angle 180 (left) relative to the centroid of {x,y}. The neighbour brain is
  // far to the RIGHT at x=100. Rotation is about the brain's OWN centroid (-5,0), so x's reach is
  // bounded to the circle of radius 5 around that centroid — the absolute best x can do is land
  // exactly ON the centroid's rightward edge (x=0), not past it. The design property under test is
  // FACING (has x swung all the way round, from -5 relative to centroid to +5 relative to
  // centroid?), not an absolute-coordinate threshold that happens to depend on where the centroid
  // itself sits.
  const pos: Positions = { x: [-10, 0, 0], y: [0, 0, 0] };
  const { angle, flip } = bestOrientation(pos, ["x", "y"], [{ own: "x", otherX: 100, otherY: 0 }], 72);
  const out = applyOrientation(pos, ["x", "y"], angle, flip);
  const centroidX = (pos.x[0] + pos.y[0]) / 2;
  expect(out.x[0] - centroidX).toBeCloseTo(5, 6);
});

test("bestOrientation finds a quarter turn when the neighbour sits 90 degrees around (angle is neither 0 nor pi)", () => {
  // x is at angle 0 relative to centroid (0,0); its distant target sits straight "up" (+y). The
  // unique cost-minimising rotation is a quarter turn, not the degenerate 0/pi cases the earlier
  // fixtures happen to land on — this kills a mutant that hardcodes {angle: Math.PI, flip: false}
  // (or any other fixed constant), since that would leave x facing the wrong way entirely.
  const pos: Positions = { x: [10, 0, 0], y: [-10, 0, 0] };
  const { angle, flip } = bestOrientation(pos, ["x", "y"], [{ own: "x", otherX: 0, otherY: 100 }], 360);
  expect(angle).toBeCloseTo(Math.PI / 2, 2);
  expect(flip).toBe(false);
});

test("bestOrientation searches reflections: a chiral cross-link pair is only optimally satisfied with flip=true", () => {
  // p and q sit 90 degrees apart (CCW) around the centroid of {p,q,r}. Their targets are arranged
  // in the opposite (CW) angular relationship, which no pure rotation can reproduce — only
  // rotation+reflection can bring both p and q close to their targets simultaneously. Verified
  // numerically (not just asserted): a fine brute-force scan confirms the true flip=true optimum
  // (cost ~199986.67) beats the true flip=false optimum (cost ~199993.33) — this is a genuine
  // requirement for flip, not an artifact of a coarse step count.
  const pos: Positions = { p: [10, 0, 0], q: [0, 10, 0], r: [0, 0, 0] };
  const links = [
    { own: "p", otherX: 100000, otherY: 0 },
    { own: "q", otherX: 0, otherY: -100000 },
  ];
  const { flip } = bestOrientation(pos, ["p", "q", "r"], links, 360);
  expect(flip).toBe(true);
});

test("boundingRadius measures the furthest node from the centroid", () => {
  const pos: Positions = { a: [3, 4, 0], b: [0, 0, 0] };
  expect(boundingRadius(pos, ["a", "b"])).toBeCloseTo(2.5, 6);
});

test("boundingRadius is the true furthest-from-centroid distance, not half the longest pairwise distance", () => {
  // With only 2 points the two quantities coincide (the earlier test can't tell them apart). A
  // 3-point triangle separates them: centroid is (2,2); the furthest point (b or c) is sqrt(20)
  // away, while half the longest pairwise distance (b-c, length sqrt(72)) is 3*sqrt(2) =~ 4.243 —
  // a different number.
  const pos: Positions = { a: [0, 0, 0], b: [6, 0, 0], c: [0, 6, 0] };
  expect(boundingRadius(pos, ["a", "b", "c"])).toBeCloseTo(Math.sqrt(20), 6);
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

test("composeBrains clamps the gap up to minGap when the natural gap would be tiny", () => {
  // Two hairline-thin brains: natural gap = gapMult * (r+r) = 0.5 * 0.1 = 0.05, far below the
  // default minGap of 40. Without the clamp, the edge-to-edge gap would be ~0.05, not 40.
  const A: Positions = { a1: [0, 0, 0], a2: [0.1, 0, 0] };
  const B: Positions = { b1: [0, 0, 0], b2: [0.1, 0, 0] };
  const out = composeBrains([{ ids: ["a1", "a2"], pos: A }, { ids: ["b1", "b2"], pos: B }]);
  const aMax = Math.max(out.a1[0], out.a2[0]);
  const bMin = Math.min(out.b1[0], out.b2[0]);
  expect(bMin - aMax).toBeCloseTo(40, 6);
});

test("composeBrains clamps the gap down to maxGap when the natural gap would be huge", () => {
  // Two huge brains: natural gap = gapMult * (1000+1000) = 1000, above the default maxGap of 600.
  // Without the clamp, the edge-to-edge gap would be ~1000, not 600.
  const A: Positions = { a1: [-1000, 0, 0], a2: [1000, 0, 0] };
  const B: Positions = { b1: [-1000, 0, 0], b2: [1000, 0, 0] };
  const out = composeBrains([{ ids: ["a1", "a2"], pos: A }, { ids: ["b1", "b2"], pos: B }]);
  const aMax = Math.max(out.a1[0], out.a2[0]);
  const bMin = Math.min(out.b1[0], out.b2[0]);
  expect(bMin - aMax).toBeCloseTo(600, 6);
});

test("composeBrains threads prevR through a 3-brain chain (gap uses the immediately preceding brain's radius, not a stale one)", () => {
  // A (r=100), B (r=200), C (r=100). Placing C must use B's radius (200) for its gap, not A's
  // (100) — a bug that forgets to advance prevR would place C's centroid at 850 instead of 900.
  const A: Positions = { a1: [-100, 0, 0], a2: [100, 0, 0] };
  const B: Positions = { b1: [-200, 0, 0], b2: [200, 0, 0] };
  const C: Positions = { c1: [-100, 0, 0], c2: [100, 0, 0] };
  const out = composeBrains([
    { ids: ["a1", "a2"], pos: A },
    { ids: ["b1", "b2"], pos: B },
    { ids: ["c1", "c2"], pos: C },
  ]);
  const cCentroidX = (out.c1[0] + out.c2[0]) / 2;
  expect(cCentroidX).toBeCloseTo(900, 6);
  // Also not hardcoded to a fixed 40px gap: this scenario's true gaps (150, 150) are well clear of
  // both the min and max clamps.
  const bCentroidX = (out.b1[0] + out.b2[0]) / 2;
  expect(bCentroidX).toBeCloseTo(450, 6);
});

test("composeBrains aligns later brains' centroid Y onto the anchor brain's centroid Y", () => {
  const A: Positions = { a1: [0, 10, 0], a2: [1, 10, 0] };
  const B: Positions = { b1: [0, -50, 0], b2: [1, -50, 0] };
  const out = composeBrains([{ ids: ["a1", "a2"], pos: A }, { ids: ["b1", "b2"], pos: B }]);
  const bCentroidY = (out.b1[1] + out.b2[1]) / 2;
  expect(bCentroidY).toBeCloseTo(10, 6);
});

test("composeBrains does not let a non-finite coordinate in one brain poison the brains placed after it", () => {
  const A: Positions = { a1: [NaN, 0, 0], a2: [1, 0, 0] };
  const B: Positions = { b1: [0, 0, 0], b2: [1, 0, 0] };
  const out = composeBrains([{ ids: ["a1", "a2"], pos: A }, { ids: ["b1", "b2"], pos: B }]);
  for (const p of [out.a1, out.a2, out.b1, out.b2]) {
    expect(p.every((n) => Number.isFinite(n))).toBe(true);
  }
  // B must still be placed to the right of A, not swallowed by a NaN cursor.
  const aMax = Math.max(out.a1[0], out.a2[0]);
  const bMin = Math.min(out.b1[0], out.b2[0]);
  expect(bMin).toBeGreaterThan(aMax);
});
