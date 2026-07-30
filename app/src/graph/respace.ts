// app/src/graph/respace.ts
//
// NODE-COUNT-INDEPENDENT SPACING — the pure half of what CanvasGraphRenderer.ts called
// `scaleToSpacing` (`:250-301`) plus its `p3Cache`/`p2Cache` signature-keyed memo (`:649-686`).
//
// THE PROBLEM: the backend's settled layout (PivotMDS + 120 force ticks, core/src/layout.ts) packs
// tighter as the node count grows — its own `smallBoost` term shrinks with n so a 2000-node vault
// doesn't sprawl past the fit box. A renderer that wants a CONSTANT, node-count-independent resting
// spacing (not the backend's own graded one) used to get it by re-running its own client force
// settle on top of the backend coordinates — ~1.2s at 2k nodes, the slow part of every mode switch.
// Canvas replaced that settle with a single O(n) uniform rescale: the backend layout is already
// fully relaxed, so the SHAPE is right and only the SCALE is off — a shape that's already right
// needs no physics to fix its scale.
//
// THIS MODULE decouples from the backend's packing model rather than mirroring its constants the
// way CanvasGraphRenderer did (its version hard-coded `BACKEND_SMALL_BOOST`/`LINK_SPREAD`, a copy of
// core/src/layout.ts's own tuning that only stays correct as long as the two files' magic numbers
// don't drift — see MERGE-NOTES.md §5, line 138). `scaleToSpacing` instead MEASURES the input
// cloud's own current typical spacing (median nearest-neighbour distance) and solves for the single
// uniform scale that makes it hit `targetSpacing` exactly, regardless of node count or which layout
// algorithm produced the input. This is legitimate because it is a RESCALE and nothing else: THE LAW
// this project holds through the whole renderer merge is that "the layout may not lie" — a transform
// may change how far apart things are, never how they are ORDERED. Center-on-centroid-then-scale is
// the one transform that provably cannot reorder anything (translation doesn't touch pairwise
// distances at all; multiplying every distance by the same positive scalar can't flip which of two
// distances is smaller) — see respace.test.ts's neighbour-rank test, which is that guarantee's guard.
//
// Deliberately NOT ported here: the "self" node pin-at-origin + golden-angle nudge for coincident
// points (CanvasGraphRenderer.ts:256-296). Those are a caller/identity concern — which point IS
// "you", and re-associating output positions back to node ids — and this module works over bare
// position arrays with no notion of node identity or kind. A caller wanting that behaviour applies
// it around this call (exclude "you" before calling, re-insert it at the origin after; the centroid
// this module recenters onto already lands "you" at the origin exactly as before, since "you" was
// excluded from the ORIGINAL centroid too).

/** A 3D point. 2D callers pass z=0 for every point — the distance math naturally degenerates to 2D
 *  when every input shares the same z, so this module never needs a separate 2D/3D mode (matching
 *  how CanvasGraphRenderer's own `NodeView.p2` was already "Vec3, z=0", not a distinct 2-tuple type). */
export type Vec3 = readonly [number, number, number];

const EPS = 1e-9;

function finite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

/** The distance from point `i` to its nearest OTHER point. O(n) per call — see
 *  `medianNearestNeighborDistance` for the O(n²)-total budget this is spent inside. */
function nearestDistance(positions: readonly Vec3[], i: number): number {
  const [xi, yi, zi] = positions[i];
  let best = Infinity;
  for (let j = 0; j < positions.length; j++) {
    if (j === i) continue;
    const [xj, yj, zj] = positions[j];
    const d = Math.hypot(finite(xi) - finite(xj), finite(yi) - finite(yj), finite(zi) - finite(zj));
    if (d < best) best = d;
  }
  return best;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Typical spacing of a point cloud: the MEDIAN of each point's nearest-neighbour distance. Median,
 * not mean, so a few outliers (a note with no close neighbours at all) don't drag the "typical"
 * figure away from where most of the cloud actually sits. Fewer than 2 points have no spacing to
 * measure and yield 0. O(n²) — fine at the scale this runs (once per structural signature, not per
 * frame; see `createSpacingCache`).
 */
export function medianNearestNeighborDistance(positions: readonly Vec3[]): number {
  if (positions.length < 2) return 0;
  const d: number[] = new Array(positions.length);
  for (let i = 0; i < positions.length; i++) d[i] = nearestDistance(positions, i);
  return median(d);
}

/**
 * Rescale a settled point cloud to a target typical spacing, in O(n²) (measuring the median
 * nearest-neighbour distance) + O(n) (applying the rescale) — no force simulation. Centers the cloud
 * on its own centroid (translated to the origin) and multiplies every point's offset from it by the
 * single scalar that makes the cloud's median nearest-neighbour distance equal `targetSpacing`. See
 * the module header for why this counts as a "pure rescale" under this project's "layout may not
 * lie" rule.
 *
 * Degenerate inputs never divide by zero or produce NaN/Infinity: fewer than 2 points, a fully
 * coincident cloud (no spacing to measure), or a non-positive/non-finite `targetSpacing` all fall
 * back to `scale=1` (a straight recenter, no rescale) rather than propagating garbage. Non-finite
 * input coordinates are scrubbed to 0 the same way graphFit.ts's `finiteOr` does. Never mutates
 * `positions` — always returns a fresh array, even when `scale` ends up 1.
 */
export function scaleToSpacing(positions: readonly Vec3[], targetSpacing: number): Vec3[] {
  const n = positions.length;
  if (n === 0) return [];

  let cx = 0, cy = 0, cz = 0;
  for (const p of positions) { cx += finite(p[0]); cy += finite(p[1]); cz += finite(p[2]); }
  cx /= n; cy /= n; cz /= n;

  const current = medianNearestNeighborDistance(positions);
  const target = finite(targetSpacing, 0);
  const scale = current > EPS && target > 0 ? target / current : 1;

  return positions.map((p): Vec3 => [
    (finite(p[0]) - cx) * scale,
    (finite(p[1]) - cy) * scale,
    (finite(p[2]) - cz) * scale,
  ]);
}

// ---- signature-keyed memo ----------------------------------------------------------------------
//
// Ports CanvasGraphRenderer's `p3Cache`/`p2Cache` + `cachePut`: re-visiting an already-seen graph
// shape (a mode toggle back to one already settled this session) becomes a Map lookup instead of
// paying the O(n²) measure again. Genericized over the cached value — the two Canvas caches each
// held a `Map<string, Vec3>` keyed by node id (this module has no id concept, so a caller with ids
// wraps that shape as T) — and keyed on an OPAQUE signature string the caller computes however it
// likes (`structuralGraphSig` in Canvas/Ascii). This module deliberately doesn't know or reach for
// that machinery — see task-6-brief.md's ambiguity note.

export interface SpacingCache<T> {
  /** Returns the cached value for `sig`, computing (and storing) it via `compute` on a miss. Never
   *  calls `compute` on a hit — the whole point is to skip the O(n²) recompute. */
  getOrCompute(sig: string, compute: () => T): T;
}

/** Default cap ported from Canvas's `cache.size > 8`: small on purpose — this cache exists only to
 *  make re-visiting a handful of recently-seen graph modes (2nd/3rd/both/agents/daemon) free, not as
 *  a general-purpose store. */
export const SPACING_CACHE_MAX_ENTRIES = 8;

/**
 * A tiny FIFO-capped memo keyed by an opaque signature string. On overflow, evicts the OLDEST
 * inserted entry (`Map` iteration order is insertion order) — the same eviction Canvas used, not a
 * true LRU: a re-hit does not move an entry to the back of the queue.
 */
export function createSpacingCache<T>(maxEntries = SPACING_CACHE_MAX_ENTRIES): SpacingCache<T> {
  const cache = new Map<string, T>();
  return {
    getOrCompute(sig, compute) {
      if (cache.has(sig)) return cache.get(sig) as T;
      const value = compute();
      cache.set(sig, value);
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return value;
    },
  };
}
