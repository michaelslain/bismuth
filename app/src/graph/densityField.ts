// The graph's bloom, computed from where the nodes actually ARE.
//
// The previous atmosphere was three CSS radial-gradients parked at cluster centroids, tuned against
// a saturated palette (#f0509b / #9b53e8 / #27c7d9). The redesign palette is desaturated
// (#C98CA8 / #A190C4 / #83B4AE), so the same 26%-alpha screen blend reads as a whisper: the effect
// did not break, its input did. Iridescence — many competing hues, soft and diffuse — is also what
// clashes with the ASCII aesthetic.
//
// This replaces it with phosphor: ONE hue, brightness driven by node DENSITY. It works on a muted
// palette because it is a luminance effect against a near-black ground rather than a saturation
// one, and it carries information — bright regions ARE dense regions, so the atmosphere is emitted
// by the graph instead of painted behind it.

export const FIELD_W = 64;
export const FIELD_H = 40;

export type DensityField = Float32Array;

export interface BloomPoint { x: number; y: number; weight?: number }

/** Bin points (screen fractions 0..1) into a w×h grid. Out-of-range points are dropped. */
export function accumulate(points: BloomPoint[], w: number, h: number): Float32Array {
  const f = new Float32Array(w * h);
  for (const p of points) {
    if (!(p.x >= 0 && p.x < 1 && p.y >= 0 && p.y < 1)) continue;
    const cx = Math.min(w - 1, Math.floor(p.x * w));
    const cy = Math.min(h - 1, Math.floor(p.y * h));
    f[cy * w + cx] += p.weight ?? 1;
  }
  return f;
}

/** Separable box blur, `radius` cells each way. Mass-conserving apart from edge clamping.
 *  `w`/`h` are REQUIRED — a Float32Array's length cannot tell you its grid shape. */
export function blur(field: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (field.length !== w * h) {
    throw new Error(`blur: field.length (${field.length}) does not match w*h (${w * h})`);
  }
  radius = Math.round(radius);
  const n = field.length;
  const width = w, height = h;
  if (radius <= 0) return Float32Array.from(field);

  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0, count = 0;
        for (let d = -radius; d <= radius; d++) {
          const sx = horizontal ? x + d : x;
          const sy = horizontal ? y : y + d;
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
          sum += src[sy * width + sx];
          count++;
        }
        out[y * width + x] = count ? sum / count : 0;
      }
    }
    return out;
  };
  return pass(pass(field, true), false);
}

/** Scale so the peak cell is exactly 1. An empty field stays empty — never NaN. */
export function normalise(field: Float32Array): Float32Array {
  let max = 0;
  for (const v of field) if (v > max) max = v;
  if (max <= 0) return Float32Array.from(field);
  const out = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) out[i] = field[i] / max;
  return out;
}

/** accumulate → blur → normalise, at the fixed field resolution. */
export function buildBloom(points: BloomPoint[], radius = 6): Float32Array {
  return normalise(blur(accumulate(points, FIELD_W, FIELD_H), FIELD_W, FIELD_H, radius));
}

// --- Emitting one SUMMARY as the cloud it stands for ---------------------------------------------
//
// A renderer that summarizes many nodes into one mark (AsciiGraphRenderer's LOD aggregate entities)
// cannot emit that mark as a single weighted point. `blur` conserves total mass but NOT peak: all of
// a cluster's light landing in one cell blurs to `weight / (2r+1)²`, whereas the same light spread
// over the members' real screen footprint blurs to roughly `weight / footprint`. At fit the two are
// close (a fitted cluster is about a kernel wide); as soon as the camera magnifies they diverge
// hard, the summary out-peaks everything else on the field, and `normalise` crushes the rest to
// black. Measured on the reference vault mid-crossfade (60%): 6.8% ink emitting summaries as points
// vs 24.3% for the leaves they replace — i.e. the summary made the atmosphere DARKER than the pass
// it stood in for. Hence `pushCloud`.

/** Rings × samples-per-ring in the unit-disc pattern below.
 *
 *  Sized against the BLUR, not by taste: the samples must sit closer together than the blur kernel
 *  can smooth over, or the cloud reads as its own little constellation of spikes — the same failure
 *  as emitting the aggregate as one point, just subdivided. A radius-6 double box blur spans ~25
 *  cells per axis on a 64×40 field, and a magnified cluster's cloud can reach ~20 cells in radius,
 *  which wants radial spacing R/M ≲ 25 (any M ≥ 1) and outer-ring arc spacing 2πR/K ≲ 25 (K ≳ 6).
 *  4 × 8 = 32 clears both with margin and still costs ~30× a handful of aggregates — nothing
 *  against the thousands of leaf points they replace. */
const CLOUD_RINGS = 4, CLOUD_PER_RING = 8;
export const CLOUD_SAMPLES = CLOUD_RINGS * CLOUD_PER_RING;

/**
 * The unit-disc sample pattern: `CLOUD_RINGS` equal-area rings (`r = √((j + ½)/M)` — a linear radius
 * would bunch samples toward the centre and re-create the very peak this exists to avoid), each of
 * `CLOUD_PER_RING` evenly spaced points, successive rings rotated so the pattern reads as a disc
 * rather than as spokes.
 *
 * Rings, not a golden-angle spiral, because this shape's moments are EXACT rather than approximate.
 * For any ring of K ≥ 3 evenly spaced points at any rotation, Σcos = Σsin = 0 and Σcos² = Σsin² =
 * K/2 identically; averaging over equal-area radii then gives mean (0, 0), zero anisotropy, and
 * E[x²] = E[y²] = ¼ — i.e. per-axis standard deviation exactly ½, whatever the rotations are. That
 * is what lets `pushCloud` hit a requested spread to the last decimal with only 12 samples (a
 * 12-point spiral is ~6% off, and the error moves whenever the sample count is retuned).
 */
const CLOUD_OFFSETS: [number, number][] = [];
for (let j = 0; j < CLOUD_RINGS; j++) {
  const r = Math.sqrt((j + 0.5) / CLOUD_RINGS);
  // Rotate each ring by a fraction of its own angular step (an irrational-ish fraction of 2π/K, so
  // no two rings line up) — cosmetic only: the moments above hold at any rotation.
  const phase = (j * Math.PI * 2) / (CLOUD_PER_RING * CLOUD_RINGS);
  for (let k = 0; k < CLOUD_PER_RING; k++) {
    const th = phase + (k * Math.PI * 2) / CLOUD_PER_RING;
    CLOUD_OFFSETS.push([r * Math.cos(th), r * Math.sin(th)]);
  }
}

/**
 * Append `weight` of light spread over an axis-aligned elliptical cloud centred at (`x`, `y`) whose
 * per-axis STANDARD DEVIATION is (`sdx`, `sdy`) — every argument in 0..1 screen fractions. Total
 * weight is preserved exactly (each sample carries `weight / CLOUD_SAMPLES`), and the emitted cloud
 * reproduces the requested second moment, so a summary contributes the same light — in the same
 * place, with the same spread — as the individual points it stands for. `sd = 0` collapses every
 * sample onto the centre, i.e. degrades to exactly the single-point behaviour.
 */
export function pushCloud(
  out: BloomPoint[], x: number, y: number, sdx: number, sdy: number, weight: number,
): void {
  // A uniform disc of radius R has sd R/2 per axis; scale by 2·sd to match the input's spread.
  const rx = 2 * sdx, ry = 2 * sdy;
  const w = weight / CLOUD_SAMPLES;
  for (const [ox, oy] of CLOUD_OFFSETS) out.push({ x: x + ox * rx, y: y + oy * ry, weight: w });
}
