import { expect, test } from "bun:test";
import {
  accumulate, blur, normalise, buildBloom, pushCloud, cloudGrid, cloudSampleCount, FIELD_W, FIELD_H,
  type BloomPoint,
} from "./densityField";

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

// --- pushCloud: emitting one SUMMARY as the cloud it stands for ---------------------------------

/** Weighted mean + per-axis weighted population standard deviation of a point list. */
function moments(pts: BloomPoint[]) {
  let w = 0, sx = 0, sy = 0, sxx = 0, syy = 0;
  for (const p of pts) {
    const pw = p.weight ?? 1;
    w += pw; sx += pw * p.x; sy += pw * p.y; sxx += pw * p.x * p.x; syy += pw * p.y * p.y;
  }
  const mx = sx / w, my = sy / w;
  return { w, mx, my, sdx: Math.sqrt(Math.max(0, sxx / w - mx * mx)), sdy: Math.sqrt(Math.max(0, syy / w - my * my)) };
}

test("pushCloud spends cloudSampleCount points and preserves the total weight exactly", () => {
  const out: BloomPoint[] = [];
  pushCloud(out, 0.5, 0.5, 0.1, 0.05, 300);
  expect(out.length).toBe(cloudSampleCount(0.1, 0.05));
  expect(moments(out).w).toBeCloseTo(300, 6);
  // ...and appends, so several aggregates can share one list.
  const before = out.length;
  pushCloud(out, 0.2, 0.2, 0.01, 0.01, 40);
  expect(out.length).toBe(before + cloudSampleCount(0.01, 0.01));
  expect(moments(out).w).toBeCloseTo(340, 6);
});

test("cloudGrid samples DENSER as the cloud grows — the spacing, not the count, is what is fixed", () => {
  // A fixed sample count is a spacing that degrades with magnification: the samples spread apart
  // until each is its own spike again. Small clouds stay at the floor (cheap — the common case is
  // dozens of aggregates at fit), big ones climb to the cap.
  expect(cloudGrid(0.002, 0.002)).toEqual({ rings: 2, perRing: 6 });   // the floor
  expect(cloudGrid(2, 2)).toEqual({ rings: 8, perRing: 16 });          // the cap
  // Monotone non-decreasing in spread, and genuinely climbing between the two ends.
  const ladder = [0.002, 0.01, 0.03, 0.06, 0.1, 0.2, 0.5, 2].map((sd) => cloudSampleCount(sd, sd));
  for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThanOrEqual(ladder[i - 1]);
  expect(ladder.at(-1)! / ladder[0]).toBeGreaterThan(5);
  // ...and what that buys: the gap between neighbouring samples on the outer ring stays well inside
  // the blur's 12-cell reach as the cloud grows, instead of scaling with it.
  const arcGap = (sd: number) => (2 * Math.PI * 2 * sd * FIELD_W) / cloudGrid(sd, 0).perRing;
  const radGap = (sd: number) => (2 * sd * FIELD_W) / cloudGrid(sd, 0).rings;
  for (const sd of [0.005, 0.02, 0.05, 0.08]) {
    expect(arcGap(sd)).toBeLessThan(6);
    expect(radGap(sd)).toBeLessThan(6);
  }
  // The exact-moment identity needs at least 3 evenly spaced points per ring at EVERY size.
  for (const sd of [0, 0.001, 0.01, 0.1, 1]) expect(cloudGrid(sd, sd).perRing).toBeGreaterThanOrEqual(3);
});

test("pushCloud's exact moments survive every sample count cloudGrid can pick", () => {
  // The identity is per-ring, so it must hold at the floor, at the cap, and in between — otherwise
  // the spread an aggregate emits would drift with how magnified it happens to be.
  for (const sd of [0.001, 0.01, 0.05, 0.12, 0.5, 3]) {
    const out: BloomPoint[] = [];
    pushCloud(out, 0.5, 0.5, sd, sd / 2, 100);
    const m = moments(out);
    expect(m.mx).toBeCloseTo(0.5, 9);
    expect(m.my).toBeCloseTo(0.5, 9);
    expect(m.sdx).toBeCloseTo(sd, 9);
    expect(m.sdy).toBeCloseTo(sd / 2, 9);
    expect(m.w).toBeCloseTo(100, 6);
  }
});

test("pushCloud reproduces the requested centre and per-axis spread — the property emitBloom relies on", () => {
  // The whole point: an aggregate must contribute light with the SAME second moment as the members
  // it summarizes, or the summary out-peaks them and normalise() crushes the rest of the field to
  // black. A uniform disc has per-axis sd R/2; dropping pushCloud's 2x scale (or emitting the
  // aggregate as a bare point) shows up here as a spread that is half (or zero) what was asked for.
  const out: BloomPoint[] = [];
  pushCloud(out, 0.4, 0.6, 0.12, 0.03, 100);
  const m = moments(out);
  expect(m.mx).toBeCloseTo(0.4, 9);
  expect(m.my).toBeCloseTo(0.6, 9);
  expect(m.sdx).toBeCloseTo(0.12, 9);
  expect(m.sdy).toBeCloseTo(0.03, 9);
  // Anisotropy is honoured, not averaged into one radius.
  expect(m.sdx / m.sdy).toBeCloseTo(4, 9);
});

test("pushCloud with zero spread collapses onto the centre — a point-like aggregate stays point-like", () => {
  const out: BloomPoint[] = [];
  pushCloud(out, 0.3, 0.7, 0, 0, 9);
  expect(out.every((p) => p.x === 0.3 && p.y === 0.7)).toBe(true);
  expect(moments(out).w).toBeCloseTo(9, 6);
});

test("a spread cloud does NOT out-peak the individual points it stands for", () => {
  // The regression this exists for, at field resolution. 60 leaves spread across a wide region vs
  // ONE aggregate of the same total weight standing in for them. Emitted as a bare point the
  // aggregate blurs to a spike far brighter than the leaves' own field; emitted as a cloud it does
  // not. The comparison is against the LEAVES' peak, not against a constant, so it stays true if
  // the blur radius or the field resolution changes.
  // Spread WIDER than the blur kernel (0.63 x 0.55 of the field vs the kernel's ~0.39 x 0.62): that
  // is the magnified-camera regime where a point and the cloud it stands for genuinely diverge, and
  // the regime the 60% stop is in.
  const leaves: BloomPoint[] = [];
  for (let i = 0; i < 60; i++) {
    leaves.push({ x: 0.5 + ((i % 10) - 4.5) * 0.07, y: 0.5 + (Math.floor(i / 10) - 2.5) * 0.11, weight: 1 });
  }
  const lm = moments(leaves);
  const asPoint: BloomPoint[] = [{ x: lm.mx, y: lm.my, weight: 60 }];
  const asCloud: BloomPoint[] = [];
  pushCloud(asCloud, lm.mx, lm.my, lm.sdx, lm.sdy, 60);

  // Normalise hides absolute peaks (it pins every field's max to 1), so the peak comparison is on
  // the PRE-normalisation blurred fields. One shared bracket, so the two assertions really are
  // opposite sides of the same line: measured 6.7x for the point, 1.5x for the cloud.
  const peak = (pts: BloomPoint[]) => Math.max(...blur(accumulate(pts, FIELD_W, FIELD_H), FIELD_W, FIELD_H, 6));
  const leafPeak = peak(leaves);
  expect(peak(asPoint)).toBeGreaterThan(leafPeak * 2);            // the bug: a spike
  expect(peak(asCloud)).toBeLessThan(leafPeak * 2);               // the fix: not a spike
  expect(peak(asCloud)).toBeGreaterThan(leafPeak * 0.5);          // ...and not a whisper either

  // And what that costs on screen, post-normalisation: how much of the field survives the
  // atmosphere's own v^4 alpha curve (GraphAtmosphere.tsx) at all, i.e. v > 0.02^(1/4).
  const lit = (pts: BloomPoint[]) => buildBloom(pts).filter((v) => v > 0.376).length;
  const leafLit = lit(leaves);
  expect(lit(asPoint)).toBeLessThan(leafLit * 0.25);              // the bug: the field goes dark
  expect(lit(asCloud)).toBeGreaterThan(leafLit * 0.5);            // the fix: it does not
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
