// app/src/graph/modeMorph.test.ts
//
// Pins the pure model behind the animated 2D<->3D morph (see modeMorph.ts's header for what it
// restores and where it deliberately diverges from the deleted CanvasGraphRenderer.ts). No DOM, no
// canvas, no timers anywhere in this file — every function under test is elapsed-time (or
// mix-fraction) in, value out.
import { describe, expect, it } from "bun:test";
import {
  blendPosition, easeInOutCubic, lerp, MODE_MORPH_MS, morphProgress,
} from "./modeMorph";
import type { Vec3 } from "./graphRenderer";

describe("MODE_MORPH_MS", () => {
  it("is the ported 500ms duration (CanvasGraphRenderer.ts:79)", () => {
    expect(MODE_MORPH_MS).toBe(500);
  });
});

describe("easeInOutCubic", () => {
  it("is exactly 0 at 0 and exactly 1 at 1", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("is strictly monotonic on [0,1]", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const v = easeInOutCubic(i / 200);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("is exactly 0.5 at the midpoint — an absolute check the round-trip-style tests below lean on", () => {
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });
});

describe("morphProgress — elapsed ms -> eased 0..1 progress", () => {
  it("is exactly 0 for any non-positive elapsed time", () => {
    for (const elapsed of [0, -1, -500, -1e6]) {
      expect(morphProgress(elapsed, MODE_MORPH_MS)).toBe(0);
    }
  });

  it("is exactly 1 once elapsed time reaches or passes the duration", () => {
    for (const elapsed of [MODE_MORPH_MS, MODE_MORPH_MS + 1, MODE_MORPH_MS * 10]) {
      expect(morphProgress(elapsed, MODE_MORPH_MS)).toBe(1);
    }
  });

  it("is monotonic non-decreasing over an increasing elapsed-time sweep", () => {
    let prev = -Infinity;
    for (let ms = -100; ms <= MODE_MORPH_MS + 100; ms += 1) {
      const v = morphProgress(ms, MODE_MORPH_MS);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("matches easeInOutCubic applied to the clamped linear fraction, not a different curve entirely", () => {
    for (const ms of [0, 50, 125, 250, 375, 450, 500]) {
      expect(morphProgress(ms, 500)).toBe(easeInOutCubic(ms / 500));
    }
  });

  it("a non-positive duration is a degenerate instant transition — always settled", () => {
    expect(morphProgress(0, 0)).toBe(1);
    expect(morphProgress(-1, -5)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// blendPosition
// ---------------------------------------------------------------------------------------------

/** A handful of distinct 3D/2D layout pairs — not just one node — so "every node" in the brief's
 *  own wording is actually exercised, not a single coincidentally-passing case. One pair (the
 *  third) has p3 and p2 differ on EVERY axis; another (the fourth) shares x/y and differs only in
 *  z, matching how AsciiGraphRenderer's own p3/p2 pairs relate for a node whose 2D layout is the
 *  3D one flattened. */
const NODE_PAIRS: { p3: Vec3; p2: Vec3 }[] = [
  { p3: [10, 20, 30], p2: [1, 2, 0] },
  { p3: [-5, 0, 40], p2: [-5, 0, 0] },
  { p3: [0, 0, 0], p2: [100, -100, 0] },
  { p3: [3.5, -7.25, 12.125], p2: [3.5, -7.25, 0] },
];

describe("blendPosition — the per-node 3D<->2D position blend", () => {
  it("at flatten <= 0 returns p3 EXACTLY (same values, not merely close)", () => {
    for (const { p3, p2 } of NODE_PAIRS) {
      for (const flatten of [0, -1, -0.5]) {
        expect(blendPosition(p3, p2, flatten)).toEqual(p3);
      }
    }
  });

  it("at flatten >= 1 equals the pure-2D position EXACTLY, for every node — the absolute assertion the brief requires", () => {
    // Deliberately NOT phrased in terms of MODE_MORPH_MS or easeInOutCubic's constants — a bare
    // structural equality that no retune of the easing curve or duration can ever make false.
    for (const { p3, p2 } of NODE_PAIRS) {
      for (const flatten of [1, 1.5, 2]) {
        expect(blendPosition(p3, p2, flatten)).toEqual(p2);
      }
    }
  });

  it("interpolates monotonically between p3 and p2 on each axis for flatten in (0,1)", () => {
    for (const { p3, p2 } of NODE_PAIRS) {
      let prev = blendPosition(p3, p2, 0);
      for (let i = 1; i <= 20; i++) {
        const flatten = i / 20;
        const cur = blendPosition(p3, p2, flatten);
        for (let axis = 0; axis < 3; axis++) {
          const delta = p2[axis] - p3[axis];
          if (delta > 0) expect(cur[axis]).toBeGreaterThanOrEqual(prev[axis]);
          else if (delta < 0) expect(cur[axis]).toBeLessThanOrEqual(prev[axis]);
          else expect(cur[axis]).toBeCloseTo(prev[axis], 10);
        }
        prev = cur;
      }
    }
  });

  it("matches a plain lerp at an interior point — the formula itself, not just its endpoints", () => {
    const p3: Vec3 = [0, 0, 0];
    const p2: Vec3 = [10, -20, 4];
    expect(blendPosition(p3, p2, 0.25)).toEqual([2.5, -5, 1]);
  });
});

// ---------------------------------------------------------------------------------------------
// lerp — the general FROM/TO interpolation that replaced `unwindOrbit` (round-1 fix: interrupting
// a transition needs an arbitrary LIVE `from`, not one fixed reference orbit — see modeMorph.ts's
// header for the history).
// ---------------------------------------------------------------------------------------------

describe("lerp — linear interpolation, exact at both ends", () => {
  it("at progress <= 0 returns `from` EXACTLY, for any `to`", () => {
    for (const progress of [0, -1, -0.2]) {
      expect(lerp(-0.5, 0.37, progress)).toBe(-0.5);
      expect(lerp(1.2, -0.8, progress)).toBe(1.2);
    }
  });

  it("at progress >= 1 returns `to` EXACTLY, for any `from`", () => {
    const pairs: [number, number][] = [[-0.5, 0], [1.2, -0.8], [0, 0], [1e20, 1]];
    for (const [from, to] of pairs) {
      for (const progress of [1, 1.4, 3]) {
        expect(lerp(from, to, progress)).toBe(to);
      }
    }
  });

  it("moves monotonically from `from` toward `to` as progress runs 0 -> 1", () => {
    const from = -0.5, to = 0.3;
    let prev = from;
    for (let i = 1; i <= 20; i++) {
      const v = lerp(from, to, i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("matches the plain arithmetic at an OFF-MIDPOINT sample — disambiguates direction, unlike a 0.5 sample alone", () => {
    // At progress = 0.5, lerp(a, b, 0.5) and lerp(b, a, 0.5) coincide (both land on the
    // midpoint), so a single midpoint assertion cannot tell a correctly-oriented lerp from one
    // with `from`/`to` swapped. 0.25 does not have that symmetry.
    expect(lerp(-0.5, 0.4, 0.25)).toBeCloseTo(-0.275, 10);
    expect(lerp(0.4, -0.5, 0.25)).toBeCloseTo(0.175, 10);
  });
});
