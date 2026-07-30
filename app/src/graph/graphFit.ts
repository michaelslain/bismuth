// app/src/graph/graphFit.ts
//
// Pure guards for the graph's fit math. The renderer scales the backend layout to the host box
// every time the box or the node set changes. THE FIT LAW (2D): 100% zoom fills each axis of the
// field to `FIT_FILL_FRACTION` of the graph's own bounding-BOX half-extents (`boundingHalfExtents`
// + `fitScaleForBox`) — not a single circumscribing radius. A radius over-reads a rectangular node
// cloud by up to sqrt(2) (the diagonal vs. the box), and considering only the shorter screen axis
// (the old `fitPxPerWorld` fraction-of-min(cols*cellW, rows*cellH) law) wastes the rest of a
// non-square field — together those two effects left the cloud occupying only ~35-40% of the
// canvas at "100%". 3D keeps the original radius-based `fitPxPerWorld` fit: an orbiting camera has
// no fixed "box" to fill, only a distance to keep in frame. Two transient states used to make the
// spacing "go weird until it settles" (card #97):
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

/** Max |x| and max |y| over a point cloud, each floored at `floor` (same non-finite-scrubbing
 *  discipline as `boundingRadius` — a NaN/Infinity coordinate is ignored, never propagated into the
 *  result). Unlike `boundingRadius`'s circumscribing radius (the largest hypot), this is the
 *  axis-aligned HALF-EXTENT of the cloud's bounding BOX — the tighter, two-axis bound a rectangular
 *  grid actually wants to fill (see the module header's fit law). */
export function boundingHalfExtents(
  points: Iterable<readonly number[]>,
  floor = 1,
): { hx: number; hy: number } {
  let hx = floor, hy = floor;
  for (const p of points) {
    const x = Math.abs(finiteOr(p[0]));
    const y = Math.abs(finiteOr(p[1]));
    if (x > hx) hx = x;
    if (y > hy) hy = y;
  }
  return { hx, hy };
}

/** The fraction of each screen axis the graph's bounding box fills at 100% (fit) zoom — see
 *  `fitScaleForBox`. Deliberately short of 1: a small margin keeps rim nodes/labels off the very
 *  edge of the field. */
export const FIT_FILL_FRACTION = 0.92;

/** World-units -> screen-px fit scale for a RECTANGULAR field, derived from the cloud's own
 *  bounding-box half-extents (`hx`/`hy`, see `boundingHalfExtents`) rather than a single
 *  circumscribing radius: each screen axis is scaled independently against its own half of the box
 *  (`boxW/2`, `boxH/2`) at `fill` occupancy, and the SMALLER of the two resulting ratios wins so
 *  neither axis overflows — the binding axis lands at exactly `fill`, the other at less than or
 *  equal to it. Guaranteed finite and > 0: degenerate inputs (a zero/negative/non-finite box,
 *  extent, or fill) fall back to 1, the same guard discipline as `fitScale`. */
export function fitScaleForBox(
  boxW: number, boxH: number, hx: number, hy: number, fill: number = FIT_FILL_FRACTION,
): number {
  const w = finiteOr(boxW, 1);
  const h = finiteOr(boxH, 1);
  const ex = Math.max(1e-6, finiteOr(hx, 1));
  const ey = Math.max(1e-6, finiteOr(hy, 1));
  const f = Number.isFinite(fill) && fill > 0 ? fill : 1;
  const sx = (w * f) / 2 / ex;
  const sy = (h * f) / 2 / ey;
  const s = Math.min(sx, sy);
  return Number.isFinite(s) && s > 0 ? s : 1;
}
