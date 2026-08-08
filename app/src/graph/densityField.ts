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
// This replaces it with phosphor: brightness driven by node DENSITY. It works on a muted palette
// because it is a luminance effect against a near-black ground rather than a saturation one, and it
// carries information — bright regions ARE dense regions, so the atmosphere is emitted by the graph
// instead of painted behind it.
//
// TERRITORY COLOUR. Brightness is density; HUE is whose density it is. Each emitter may carry the
// community colour it is already drawn in (AsciiGraphRenderer's `slotBloomRgb`/`nodeBloomRgb`, off
// the size-ranked `clusterVisual.buildColorSlots` slots), so the ground reads as a soft map of
// territories rather than one flat haze. That is a REVISIT of the single-hue decision the paragraph
// above records, made after looking at seven rendered variants side by side; the reason it does not
// re-open the iridescence problem is that the hues are the theme's own desaturated ramp, they are
// mixed only partway (GraphAtmosphere's `TERRITORY_TINT`), and every one of them is renormalised to
// the base hue's luma before it is painted — so a territory can change what colour a region is but
// never how bright it is. Nothing about the kernel, the radius or the alpha curve changed with it.
//
// The colour rides in the field itself (three weighted channels blurred by the SAME kernel, then
// divided by the blurred weight to recover a per-cell weighted MEAN) rather than being tinted in at
// paint time. That is not a stylistic preference: where two territories overlap, their hues have to
// mix in proportion to how much light each actually put there, and only a field carries enough
// information to do that. A paint-time hue picked per cell from "whichever cluster is nearest" has
// hard seams the `screen` blend then makes worse.

export const FIELD_W = 64;
export const FIELD_H = 40;

/** Per-cell MEAN emitter colour, 0..255 per channel, parallel to the intensity field. Present only
 *  when at least one emitter carried a colour — a graph with no communities at all (an embedded
 *  graph block strips them; see EmbeddedGraph.tsx) emits a plain scalar field and is painted in the
 *  base phosphor hue, exactly as it always was. */
export interface RgbChannels { r: Float32Array; g: Float32Array; b: Float32Array }

/** The intensity field, optionally carrying colour. Attaching `rgb` to the Float32Array rather than
 *  wrapping it keeps every consumer (the whole `setBloomCallback` seam, the QA counters, the tests)
 *  reading a plain Float32Array unchanged. */
export type DensityField = Float32Array & {
  rgb?: RgbChannels;
  /** The RAW blurred peak this frame, BEFORE normalisation. The caller needs it to carry a
   *  reference peak across frames — see `scaleField`. */
  peak?: number;
};

export interface BloomPoint {
  x: number; y: number; weight?: number;
  /** Emitter colour, 0..255 per channel — the community territory this light belongs to. Omitted
   *  for an emitter with no community, which contributes light but no hue. */
  rgb?: readonly [number, number, number];
}

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

/**
 * Bin points into FOUR parallel grids: the same weight field `accumulate` builds, plus
 * weight×channel for r/g/b. Blurring all four with the identical kernel and then dividing gives the
 * WEIGHTED MEAN emitter colour per cell — see `buildBloom`. The intensity channel is bit-for-bit
 * what `accumulate` would have produced for the same points, so carrying colour cannot change how
 * bright the atmosphere is. A point with no `rgb` adds its weight to the intensity and nothing to
 * the colour, so it reads as the base hue.
 */
export function accumulateColor(
  points: BloomPoint[], w: number, h: number,
): { v: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array } {
  const v = new Float32Array(w * h);
  const r = new Float32Array(w * h), g = new Float32Array(w * h), b = new Float32Array(w * h);
  for (const p of points) {
    if (!(p.x >= 0 && p.x < 1 && p.y >= 0 && p.y < 1)) continue;
    const cx = Math.min(w - 1, Math.floor(p.x * w));
    const cy = Math.min(h - 1, Math.floor(p.y * h));
    const i = cy * w + cx;
    const wt = p.weight ?? 1;
    v[i] += wt;
    if (p.rgb) { r[i] += wt * p.rgb[0]; g[i] += wt * p.rgb[1]; b[i] += wt * p.rgb[2]; }
  }
  return { v, r, g, b };
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

  // PREFIX SUMS, not a per-cell tap loop: cost is O(cells) regardless of `radius`, which is what
  // makes a ZOOM-SCALED radius affordable (see `radiusForSpread` / AsciiGraphRenderer's emitBloom —
  // the kernel has to grow with magnification or a magnified cluster resolves into one halo per
  // node). Arithmetically identical to the old loop: the same mean over the same in-bounds taps,
  // with the same edge clamping via the clipped window `count`.
  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(n);
    const major = horizontal ? height : width;   // lines to sweep
    const minor = horizontal ? width : height;   // cells per line
    const pre = new Float32Array(minor + 1);
    for (let m = 0; m < major; m++) {
      for (let i = 0; i < minor; i++) {
        const idx = horizontal ? m * width + i : i * width + m;
        pre[i + 1] = pre[i] + src[idx];
      }
      for (let i = 0; i < minor; i++) {
        const lo = i - radius < 0 ? 0 : i - radius;
        const hi = i + radius + 1 > minor ? minor : i + radius + 1;
        const count = hi - lo;
        const idx = horizontal ? m * width + i : i * width + m;
        out[idx] = count ? (pre[hi] - pre[lo]) / count : 0;
      }
    }
    return out;
  };
  let out = field;
  for (let i = 0; i < BOX_PASSES; i++) out = pass(pass(out, true), false);
  return out;
}

/** The kernel radius at fit, in field cells. */
export const BASE_BLUR_RADIUS = 6;
/** Ceiling, in field cells. The field is only FIELD_W×FIELD_H, so past roughly this the kernel
 *  already reaches most of it and growing further only costs contrast. */
export const MAX_BLUR_RADIUS = 20;

/**
 * Kernel radius for a camera magnification of `zoom` (1 = fit).
 *
 * LINEAR, because the thing the kernel has to bridge — the on-screen gap between neighbouring
 * nodes — is itself exactly linear in the camera scale. A radius fixed at `BASE_BLUR_RADIUS` is
 * correct only at fit: magnify 4× and every node sits four kernels from its neighbours, so each
 * blurs into its own isolated disc and a cluster reads as a constellation of halos rather than one
 * lit region. Keeping the kernel a fixed multiple of node SPACING instead of a fixed number of
 * cells also keeps the field's peak roughly invariant under zoom, which is what lets `normalise`'s
 * decayed reference peak (see `buildBloom`) hold a stable brightness across the zoom ladder.
 */
export function blurRadiusForZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 1) return BASE_BLUR_RADIUS;
  return Math.min(MAX_BLUR_RADIUS, Math.round(BASE_BLUR_RADIUS * zoom));
}

/** The largest cell in a field, or 0 for an empty one. */
export function fieldPeak(field: Float32Array): number {
  let max = 0;
  for (let i = 0; i < field.length; i++) if (field[i] > max) max = field[i];
  return max;
}

/** Scale so the peak cell is exactly 1. An empty field stays empty — never NaN. */
export function normalise(field: Float32Array): Float32Array {
  const max = fieldPeak(field);
  if (max <= 0) return Float32Array.from(field);
  const out = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) out[i] = field[i] / max;
  return out;
}

/**
 * Scale a normalised field by `k` (clamped to 0..1), in place, returning it.
 *
 * This is what stops the atmosphere GLOWING RANDOMLY. `normalise` divides by the frame's OWN peak,
 * which makes brightness purely relative: whatever happens to be densest right now paints at full
 * intensity, so panning the dense core off-field promotes some arbitrary sparse corner to maximum,
 * and every camera move re-scales the whole field again on the next frame — regions lighting up for
 * no reason, flickering as you move. The renderer carries a reference peak across frames
 * (AsciiGraphRenderer's `bloomPeakRef`) and hands the resulting ratio here, so brightness means
 * roughly the same density from one frame to the next. Applied AFTER normalisation, not as a
 * substitute divisor, so the caller can pick `k` knowing the peak this frame actually produced.
 */
export function scaleField(field: DensityField, k: number): DensityField {
  const f = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : 1;
  if (f === 1) return field;
  for (let i = 0; i < field.length; i++) field[i] *= f;
  return field;
}

/** Below this blurred weight a cell has no meaningful mean colour — dividing there amplifies
 *  rounding noise into a hue, which reads as coloured speckle in the dark corners. Such cells get
 *  colour 0, and the painter falls back to the base hue for them (they are also invisible at v⁴). */
const COLOR_EPS = 1e-6;

/**
 * accumulate → blur → normalise, at the fixed field resolution.
 *
 * If ANY point carries an `rgb`, three more channels (weight×channel) ride through the identical
 * kernel and are divided by the blurred weight afterwards, recovering the per-cell weighted MEAN
 * emitter colour on `field.rgb`. The intensity is bit-for-bit identical either way — that is the
 * property that makes territory colour a hue change and not a brightness change, and it is what the
 * `buildBloom`'s INTENSITY is identical with or without colour test pins.
 *
 * The colourless case is not a leftover switch: a graph with no communities (an embedded graph
 * block, the daemon/agents modes' non-note nodes) genuinely has no territories to colour, must
 * still glow, and should not pay for three blurs it would divide back out to nothing. Blur is the
 * whole cost here and it is on the rAF path — measured on the reference vault's 2125 points,
 * 0.47 ms colourless against 1.81 ms coloured, i.e. +1.34 ms on a DIRTY frame (emitBloom does not
 * run on a still one). Four blurs, not one, is the price of the effect; skipping three of them
 * where there is nothing to colour is free.
 *
 * `radius` scales with the camera — see `blurRadiusForZoom`. The raw pre-normalisation peak comes
 * back on `field.peak`, which is what lets a caller carry a reference peak across frames and damp
 * this per-frame normalisation afterwards (see `scaleField`).
 */
export function buildBloom(points: BloomPoint[], radius = BASE_BLUR_RADIUS): DensityField {
  let colored = false;
  for (const p of points) if (p.rgb) { colored = true; break; }
  if (!colored) {
    const b = blur(accumulate(points, FIELD_W, FIELD_H), FIELD_W, FIELD_H, radius);
    const mono: DensityField = normalise(b);
    mono.peak = fieldPeak(b);
    return mono;
  }
  const acc = accumulateColor(points, FIELD_W, FIELD_H);
  const vB = blur(acc.v, FIELD_W, FIELD_H, radius);
  const rB = blur(acc.r, FIELD_W, FIELD_H, radius);
  const gB = blur(acc.g, FIELD_W, FIELD_H, radius);
  const bB = blur(acc.b, FIELD_W, FIELD_H, radius);
  for (let i = 0; i < vB.length; i++) {
    const w = vB[i];
    // The UNNORMALISED blurred weight — `normalise` returns a new array below, so the divisor here
    // is the same quantity the numerators were accumulated against.
    if (w > COLOR_EPS) { rB[i] /= w; gB[i] /= w; bB[i] /= w; }
    else { rB[i] = 0; gB[i] = 0; bB[i] = 0; }
  }
  const out: DensityField = normalise(vB);
  out.rgb = { r: rB, g: gB, b: bB };
  out.peak = fieldPeak(vB);
  return out;
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
 *
 * `rgb` is the summarized cluster's own territory colour, carried onto EVERY sample: the cloud
 * stands for one community's members, so all of its light belongs to that community. Omitting it
 * emits an uncoloured cloud, which paints as the base phosphor hue.
 */
export function pushCloud(
  out: BloomPoint[], x: number, y: number, sdx: number, sdy: number, weight: number,
  rgb?: readonly [number, number, number],
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
      out.push({ x: x + Math.cos(th) * r * rx, y: y + Math.sin(th) * r * ry, weight: w, rgb });
    }
  }
}
