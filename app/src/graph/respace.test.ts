import { describe, expect, it } from "bun:test";
import {
  type Vec3,
  medianNearestNeighborDistance,
  scaleToSpacing,
  createSpacingCache,
  SPACING_CACHE_MAX_ENTRIES,
} from "./respace";

// ---- fixtures -------------------------------------------------------------------------------
//
// Deterministic point clouds (no Math.random — matches the rest of app/src/graph's fixtures, e.g.
// AsciiGraphRenderer.test.ts's trig-based sampleGraph()). A Fibonacci-sphere-style spiral: golden-
// angle steps around, sqrt-growing radius outward. Aperiodic by construction (the golden angle is
// irrational relative to a full turn), so it has none of a symmetric ring's distance TIES — every
// nearest-neighbour relationship in the fixture is unambiguous, which the rank-order test below
// depends on.
const GOLDEN_ANGLE = 2.399963229728653;

function spiralCloud(n: number, radiusScale = 10): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(i + 1) * radiusScale;
    const theta = i * GOLDEN_ANGLE;
    const phi = ((i * 0.6180339887) % 1) * Math.PI;
    pts.push([
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    ]);
  }
  return pts;
}

/** Independent (re-implemented, not imported from respace.ts) nearest-neighbour rank list for every
 *  point, nearest-first, by INDEX. Used to check `scaleToSpacing` doesn't reorder anything — kept
 *  deliberately separate from the module's own `medianNearestNeighborDistance` so a shared bug in
 *  the distance math can't hide from both the implementation and its test. */
function neighborRanks(positions: readonly Vec3[]): number[][] {
  return positions.map((p, i) => {
    const others = positions
      .map((q, j) => ({ j, d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d);
    return others.map((e) => e.j);
  });
}

/** Independent median-nearest-neighbour-distance measurement, re-implemented (not imported from
 *  respace.ts) for the same reason as `neighborRanks` — a black-box check on the OUTPUT of
 *  scaleToSpacing, not a re-run of the code that produced it. */
function measuredSpacing(positions: readonly Vec3[]): number {
  const nn = positions.map((p, i) => {
    let best = Infinity;
    positions.forEach((q, j) => {
      if (j === i) return;
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (d < best) best = d;
    });
    return best;
  });
  const s = [...nn].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---- medianNearestNeighborDistance -----------------------------------------------------------

describe("medianNearestNeighborDistance", () => {
  it("is the spacing on a simple evenly-spaced line", () => {
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
    expect(medianNearestNeighborDistance(pts)).toBeCloseTo(1, 10);
  });

  it("is the MEDIAN, not the min or mean, when per-point nearest-neighbour distances differ", () => {
    // Unevenly spaced line: gaps 1, 2, 3, 4 between consecutive points at x = 0, 1, 3, 6, 10. Each
    // point's own nearest-neighbour distance comes out different (1, 1, 2, 3, 4 — see below), so this
    // fixture discriminates median (2) from both min (1) and mean (2.2); the earlier "evenly-spaced
    // line" case above can't (every point's NN distance is the same 1 there, so min/mean/median all
    // agree and a min-instead-of-median bug would slip through it undetected).
    //   p0=0: nearest p1 (1)        p1=1: nearest p0 (1)        p2=3: nearest p1 (2)
    //   p3=6: nearest p2 (3)        p4=10: nearest p3 (4)
    //   sorted NN distances: [1, 1, 2, 3, 4] -> median = 2 (mean = 2.2, min = 1)
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [3, 0, 0], [6, 0, 0], [10, 0, 0]];
    expect(medianNearestNeighborDistance(pts)).toBeCloseTo(2, 10);
  });

  it("is 0 for fewer than 2 points", () => {
    expect(medianNearestNeighborDistance([])).toBe(0);
    expect(medianNearestNeighborDistance([[5, 5, 5]])).toBe(0);
  });

  it("is 0 for a fully coincident cloud", () => {
    const pts: Vec3[] = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
    expect(medianNearestNeighborDistance(pts)).toBe(0);
  });
});

// ---- scaleToSpacing: node-count independence ---------------------------------------------------

describe("scaleToSpacing — node-count independence", () => {
  it("hits the target spacing on a single cloud", () => {
    const cloud = spiralCloud(150, 7);
    const out = scaleToSpacing(cloud, 20);
    expect(measuredSpacing(out)).toBeCloseTo(20, 5);
  });

  it("100 vs 2000 nodes converge on comparable median nearest-neighbour distance for the same target", () => {
    // Two clouds of very different size and very different RAW spacing (spiralCloud's radius grows
    // with sqrt(n), so their untouched median NN distances differ substantially) — this is the
    // "node-count-independent spacing" property: after rescaling both to the SAME targetSpacing,
    // their resting spacing should land on (and therefore near each other at) that target,
    // regardless of how many nodes went in.
    const small = spiralCloud(100, 5);
    const large = spiralCloud(2000, 50);
    expect(measuredSpacing(small)).not.toBeCloseTo(measuredSpacing(large), 0); // raw spacing genuinely differs

    const target = 15;
    const smallOut = scaleToSpacing(small, target);
    const largeOut = scaleToSpacing(large, target);

    const smallSpacing = measuredSpacing(smallOut);
    const largeSpacing = measuredSpacing(largeOut);
    expect(smallSpacing).toBeCloseTo(target, 0);
    expect(largeSpacing).toBeCloseTo(target, 0);
    expect(Math.abs(smallSpacing - largeSpacing)).toBeLessThan(1);
  });
});

// ---- scaleToSpacing: pure rescale (THE LAW — "the layout may not lie") ------------------------

describe("scaleToSpacing — pure rescale (neighbour ranks preserved)", () => {
  it("preserves every point's full nearest-neighbour rank list on a non-trivial fixture", () => {
    const cloud = spiralCloud(60, 9);
    const before = neighborRanks(cloud);
    const after = neighborRanks(scaleToSpacing(cloud, 3));
    expect(after).toEqual(before);
  });

  it("preserves rank order under a DOWN-scale too (target smaller than the raw spacing)", () => {
    const cloud = spiralCloud(60, 40);
    const before = neighborRanks(cloud);
    const after = neighborRanks(scaleToSpacing(cloud, 2));
    expect(after).toEqual(before);
  });

  it("recenters the cloud onto its own centroid", () => {
    const cloud = spiralCloud(80, 11).map(([x, y, z]): Vec3 => [x + 500, y - 300, z + 42]); // off-center
    const out = scaleToSpacing(cloud, 5);
    let cx = 0, cy = 0, cz = 0;
    for (const [x, y, z] of out) { cx += x; cy += y; cz += z; }
    cx /= out.length; cy /= out.length; cz /= out.length;
    expect(cx).toBeCloseTo(0, 6);
    expect(cy).toBeCloseTo(0, 6);
    expect(cz).toBeCloseTo(0, 6);
  });

  it("never mutates the input array", () => {
    const cloud = spiralCloud(30, 5);
    const snapshot = cloud.map((p) => [...p]);
    scaleToSpacing(cloud, 100);
    expect(cloud).toEqual(snapshot);
  });
});

// ---- scaleToSpacing: degenerate inputs ---------------------------------------------------------

describe("scaleToSpacing — degenerate inputs stay finite", () => {
  it("returns an empty array for an empty cloud", () => {
    expect(scaleToSpacing([], 10)).toEqual([]);
  });

  it("recenters a single point onto the origin without a target to hit", () => {
    expect(scaleToSpacing([[3, 4, 5]], 10)).toEqual([[0, 0, 0]]);
  });

  it("does not divide by zero on a fully coincident cloud", () => {
    const pts: Vec3[] = [[2, 2, 2], [2, 2, 2], [2, 2, 2]];
    const out = scaleToSpacing(pts, 10);
    for (const p of out) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
      expect(Number.isFinite(p[2])).toBe(true);
    }
  });

  it("scrubs non-finite input coordinates instead of propagating NaN", () => {
    const pts: Vec3[] = [[0, 0, 0], [NaN, 5, Infinity], [3, -Infinity, 1]];
    const out = scaleToSpacing(pts, 10);
    for (const p of out) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
      expect(Number.isFinite(p[2])).toBe(true);
    }
  });

  it("one non-finite point among many well-formed ones doesn't poison the whole cloud's rescale", () => {
    // graphFit.ts's discipline ("a NaN/Infinity coordinate ... can never take the layout down")
    // applies here too: a single corrupt point should scrub to something harmless, NOT make the
    // measured spacing NaN and silently fall the ENTIRE cloud back to scale=1 (no rescale at all).
    // If nearest-neighbour distances involving the bad point aren't scrubbed before the median is
    // taken, `current` goes NaN, `scale` falls back to 1 (NaN > EPS is false), and every well-formed
    // point is left at its RAW spacing instead of the requested target — this test's whole point is
    // to distinguish that failure from a genuine rescale.
    const cloud = spiralCloud(50, 8);
    const raw = measuredSpacing(cloud);
    const corrupted = cloud.map((p, i): Vec3 => (i === 7 ? [NaN, p[1], Infinity] : p));
    const target = raw * 4; // far enough from `raw` that "still at raw spacing" is unambiguous
    const out = scaleToSpacing(corrupted, target);
    const wellFormed = out.filter((_, i) => i !== 7);
    for (const p of wellFormed) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
      expect(Number.isFinite(p[2])).toBe(true);
    }
    const achieved = measuredSpacing(wellFormed);
    expect(Math.abs(achieved - target) / target).toBeLessThan(0.15); // close to the TARGET...
    expect(Math.abs(achieved - raw) / raw).toBeGreaterThan(0.5);      // ...and clearly not stuck at raw
  });

  it("falls back to scale=1 (recenter only) for a non-positive or non-finite target", () => {
    const cloud = spiralCloud(20, 6);
    const zero = scaleToSpacing(cloud, 0);
    const negative = scaleToSpacing(cloud, -5);
    const nan = scaleToSpacing(cloud, NaN);
    // All three should equal the plain recenter (scale=1): same as calling with target === current.
    const current = medianNearestNeighborDistance(cloud);
    const recentered = scaleToSpacing(cloud, current);
    for (let i = 0; i < cloud.length; i++) {
      expect(zero[i][0]).toBeCloseTo(recentered[i][0], 6);
      expect(negative[i][0]).toBeCloseTo(recentered[i][0], 6);
      expect(nan[i][0]).toBeCloseTo(recentered[i][0], 6);
    }
  });
});

// ---- signature-keyed memo -----------------------------------------------------------------------

describe("createSpacingCache", () => {
  it("returns the identical array for an unchanged signature (compute not called again)", () => {
    let calls = 0;
    const cache = createSpacingCache<Vec3[]>();
    const compute = () => { calls++; return scaleToSpacing(spiralCloud(10), 5); };
    const first = cache.getOrCompute("sig-a", compute);
    const second = cache.getOrCompute("sig-a", compute);
    expect(second).toBe(first); // same reference, not just deep-equal
    expect(calls).toBe(1);
  });

  it("recomputes for a changed signature", () => {
    let calls = 0;
    const cache = createSpacingCache<Vec3[]>();
    const a = cache.getOrCompute("sig-a", () => { calls++; return [[1, 1, 1]]; });
    const b = cache.getOrCompute("sig-b", () => { calls++; return [[2, 2, 2]]; });
    expect(calls).toBe(2);
    expect(a).not.toEqual(b);
    // Re-visiting "sig-a" is still a hit after a different signature was inserted.
    const aAgain = cache.getOrCompute("sig-a", () => { calls++; return [[9, 9, 9]]; });
    expect(aAgain).toBe(a);
    expect(calls).toBe(2);
  });

  it("evicts the OLDEST entry once past the cap (FIFO, not LRU)", () => {
    const cap = 3;
    const cache = createSpacingCache<number>(cap);
    cache.getOrCompute("s1", () => 1);
    cache.getOrCompute("s2", () => 2);
    cache.getOrCompute("s3", () => 3);
    // Touching "s1" again does NOT move it to the back — this is FIFO, not LRU.
    cache.getOrCompute("s1", () => -1);
    cache.getOrCompute("s4", () => 4); // pushes size to 4 -> evicts the oldest insertion ("s1")

    // Check the still-cached survivor FIRST: a hit never inserts, so this probe can't itself evict
    // anything and disturb what it's checking. (Probing the evicted key below is a genuine miss —
    // it re-inserts "s1", which would itself evict "s3" as a side effect, so it must run last.)
    let s2Calls = 0;
    cache.getOrCompute("s2", () => { s2Calls++; return 222; }); // still cached: not evicted
    expect(s2Calls).toBe(0);

    let s1Calls = 0;
    cache.getOrCompute("s1", () => { s1Calls++; return 111; }); // must recompute: evicted
    expect(s1Calls).toBe(1);
  });

  it("defaults its cap to SPACING_CACHE_MAX_ENTRIES", () => {
    const cache = createSpacingCache<number>();
    for (let i = 0; i < SPACING_CACHE_MAX_ENTRIES; i++) cache.getOrCompute(`s${i}`, () => i);
    // The first entry is still present right at the cap...
    let firstCalls = 0;
    cache.getOrCompute("s0", () => { firstCalls++; return -1; });
    expect(firstCalls).toBe(0);
    // ...but one more insertion pushes it out.
    cache.getOrCompute("s-overflow", () => -2);
    let firstCallsAfter = 0;
    cache.getOrCompute("s0", () => { firstCallsAfter++; return -1; });
    expect(firstCallsAfter).toBe(1);
  });
});
