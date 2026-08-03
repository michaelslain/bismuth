// app/src/graph/modeMorph.ts
//
// THE PURE MODEL for the animated 2D<->3D morph — see graphRenderer.ts's EPITAPH item 1 for the
// defect this restores (`AsciiGraphRenderer.setConfig` hard-resetting the camera on a `viewMode`
// flip instead of transitioning). No timers, no canvas, no DOM: every function here is elapsed-time
// (or mix-fraction) in, blended value out, so it is unit-testable directly and so
// AsciiGraphRenderer's wiring is a thin adapter rather than where the logic lives.
//
// Ported from CanvasGraphRenderer.ts (readable at `git show 817bad5:app/src/graph/CanvasGraphRenderer.ts`)
// — NOT verbatim. `morphProgress` and `blendPosition` are direct, behaviour-preserving extractions.
//
// `lerp` (below) replaced an earlier `unwindOrbit(rx0, ry0, flatten)` that computed the camera
// orbit as a FIXED reference angle times a flatten-shaped decay factor — modelled on Canvas's own
// per-frame `rx *= 1 - e` (CanvasGraphRenderer.ts:1167), which is a recurrence over the CURRENT,
// already-decayed value, not a pure function of elapsed time (replaying it exactly needs the actual
// sequence of frame timestamps a session rendered at, which a "no timers" pure model cannot
// reproduce without smuggling frame history back in as hidden state — hence the closed form
// instead of a literal port).
//
// Round-1 review found that fixed-reference design broke when a transition is INTERRUPTED (a
// second `viewMode` flip before the first finishes): the flatten/orbit sweep always restarted from
// a hardcoded far endpoint, producing a visible jump away from wherever the field actually was.
// The fix is architectural, not a tweak to the old function: instead of "one fixed reference,
// decayed by the current flatten", every blended camera quantity is now a plain FROM/TO lerp where
// `from` is captured LIVE — wherever the quantity actually is the instant a transition (re)starts —
// and `to` is the resting value for the arrival mode. `lerp` is that primitive, used identically for
// the flatten fraction itself and for each orbit angle (see AsciiGraphRenderer.ts's `modeMorph`
// field and `tick()` for where `from` is captured and how the interpolated value is written back to
// live state every frame, which is what makes a LATER interruption's own `from` correct in turn).

import type { Vec3 } from "./graphRenderer";

/** CanvasGraphRenderer.ts:79's `MODE_MORPH_MS` — the 2D<->3D flatten/expand duration. Carried over
 *  unchanged: a faithful port has no reason to retune a value nobody has complained about. */
export const MODE_MORPH_MS = 500;

/** CanvasGraphRenderer.ts:336, verbatim — the standard smoothstep-derived cubic ease. Monotonic on
 *  [0,1] (in fact strictly increasing there), `easeInOutCubic(0) === 0`, `easeInOutCubic(1) === 1`. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * The eased 0..1 progress of a mode-morph transition, `elapsedMs` after it started, over a total
 * `durationMs`. Clamped BEFORE easing, not after: `elapsedMs <= 0` returns EXACTLY 0 and
 * `elapsedMs >= durationMs` returns EXACTLY 1 for any `durationMs > 0` — the two endpoints a caller
 * needs to decide "is this transition over yet" without a separate comparison, and the property
 * `blendPosition`/`lerp`'s own endpoint guarantees are built on. `durationMs <= 0` is a degenerate
 * instant transition: always 1 (there is no interval to be partway through).
 *
 * Monotonic non-decreasing over any INCREASING sequence of `elapsedMs` for a fixed `durationMs` —
 * `easeInOutCubic` is monotonic on [0,1] and the pre-clamp is monotonic by construction, so the
 * composition is too.
 */
export function morphProgress(elapsedMs: number, durationMs: number = MODE_MORPH_MS): number {
  if (durationMs <= 0) return 1;
  const k = elapsedMs <= 0 ? 0 : elapsedMs >= durationMs ? 1 : elapsedMs / durationMs;
  return easeInOutCubic(k);
}

/**
 * Per-node position blend from the 3D layout position `p3` toward the flat 2D one `p2`, at a
 * flatten fraction `flatten` where 0 is pure `p3` and 1 is pure `p2` —
 * CanvasGraphRenderer.ts:1011-1013's `projectPositions()` lerp, pulled out pure (no `this.morph`
 * instance field to read).
 *
 * Exact, not merely close, at both ends: `flatten <= 0` returns `p3` UNCHANGED (the same array
 * elements, not a recomputed lerp that happens to land on them) and `flatten >= 1` returns `p2`
 * unchanged. That exactness is load-bearing for modeMorph.test.ts's "morph=1 equals the pure-2D
 * position for every node" assertion — a lerp computed as `p3 + (p2-p3)*1` is mathematically the
 * same value but is not guaranteed bit-identical once floating-point rounding is involved, and the
 * brief requires an ABSOLUTE assertion there, not a `toBeCloseTo`.
 *
 * `flatten` is the CURRENT frame's flatten fraction (`AsciiGraphRenderer`'s `this.morphFlatten`) —
 * safe to read directly regardless of whether the current transition is fresh or an interruption of
 * an earlier one, because `p3`/`p2` are fixed per-node reference points, not per-transition captured
 * state; only `flatten` itself needs interruption-safe bookkeeping (see `lerp`'s doc comment), and
 * once it has that, this function needs none of its own.
 */
export function blendPosition(p3: Vec3, p2: Vec3, flatten: number): Vec3 {
  if (flatten <= 0) return p3;
  if (flatten >= 1) return p2;
  return [
    p3[0] + (p2[0] - p3[0]) * flatten,
    p3[1] + (p2[1] - p3[1]) * flatten,
    p3[2] + (p2[2] - p3[2]) * flatten,
  ];
}

/**
 * Linear interpolation from `from` to `to` at progress `progress`, exact at both ends by
 * construction: `progress <= 0` returns `from` UNCHANGED and `progress >= 1` returns `to`
 * UNCHANGED, rather than relying on `from + (to - from) * progress` to land on them — that
 * expression is not guaranteed bit-identical to either endpoint in IEEE-754 (it can lose precision
 * by subtraction-then-addition when `from`/`to` differ by many orders of magnitude), so the
 * endpoints are special-cased instead of hoped for.
 *
 * The general-purpose replacement for the old `unwindOrbit` (module header has the full history):
 * where that function tied the camera orbit to ONE fixed reference angle and a flatten-derived
 * decay, `lerp` takes an explicit `from`/`to` pair, so a caller can supply whatever the LIVE value
 * actually is at the moment a transition starts — the fix for the interruption bug round-1 review
 * found. Used identically for the flatten fraction itself and for each orbit angle; see
 * AsciiGraphRenderer.ts's `tick()`.
 */
export function lerp(from: number, to: number, progress: number): number {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  return from + (to - from) * progress;
}
