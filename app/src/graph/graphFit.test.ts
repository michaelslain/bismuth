import { describe, expect, it } from "bun:test";
import {
  MIN_USABLE_BOX_PX,
  isUsableBox,
  finiteOr,
  finiteVec3,
  boundingRadius,
  fitScale,
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
