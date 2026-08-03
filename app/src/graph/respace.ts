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
// don't drift). `scaleToSpacing` instead MEASURES the input
// cloud's own current typical spacing (median nearest-neighbour distance) and solves for the single
// uniform scale that makes it hit `targetSpacing` exactly, regardless of node count or which layout
// algorithm produced the input. This is legitimate because it is a RESCALE and nothing else: THE LAW
// this project holds through the whole renderer merge is that "the layout may not lie" — a transform
// may change how far apart things are, never how they are ORDERED. Center-on-centroid-then-scale is
// the one transform that provably cannot reorder anything (translation doesn't touch pairwise
// distances at all; multiplying every distance by the same positive scalar can't flip which of two
// distances is smaller) — see respace.test.ts's neighbour-rank test, which is that guarantee's guard.
//
// Deliberately NOT ported here:
//
//  - The "self" node pin-at-origin + golden-angle nudge for coincident points
//    (CanvasGraphRenderer.ts:256-296). Those are a caller/identity concern — which point IS "you",
//    and re-associating output positions back to node ids — and this module works over bare position
//    arrays with no notion of node identity or kind. A caller wanting that behaviour applies it
//    around this call (exclude "you" before calling, re-insert it at the origin after; the centroid
//    this module recenters onto already lands "you" at the origin exactly as before, since "you" was
//    excluded from the ORIGINAL centroid too).
//  - `settlePositions`'s own guard, `if (n < 2 || this.hasIntentionalLayout()) return;`
//    (CanvasGraphRenderer.ts:652) — skip respacing ENTIRELY for graphs that "arrive pre-laid-out"
//    (agents/daemon graphs, keyed off `node.kind`). Like the self-pin, this is a node-KIND decision,
//    and this module never sees `kind` — it only sees bare coordinates. The `n < 2` half is ported
//    (see `scaleToSpacing`'s early return below); the `hasIntentionalLayout()` half is entirely a
//    caller-side routing decision: don't call `scaleToSpacing` at all for a graph you know arrived
//    pre-laid-out. A caller that ignores this and calls it anyway gets a real (if unwanted) rescale,
//    not a crash — this module has no way to detect "pre-laid-out" from coordinates alone.

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
 *
 * One cliff worth knowing about, because it has no equivalent in Canvas's formula-based version: once
 * MORE THAN HALF the cloud coincides at a single point — ANYWHERE, not necessarily the centroid; all
 * that matters is that a strict majority of points share one location (real inputs: a just-created
 * vault where many notes never got laid out, or a batch of nodes the backend punted to the same spot)
 * — the MEDIAN nearest-neighbour distance itself hits ~0, not because the cloud has no spacing
 * anywhere, but because "typical" (the median) is dominated by the coincident majority. Note the
 * threshold is a STRICT majority, not "half or more": at exactly half (e.g. 250 of 500 coincident),
 * the two middle-ranked distances the even-length median averages straddle the coincident/well-spaced
 * boundary, so the median still comes out as a real, nonzero number (verified: 249/500 -> no cliff,
 * 250/500 -> no cliff, 251/500 -> cliff, at that exact boundary). `scale` then falls back to 1 (a
 * silent no-op: `targetSpacing` was requested but never applied) rather than exploding: the only
 * alternative would be to divide by ~0 and blow the well-spaced minority out to Infinity, which is
 * worse. This is a real, cheap-to-hit cliff a caller might want to know about, so — unlike every other
 * guard above, which are all silent by design — this one specific case logs a `console.warn` (never
 * throws, never changes the still-correct `scale=1` output), THROTTLED to once per PROCESS (not once
 * per call — an uncached caller hitting this every frame on a genuinely degenerate graph would
 * otherwise flood the console at frame rate; see `resetSpacingWarningForTests`) so it doesn't fail
 * silently forever without also becoming its own new kind of noise. See
 * `medianNearestNeighborDistance`'s own doc for why the median (not min/mean) is what's being measured
 * here.
 */
let warnedDegenerateSpacingOnce = false;

/** Test-only escape hatch: `scaleToSpacing`'s degenerate-majority warning (see its doc) fires at most
 *  once per process, so a test suite exercising it more than once needs to reset the flag between
 *  cases. Not meant for production callers. */
export function resetSpacingWarningForTests(): void {
  warnedDegenerateSpacingOnce = false;
}

export function scaleToSpacing(positions: readonly Vec3[], targetSpacing: number): Vec3[] {
  const n = positions.length;
  if (n === 0) return [];

  let cx = 0, cy = 0, cz = 0;
  for (const p of positions) { cx += finite(p[0]); cy += finite(p[1]); cz += finite(p[2]); }
  cx /= n; cy /= n; cz /= n;

  const current = medianNearestNeighborDistance(positions);
  const target = finite(targetSpacing, 0);
  // n < 2 is a DIFFERENT, unsurprising degenerate case (nothing to measure at all, not "the cloud is
  // coincident") — already covered by its own doc note above, so it's excluded here to keep this
  // warning specifically about the majority-coincidence cliff.
  const degenerate = n >= 2 && target > 0 && current <= EPS;
  if (degenerate && !warnedDegenerateSpacingOnce) {
    warnedDegenerateSpacingOnce = true;
    console.warn(
      `respace: scaleToSpacing — ${n} points, requested targetSpacing=${target}, but the median ` +
      "nearest-neighbour distance is ~0 (a majority of the cloud coincides at a single point); " +
      "rescale skipped (scale=1). Further occurrences are suppressed for this process.",
    );
  }
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
//
// NEVER ALIASED, in either direction: `getOrCompute` clones via the caller-supplied `clone` on the
// way INTO the cache (before `cache.set`, on a miss) as well as on the way OUT (on every return, hit
// or miss alike) — so the Map's own stored value is never the same reference as anything a caller of
// `compute` retains, AND never the same reference as anything a caller of `getOrCompute` gets back.
// Ported from Canvas's OWN cache-hit path (`:654`, `for (const nv of this.nodes) { const p =
// hit.get(nv.node.id); if (p) nv.p3 = [p[0], p[1], p[2]]; }`) — it never aliased a live node's
// position onto the cached one either. An earlier cut of this memo cloned only on the way out, which
// closes the "caller mutates what it got back" hole but not the "compute()'s OWN closure still holds
// the array it just returned, and mutates that later" one — a real footgun, not a hypothetical one:
// the 2D<->3D morph a caller runs this under lerps positions IN PLACE every frame. `clone` is
// required, not defaulted, so a caller can't opt into the unsafe version by accident — see
// `cloneVec3Array` below for the ready-made one this module's own primary value type (`Vec3[]`)
// needs. IMPORTANT for any OTHER T: `clone` must not be an identity function (`(v) => v`) for a
// reference type — that silently reinstates the exact hazard this cache exists to prevent, with no
// type-level signal that anything is wrong. Identity is only safe for primitives (see this module's
// own tests, which use `(n: number) => n` for a `SpacingCache<number>`). A caller wrapping Canvas's
// old `Map<string, Vec3>` per-view shape as `T` has no ready-made clone here — bring your own (a
// fresh `Map` of freshly-cloned `Vec3` entries, not `(m) => m`).

export interface SpacingCache<T> {
  /** Returns an INDEPENDENT copy (via `clone`, see `createSpacingCache`) of the value for `sig`,
   *  computing (and storing) it via `compute` on a miss. Never calls `compute` on a hit — the whole
   *  point is to skip the O(n²) recompute. Safe to mutate whatever comes back; the cache's own copy
   *  is never exposed. */
  getOrCompute(sig: string, compute: () => T): T;
}

/** Default cap ported from Canvas's `cache.size > 8`: small on purpose — this cache exists only to
 *  make re-visiting a handful of recently-seen graph modes (2nd/3rd/both/agents/daemon) free, not as
 *  a general-purpose store. */
export const SPACING_CACHE_MAX_ENTRIES = 8;

/** `clone` for a `SpacingCache<Vec3[]>` — a fresh outer array of fresh inner tuples. This is the
 *  clone this module's own values (`scaleToSpacing`'s return) need; a cache over some other T brings
 *  its own. */
export function cloneVec3Array(v: readonly Vec3[]): Vec3[] {
  return v.map((p): Vec3 => [p[0], p[1], p[2]]);
}

/**
 * A tiny FIFO-capped memo keyed by an opaque signature string. On overflow, evicts the OLDEST
 * inserted entry (`Map` iteration order is insertion order) — the same eviction Canvas used, not a
 * true LRU: a re-hit does not move an entry to the back of the queue. `clone` runs BOTH when a fresh
 * `compute()` result is stored (so the cache is never aliased to whatever the caller of `compute`
 * keeps) AND on every return (hit and miss alike, so whatever you get back from `getOrCompute` is
 * always yours to mutate, never the cache's own copy) — see the header block above for why both
 * directions matter.
 */
export function createSpacingCache<T>(
  clone: (value: T) => T,
  maxEntries = SPACING_CACHE_MAX_ENTRIES,
): SpacingCache<T> {
  const cache = new Map<string, T>();
  return {
    getOrCompute(sig, compute) {
      if (!cache.has(sig)) {
        // Clone BEFORE storing, not just on the way out: `compute()` may return an array its own
        // caller/closure also retains a reference to (a real case, not hypothetical — see task-6
        // review round 2). Storing that reference directly would let a later external mutation of
        // the ORIGINAL corrupt the cache even though nothing ever mutated what `getOrCompute` itself
        // handed back. Store our own copy so the cache is never aliased to anything outside it.
        cache.set(sig, clone(compute()));
        if (cache.size > maxEntries) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
      }
      return clone(cache.get(sig) as T); // and clone AGAIN on the way out — see the header block above
    },
  };
}
