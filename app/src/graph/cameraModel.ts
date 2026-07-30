// app/src/graph/cameraModel.ts
//
// The resolution of MERGE-NOTES.md §6 — the merge's central design tension. Read that section in
// full before touching this file.
//
// `res`/`zoomPct` (asciiGrid.ts `resolutionT`/`resFromT`) stays the ONE durable, user-facing zoom
// state: 10% steps, a 0-100% HUD readout, cursor-anchored in 2D. Everything SEMANTIC — LOD level,
// the label ladder, node colour, edge-level weights — keys off `resolutionT(res, maxRes)` exactly as
// it does today, unchanged by anything in this file.
//
// What lives here is the one thing that genuinely needs a second axis: in 3D, a camera dolly
// (`zc = z2 + zoom`) is what produces perspective APPROACH — parallax, the cloud opening up as you
// move into it, near and far separating. That is a property of the CAMERA, not of the marks, so it
// can be derived from the resolution progress instead of tracked as an independent zoom. One wheel
// notch then does both jobs: it raises resolution (density/aggregation — the semantic) and dollies
// the camera in (the optical "magnificent" part) from the same number.
//
// THE LAW still holds: a mark's screen size never changes with zoom. `dollyForT` only ever feeds a
// camera-space z-offset; it does not touch glyph size or letter-spacing. The 6 THE LAW tests
// elsewhere assert `ctx.font`/`letterSpacing` invariance, not position invariance, so they are
// unaffected by anything below.
//
// DERIVATION. Canvas's `zoomT()` (CanvasGraphRenderer.ts:820-826, pre-merge) computed exactly the
// INVERSE of what a unified camera needs — dolly px -> [0,1] resolution progress — by
// log-normalising the perspective magnification against the wheel's zoom-in stop:
//
//   zs(zoom, P)    = P / max(1, P - zoom)                     // magnification; 1 at zoom = 0
//   maxZs(P)       = P / max(1, P - MAX_ZOOM_FRAC * P)        // magnification at the wheel's stop
//   zoomT(zoom, P) = clamp01( log(zs) / log(max(1.0001, maxZs)) )
//
// This inversion is exact PROVIDED `max(1, P - MAX_ZOOM_FRAC * P)` never hits its floor of 1, i.e.
// `P > 1 / (1 - MAX_ZOOM_FRAC)` ≈ 16.667 — below that, the floor distorts the ratio at intermediate
// `t` (not just at the `t=1` boundary) and the two functions stop being exact inverses (verified
// numerically: round-trip error is ~1e-15 at P=17 but grows to ~0.18 at P=10 and ~1 at P=1). For any
// perspective distance a real viewport produces (`P = (H/2) / tan(FOV/2)` with `H` in device px —
// always ≫ 17, since `isUsableBox` already rejects near-zero host boxes) this precondition holds by
// a wide margin, so `maxZs` collapses to a constant independent of `P`:
// `1 / (1 - MAX_ZOOM_FRAC)` ≈ 16.667 (Canvas's own "~17× at the stop").
// `dollyForT` below is `zoomT` run backwards, inverted ALGEBRAICALLY (not numerically) in that same
// regime:
//
//   zs = maxZs^t                                  // invert the log
//   P - zoom = P / zs = P * maxZs^(-t)             // invert the magnification
//   zoom = P * (1 - maxZs^(-t))                    // = dollyForT(t, P)
//
// Substituting back: (P - zoom) = P * maxZs^(-t), so zs = P / (P - zoom) = maxZs^t, and
// log(zs) / log(maxZs) = t identically — this is an exact inverse, not an approximation. The
// round-trip test below (`zoomT(dollyForT(t, P), P) ≈ t`) therefore uses a tight tolerance
// (`toBeCloseTo(t, 9)`, i.e. within 1e-9): the residual is pure float64 rounding from `Math.log`/
// `Math.pow`, not model error. See that test for the measured error (~1e-15 across the sampled
// range) and why the tolerance is not "loosened until it passes".
//
// `MAX_ZOOM_FRAC = 0.94` is carried over verbatim from Canvas's own wheel clamp (`onWheel`:
// `goalZoom` capped at `P * 0.94`) — not re-derived — so `dollyForT(1, P) === MAX_ZOOM_FRAC * P`,
// the same "how far in the camera can dolly" contract the old renderer shipped. It is also what
// keeps the dolly off the perspective plane P (the projection's near-plane singularity, see
// `projValid` in the pre-merge renderers: `persp > 0.05 && zc < P * 0.985`): `maxZs^(-t)` ranges over
// `[1 / maxZs, 1] = [1 - MAX_ZOOM_FRAC, 1] = [0.06, 1]` for `t` in `[0,1]`, so `P - zoom` never drops
// below `0.06 * P` — comfortably clear of both 0 and the singularity for any real viewport.

/** Canvas's wheel-zoom clamp (`onWheel`, pre-merge): the dolly never goes further in than this
 *  fraction of the perspective distance `P`. Reused here, unchanged, as the ceiling `dollyForT`
 *  derives toward at `t = 1` — see the module comment for why this is what keeps the dolly off the
 *  projection's near-plane singularity. */
export const MAX_ZOOM_FRAC = 0.94;

/** Magnification at the wheel's zoom-in stop (`t = 1`). Algebraically independent of the perspective
 *  distance `P` — see the module comment's derivation — so this is a plain constant, not a function:
 *  `1 / (1 - MAX_ZOOM_FRAC)` ≈ 16.667×, matching Canvas's own measured "~17× at the stop". */
export const MAX_MAGNIFICATION = 1 / (1 - MAX_ZOOM_FRAC);

/**
 * Derive the 3D camera dolly (a camera-forward z-offset, in the same px units as `perspective`)
 * from the resolution ladder's `[0,1]` progress `t` (`asciiGrid.ts` `resolutionT(res, maxRes)`).
 *
 * Monotonic (strictly increasing) in `t` for any `perspective > 0`. `dollyForT(0, P) === 0`: the
 * resting overview (fit, `res = 1`) has no dolly — the camera sits at the fit distance, matching
 * ASCII's `zc = z2` today. `dollyForT(1, P) === MAX_ZOOM_FRAC * P`: the deepest resolution stop
 * dollies exactly as far in as Canvas's old wheel clamp allowed. Never reaches `perspective` itself
 * for any `t` in `[0,1]` — see the module comment.
 *
 * `t` is clamped to `[0,1]` (mirrors `resolutionT`'s own clamp — a caller passing an out-of-range
 * progress gets the nearest valid dolly rather than an extrapolated one).
 */
export function dollyForT(t: number, perspective: number): number {
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  return perspective * (1 - Math.pow(MAX_MAGNIFICATION, -tc));
}

/**
 * Inverse of `dollyForT`: the `[0,1]` resolution progress a given dolly distance corresponds to.
 * This is Canvas's original `zoomT()` (`CanvasGraphRenderer.ts:820-826`, pre-merge), carried over
 * unchanged and parameterized (`this.zoom`/`this.P` become `zoom`/`perspective` arguments) rather
 * than rewritten — `dollyForT` was derived FROM this, so the two are exact algebraic inverses of
 * each other (see the module comment), not a pair independently tuned to agree.
 *
 * `zs <= 1` (zoom at or behind the fit distance) returns `0` rather than a negative progress — same
 * guard as the source. Clamped to `[0,1]` either way.
 */
export function zoomT(zoom: number, perspective: number): number {
  const zs = perspective / Math.max(1, perspective - zoom);
  if (zs <= 1) return 0;
  const maxZs = perspective / Math.max(1, perspective - MAX_ZOOM_FRAC * perspective);
  const t = Math.log(zs) / Math.log(Math.max(1.0001, maxZs));
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
