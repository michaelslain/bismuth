import { expect, test } from "bun:test";
import {
  accumulate, accumulateColor, blur, normalise, buildBloom, pushCloud, cloudGrid, cloudSampleCount,
  blurRadiusForZoom, scaleField, BASE_BLUR_RADIUS, MAX_BLUR_RADIUS,
  FIELD_W, FIELD_H,
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

// blur() now runs BOX_PASSES (3) successive box applications, so a radius-1 kernel's true reach is
// 3 cells, not 1 — the tests below use a 15x15 grid (7 cells from centre to any edge) so an
// interior spike's mass-conservation and axis symmetry are exercised with ZERO boundary clipping,
// same as the old 5x5 grid did for a single pass. The dedicated edge-policy test below still uses a
// small grid — clipping IS the thing it tests.
const idx = (w: number, cx: number, cy: number, dx: number, dy: number) => (cy + dy) * w + (cx + dx);

test("blur spreads a single spike to its neighbours and conserves total mass", () => {
  const w = 15, h = 15, cx = 7, cy = 7;
  const f = new Float32Array(w * h);
  f[idx(w, cx, cy, 0, 0)] = 1; // centre, 7 cells from every edge — 3 passes at radius 1 reach only 3
  const b = blur(f, w, h, 1);
  expect(b[idx(w, cx, cy, 0, 0)]).toBeLessThan(1);
  expect(b[idx(w, cx, cy, -1, 0)]).toBeGreaterThan(0);
  expect(b[idx(w, cx, cy, 1, 0)]).toBeGreaterThan(0);
  const before = f.reduce((s, v) => s + v, 0);
  const after = b.reduce((s, v) => s + v, 0);
  expect(after).toBeCloseTo(before, 4);
});

test("blur is separable in BOTH axes — the spike spreads vertically too, isotropically", () => {
  const w = 15, h = 15, cx = 7, cy = 7;
  const f = new Float32Array(w * h); f[idx(w, cx, cy, 0, 0)] = 1;
  const b = blur(f, w, h, 1);
  const at = (dx: number, dy: number) => b[idx(w, cx, cy, dx, dy)];
  expect(at(0, -1)).toBeGreaterThan(0);   // row above
  expect(at(0, 1)).toBeGreaterThan(0);    // row below
  // A box kernel (any pass count) stays symmetric under swapping x and y for a field that is
  // itself symmetric under that swap — up/down/left/right must all agree.
  expect(at(0, -1)).toBeCloseTo(at(-1, 0), 6);
  expect(at(0, -1)).toBeCloseTo(at(0, 1), 6);
  expect(at(0, -1)).toBeCloseTo(at(1, 0), 6);
  // NOTE: a single-pass box kernel also makes the DIAGONAL neighbour exactly equal to the centre
  // (the whole support is one flat square) — that flatness is the boxy-halo bug itself, so after
  // the fix it must NOT hold. See "corner energy is less than edge energy" below for the assertion
  // that replaces it.
  expect(at(-1, -1)).toBeLessThan(at(0, 0));
});

test("blur edge policy: the window SHRINKS at the border, it does not replicate", () => {
  const g = new Float32Array(25); g[0] = 1;
  // A single-pass box average at radius 1 would keep 25/36 ≈ 0.694 of the mass at a corner (still
  // less than 1, since count-based clipping never replicates/pads). Three successive passes clip
  // repeatedly, so more is lost — the exact fraction is a coupled recurrence not worth hardcoding
  // (it would just re-encode "whatever this call currently computes"), but the DIRECTION is exactly
  // what this test is for: strictly below 1 (shrinks — edge replication would hold it near 1) and
  // still substantial (not collapsed to noise — the average never zeroes out a nonzero neighbourhood).
  const mass = sum(blur(g, 5, 5, 1));
  expect(mass).toBeLessThan(0.9);
  expect(mass).toBeGreaterThan(0.3);
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
  // A box kernel's support grows by exactly `radius` per pass, independently in x and y (each pass
  // is a full h+v box application) — so 3 passes at radius 2 reach 3*2 = 6 cells, giving a
  // (2*6+1)^2 = 169-cell footprint, not the single-pass (2*2+1)^2 = 25.
  expect(f.filter((v) => v > 0).length).toBe(169);
  const cx = Math.floor(0.5 * FIELD_W), cy = Math.floor(0.5 * FIELD_H);
  expect(f[cy * FIELD_W + cx + 6]).toBeGreaterThan(0);
  expect(f[cy * FIELD_W + cx + 7]).toBe(0);
  expect(f[(cy + 6) * FIELD_W + cx]).toBeGreaterThan(0);
  expect(f[(cy + 7) * FIELD_W + cx]).toBe(0);
});

test("three-pass blur reads as Gaussian, not a box — corner energy is less than edge energy at fixed radius", () => {
  // The defect this task fixes: a single-pass box kernel is a flat square, so a cell on the
  // DIAGONAL (Euclidean distance √2·R from the peak) gets exactly the same value as a cell the
  // same Chebyshev distance R away along an AXIS — that flat-topped equality is what reads on
  // screen as a rectangle. A kernel that has converged toward Gaussian falls off with (Euclidean)
  // distance, so the corner must be strictly dimmer than the edge at the same R, and increasingly
  // so as R grows (the tail thins faster diagonally). This is false for any single box pass, at
  // every radius — it isn't a threshold this could accidentally clear by tuning the radius instead.
  const w = 15, h = 15, cx = 7, cy = 7;
  const f = new Float32Array(w * h); f[idx(w, cx, cy, 0, 0)] = 1;
  const b = blur(f, w, h, 1);
  const at = (dx: number, dy: number) => b[idx(w, cx, cy, dx, dy)];
  const ratio1 = at(-1, -1) / at(0, -1);
  const ratio2 = at(-2, -2) / at(0, -2);
  expect(ratio1).toBeLessThan(0.95);
  expect(ratio2).toBeLessThan(0.95);
  // A box kernel's ratio would be pinned at exactly 1 (flat); a Gaussian-like one gets WORSE
  // (further from 1) as R grows, because more of the tail has been shaped by repeated averaging.
  expect(ratio2).toBeLessThan(ratio1);
});

test("three-pass blur falls off monotonically from the peak, along both an axis and a diagonal", () => {
  // A single box pass is flat-then-a-cliff (constant inside the support, exactly 0 outside) — NOT
  // monotonically decreasing, since neighbouring interior cells tie rather than shrink. Repeated
  // passes should produce genuine, strict monotonic falloff — the "soft light" shape — all the way
  // to the (still hard, box kernels never grow unbounded tails) edge of the support.
  const w = 25, h = 25, cx = 12, cy = 12;
  const f = new Float32Array(w * h); f[idx(w, cx, cy, 0, 0)] = 1;
  const b = blur(f, w, h, 2);
  const at = (dx: number, dy: number) => b[idx(w, cx, cy, dx, dy)];
  const axisRay = Array.from({ length: 7 }, (_, i) => at(i, 0));
  const diagRay = Array.from({ length: 7 }, (_, i) => at(i, i));
  for (const ray of [axisRay, diagRay]) {
    for (let i = 1; i < ray.length; i++) expect(ray[i]).toBeLessThan(ray[i - 1]);
  }
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

test("a non-finite or negative spread degrades to that same point, and NEVER to silence", () => {
  // This module's own version of the bug it exists to fix. Unguarded, a NaN sd makes both of
  // pushCloud's loop bounds NaN and the aggregate emits ZERO points while its caller still counts
  // its full weight — healthy counters, dark field, exactly the regression signature. An infinite
  // one gets there by the other road: points `accumulate` silently drops as out-of-range.
  for (const [sx, sy] of [[NaN, 0.1], [0.1, NaN], [NaN, NaN], [Infinity, 0.1], [0.1, -0.2]] as const) {
    const out: BloomPoint[] = [];
    pushCloud(out, 0.5, 0.5, sx, sy, 24);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(moments(out).w).toBeCloseTo(24, 6);                 // the light is not lost
    // ...and the field really does receive it, rather than accumulate() dropping every point.
    expect(buildBloom(out).some((v) => v > 0)).toBe(true);
    // The bad axis reads as 0 spread; a good one alongside it is still honoured.
    const m = moments(out);
    expect(m.sdx).toBeCloseTo(Number.isFinite(sx) && sx > 0 ? sx : 0, 9);
    expect(m.sdy).toBeCloseTo(Number.isFinite(sy) && sy > 0 ? sy : 0, 9);
  }
  // The sample count stays a real integer too — that is what goes NaN first.
  for (const bad of [NaN, Infinity, -1]) {
    expect(Number.isInteger(cloudSampleCount(bad, bad))).toBe(true);
    expect(cloudSampleCount(bad, bad)).toBeGreaterThan(0);
  }
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

// ---------------------------------------------------------------------------
// TERRITORY COLOUR — the field carries WHOSE density each cell is, not just how much.
//
// The regression every test below is aimed at is one specific way this can rot back into what it
// replaced: every cluster ends up contributing the SAME hue, the ground goes back to a single flat
// haze, and nothing else about the picture changes — so the suite stays green, the field is still
// normalised, the intensity is still right, and the one property the change exists for is gone.
// ---------------------------------------------------------------------------

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];

/** The field's mean colour at a screen fraction, as a plain triple. */
const hueAt = (f: ReturnType<typeof buildBloom>, fx: number, fy: number) => {
  const i = Math.floor(fy * FIELD_H) * FIELD_W + Math.floor(fx * FIELD_W);
  return [f.rgb!.r[i], f.rgb!.g[i], f.rgb!.b[i]] as [number, number, number];
};

test("TWO CLUSTERS WITH DIFFERENT SLOTS PRODUCE DIFFERENT HUES — the whole point of the change", () => {
  // Two well-separated territories, each a little cloud of its own colour. If the emitted field
  // gave every cluster one shared hue — the exact regression that would undo this — the two
  // samples below would be equal, whatever that shared hue happened to be.
  const pts: BloomPoint[] = [];
  for (let i = 0; i < 20; i++) pts.push({ x: 0.2 + (i % 5) * 0.005, y: 0.5, weight: 1, rgb: RED });
  for (let i = 0; i < 20; i++) pts.push({ x: 0.8 + (i % 5) * 0.005, y: 0.5, weight: 1, rgb: BLUE });
  const f = buildBloom(pts);
  expect(f.rgb).toBeDefined();

  const left = hueAt(f, 0.2, 0.5), right = hueAt(f, 0.8, 0.5);
  // Each territory is its OWN colour where it dominates — not the average of the two, and not one
  // shared hue.
  expect(left[0]).toBeGreaterThan(200);   // red over the left cluster
  expect(left[2]).toBeLessThan(20);
  expect(right[2]).toBeGreaterThan(200);  // blue over the right one
  expect(right[0]).toBeLessThan(20);
});

test("a cell's colour is the WEIGHTED MEAN of what reached it, not the last emitter to touch it", () => {
  // Two points in one cell, 2 units of red to 1 of blue -> (170, 0, 85). "Last writer wins" would
  // give (0,0,255); an unweighted mean would give (127.5, 0, 127.5).
  const acc = accumulateColor(
    [{ x: 0.5, y: 0.5, weight: 2, rgb: RED }, { x: 0.5, y: 0.5, weight: 1, rgb: BLUE }], 2, 2,
  );
  const i = 1 * 2 + 1;
  expect(acc.v[i]).toBe(3);
  expect(acc.r[i] / acc.v[i]).toBeCloseTo(170, 4);
  expect(acc.b[i] / acc.v[i]).toBeCloseTo(85, 4);
});

test("where two territories overlap their hues MIX, in proportion to the light each put there", () => {
  // Three units of red and one of blue landing on the same spot. The mean has to land between the
  // two and nearer the red — which is what carrying colour in the FIELD buys over picking a
  // nearest-cluster hue at paint time (that would give a hard seam, i.e. one of the two exactly).
  const f = buildBloom([
    ...Array.from({ length: 3 }, () => ({ x: 0.5, y: 0.5, weight: 1, rgb: RED })),
    { x: 0.5, y: 0.5, weight: 1, rgb: BLUE },
  ]);
  const [r, , b] = hueAt(f, 0.5, 0.5);
  expect(r).toBeCloseTo(191.25, 3);
  expect(b).toBeCloseTo(63.75, 3);
});

test("carrying colour cannot change how BRIGHT the atmosphere is", () => {
  // The intensity channel must be bit-for-bit what the colourless build produces for the same
  // points. Without this a variant could win a side-by-side comparison for the wrong reason, and
  // more importantly the atmosphere would stop being a pure density map.
  const geometry: BloomPoint[] = [
    { x: 0.25, y: 0.5, weight: 2 }, { x: 0.75, y: 0.5, weight: 1 }, { x: 0.4, y: 0.2, weight: 3 },
  ];
  const mono = buildBloom(geometry);
  const col = buildBloom(geometry.map((p, i) => ({ ...p, rgb: i === 0 ? RED : BLUE })));
  expect(mono.rgb).toBeUndefined();
  expect(col.rgb).toBeDefined();
  expect(col.length).toBe(mono.length);
  for (let i = 0; i < mono.length; i++) expect(col[i]).toBe(mono[i]);
});

test("an emitter with no community contributes light but no colour", () => {
  // A community-less graph (embedded graph blocks strip communities entirely) must still glow.
  const f = buildBloom([{ x: 0.5, y: 0.5, weight: 1 }]);
  expect(f.rgb).toBeUndefined();                  // no colour channels built at all...
  expect(Math.max(...f)).toBeCloseTo(1, 6);       // ...and the light is there
  expect(f.filter((v) => v > 0).length).toBeGreaterThan(100);
});

test("a colourless emitter mixed in with coloured ones dilutes the hue rather than voting for one", () => {
  // Half the light in this cell carries no territory. The mean colour must fall halfway to black
  // (i.e. toward "no territory", which the painter renders as the base phosphor hue) — NOT be
  // dropped, and NOT let the coloured half claim the whole cell.
  const f = buildBloom([
    { x: 0.5, y: 0.5, weight: 1, rgb: RED }, { x: 0.5, y: 0.5, weight: 1 },
  ]);
  expect(hueAt(f, 0.5, 0.5)[0]).toBeCloseTo(127.5, 3);
});

test("dark cells get NO colour rather than a hue manufactured from rounding noise", () => {
  // Far outside the kernel's reach the blurred weight is 0, and dividing there would turn float
  // noise into coloured speckle in the corners of an otherwise black ground.
  const f = buildBloom([{ x: 0.5, y: 0.5, weight: 1, rgb: RED }], 2);
  const corner = 0 * FIELD_W + 0;
  expect(f[corner]).toBe(0);
  expect(f.rgb!.r[corner]).toBe(0);
  expect(f.rgb!.g[corner]).toBe(0);
  expect(f.rgb!.b[corner]).toBe(0);
});

test("pushCloud stamps the cluster's colour on EVERY sample it emits", () => {
  // A cloud stands for one community's members, so all of its light belongs to that community. A
  // cloud that coloured only its first sample would read as a grey blob with one tinted cell.
  const out: BloomPoint[] = [];
  pushCloud(out, 0.5, 0.5, 0.05, 0.05, 10, RED);
  expect(out.length).toBeGreaterThan(1);
  expect(out.every((p) => p.rgb === RED)).toBe(true);

  const plain: BloomPoint[] = [];
  pushCloud(plain, 0.5, 0.5, 0.05, 0.05, 10);
  expect(plain.every((p) => p.rgb === undefined)).toBe(true);
});

test("a coloured cloud lands in the same place, at the same spread, as an uncoloured one", () => {
  // Colour is a hue channel bolted onto the emission, not a change to it: the geometry pushCloud
  // produces must be identical with and without an rgb.
  const withRgb: BloomPoint[] = [], without: BloomPoint[] = [];
  pushCloud(withRgb, 0.3, 0.6, 0.04, 0.02, 7, BLUE);
  pushCloud(without, 0.3, 0.6, 0.04, 0.02, 7);
  expect(withRgb.length).toBe(without.length);
  for (let i = 0; i < withRgb.length; i++) {
    expect(withRgb[i].x).toBe(without[i].x);
    expect(withRgb[i].y).toBe(without[i].y);
    expect(withRgb[i].weight).toBe(without[i].weight);
  }
});

// --- zoom-scaled kernel + the carried reference peak ---------------------------------------------

test("blur's prefix-sum sweep matches a naive per-cell mean, at every radius", () => {
  // The rewrite exists to make radius free (O(cells), not O(cells·r)) so the kernel can scale with
  // the camera. It must not change the picture: this is the naive kernel the old implementation
  // ran, applied the same BOX_PASSES times, compared against the shipped one.
  const naive = (f: Float32Array, w: number, h: number, r: number) => {
    const pass = (src: Float32Array, horizontal: boolean) => {
      const out = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let sum = 0, count = 0;
        for (let d = -r; d <= r; d++) {
          const sx = horizontal ? x + d : x, sy = horizontal ? y : y + d;
          if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
          sum += src[sy * w + sx]; count++;
        }
        out[y * w + x] = count ? sum / count : 0;
      }
      return out;
    };
    let out = f;
    for (let i = 0; i < 3; i++) out = pass(pass(out, true), false);
    return out;
  };
  const w = 17, h = 11;
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = (i * 37) % 13;      // deterministic, non-symmetric
  for (const r of [1, 2, 5, 9, 20, 40]) {
    const a = blur(f, w, h, r), b = naive(f, w, h, r);
    for (let i = 0; i < f.length; i++) expect(a[i]).toBeCloseTo(b[i], 4);
  }
});

test("blurRadiusForZoom holds the fit radius at or below fit and grows linearly, capped", () => {
  expect(blurRadiusForZoom(1)).toBe(BASE_BLUR_RADIUS);
  expect(blurRadiusForZoom(0.5)).toBe(BASE_BLUR_RADIUS);        // below fit never SHRINKS the kernel
  expect(blurRadiusForZoom(NaN)).toBe(BASE_BLUR_RADIUS);
  expect(blurRadiusForZoom(2)).toBe(2 * BASE_BLUR_RADIUS);      // linear in the camera scale...
  expect(blurRadiusForZoom(1000)).toBe(MAX_BLUR_RADIUS);        // ...to the ceiling
});

test("THE HALO BUG — a magnified pair stays ONE lit body; a fit-sized kernel leaves a dark gap", () => {
  // The reported defect: zoom far enough in and each node grows its own halo instead of the cluster
  // lighting up together. It is a CONTRAST failure, not a coverage one — a radius-6 kernel over
  // three box passes still reaches far enough to leave the field technically connected, but the
  // trough between two nodes falls to ~0.8 of the peak, and the atmosphere paints v⁴, which turns
  // that into half the alpha. Dark gaps between bright discs IS the halo.
  //
  // Measured as the painted alpha in the gap relative to the peak, on the same geometry at fit
  // spacing and magnified, with the kernel held fixed vs. scaled to the same camera.
  const gapAlpha = (zoom: number, radius: number) => {
    const sep = 0.03 * zoom;                              // node spacing is linear in the camera
    const f = buildBloom([{ x: 0.5 - sep / 2, y: 0.5 }, { x: 0.5 + sep / 2, y: 0.5 }], radius);
    const row = Math.floor(FIELD_H / 2);
    let lo = 1;
    for (let x = Math.round((0.5 - sep / 2) * FIELD_W); x <= Math.round((0.5 + sep / 2) * FIELD_W); x++) {
      lo = Math.min(lo, f[row * FIELD_W + x]);
    }
    return lo ** 4;                                       // GraphAtmosphere's own alpha curve
  };
  // At fit the two agree by construction — blurRadiusForZoom(1) IS the fit radius.
  expect(gapAlpha(1, BASE_BLUR_RADIUS)).toBeGreaterThan(0.9);
  // The bug, still reproducible: magnified geometry, kernel left at its fit size.
  expect(gapAlpha(6, BASE_BLUR_RADIUS)).toBeLessThan(0.5);
  // The fix: the same geometry with the kernel scaled to the same camera. Also checked one stop
  // either side, so this cannot pass on a single lucky separation.
  for (const zoom of [3, 4, 6]) {
    expect(gapAlpha(zoom, blurRadiusForZoom(zoom))).toBeGreaterThan(0.8);
    expect(gapAlpha(zoom, blurRadiusForZoom(zoom))).toBeGreaterThan(gapAlpha(zoom, BASE_BLUR_RADIUS));
  }
});

test("scaleField dims a field by the ratio, clamps out of range, and leaves 1 untouched", () => {
  const make = () => buildBloom([{ x: 0.5, y: 0.5 }, { x: 0.45, y: 0.5 }]);
  const ref = make();
  const half = scaleField(make(), 0.5);
  for (let i = 0; i < ref.length; i++) expect(half[i]).toBeCloseTo(ref[i] * 0.5, 6);
  expect(Math.max(...Array.from(scaleField(make(), 3)))).toBeCloseTo(1, 6);      // >1 clamps to 1x
  expect(Math.max(...Array.from(scaleField(make(), -1)))).toBe(0);               // <0 clamps to dark
  expect(Math.max(...Array.from(scaleField(make(), NaN)))).toBeCloseTo(1, 6);    // non-finite: no-op
});
