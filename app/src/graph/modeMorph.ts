// app/src/graph/modeMorph.ts
//
// THE PURE MODEL for the animated 2D<->3D morph — see graphRenderer.ts's EPITAPH item 1 for the
// defect this restores (`AsciiGraphRenderer.setConfig` hard-resetting the camera on a `viewMode`
// flip instead of transitioning). No timers, no canvas, no DOM: every function here is elapsed-time
// (or mix-fraction) in, blended value out, so it is unit-testable directly and so
// AsciiGraphRenderer's wiring is a thin adapter rather than where the logic lives.
//
// Ported from CanvasGraphRenderer.ts (readable at `git show 817bad5:app/src/graph/CanvasGraphRenderer.ts`)
// — NOT verbatim. Two of the three pieces below (morphProgress, blendPosition) are direct,
// behaviour-preserving extractions. The third (unwindOrbit) is a MEASURED DIVERGENCE, documented at
// its own definition: the source's orbit-unwind was a per-frame recurrence (it multiplies the
// CURRENT, already-decayed orbit angle by a freshly-recomputed factor every rendered frame), which
// is not a pure function of elapsed time — replaying it exactly requires the actual sequence of
// frame timestamps a session rendered at. A "no timers" pure model cannot reproduce that without
// becoming stateful, so this file implements the closed form that recurrence approximates instead of
// copying a shape it structurally cannot replicate. See unwindOrbit's doc comment for the measured
// difference and why the two endpoints (all that the wiring's end-state contract requires) still
// agree exactly.

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
 * `blendPosition`/`unwindOrbit`'s own endpoint guarantees are built on. `durationMs <= 0` is a
 * degenerate instant transition: always 1 (there is no interval to be partway through).
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
 * Callers orient `flatten` for whichever direction the transition is running: entering 2D,
 * `flatten` IS the eased morph progress (`morphProgress`'s return); entering 3D, it's
 * `1 - morphProgress(...)` — see AsciiGraphRenderer.ts's call site.
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
 * The camera orbit at flatten fraction `flatten` (same convention as `blendPosition`: 0 = the full
 * 3D orbit `(rx0, ry0)`, 1 = level). `unwindOrbit(rx0, ry0, 0)` returns `{rx: rx0, ry: ry0}`
 * EXACTLY and `unwindOrbit(rx0, ry0, 1)` returns `{rx: 0, ry: 0}` EXACTLY — the camera is level
 * precisely when the field is fully flat, matching the flat 2D projection's own hardcoded `rx = ry
 * = 0` (AsciiGraphRenderer.ts's `projectNodes`) at the instant the transition hands off to it.
 *
 * MEASURED DIVERGENCE FROM THE SOURCE (module header has the full reasoning). Canvas's tick()
 * unwound the orbit with `this.rx *= 1 - e; this.ry *= 1 - e` (CanvasGraphRenderer.ts:1167),
 * evaluated once per RENDERED FRAME against the CURRENT, already-decayed `this.rx`, with `e`
 * recomputed fresh from absolute elapsed time every call. That is a per-frame RECURRENCE, not a
 * pure function of elapsed time: `rx(t)` depends on the actual sequence of frame timestamps a
 * session happened to render at (`rx` after N frames is `rx0 * product(1 - e(t_i))` over the
 * SPECIFIC `t_i` the session rendered, not a formula of `t` alone), so two sessions morphing over
 * the identical 500ms at different frame rates would unwind along measurably different curves. A
 * "no timers" pure module (this file's own contract) cannot reproduce a history-dependent
 * recurrence without smuggling the frame history back in as hidden state — so this implements the
 * closed form that recurrence approximates instead: a plain lerp from the starting orbit down to
 * level, using the SAME eased progress as the position blend. It shares both endpoints with the
 * source exactly (full orbit at the transition's start, level at its end, which is everything the
 * wiring's end-state contract requires) and is monotonic and framerate-independent in between,
 * where the source was neither.
 */
export function unwindOrbit(rx0: number, ry0: number, flatten: number): { rx: number; ry: number } {
  // The `flatten >= 1` branch returns the literal `0`, not `rx0 * 0` — `rx0` is negative for the
  // renderer's own resting 3D orbit (-0.5), and `-0.5 * 0` is `-0`, which is a DIFFERENT value from
  // `0` under `Object.is` (and so under `toEqual`) even though `-0 === 0`. "Level" should mean
  // exactly `0`, not a sign-preserving almost-zero.
  if (flatten >= 1) return { rx: 0, ry: 0 };
  const carry = flatten <= 0 ? 1 : 1 - flatten;
  return { rx: rx0 * carry, ry: ry0 * carry };
}
