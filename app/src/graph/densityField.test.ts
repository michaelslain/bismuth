import { expect, test } from "bun:test";
import { accumulate, blur, normalise, buildBloom, FIELD_W, FIELD_H } from "./densityField";

const sum = (f: Float32Array) => f.reduce((s, v) => s + v, 0);

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

test("accumulate floors (does not round) a non-integer cell coordinate", () => {
  // 0.4*4 = 1.6 -> col 1 ; 0.9*4 = 3.6 -> row 3 (rounding would give col 2 / row 3)
  expect(accumulate([{ x: 0.4, y: 0.9 }], 4, 4)[3 * 4 + 1]).toBe(1);
});

test("accumulate boundary semantics: 0 is in, exactly 1 is out, NaN is out, weight 0 is respected", () => {
  expect(accumulate([{ x: 0, y: 0 }], 4, 4)[0]).toBe(1);
  expect(sum(accumulate([{ x: 1, y: 0.5 }], 4, 4))).toBe(0);
  expect(sum(accumulate([{ x: 0.5, y: 1 }], 4, 4))).toBe(0);
  expect(sum(accumulate([{ x: NaN, y: 0.5 }], 4, 4))).toBe(0);
  expect(sum(accumulate([{ x: 0.5, y: 0.5, weight: 0 }], 4, 4))).toBe(0);
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

test("blur is separable in BOTH axes — the spike spreads vertically too, isotropically", () => {
  const f = new Float32Array(25); f[12] = 1;
  const b = blur(f, 5, 5, 1);
  expect(b[7]).toBeGreaterThan(0);   // row above
  expect(b[17]).toBeGreaterThan(0);  // row below
  expect(b[7]).toBeCloseTo(b[11], 6); // a box kernel is symmetric in x and y
  expect(b[6]).toBeCloseTo(b[12], 6); // diagonal too
});

test("blur edge policy: the window SHRINKS at the border, it does not replicate", () => {
  const g = new Float32Array(25); g[0] = 1;
  // corner windows are 2x2/2x3/3x2/3x3 -> mass 1/4+1/6+1/6+1/9 = 25/36. Edge replication would keep ~1.
  expect(sum(blur(g, 5, 5, 1))).toBeCloseTo(25 / 36, 5);
});

test("blur with radius <= 0 is the identity", () => {
  const f = new Float32Array(25); f[12] = 1;
  expect(Array.from(blur(f, 5, 5, 0))).toEqual(Array.from(f));
  expect(Array.from(blur(f, 5, 5, -3))).toEqual(Array.from(f));
});

test("blur rounds a non-integer radius instead of producing NaN", () => {
  const f = new Float32Array(25); f[12] = 1;
  const b = blur(f, 5, 5, 1.5);
  expect(b.some((v) => Number.isNaN(v))).toBe(false);
  // Math.round(1.5) === 2, so this should match radius 2 exactly
  const b2 = blur(f, 5, 5, 2);
  expect(Array.from(b)).toEqual(Array.from(b2));
});

test("blur throws when field length does not match w*h", () => {
  expect(() => blur(new Float32Array(9), 4, 4, 1)).toThrow();
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

test("buildBloom really blurs, at the right resolution and orientation", () => {
  const f = buildBloom([{ x: 0.5, y: 0.5 }], 2);
  expect(f.filter((v) => v > 0).length).toBe(25); // (2*2+1)^2, not 1
  const cx = Math.floor(0.5 * FIELD_W), cy = Math.floor(0.5 * FIELD_H);
  expect(f[cy * FIELD_W + cx + 2]).toBeGreaterThan(0);
  expect(f[cy * FIELD_W + cx + 3]).toBe(0);
  expect(f[(cy + 2) * FIELD_W + cx]).toBeGreaterThan(0);
  expect(f[(cy + 3) * FIELD_W + cx]).toBe(0);
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
