// Compose per-brain layouts (vault / memory / daemon) into one coordinate space.
//
// The honesty rule: positions are emergent WITHIN a brain; brains are PLACED. Placement between
// brains is legitimate because they are separate graphs joined by sparse `about` edges — a world
// map places countries, but cities sit where they actually are.
//
// Orientation uses only ROTATION and REFLECTION, which are isometries: every internal distance is
// preserved exactly. Without it, cross-brain edges connect arbitrary points and read as spaghetti
// rather than as a band.
import type { Positions } from "./layout";

/** Replace a non-finite number (NaN/±Infinity) with `fallback`. The single choke point that keeps
 *  one bad coordinate (a stale cache, a not-yet-settled layout, a diverged force tick) from
 *  poisoning the centroid/radius/orientation math for its own brain — or, via `composeBrains`'s
 *  running cursor, EVERY brain placed after it. Mirrors `app/src/graph/graphFit.ts`'s `finiteOr`,
 *  which exists for the identical reason on the render side. */
function finiteOr(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

const centroid = (pos: Positions, ids: string[]): [number, number] => {
  let x = 0, y = 0, n = 0;
  for (const id of ids) {
    const p = pos[id];
    if (!p) continue;
    x += finiteOr(p[0]);
    y += finiteOr(p[1]);
    n++;
  }
  return n === 0 ? [0, 0] : [x / n, y / n];
};

/** Distance from the centroid to the furthest member. */
export function boundingRadius(pos: Positions, ids: string[]): number {
  const [cx, cy] = centroid(pos, ids);
  let r = 0;
  for (const id of ids) {
    const p = pos[id];
    if (!p) continue;
    const d = Math.hypot(finiteOr(p[0]) - cx, finiteOr(p[1]) - cy);
    if (d > r) r = d;
  }
  return r;
}

/** Rotate an (already centroid-relative) offset by `angle`, optionally reflecting across X first.
 *  The one place `Math.sin`/`Math.cos` are combined into a rotation — shared by `applyOrientation`
 *  (transforms a whole brain, called once per orientation decision) and `bestOrientation`'s search
 *  loop (transforms only the handful of cross-linked points, many times), so there is exactly one
 *  formula to get right and both call sites move in lockstep if it ever changes. */
function rotateOffset(dx: number, dy: number, cos: number, sin: number, flip: boolean): [number, number] {
  const fy = (flip ? -1 : 1) * dy;
  return [dx * cos - fy * sin, dx * sin + fy * cos];
}

/**
 * Rotate about the brain's OWN centroid by `angle`, optionally reflecting across the X axis first.
 * Z is untouched.
 *
 * Deliberately about the centroid, not the origin: rotating about a point that is itself a
 * function of the rotation (e.g. the origin, when the centroid isn't already there) mixes a
 * Q-dependent TRANSLATION into what should be a pure orientation search — `bestOrientation`
 * minimises cost against fixed partner points, so that stray translation term changes the
 * argmin as a function of the rotation, not just the achievable minimum. Rotating about the
 * centroid holds the brain's anchor fixed and isolates "which way does it face" from "where does
 * it end up", which is the only question `bestOrientation` is supposed to be answering — final
 * placement is `composeBrains`'s job, done separately, after orientation is decided.
 */
export function applyOrientation(pos: Positions, ids: string[], angle: number, flip: boolean): Positions {
  const [cx, cy] = centroid(pos, ids);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const out: Positions = { ...pos };
  for (const id of ids) {
    const p = pos[id];
    if (!p) continue;
    const dx = finiteOr(p[0]) - cx;
    const dy = finiteOr(p[1]) - cy;
    const [rx, ry] = rotateOffset(dx, dy, cos, sin, flip);
    out[id] = [cx + rx, cy + ry, finiteOr(p[2])];
  }
  return out;
}

/**
 * Search rotations (and both reflections) for the orientation minimising total distance from this
 * brain's cross-linked nodes to their partners' positions. Brute force: `steps` rotations x 2
 * reflections, each transforming only the cross-linked points (not the whole brain) — O(steps *
 * links), not O(steps * brainSize). The centroid is computed once and held fixed for the whole
 * search (see `applyOrientation`'s doc for why centroid, not origin). On a 2246-node brain with 8
 * cross-links this is ~5.8K point-transforms instead of ~1.6M from naively re-deriving the whole
 * brain (via `applyOrientation`) on every candidate angle — this sits on the graph-rebuild path.
 */
export function bestOrientation(
  pos: Positions,
  ownIds: string[],
  links: { own: string; otherX: number; otherY: number }[],
  steps = 360,
): { angle: number; flip: boolean } {
  if (links.length === 0) return { angle: 0, flip: false };
  const [cx, cy] = centroid(pos, ownIds);
  const offsets = links
    .map((link) => {
      const p = pos[link.own];
      if (!p) return null;
      return { link, dx: finiteOr(p[0]) - cx, dy: finiteOr(p[1]) - cy };
    })
    .filter((o): o is { link: (typeof links)[number]; dx: number; dy: number } => o !== null);
  let best = { angle: 0, flip: false }, bestCost = Infinity;
  for (const flip of [false, true]) {
    for (let s = 0; s < steps; s++) {
      const angle = (s / steps) * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      let cost = 0;
      for (const { link, dx, dy } of offsets) {
        const [rx, ry] = rotateOffset(dx, dy, cos, sin, flip);
        cost += Math.hypot(cx + rx - link.otherX, cy + ry - link.otherY);
      }
      if (cost < bestCost) { bestCost = cost; best = { angle, flip }; }
    }
  }
  return best;
}

/**
 * Place brains left-to-right, each offset so their bounding circles clear by a gap derived from
 * their own radii. Territories keep their honest size — a five-node daemon looks small — but the
 * gap is clamped so it is neither overlapping nor screens away.
 *
 * The first brain is the anchor: left untouched (shift 0) — it defines both the horizontal origin
 * and the vertical band every other brain lines up on. Every later brain is translated (X to clear
 * the running edge by `gap`, Y to bring its own centroid onto the anchor's centroid Y) — both pure
 * translations, themselves isometries, so nothing internal to a brain is reshaped. Aligning Y is
 * NOT the same move as leaving it alone: without it, brains whose emergent layouts happen to sit
 * at different heights read as a diagonal staircase instead of a row of neighbouring territories —
 * translating a territory to sit level with its neighbour costs it nothing, same as sliding it
 * along X to clear the gap.
 */
export function composeBrains(
  brains: { ids: string[]; pos: Positions }[],
  opts: { gapMult?: number; minGap?: number; maxGap?: number } = {},
): Positions {
  const gapMult = opts.gapMult ?? 0.5;
  const minGap = opts.minGap ?? 40;
  const maxGap = opts.maxGap ?? 600;
  const out: Positions = {};
  let rightEdge = 0;
  let prevR = 0;
  let anchorCy = 0;
  brains.forEach((brain, i) => {
    const r = boundingRadius(brain.pos, brain.ids);
    const [cx, cy] = centroid(brain.pos, brain.ids);
    let shiftX = 0, shiftY = 0;
    if (i === 0) {
      anchorCy = cy;
    } else {
      const gap = Math.min(maxGap, Math.max(minGap, gapMult * (prevR + r)));
      const targetCx = rightEdge + gap + r;
      shiftX = targetCx - cx;
      shiftY = anchorCy - cy;
    }
    for (const id of brain.ids) {
      const p = brain.pos[id];
      if (!p) continue;
      out[id] = [finiteOr(p[0]) + shiftX, finiteOr(p[1]) + shiftY, finiteOr(p[2])];
    }
    rightEdge = cx + shiftX + r;
    prevR = r;
  });
  return out;
}
