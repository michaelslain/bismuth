import { expect, test } from "bun:test";
import { accumulate, blur, normalise, buildBloom, FIELD_W, FIELD_H } from "./densityField";

test("accumulate puts a point in the right cell", () => {
  const f = accumulate([{ x: 0.5, y: 0.5 }], 4, 4);
  // 0.5 * 4 = 2 → cell (2,2) → index 2*4 + 2 = 10
  expect(f[10]).toBe(1);
  expect(f.reduce((s, v) => s + v, 0)).toBe(1);
});

test("accumulate respects weight and ignores out-of-range points", () => {
  const f = accumulate(
    [{ x: 0.5, y: 0.5, weight: 3 }, { x: -0.2, y: 0.5 }, { x: 1.4, y: 0.5 }, { x: 0.5, y: 99 }],
    4, 4,
  );
  expect(f.reduce((s, v) => s + v, 0)).toBe(3);
});

test("blur spreads a single spike to its neighbours and conserves total mass", () => {
  const f = new Float32Array(25);
  f[12] = 1; // centre of a 5x5
  const b = blur(f, 5, 5, 1);
  expect(b[12]).toBeLessThan(1);
  expect(b[11]).toBeGreaterThan(0);
  expect(b[13]).toBeGreaterThan(0);
  const before = f.reduce((s, v) => s + v, 0);
  const after = b.reduce((s, v) => s + v, 0);
  expect(after).toBeCloseTo(before, 4);
});

test("normalise scales the peak to exactly 1", () => {
  const f = Float32Array.from([0, 2, 4, 1]);
  const n = normalise(f);
  expect(Math.max(...n)).toBe(1);
  expect(n[2]).toBe(1);
  expect(n[1]).toBeCloseTo(0.5, 6);
});

test("normalise leaves an all-zero field alone — no NaN", () => {
  const n = normalise(new Float32Array(9));
  expect(n.every((v) => v === 0)).toBe(true);
  expect(n.some((v) => Number.isNaN(v))).toBe(false);
});

test("buildBloom returns a normalised FIELD_W x FIELD_H field", () => {
  const f = buildBloom([{ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.8 }]);
  expect(f.length).toBe(FIELD_W * FIELD_H);
  expect(Math.max(...f)).toBeCloseTo(1, 6);
  expect(f.every((v) => v >= 0 && v <= 1)).toBe(true);
});

test("buildBloom on an empty point set is all zero, not NaN", () => {
  const f = buildBloom([]);
  expect(f.every((v) => v === 0)).toBe(true);
});

test("denser regions are brighter — the whole point of the effect", () => {
  // 20 points clustered left, 1 point right.
  const pts = [
    ...Array.from({ length: 20 }, () => ({ x: 0.25, y: 0.5 })),
    { x: 0.75, y: 0.5 },
  ];
  const f = buildBloom(pts);
  const at = (fx: number, fy: number) =>
    f[Math.floor(fy * FIELD_H) * FIELD_W + Math.floor(fx * FIELD_W)];
  expect(at(0.25, 0.5)).toBeGreaterThan(at(0.75, 0.5));
});
