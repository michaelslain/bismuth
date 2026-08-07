import { describe, expect, it } from "bun:test";
import {
  MIN_USABLE_BOX_PX,
  isUsableBox,
  finiteOr,
  finiteVec3,
  boundingRadius,
  fitScale,
  boundingHalfExtents,
  fitScaleForBox,
  FIT_FILL_FRACTION,
  MAX_CANVAS_AREA_PX,
  clampDprToCanvasArea,
} from "./graphFit";

describe("isUsableBox", () => {
  it("accepts a real pane box", () => {
    expect(isUsableBox(800, 600)).toBe(true);
    expect(isUsableBox(MIN_USABLE_BOX_PX, MIN_USABLE_BOX_PX)).toBe(true);
  });

  it("rejects a degenerate mid-layout box (the collapse trigger)", () => {
    // `measure()` floors a 0px box to 1px; fitting to it collapses every node onto a point.
    expect(isUsableBox(1, 1)).toBe(false);
    expect(isUsableBox(0, 600)).toBe(false);
    expect(isUsableBox(800, 0)).toBe(false);
    expect(isUsableBox(3.9, 600)).toBe(false);
  });

  it("rejects a non-finite box", () => {
    expect(isUsableBox(NaN, 600)).toBe(false);
    expect(isUsableBox(800, Infinity)).toBe(false);
  });
});

describe("finiteOr", () => {
  it("passes finite values through", () => {
    expect(finiteOr(42)).toBe(42);
    expect(finiteOr(-3.5)).toBe(-3.5);
    expect(finiteOr(0)).toBe(0);
  });
  it("replaces NaN / Infinity with the fallback", () => {
    expect(finiteOr(NaN)).toBe(0);
    expect(finiteOr(Infinity)).toBe(0);
    expect(finiteOr(-Infinity, 7)).toBe(7);
    expect(finiteOr(NaN, 99)).toBe(99);
  });
});

describe("finiteVec3", () => {
  it("passes a clean triple through", () => {
    expect(finiteVec3([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("fills a missing z (a 2D coordinate) from the fallback", () => {
    expect(finiteVec3([5, 6])).toEqual([5, 6, 0]);
    expect(finiteVec3([5, 6], [0, 0, 9])).toEqual([5, 6, 9]);
  });
  it("returns the fallback triple for a missing point", () => {
    expect(finiteVec3(undefined)).toEqual([0, 0, 0]);
    expect(finiteVec3(undefined, [1, 1, 1])).toEqual([1, 1, 1]);
  });
  it("scrubs non-finite axes per-axis without poisoning the rest", () => {
    expect(finiteVec3([NaN, 2, 3])).toEqual([0, 2, 3]);
    expect(finiteVec3([1, Infinity, 3])).toEqual([1, 0, 3]);
    expect(finiteVec3([1, 2, NaN])).toEqual([1, 2, 0]);
  });
});

describe("boundingRadius", () => {
  it("returns the largest distance from origin", () => {
    expect(boundingRadius([[3, 4, 0], [1, 0, 0]])).toBeCloseTo(5, 6);
    expect(boundingRadius([[0, 0, 0], [0, 0, 10]])).toBeCloseTo(10, 6);
  });
  it("floors an empty / origin-only cloud so the fit scale can't divide by zero", () => {
    expect(boundingRadius([])).toBe(1);
    expect(boundingRadius([[0, 0, 0]])).toBe(1);
    expect(boundingRadius([[0.2, 0.1, 0]])).toBe(1); // sub-floor extent -> floor
  });
  it("honors a custom floor", () => {
    expect(boundingRadius([[0, 0, 0]], 5)).toBe(5);
  });
  it("ignores non-finite coordinates instead of returning NaN", () => {
    // A single NaN coordinate must NOT poison the radius (which would make worldScale NaN
    // and blank the whole graph until a clean layout arrives).
    expect(boundingRadius([[NaN, NaN, NaN], [3, 4, 0]])).toBeCloseTo(5, 6);
    expect(Number.isFinite(boundingRadius([[Infinity, 0, 0]]))).toBe(true);
    expect(boundingRadius([[Infinity, 0, 0]])).toBe(1); // scrubbed to origin -> floor
  });
  it("treats a 2-element point as z=0", () => {
    expect(boundingRadius([[3, 4]])).toBeCloseTo(5, 6);
  });
});

describe("fitScale", () => {
  it("computes fitPx / radius for healthy inputs", () => {
    expect(fitScale(300, 100)).toBeCloseTo(3, 6);
    expect(fitScale(336, 112)).toBeCloseTo(3, 6);
  });
  it("floors the radius at 1 (never explodes on a sub-unit cloud)", () => {
    expect(fitScale(300, 0.5)).toBe(300);
    expect(fitScale(300, 0)).toBe(300);
  });
  it("returns a finite positive scale for degenerate inputs (never NaN/Infinity)", () => {
    expect(fitScale(NaN, 100)).toBe(1 / 100);
    expect(fitScale(300, NaN)).toBe(300); // radius NaN -> floored to 1
    expect(fitScale(NaN, NaN)).toBe(1);
    expect(fitScale(Infinity, 100)).toBe(1 / 100);
    expect(Number.isFinite(fitScale(300, -5))).toBe(true);
    expect(fitScale(300, -5)).toBe(300); // negative radius -> floored to 1
  });
});

describe("boundingHalfExtents", () => {
  it("returns max |x| and max |y| independently over the cloud", () => {
    const r = boundingHalfExtents([[3, 1], [1, 9], [-8, 2]]);
    expect(r.hx).toBeCloseTo(8, 6);
    expect(r.hy).toBeCloseTo(9, 6);
  });

  it("floors an empty / origin-only cloud so the fit scale can't divide by zero", () => {
    expect(boundingHalfExtents([])).toEqual({ hx: 1, hy: 1 });
    expect(boundingHalfExtents([[0, 0]])).toEqual({ hx: 1, hy: 1 });
    expect(boundingHalfExtents([[0.1, 0.2]])).toEqual({ hx: 1, hy: 1 }); // sub-floor extent -> floor
  });

  it("honors a custom floor", () => {
    expect(boundingHalfExtents([[0, 0]], 5)).toEqual({ hx: 5, hy: 5 });
  });

  it("ignores non-finite coordinates instead of propagating NaN", () => {
    const r = boundingHalfExtents([[NaN, Infinity], [4, 6]]);
    expect(r.hx).toBeCloseTo(4, 6);
    expect(r.hy).toBeCloseTo(6, 6);
    expect(Number.isFinite(boundingHalfExtents([[Infinity, -Infinity]]).hx)).toBe(true);
  });
});

describe("fitScaleForBox", () => {
  it("fills the BINDING axis to exactly `fill` fraction of the box", () => {
    // box 1000x500, extents hx=hy=100 -> x ratio (1000*.92/2)/100=4.6, y ratio (500*.92/2)/100=2.3
    // the y axis is the binding one (smaller ratio wins).
    const s = fitScaleForBox(1000, 500, 100, 100);
    expect(s).toBeCloseTo(2.3, 6);
    expect((s * 100 * 2) / 500).toBeCloseTo(FIT_FILL_FRACTION, 6);
  });

  it("picks the smaller of the two axis ratios (never overflows the box)", () => {
    const wide = fitScaleForBox(800, 800, 200, 50);
    const tall = fitScaleForBox(800, 800, 50, 200);
    expect(wide).toBeCloseTo(tall, 6); // symmetric box, extents swapped -> same binding scale
    expect(wide).toBeCloseTo(1.84, 6);
  });

  it("returns 1 for degenerate (all-zero) inputs", () => {
    expect(fitScaleForBox(0, 0, 0, 0)).toBe(1);
  });

  it("is always finite and positive for extreme/non-finite inputs", () => {
    expect(Number.isFinite(fitScaleForBox(NaN, NaN, NaN, NaN))).toBe(true);
    expect(fitScaleForBox(NaN, NaN, NaN, NaN)).toBeGreaterThan(0);
    expect(Number.isFinite(fitScaleForBox(1e9, 1e-9, 1e-9, 1e9))).toBe(true);
    expect(fitScaleForBox(1e9, 1e-9, 1e-9, 1e9)).toBeGreaterThan(0);
    expect(Number.isFinite(fitScaleForBox(-100, 500, 100, 100))).toBe(true);
    expect(fitScaleForBox(-100, 500, 100, 100)).toBe(1); // negative box -> negative ratio -> fallback
  });
});

describe("clampDprToCanvasArea", () => {
  // The failure this guards is silent: WebKit refuses an oversized 2D backing store without
  // throwing, so the canvas keeps its CSS size and simply never paints. See MAX_CANVAS_AREA_PX.

  it("leaves ordinary windows untouched, at every ratio a real display reports", () => {
    // A maximised 16" MacBook Pro (1728x1117 CSS) — 7.7M device px at 2x, well under the cap.
    expect(clampDprToCanvasArea(2, 1728, 1117)).toBe(2);
    expect(clampDprToCanvasArea(1, 1728, 1117)).toBe(1);
    expect(clampDprToCanvasArea(1.5, 1280, 800)).toBe(1.5);
  });

  it("steps the ratio down for a box whose backing store would exceed the cap", () => {
    // 3600x2400 CSS at 2x = 69M device px, ~4x over budget.
    const d = clampDprToCanvasArea(2, 3600, 2400);
    expect(d).toBeLessThan(2);
    expect(d).toBeGreaterThan(1);
  });

  it("lands the clamped backing store ON the budget, not merely under it", () => {
    // Absolute, not relative to the returned value: an implementation that scaled the ratio
    // linearly (rather than by sqrt) would still return "something smaller" and still be over
    // budget — which is the whole bug. Area must actually fit.
    // Every box here still fits under the cap at dpr 1, so the sqrt clamp is genuinely free to
    // land on the budget — the dpr>=1 floor (tested separately below) never binds.
    // 2560x1440 is a 5K Studio Display's CSS box — 14.7M DEVICE px at 2x, i.e. over budget on the
    // exact hardware this bug was reported from, while fitting comfortably at 1x.
    for (const [w, h] of [[3600, 2400], [2560, 1440], [4000, 3000]]) {
      const d = clampDprToCanvasArea(2, w, h);
      expect(w * h * d * d).toBeLessThanOrEqual(MAX_CANVAS_AREA_PX + 1);
    }
  });

  it("never returns a ratio below 1 — a sub-1 backing store is blurrier than the bug it fixes", () => {
    expect(clampDprToCanvasArea(2, 20000, 20000)).toBe(1);
  });

  it("falls back to 1 on a garbage ratio or box rather than propagating NaN into canvas.width", () => {
    expect(clampDprToCanvasArea(NaN, 800, 600)).toBe(1);
    expect(clampDprToCanvasArea(0, 800, 600)).toBe(1);
    expect(clampDprToCanvasArea(2, NaN, NaN)).toBe(2);
    expect(Number.isFinite(clampDprToCanvasArea(Infinity, 800, 600))).toBe(true);
  });
});
