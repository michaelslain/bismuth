// app/src/graph/graphFit.ts
//
// Pure guards for the graph's fit math. The renderer scales the backend layout to the host box
// (worldScale = fitPx / boundingRadius) every time the box or the node set changes. Two transient
// states used to make the spacing "go weird until it settles" (card #97):
//
//   1. A DEGENERATE HOST BOX. The knowledge graph is a single floating element that App re-places
//      across slots (initial mount, tab<->graph, Cmd+O switcher expand, sidebar toggle) and re-sizes
//      it twice — once immediately, once ~280ms later once the pane transition settles. If measure()
//      runs while the host is still mid-layout at 0/1px, `fitPx ≈ FIT_FRACTION * 1` and every node
//      collapses onto a point until the real box arrives. isUsableBox() lets the renderer keep its
//      last good geometry across such a measurement instead of collapsing to it.
//
//   2. A DEGENERATE / NON-FINITE BOUND. `worldScale = fitPx / radius`: a NaN/Infinity coordinate
//      (stale localStorage cache, a not-yet-laid-out node, a diverged force tick) poisons the radius,
//      makes worldScale NaN, and blanks or explodes the whole cloud. finiteVec3/boundingRadius/
//      fitScale keep every step finite and the scale positive, so one bad coordinate can never take
//      the layout down.
//
// Kept framework-free (no Solid, no canvas) so it's unit-tested in isolation (graphFit.test.ts).

/** A host box is only usable for fitting once BOTH dimensions clear this many px. Real panes are
 *  always far larger; this floor only rejects the 0/1px measurements taken mid-layout. */
export const MIN_USABLE_BOX_PX = 4;

/** True when a measured host box is large + finite enough to fit the graph to. A box that fails this
 *  should be ignored (keep the last good geometry) rather than fitted to — fitting to a ~0px box
 *  collapses every node onto a point. */
export function isUsableBox(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= MIN_USABLE_BOX_PX &&
    height >= MIN_USABLE_BOX_PX
  );
}

/** Replace a non-finite number (NaN/±Infinity) with `fallback`. The single choke point that keeps a
 *  bad coordinate from propagating into bounds/scale math. */
export function finiteOr(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Sanitize a raw layout coordinate into a finite [x,y,z] triple. Missing entries (a node that only
 *  carries `position2d`, or vice versa) fall back per-axis; non-finite entries are scrubbed. */
export function finiteVec3(
  p: readonly number[] | undefined,
  fallback: readonly [number, number, number] = [0, 0, 0],
): [number, number, number] {
  if (!p) return [fallback[0], fallback[1], fallback[2]];
  return [
    finiteOr(p[0], fallback[0]),
    finiteOr(p[1], fallback[1]),
    finiteOr(p.length > 2 ? p[2] : fallback[2], fallback[2]),
  ];
}

/** Largest finite distance-from-origin over a set of points, floored at `floor`. An empty cloud, a
 *  single point at the origin, or one with only degenerate coordinates yields exactly `floor` — so
 *  the fit scale can never divide by zero (explode) nor chase a NaN. Non-finite coordinates are
 *  ignored, never propagated into the max. */
export function boundingRadius(points: Iterable<readonly number[]>, floor = 1): number {
  let r = floor;
  for (const p of points) {
    const x = finiteOr(p[0]);
    const y = finiteOr(p[1]);
    const z = finiteOr(p.length > 2 ? p[2] : 0);
    const d = Math.hypot(x, y, z);
    if (d > r) r = d; // d is finite by construction (all operands scrubbed)
  }
  return r;
}

/** World-units -> screen-px fit scale, guaranteed finite + positive. A degenerate radius or fitPx
 *  (0 / NaN / Infinity) yields 1 instead of a NaN/Infinity worldScale that would blank or explode
 *  the graph. Mirrors the renderer's `fitPx / max(1, radius)` with the non-finite cases pinned. */
export function fitScale(fitPx: number, radius: number): number {
  const f = finiteOr(fitPx, 1);
  const r = Math.max(1, finiteOr(radius, 1));
  const s = f / r;
  return Number.isFinite(s) && s > 0 ? s : 1;
}
