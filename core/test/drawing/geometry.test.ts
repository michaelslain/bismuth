import { test, expect } from "bun:test";
import { strokeOutline } from "../../src/drawing/geometry";
import type { Stroke } from "../../src/drawing/model";

const resolve = (c: string) => (c === "fg" ? "#e8e8ea" : c);

test("strokeOutline returns a closed polygon and resolved color for a pen stroke", () => {
  const s: Stroke = { t: "pen", c: "fg", w: 4, pts: [0, 0, 255, 10, 0, 255, 20, 5, 200] };
  const out = strokeOutline(s, resolve);
  expect(out.color).toBe("#e8e8ea");
  expect(out.fill.length).toBeGreaterThan(3);
  expect(out.fill[0].length).toBe(2);
});

test("a straight stroke produces a uniform capsule between its endpoints", () => {
  const s: Stroke = { t: "pen", c: "#fff", w: 6, straight: true, pts: [0, 0, 255, 100, 0, 255] };
  const out = strokeOutline(s, resolve);
  const xs = out.fill.map((p) => p[0]);
  expect(Math.min(...xs)).toBeLessThanOrEqual(1);
  expect(Math.max(...xs)).toBeGreaterThanOrEqual(99);
});

test("a single-point stroke still yields a dot outline (no crash)", () => {
  const s: Stroke = { t: "pen", c: "#fff", w: 4, pts: [5, 5, 255] };
  expect(strokeOutline(s, resolve).fill.length).toBeGreaterThan(2);
});

