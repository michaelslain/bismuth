// On-release smoothing for freehand strokes. Operates on a flat [x, y, pressure, …] buffer.
//
// Pipeline (all O(n), closed-form, sub-millisecond for the ~50–150-point strokes we capture):
//   1. dedupe coincident points (guards the spline's divide-by-zero),
//   2. uniform arc-length resample — raw pointer samples are non-uniformly spaced (fast =
//      sparse, slow = dense); uneven spacing is a primary cause of the "geometric" look and
//      makes any averaging kernel pull unevenly. Resampling gives evenly-spaced control points
//      so the later steps are well-behaved,
//   3. light Gaussian (binomial) denoise on those uniform points — an APPROXIMATING pass that
//      actually removes hand jitter (an interpolating spline alone can't: it would pass through
//      the jitter). Few passes on uniform points → negligible shrinkage, unlike the previous
//      9-pass-on-raw-points version,
//   4. centripetal Catmull-Rom (α = 0.5) through the denoised points — interpolates them into a
//      dense, flowing curve (α = 0.5 is the parametrisation proven to avoid cusps).
// The stroke is then drawn with perfect-freehand + a quadratic-midpoint outline fill, which
// removes the last of the faceting.

interface P { x: number; y: number; p: number }

// px between control points after resampling. Larger = smoother (more jitter decimated),
// smaller = more faithful. Tuned for the 816×1056 page.
export const RESAMPLE_SPACING = 6;
// Catmull-Rom sub-samples emitted per segment. 6–12 is plenty given the curve is also
// rendered with a quadratic-midpoint outline path.
export const SAMPLES_PER_SEGMENT = 8;
// Gaussian denoise passes over the uniform points. Higher = smoother but flatter; a handful
// on uniform spacing kills jitter with negligible shrinkage.
export const DENOISE_PASSES = 6;
const EPS = 1e-4;

const dist = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a: P, b: P, t: number): P => ({
  x: a.x + t * (b.x - a.x),
  y: a.y + t * (b.y - a.y),
  p: a.p + t * (b.p - a.p),
});

function toPts(a: number[]): P[] {
  const out: P[] = [];
  for (let i = 0; i + 2 < a.length + 1; i += 3) out.push({ x: a[i], y: a[i + 1], p: a[i + 2] ?? 255 });
  return out;
}
function toFlat(ps: P[]): number[] {
  const out: number[] = [];
  for (const q of ps) out.push(q.x, q.y, Math.max(0, Math.min(255, q.p)));
  return out;
}

/** Drop consecutive near-duplicate points; always keep the exact final point. */
function dedupe(ps: P[], minDist = 0.6): P[] {
  if (ps.length < 2) return ps.slice();
  const out: P[] = [ps[0]];
  for (let i = 1; i < ps.length; i++) {
    if (dist(out[out.length - 1], ps[i]) >= minDist) out.push(ps[i]);
  }
  const last = ps[ps.length - 1];
  if (dist(out[out.length - 1], last) > EPS) out.push(last);
  return out;
}

/** Resample a polyline to (approximately) uniform arc-length spacing; endpoints kept exact. */
function resample(ps: P[], spacing: number): P[] {
  if (ps.length < 2) return ps.slice();
  const out: P[] = [ps[0]];
  let carry = 0; // arc length walked since the last emitted point
  for (let i = 1; i < ps.length; i++) {
    let a = ps[i - 1];
    const b = ps[i];
    let d = dist(a, b);
    while (carry + d >= spacing) {
      const t = (spacing - carry) / d;
      a = lerp(a, b, t);   // advance within the segment and emit
      out.push(a);
      carry = 0;
      d = dist(a, b);
    }
    carry += d;
  }
  const last = ps[ps.length - 1];
  if (dist(out[out.length - 1], last) > EPS) out.push(last);
  return out;
}

/** Binomial [0.25, 0.5, 0.25] smoothing, `passes` times, endpoints pinned. Run on UNIFORMLY
 *  spaced points so it denoises evenly (the approximating step that removes jitter). */
function gaussian(ps: P[], passes: number): P[] {
  if (ps.length < 3 || passes <= 0) return ps.slice();
  let cur = ps;
  for (let it = 0; it < passes; it++) {
    const next = cur.slice();
    for (let i = 1; i < cur.length - 1; i++) {
      next[i] = {
        x: 0.25 * cur[i - 1].x + 0.5 * cur[i].x + 0.25 * cur[i + 1].x,
        y: 0.25 * cur[i - 1].y + 0.5 * cur[i].y + 0.25 * cur[i + 1].y,
        p: 0.25 * cur[i - 1].p + 0.5 * cur[i].p + 0.25 * cur[i + 1].p,
      };
    }
    cur = next;
  }
  return cur;
}

/**
 * Centripetal Catmull-Rom (α = 0.5) through `ps`, emitting `samples` points per segment.
 * Non-uniform tangents + power-basis evaluation (Barry–Goldman form). Endpoints are
 * duplicated as phantom controls so the first/last real segments exist, and the exact final
 * point is re-pinned.
 */
function catmullRom(ps: P[], samples: number): P[] {
  const n = ps.length;
  if (n < 3) return ps.slice();
  const pad = [ps[0], ...ps, ps[n - 1]];
  const out: P[] = [ps[0]];
  const knot = (t: number, a: P, b: P) => t + Math.pow(Math.max(dist(a, b), EPS), 0.5); // α = 0.5

  for (let i = 1; i + 2 < pad.length; i++) {
    const p0 = pad[i - 1], p1 = pad[i], p2 = pad[i + 1], p3 = pad[i + 2];
    const t0 = 0, t1 = knot(t0, p0, p1), t2 = knot(t1, p1, p2), t3 = knot(t2, p2, p3);

    const channel = (k: "x" | "y" | "p") => {
      let m1 = (p2[k] - p1[k]) / (t2 - t1) - (p2[k] - p0[k]) / (t2 - t0) + (p1[k] - p0[k]) / (t1 - t0);
      let m2 = (p3[k] - p2[k]) / (t3 - t2) - (p3[k] - p1[k]) / (t3 - t1) + (p2[k] - p1[k]) / (t2 - t1);
      m1 *= t2 - t1; m2 *= t2 - t1;
      const a = 2 * (p1[k] - p2[k]) + m1 + m2;
      const b = -3 * (p1[k] - p2[k]) - 2 * m1 - m2;
      return (u: number) => ((a * u + b) * u + m1) * u + p1[k]; // c = m1, d = p1[k]
    };
    const fx = channel("x"), fy = channel("y"), fp = channel("p");
    for (let s = 1; s <= samples; s++) {
      const u = s / samples;
      out.push({ x: fx(u), y: fy(u), p: fp(u) });
    }
  }
  out[out.length - 1] = ps[n - 1]; // re-pin the exact last captured point
  return out;
}

/**
 * Smooth a finished freehand stroke. Drop-in for the previous Laplacian version (same name +
 * signature) so the canvas just calls it on pointer-release for "smooth" strokes.
 */
export function smoothStrokePoints(
  pts: number[],
  spacing: number = RESAMPLE_SPACING,
  samples: number = SAMPLES_PER_SEGMENT,
  passes: number = DENOISE_PASSES,
): number[] {
  const ps = dedupe(toPts(pts));
  if (ps.length < 3) return toFlat(ps); // a dot or a 2-point line: nothing to smooth
  return toFlat(catmullRom(gaussian(resample(ps, spacing), passes), samples));
}
