// app/src/graph/cameraModel.test.ts
//
// Pins the camera-dolly derivation documented in cameraModel.ts's header: `dollyForT` must be the exact algebraic
// inverse of Canvas's original `zoomT()`, monotonic, zero at the resting overview, and never reach
// the perspective plane — at ANY perspective distance a real host box can produce, not just an
// "ordinary" one (see cameraModel.ts's module comment for why that distinction matters). The
// round-trip test is the whole correctness claim for the derivation — its tolerance is exercised
// here, not just asserted.
import { describe, expect, it } from "bun:test";
import { dollyForT, MAX_MAGNIFICATION, MAX_ZOOM_FRAC, zoomT } from "./cameraModel";

// Perspective distances (`P = (H/2) / tan(FOV/2)`, FOV 60°) spanning ordinary viewport heights
// (~280px to ~5540px) down to the genuinely degenerate cases this renderer's own code admits: 15.59
// is ASCII's grid floor (`rows = max(1, floor((h - 2*PAD_Y) / cellH))`) for ANY host box under 56px
// tall — a pane dragged to a sliver, or a collapsed split, both ordinary UI states — and 8.66 is the
// same floor under a `--cell-h: 10px` CSS override; `graphFit.ts`'s `MIN_USABLE_BOX_PX = 4` admits
// boxes smaller still (1.5 stands in for that). There is no separate "too small" code path in
// dollyForT/zoomT — whatever P a real host box produces is handed to them unmodified — so the
// properties below hold across this whole range, not just at a comfortable viewport scale.
const PERSPECTIVES = [1.5, 8.66, 15.59, 120, 300, 650, 1200, 2400, 3741];

// The subset of PERSPECTIVES clear of the MAX_ZOOM_FRAC floor (P > 1/(1-MAX_ZOOM_FRAC) ≈ 16.667),
// where maxZsFor's per-P magnification simplifies to exactly the asymptotic MAX_MAGNIFICATION — i.e.
// where dollyForT(1,P) === MAX_ZOOM_FRAC*P and the t=0.5 magnification === √MAX_MAGNIFICATION hold as
// exact shortcuts rather than merely "the correct, P-scaled value" (which the round-trip test below
// already covers at every P in PERSPECTIVES, floor included).
const ORDINARY_PERSPECTIVES = [120, 300, 650, 1200, 2400, 3741];

describe("dollyForT — the derived camera dolly", () => {
  it("is strictly monotonic on [0,1], at every perspective distance including the degenerate ones", () => {
    for (const P of PERSPECTIVES) {
      let prev = -Infinity;
      for (let i = 0; i <= 200; i++) {
        const z = dollyForT(i / 200, P);
        expect(z).toBeGreaterThan(prev);
        prev = z;
      }
    }
  });

  it("dollyForT(0, P) === 0 — the resting overview (fit) has no dolly", () => {
    for (const P of PERSPECTIVES) expect(dollyForT(0, P)).toBe(0);
  });

  it("at ordinary viewport scale, dollyForT(1, P) reaches exactly Canvas's old wheel-clamp stop, MAX_ZOOM_FRAC * P", () => {
    // Clear of maxZsFor's floor (see ORDINARY_PERSPECTIVES) this is not just close — the chain
    // P * (1 - 1/maxZsFor(P)) collapses to exactly MAX_ZOOM_FRAC * P, bit-for-bit, at every P tested.
    for (const P of ORDINARY_PERSPECTIVES) expect(dollyForT(1, P)).toBe(MAX_ZOOM_FRAC * P);
  });

  it("never reaches the perspective plane P for any t in [0,1] — no divide-by-zero, no inversion", () => {
    for (const P of PERSPECTIVES) {
      for (let i = 0; i <= 200; i++) {
        expect(dollyForT(i / 200, P)).toBeLessThan(P);
      }
    }
  });

  it("clamps out-of-range t to [0,1], mirroring resolutionT's own clamp — bit-identical, not just close", () => {
    for (const P of PERSPECTIVES) {
      expect(dollyForT(-1, P)).toBe(dollyForT(0, P));
      expect(dollyForT(2, P)).toBe(dollyForT(1, P));
    }
  });

  it("pins the mapping's LOG shape independently of the round trip: at t=0.5 the magnification is exactly √MAX_MAGNIFICATION", () => {
    // A correlated-but-WRONG pair — e.g. dollyForT'(t) = dollyForT(√t) paired with zoomT'(z) =
    // zoomT(z)² — round-trips perfectly (zoomT'(dollyForT'(t)) = zoomT(dollyForT(√t))² = (√t)² = t)
    // while relocating every LOD/label/colour boundary the log character exists to space evenly. The
    // round-trip test alone cannot catch that kind of bug, because it only checks that going in and
    // back out returns you to where you started — not where the midpoint actually landed. This does.
    for (const P of ORDINARY_PERSPECTIVES) {
      const dolly = dollyForT(0.5, P);
      const magnification = P / (P - dolly);
      expect(magnification).toBeCloseTo(Math.sqrt(MAX_MAGNIFICATION), 10);
    }
  });
});

describe("the degenerate-perspective domain guard (maxZsFor's Math.max(1, perspective))", () => {
  // These became reachable when AsciiGraphRenderer started calling this module: the renderer holds
  // `P = 1` from construction until its first measure(), and nothing in these signatures forbids a
  // caller from handing over worse. See maxZsFor's doc for why a NaN here is the worst shape available.
  it("returns a FINITE, non-positive dolly at a non-positive perspective instead of NaN", () => {
    for (const P of [0, -1, -15.59, -3741]) {
      for (let i = 0; i <= 20; i++) {
        const d = dollyForT(i / 20, P);
        expect(Number.isNaN(d)).toBe(false);
        expect(Number.isFinite(d)).toBe(true);
        // A camera with no depth in front of it must not be moved FORWARD by a fractional t — which
        // is what the un-floored formula did before it reached the NaN: maxZsFor(-5) came out as -5,
        // and Math.pow(-5, -0.5) is NaN while Math.pow(-5, -1) is a finite -0.2.
        expect(d).toBeLessThanOrEqual(0);
      }
    }
  });

  it("is identically 0 at P <= 1 — a flat segment, exactly as dollyForT's docstring now scopes it", () => {
    // The renderer's pre-measure() state. Asserted rather than left implicit because the behaviour is
    // deliberate (no measured depth, no camera movement) and an earlier docstring claimed the
    // opposite ("strictly monotonic for any perspective >= 1").
    for (const P of [1, 0.5]) {
      for (let i = 0; i <= 20; i++) expect(dollyForT(i / 20, P)).toBe(0);
    }
  });

  it("changes NOTHING at any perspective a measured host box produces — the floor is a guard, not a knob", () => {
    // Guards against the floor being "tidied" upward (e.g. Math.max(20, …)), which would silently
    // flatten the dolly across the whole small-viewport end of PERSPECTIVES while every other test
    // here still passed. Comparandum computed WITHOUT the floor, from MAX_ZOOM_FRAC directly.
    for (const P of PERSPECTIVES) {
      const unflooredMaxZs = P / Math.max(1, P - MAX_ZOOM_FRAC * P);
      for (const t of [0.25, 0.5, 0.75, 1]) {
        expect(dollyForT(t, P)).toBe(P * (1 - Math.pow(unflooredMaxZs, -t)));
      }
    }
  });
});

describe("zoomT — Canvas's dolly-to-progress mapping, ported and parameterized", () => {
  it("zoomT(0, P) === 0 — the fit distance has no progress", () => {
    for (const P of PERSPECTIVES) expect(zoomT(0, P)).toBe(0);
  });

  it("a zoom at or behind the fit distance (zs <= 1) returns 0, not a negative progress", () => {
    for (const P of PERSPECTIVES) {
      expect(zoomT(-50, P)).toBe(0);
      expect(zoomT(-P, P)).toBe(0);
    }
  });

  it("clamps its result to [0,1] even past the wheel-clamp stop", () => {
    for (const P of PERSPECTIVES) {
      // Push zoom well past MAX_ZOOM_FRAC * P (the wheel itself would never do this — onWheel
      // clamps goalZoom — but zoomT must not blow past 1 or divide by ~0 if handed one anyway).
      expect(zoomT(P * 0.999, P)).toBeLessThanOrEqual(1);
      expect(zoomT(P * 0.999, P)).toBeGreaterThan(0);
    }
  });
});

describe("round trip — the whole correctness claim (zoomT(dollyForT(t, P), P) ≈ t)", () => {
  it("round-trips within 1e-9 across the full [0,1] range, at every perspective distance — no domain restriction", () => {
    // Tolerance is NOT tuned to make this pass — dollyForT and zoomT share ONE formula for the
    // wheel-stop magnification (maxZsFor), so they are exact algebraic inverses of each other at
    // every perspective, not just at a comfortable viewport scale (see cameraModel.ts's module
    // comment for the history: an earlier version hardcoded that magnification's large-P asymptote
    // instead of computing it per-P, which broke exactly at the small-P end of this same
    // PERSPECTIVES array — see the "deliberately wrong dolly" test below for the measured size of
    // that break). The only residual here is float64 rounding in Math.log/Math.pow — measured at
    // ~8e-16 across this whole sweep. 1e-9 leaves six orders of magnitude of headroom over that
    // measured error, so this stays a meaningful regression check without being fragile to
    // engine-level float differences.
    for (const P of PERSPECTIVES) {
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        expect(zoomT(dollyForT(t, P), P)).toBeCloseTo(t, 9);
      }
    }
  });

  it("a deliberately wrong dolly — the hardcoded-constant formula this file used to use — fails the round-trip gate at a degenerate perspective", () => {
    // Proof the 1e-9 tolerance above is load-bearing, not decorative: it must be ABLE to fail. This
    // reconstructs the earlier (wrong) implementation locally — plugging the ASYMPTOTIC
    // MAX_MAGNIFICATION straight into the dolly formula instead of the per-P maxZsFor — rather than
    // asserting the CURRENT (correct) dollyForT fails at a degenerate P, which would be pinning the
    // bug in place instead of the fix (see cameraModel.ts's module comment for why that constant is
    // now merely a documentation value, not something either exported function computes with).
    const wrongDollyForT = (t: number, perspective: number) => perspective * (1 - Math.pow(MAX_MAGNIFICATION, -t));
    const P = 10, t = 0.5;
    expect(Math.abs(zoomT(wrongDollyForT(t, P), P) - t)).toBeGreaterThan(0.1); // measured ~0.111
    // Sanity: the wrong formula agrees with the correct one at ordinary viewport scale (that's WHY
    // the bug shipped unnoticed) — this isn't testing dollyForT, just confirming the comparandum
    // above is a faithful reconstruction of "worked in the common case, broke at the small-P edge".
    expect(zoomT(wrongDollyForT(0.5, 300), 300)).toBeCloseTo(0.5, 9);
  });
});

describe("constants", () => {
  it("MAX_MAGNIFICATION is the fixed 1/(1-MAX_ZOOM_FRAC) ratio, independent of perspective", () => {
    expect(MAX_MAGNIFICATION).toBeCloseTo(1 / (1 - MAX_ZOOM_FRAC), 10);
    expect(MAX_ZOOM_FRAC).toBe(0.94); // Canvas's own wheel clamp, carried over verbatim
  });
});
