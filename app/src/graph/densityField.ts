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
