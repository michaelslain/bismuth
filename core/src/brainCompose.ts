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

const centroid = (pos: Positions, ids: string[]): [number, number] => {
  let x = 0, y = 0, n = 0;
  for (const id of ids) { const p = pos[id]; if (!p) continue; x += p[0]; y += p[1]; n++; }
  return n === 0 ? [0, 0] : [x / n, y / n];
};

/** Distance from the centroid to the furthest member. */
export function boundingRadius(pos: Positions, ids: string[]): number {
  const [cx, cy] = centroid(pos, ids);
  let r = 0;
  for (const id of ids) {
    const p = pos[id];
    if (!p) continue;
    r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy));
  }
  return r;
}

/**
 * Rotate about the origin by `angle`, optionally reflecting across the X axis first. Z is
 * untouched.
 *
 * Deliberately about the origin, not the brain's own centroid: rotation about ANY fixed point is
 * still an isometry (it preserves every pairwise distance — see the isometry test), and
 * `composeBrains` re-centers each brain from its (post-rotation) centroid when it places brains
 * side by side, so the choice of rotation center has no effect on the final composed layout. What
 * it DOES affect is `bestOrientation`'s search: a brain rotated about its own centroid can only
 * ever swing a given node through a circle of that node's own radius-from-centroid, which can
 * under-reach a distant neighbour if the centroid itself sits far from that node. Rotating about
 * the origin gives the search the full swing of the node's own distance from the origin instead.
 */
export function applyOrientation(pos: Positions, ids: string[], angle: number, flip: boolean): Positions {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const out: Positions = { ...pos };
  for (const id of ids) {
    const p = pos[id];
    if (!p) continue;
    const dx = p[0];
    const dy = (flip ? -1 : 1) * p[1];
    out[id] = [dx * cos - dy * sin, dx * sin + dy * cos, p[2]];
  }
  return out;
}

/**
 * Search rotations (and both reflections) for the orientation minimising total distance from this
 * brain's cross-linked nodes to their partners' positions. Brute force: `steps` rotations x 2, each
 * linear in the cross-link count — cheap, and deterministic.
 */
export function bestOrientation(
  pos: Positions,
  ownIds: string[],
  links: { own: string; otherX: number; otherY: number }[],
  steps = 360,
): { angle: number; flip: boolean } {
  if (links.length === 0) return { angle: 0, flip: false };
  let best = { angle: 0, flip: false }, bestCost = Infinity;
  for (const flip of [false, true]) {
    for (let s = 0; s < steps; s++) {
      const angle = (s / steps) * Math.PI * 2;
      const moved = applyOrientation(pos, ownIds, angle, flip);
      let cost = 0;
      for (const l of links) {
        const p = moved[l.own];
        if (!p) continue;
        cost += Math.hypot(p[0] - l.otherX, p[1] - l.otherY);
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
 * Only X is ever touched, and only by a uniform per-brain translation (itself an isometry — it
 * changes no internal distance). The first brain is the anchor and is left byte-for-byte alone
 * (shift 0); every later brain's centroid is translated in X to sit `gap` past the previous
 * brain's edge. Y is never recentered — each brain keeps the vertical position its own layout
 * emergently produced, since "placement" between brains is a horizontal arrangement, not a
 * license to re-flatten what was earned within a brain.
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
  brains.forEach((brain, i) => {
    const r = boundingRadius(brain.pos, brain.ids);
    const [cx] = centroid(brain.pos, brain.ids);
    let shift = 0;
    if (i > 0) {
      const gap = Math.min(maxGap, Math.max(minGap, gapMult * (prevR + r)));
      const targetCx = rightEdge + gap + r;
      shift = targetCx - cx;
    }
    for (const id of brain.ids) {
      const p = brain.pos[id];
      if (!p) continue;
      out[id] = [p[0] + shift, p[1], p[2]];
    }
    rightEdge = cx + shift + r;
    prevR = r;
  });
  return out;
}
