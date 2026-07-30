// app/src/graph/cameraModel.test.ts
//
// Pins the camera-dolly derivation from MERGE-NOTES.md §6: `dollyForT` must be the exact algebraic
// inverse of Canvas's original `zoomT()`, monotonic, zero at the resting overview, and never reach
// the perspective plane. The round-trip test is the whole correctness claim for the derivation (see
// cameraModel.ts's module comment) — its tolerance is exercised here, not just asserted.
import { describe, expect, it } from "bun:test";
import { dollyForT, MAX_MAGNIFICATION, MAX_ZOOM_FRAC, zoomT } from "./cameraModel";

// Representative perspective distances (`P = (H/2) / tan(FOV/2)`, FOV 60°) for viewport heights from
// ~140px to ~2770px — comfortably inside the "any real viewport" domain the module comment's
// derivation depends on (P ≫ 1 / (1 - MAX_ZOOM_FRAC) ≈ 16.667; see the "round trip" describe below
// for what happens once P drops near that threshold).
const PERSPECTIVES = [120, 300, 650, 1200, 2400];

describe("dollyForT — the derived camera dolly", () => {
  it("is strictly monotonic on [0,1]", () => {
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

  it("dollyForT(1, P) reaches exactly Canvas's old wheel-clamp stop, MAX_ZOOM_FRAC * P", () => {
    for (const P of PERSPECTIVES) expect(dollyForT(1, P)).toBeCloseTo(MAX_ZOOM_FRAC * P, 9);
  });

  it("never reaches the perspective plane P for any t in [0,1] — no divide-by-zero, no inversion", () => {
    for (const P of PERSPECTIVES) {
      for (let i = 0; i <= 200; i++) {
        expect(dollyForT(i / 200, P)).toBeLessThan(P);
      }
    }
  });

  it("clamps out-of-range t to [0,1], mirroring resolutionT's own clamp", () => {
    for (const P of PERSPECTIVES) {
      expect(dollyForT(-1, P)).toBe(dollyForT(0, P));
      expect(dollyForT(2, P)).toBeCloseTo(dollyForT(1, P), 9);
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
  it("round-trips within 1e-9 across the full [0,1] range, for any realistic perspective", () => {
    // Tolerance is NOT tuned to make this pass — dollyForT was derived as the closed-form algebraic
    // inverse of zoomT (see cameraModel.ts's module comment), so in the domain where that derivation
    // holds (P > 1 / (1 - MAX_ZOOM_FRAC) ≈ 16.667, true of any real viewport) the two are exact
    // inverses and the only residual is float64 rounding in Math.log/Math.pow — measured at ~1e-15
    // across this same sweep. 1e-9 leaves nine orders of magnitude of headroom over that measured
    // error, so this stays a meaningful regression check (it fails hard if the derivation is ever
    // broken by an edit) without being fragile to engine-level float differences.
    for (const P of PERSPECTIVES) {
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        expect(zoomT(dollyForT(t, P), P)).toBeCloseTo(t, 9);
      }
    }
  });

  it("degrades below the documented precondition (P near 1/(1-MAX_ZOOM_FRAC)) — proof the tolerance is load-bearing, not decorative", () => {
    // At P = 10 (well under the ~16.667 threshold), the guard inside zoomT's own zs/maxZs floor
    // distorts the ratio at mid-range t, not just at the t=1 boundary — the round trip genuinely
    // breaks (measured error ~0.18 at t=0.5), rather than merely losing precision. This pins that the
    // 1e-9 tolerance above is doing real work (it would catch this), not a threshold nobody could
    // ever miss.
    const P = 10;
    const t = 0.5;
    expect(Math.abs(zoomT(dollyForT(t, P), P) - t)).toBeGreaterThan(0.1);
  });
});

describe("constants", () => {
  it("MAX_MAGNIFICATION is the fixed 1/(1-MAX_ZOOM_FRAC) ratio, independent of perspective", () => {
    expect(MAX_MAGNIFICATION).toBeCloseTo(1 / (1 - MAX_ZOOM_FRAC), 10);
    expect(MAX_ZOOM_FRAC).toBe(0.94); // Canvas's own wheel clamp, carried over verbatim
  });
});
