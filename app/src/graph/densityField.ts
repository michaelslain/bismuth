// The graph's bloom, computed from where the nodes actually ARE.
//
// The previous atmosphere was three CSS radial-gradients parked at cluster centroids, tuned against
// the OLD saturated category ramp. The redesign ramp is desaturated, so the same 26%-alpha screen
// blend reads as a whisper: the effect did not break, its input did. Iridescence — many competing
// hues, soft and diffuse — is also what clashes with the ASCII aesthetic. (Both ramps live in
// core/src/theme/tokens.ts; they are deliberately NOT quoted here, because themeGuard.test.ts's
// anti-drift lint counts a literal swatch triple anywhere in app/src as a re-duplication — prose
// included, and rightly so: a comment's copy goes stale exactly like code's.)
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

/** Successive box blurs converge to a Gaussian (CLT) — a single box pass is a flat-topped square
 *  with hard edges at exactly `radius`, which is precisely the boxy-halo defect this exists to
 *  avoid: two passes still has straight sides (the CORNER of the square support gets exactly the
 *  same value as an EDGE midpoint at the same pass count, because a box kernel is separable and
 *  therefore literally a flat square, not a disc). Three passes is the standard approximation used
 *  everywhere from Photoshop to Skia's `BlurMaskFilter` and is visually indistinguishable from a
 *  true Gaussian. See densityField.test.ts's "corner energy is less than edge energy" test for the
 *  property this actually buys — a box kernel gets that ratio wrong by construction, at ANY pass
 *  count below this, so it is not tunable away by nudging the radius instead. */
const BOX_PASSES = 3;

/** Separable box blur, `radius` cells each way, applied `BOX_PASSES` times. Mass-conserving apart
 *  from edge clamping. `w`/`h` are REQUIRED — a Float32Array's length cannot tell you its grid
 *  shape. */
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
  let out = field;
  for (let i = 0; i < BOX_PASSES; i++) out = pass(pass(out, true), false);
  return out;
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

/**
 * Target gap between neighbouring samples, in FIELD CELLS. Sized against the BLUR, not by taste:
 * samples must sit closer together than the kernel can smooth over, or the cloud reads as its own
 * little constellation of spikes — the same failure as emitting the aggregate as one point, just
 * subdivided. A radius-6 double box blur reaches 12 cells either way, so 5 leaves better than 2×
 * margin. Measured on a 275-note single-cluster fixture swept across the whole zoom ladder: a fixed
 * 32-sample cloud (spacing up to ~20 cells once magnified) fell to 0.32× the light of the leaves it
 * summarized at the worst stop; sampling to this spacing holds ≥ 0.69× everywhere.
 */
const CLOUD_SPACING_CELLS = 5;
/** Sample-count bounds. The floor keeps a tiny aggregate from degenerating into a cross (and `K ≥ 3`
 *  is what the exact-moment identity below needs); the ceiling keeps a hugely magnified one from
 *  costing more than the leaves it replaced — past that point most of the cloud is off-field anyway
 *  and `accumulate` discards it. */
const CLOUD_MIN_RINGS = 2, CLOUD_MAX_RINGS = 8;
const CLOUD_MIN_PER_RING = 6, CLOUD_MAX_PER_RING = 16;

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * A spread that can actually be sampled: non-finite or negative becomes 0, i.e. the documented
 * point-like behaviour.
 *
 * NOT defensive noise — it closes this module's own version of the bug it exists to fix. Left raw, a
 * NaN `sd` makes `clampInt(NaN, …)` return NaN, both of `pushCloud`'s loops fail their first
 * comparison, and the aggregate emits ZERO points while its caller still counts its full weight; an
 * infinite `sd` gets there by the other road, emitting points `accumulate` then drops. Either way
 * the QA counters read healthy and the field is dark — precisely the signature of the regression
 * this file was changed for, and precisely what those counters exist to make impossible. Degrading
 * to a point keeps the light (the CENTRE is still meaningful when only the spread has gone bad)
 * rather than dropping the cluster.
 *
 * Not reachable from `layout.ts` today: `LodCluster`'s `sdx`/`sdy` come from `√(E[x²] − E[x]²)`
 * clamped at 0, so it takes a member coordinate around 1e150 — big enough for the sum of squares to
 * overflow while the plain sum stays finite. Guarded anyway, for the same reason `safeDepthBand`
 * is: a non-finite that reaches the rAF path is a silent, permanent visual failure, not a throw.
 */
const sanitizeSpread = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Rings × samples-per-ring `pushCloud` will spend on a cloud of this spread (0..1 fractions) —
 *  exported so tests and QA can predict the cost without re-deriving it. Never returns a non-finite
 *  count: see `sanitizeSpread`. */
export function cloudGrid(sdx: number, sdy: number): { rings: number; perRing: number } {
  // Outer radius in cells, worst axis. The field is not square, so a fraction means a different
  // number of cells in x than in y.
  const rCells = Math.max(2 * sanitizeSpread(sdx) * FIELD_W, 2 * sanitizeSpread(sdy) * FIELD_H);
  return {
    rings: clampInt(rCells / CLOUD_SPACING_CELLS, CLOUD_MIN_RINGS, CLOUD_MAX_RINGS),
    perRing: clampInt((2 * Math.PI * rCells) / CLOUD_SPACING_CELLS, CLOUD_MIN_PER_RING, CLOUD_MAX_PER_RING),
  };
}

/** Total samples `pushCloud` spends on a cloud of this spread. */
export const cloudSampleCount = (sdx: number, sdy: number): number => {
  const g = cloudGrid(sdx, sdy);
  return g.rings * g.perRing;
};

/**
 * Append `weight` of light spread over an axis-aligned elliptical cloud centred at (`x`, `y`) whose
 * per-axis STANDARD DEVIATION is (`sdx`, `sdy`) — every argument in 0..1 screen fractions.
 *
 * THE PATTERN: `rings` equal-area rings (`r = √((j + ½)/M)` — a linear radius would bunch samples
 * toward the centre and re-create the very peak this exists to avoid), each of `perRing` evenly
 * spaced points, successive rings rotated so the whole reads as a disc rather than as spokes.
 *
 * Rings, not a golden-angle spiral, because this shape's moments are EXACT rather than approximate,
 * at every one of the sample counts `cloudGrid` can pick. For any ring of K ≥ 3 evenly spaced points
 * at any rotation, Σcos = Σsin = 0 and Σcos² = Σsin² = K/2 identically; averaging over equal-area
 * radii then gives mean (0, 0), zero anisotropy, and E[x²] = E[y²] = ¼ for ANY M — i.e. per-axis
 * standard deviation exactly ½. (A 12-point spiral is ~6% off, and its error moves whenever the
 * sample count is retuned, which here it does per call.) A uniform disc of radius R has per-axis sd
 * R/2, which is why the offsets are scaled by 2·sd.
 *
 * So: total weight is preserved exactly, and the emitted cloud reproduces the requested second
 * moment — a summary contributes the same light, in the same place, at the same spread, as the
 * individual points it stands for. `sd = 0` — or a non-finite/negative one, see `sanitizeSpread` —
 * collapses every sample onto the centre, i.e. degrades to exactly the single-point behaviour, and
 * the emitted weight is the same either way.
 */
export function pushCloud(
  out: BloomPoint[], x: number, y: number, sdx: number, sdy: number, weight: number,
): void {
  const { rings, perRing } = cloudGrid(sdx, sdy);
  const rx = 2 * sanitizeSpread(sdx), ry = 2 * sanitizeSpread(sdy);
  const w = weight / (rings * perRing);
  const step = (Math.PI * 2) / perRing;
  for (let j = 0; j < rings; j++) {
    const r = Math.sqrt((j + 0.5) / rings);
    // Rotate each ring by a fraction of its own angular step so no two rings line up — cosmetic
    // only: the moment identities above hold at any rotation.
    const phase = (j * step) / rings;
    for (let k = 0; k < perRing; k++) {
      const th = phase + k * step;
      out.push({ x: x + Math.cos(th) * r * rx, y: y + Math.sin(th) * r * ry, weight: w });
    }
  }
}
