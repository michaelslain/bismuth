// app/src/graph/cameraModel.ts
//
// THE MERGE'S CENTRAL DESIGN TENSION, resolved: zoom-as-RESOLUTION vs zoom-as-DOLLY. The two
// renderers merged in Part 2b disagreed about what a wheel notch means, and this file is where that
// disagreement was settled. Read the whole header before touching anything below.
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
//   zs(zoom, P)    = P / max(1, P - zoom)                    // magnification; 1 at zoom = 0
//   maxZs(P)       = P / max(1, P - MAX_ZOOM_FRAC * P)       // magnification at the wheel's stop —
//                                                             // see maxZsFor() below
//   zoomT(zoom, P) = clamp01( log(zs) / log(max(1.0001, maxZs(P))) )
//
// `dollyForT` is `zoomT` run backwards, inverted ALGEBRAICALLY:
//
//   zs = maxZs(P)^t                                    // invert the log
//   P - zoom = P / zs = P * maxZs(P)^(-t)               // invert the magnification
//   zoom = P * (1 - maxZs(P)^(-t))                      // = dollyForT(t, P)
//
// Substituting back: (P - zoom) = P * maxZs(P)^(-t), so zs = P / (P - zoom) = maxZs(P)^t, and
// log(zs) / log(maxZs(P)) = t identically — an EXACT inverse at ANY perspective P, no domain
// restriction, PROVIDED both directions compute `maxZs` the SAME way. That "provided" is load-bearing
// enough to be code, not a comment: `maxZsFor()` below is the one formula both `dollyForT` and
// `zoomT` call, so the two cannot independently drift apart.
//
// That sharing is not hypothetical hardening — an earlier version of this file inlined `maxZs`'s
// ASYMPTOTIC value (`MAX_MAGNIFICATION`, below) directly into `dollyForT` instead of computing it
// from `perspective`, on the assumption that a real viewport's `P` is always comfortably clear of
// where `maxZsFor` and that constant diverge. Code review found that assumption false against this
// renderer's own code, not a hypothetical: `graphFit.ts`'s `MIN_USABLE_BOX_PX = 4` admits a
// near-zero host box, and ASCII's `rows = max(1, floor((h - 2*PAD_Y) / cellH))` floors to `rows = 1`
// for ANY host shorter than 56px — a pane dragged to a sliver, or a collapsed split, both ordinary UI
// states, not contrived ones — giving `P ≈ 15.59` (or `≈ 8.66` under a `--cell-h: 10px` CSS
// override). Both sit well inside the range where the constant and the true per-P ceiling disagree
// enough to break the round trip by over 0.1. Sharing `maxZsFor()` fixes this BY CONSTRUCTION — there
// is no longer a precondition for a real viewport to violate, so there is nothing left to document as
// a restriction.
//
// `MAX_ZOOM_FRAC = 0.94` is carried over verbatim from Canvas's own wheel clamp (`onWheel`: `goalZoom`
// capped at `P * 0.94`) — not re-derived. At ordinary viewport scale (`P` large enough that
// `maxZsFor`'s floor never binds — see `maxZsFor`) this makes `dollyForT(1, P) === MAX_ZOOM_FRAC * P`,
// the same "how far in the camera can dolly" contract the old renderer shipped; below that scale the
// ceiling is still correct, just not equal to that shortcut (a genuinely tiny viewport genuinely
// cannot dolly as far, in absolute px, as `MAX_ZOOM_FRAC * P` would suggest). Either way the dolly
// stays off the perspective plane P (the projection's near-plane singularity, see `projValid` in the
// pre-merge renderers: `persp > 0.05 && zc < P * 0.985`): `maxZsFor(P) >= 1` always (see `maxZsFor`),
// so `maxZsFor(P)^(-t) ∈ (0, 1]` for `t ∈ [0,1]`, so `dollyForT(t, P) < P` unconditionally.

/** Canvas's wheel-zoom clamp (`onWheel`, pre-merge): the dolly never goes further in than this
 *  fraction of the perspective distance `P`, at ordinary viewport scale. Reused here, unchanged, as
 *  the input `maxZsFor` derives the wheel-stop magnification from. */
export const MAX_ZOOM_FRAC = 0.94;

/** The value `maxZsFor(P)` (below) converges to as `P` grows — Canvas's own measured "~17× at the
 *  stop" (`1 / (1 - MAX_ZOOM_FRAC)` ≈ 16.667×). Neither `dollyForT` nor `zoomT` uses this constant
 *  directly any more — see the module comment for why that used to be a bug — it is kept as a named
 *  reference value for documentation and for the golden-shape test in cameraModel.test.ts, which pins
 *  the mapping's log character independently of the round trip. */
export const MAX_MAGNIFICATION = 1 / (1 - MAX_ZOOM_FRAC);

/** The magnification at the wheel's zoom-in stop (`t = 1`) for a GIVEN perspective distance — the one
 *  formula `dollyForT` and `zoomT` both call, so they cannot independently drift into disagreement
 *  (see the module comment: computing this from a precomputed constant instead, which only agrees
 *  with this formula once `P` is comfortably large, is exactly the bug code review found). Always
 *  `>= 1` for any `perspective >= 1` (the `Math.max(1, …)` floor guarantees it), which is what keeps
 *  `dollyForT` from ever reaching `perspective`. Converges to `MAX_MAGNIFICATION` as `perspective`
 *  grows; below the floor (a degenerate — but real, see the module comment — small viewport) it is
 *  smaller than that limit, which is correct: the ceiling magnification a genuinely tiny viewport can
 *  reach is genuinely smaller.
 *
 *  `Math.max(1, perspective)` on the way IN is a domain guard, not a tuning constant, and it landed
 *  here once this module got a live call site (`AsciiGraphRenderer.projectNodes`) that can reach it
 *  with a degenerate `perspective`: the renderer initialises `private P = 1` and only computes the
 *  real focal length in `measure()`, so every frame between construction and the first usable host
 *  box calls in at exactly `P = 1`. Nothing in the app produces a `perspective <= 0` today (the
 *  renderer floors its own height), but nothing in the SIGNATURE forbids one either — and without the
 *  floor a negative `perspective` makes this return a NEGATIVE ratio, whereupon
 *  `Math.pow(negative, -t)` is `NaN` for fractional `t`. A NaN dolly does not throw: it silently
 *  poisons `zc`, `persp`, `sx` and `sy` for EVERY node, i.e. blanks the field with no error anywhere
 *  — the worst failure shape available at this call site. The floor makes that unreachable by
 *  construction rather than by every caller remembering. */
function maxZsFor(perspective: number): number {
  const p = Math.max(1, perspective);
  return p / Math.max(1, p - MAX_ZOOM_FRAC * p);
}

/**
 * Derive the 3D camera dolly (a camera-forward z-offset, in the same px units as `perspective`)
 * from the resolution ladder's `[0,1]` progress `t` (`asciiGrid.ts` `resolutionT(res, maxRes)`).
 *
 * Monotonic (strictly increasing) in `t` for any `perspective > 1` — i.e. any perspective distance a
 * real host box produces, degenerate ones included (see the module comment). At `perspective <= 1` it
 * is identically 0 for every `t`, NOT strictly increasing: `maxZsFor` bottoms out at exactly 1 there,
 * and `1^-t` is 1. That is not a rounding artefact and it is not unreachable — `AsciiGraphRenderer`
 * holds `P = 1` from construction until its first `measure()`, so every frame before the host box is
 * usable takes this branch. The behaviour is the right one (a camera with no measured depth to move
 * through does not move), but it is a FLAT segment, so the "strictly increasing" claim is scoped
 * above rather than stated unconditionally — an earlier draft of this docstring said
 * "any perspective >= 1" and was false at exactly the value the renderer boots with.
 * `dollyForT(0, P) === 0`:
 * the resting overview (fit, `res = 1`) has no dolly — the camera sits at the fit distance, matching
 * ASCII's `zc = z2` today. At ordinary viewport scale, `dollyForT(1, P) === MAX_ZOOM_FRAC * P`: the
 * deepest resolution stop dollies exactly as far in as Canvas's old wheel clamp allowed (see
 * `maxZsFor` for why this simplification only holds clear of its floor — the underlying ceiling is
 * still correct either side of it). Never reaches `perspective` itself for any `t` in `[0,1]`, at ANY
 * `perspective` — see the module comment.
 *
 * `t` is clamped to `[0,1]` (mirrors `resolutionT`'s own clamp — a caller passing an out-of-range
 * progress gets the nearest valid dolly rather than an extrapolated one).
 */
export function dollyForT(t: number, perspective: number): number {
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  return perspective * (1 - Math.pow(maxZsFor(perspective), -tc));
}

/**
 * Inverse of `dollyForT`: the `[0,1]` resolution progress a given dolly distance corresponds to.
 * This is Canvas's original `zoomT()` (`CanvasGraphRenderer.ts:820-826`, pre-merge), carried over
 * unchanged and parameterized (`this.zoom`/`this.P` become `zoom`/`perspective` arguments) rather
 * than rewritten — and it is the function `maxZsFor` was extracted FROM, with `dollyForT` calling the
 * SAME helper, so the two remain exact algebraic inverses of each other at every perspective, not a
 * pair independently tuned to agree in the common case.
 *
 * `zs <= 1` (zoom at or behind the fit distance) returns `0` rather than a negative progress — same
 * guard as the source. Clamped to `[0,1]` either way.
 */
export function zoomT(zoom: number, perspective: number): number {
  const zs = perspective / Math.max(1, perspective - zoom);
  if (zs <= 1) return 0;
  const maxZs = maxZsFor(perspective);
  const t = Math.log(zs) / Math.log(Math.max(1.0001, maxZs));
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
