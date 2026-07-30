// LinLog attraction (Noack): the pull between linked nodes grows with ln(1 + d) rather than with d.
//
// WHY THIS AND NOT forceLink: d3's link force is a Hooke spring — attraction proportional to
// (d - restLength). Proportional attraction is what collapses communities into a hairball, because
// the further apart two clusters drift the harder they are yanked back together. LinLog's
// near-distance-independent pull lets dense regions stay dense while sparse regions spread, so
// cluster separation is a PROPERTY OF THE MODEL rather than something a corrective force imposes.
//
// The `1 +` guards d → 0 (ln(1) = 0, no force, no NaN when two nodes coincide).

interface LinLogNode { index: number; x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number }

export interface LinLogOptions<N, L> {
  /** Resolve a node's link id (mirrors d3's forceLink .id()). */
  id: (n: N) => string;
  /** Per-link multiplier on the attraction magnitude. */
  strength: (l: L) => number;
  dim: 2 | 3;
}

export interface LinLogForce<N> {
  (alpha: number): void;
  initialize(nodes: N[]): void;
}

export function linLogLinkForce<N extends LinLogNode, L extends { source: string; target: string }>(
  links: L[],
  opts: LinLogOptions<N, L>,
): LinLogForce<N> {
  let nodes: N[] = [];
  let pairs: { a: number; b: number; s: number }[] = [];

  const force = ((alpha: number) => {
    for (const { a, b, s } of pairs) {
      const na = nodes[a], nb = nodes[b];
      const dx = (nb.x ?? 0) - (na.x ?? 0);
      const dy = (nb.y ?? 0) - (na.y ?? 0);
      const dz = opts.dim === 3 ? (nb.z ?? 0) - (na.z ?? 0) : 0;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d === 0) continue;                       // coincident: no direction, no force
      // LinLog: magnitude ~ ln(1 + d), applied along the unit vector between the pair.
      const mag = (s * Math.log1p(d) * alpha) / d; // /d folds in the normalisation
      na.vx = (na.vx ?? 0) + dx * mag;
      na.vy = (na.vy ?? 0) + dy * mag;
      nb.vx = (nb.vx ?? 0) - dx * mag;
      nb.vy = (nb.vy ?? 0) - dy * mag;
      if (opts.dim === 3) {
        na.vz = (na.vz ?? 0) + dz * mag;
        nb.vz = (nb.vz ?? 0) - dz * mag;
      }
    }
  }) as LinLogForce<N>;

  force.initialize = (ns: N[]) => {
    nodes = ns;
    const byId = new Map<string, number>();
    ns.forEach((n, i) => byId.set(opts.id(n), i));
    pairs = [];
    for (const l of links) {
      const a = byId.get(l.source), b = byId.get(l.target);
      if (a === undefined || b === undefined || a === b) continue;
      pairs.push({ a, b, s: opts.strength(l) });
    }
  };

  return force;
}
