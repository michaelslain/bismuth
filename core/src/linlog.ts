// LinLog-mode attraction (ForceAtlas2's ln(1+d) approximation, Jacomy et al. — not strict Noack
// LinLog, which is fully distance-independent): the pull between linked nodes grows with ln(1 + d)
// rather than with d.
//
// WHY THIS AND NOT forceLink: d3's link force is a Hooke spring — attraction proportional to
// (d - restLength). Proportional attraction is what collapses communities into a hairball, because
// the further apart two clusters drift the harder they are yanked back together. LinLog's pull
// grows only logarithmically with distance, letting dense regions stay dense while sparse regions
// spread, so cluster separation is a PROPERTY OF THE MODEL rather than something a corrective force
// imposes.
//
// The `1 +` keeps attraction positive below d=1 (ln(d) alone goes negative and would repel for
// d < 1); the actual d → 0 / NaN guard is the `if (d === 0) continue` below.
//
// (Task 4 briefly parameterized the ln(1+d) magnitude function via an `attraction` option, to build
// a linear/Hooke-shaped CONTROL arm meant to isolate the force law from the other two things this
// module changes vs. d3's forceLink — no per-node degree division of the correction, raw rather than
// velocity-predicted positions. That arm diverged on the reference vault's hub topology in both
// variants tried and was never shipped; the option was removed with it — see layout.ts's git history
// for Task 4/5 — rather than left as an untested hook with no caller.)

// `index` is optional and, like the other fields, never read by this module — it's only here so a
// plain d3 SimNode-shaped type (e.g. layout.ts's `RN`, whose `index` comes from an untyped index
// signature rather than an explicit field) satisfies this constraint structurally.
interface LinLogNode {
    index?: number
    x?: number
    y?: number
    z?: number
    vx?: number
    vy?: number
    vz?: number
}

export interface LinLogOptions<N, L> {
    /** Resolve a node's link id (mirrors d3's forceLink .id()). */
    id: (n: N) => string
    /** Per-link multiplier on the attraction magnitude. */
    strength: (l: L) => number
    dim: 2 | 3
}

export interface LinLogForce<N> {
    (alpha: number): void
    initialize(nodes: N[]): void
}

export function linLogLinkForce<
    N extends LinLogNode,
    L extends { source: string; target: string },
>(links: L[], opts: LinLogOptions<N, L>): LinLogForce<N> {
    let nodes: N[] = []
    let pairs: { a: number; b: number; s: number }[] = []

    const force = ((alpha: number) => {
        for (const { a, b, s } of pairs) {
            const na = nodes[a],
                nb = nodes[b]
            const dx = (nb.x ?? 0) - (na.x ?? 0)
            const dy = (nb.y ?? 0) - (na.y ?? 0)
            const dz = opts.dim === 3 ? (nb.z ?? 0) - (na.z ?? 0) : 0
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (d === 0) continue // coincident: no direction, no force
            // magnitude ~ ln(1 + d), applied along the unit vector between the pair.
            const mag = (s * Math.log1p(d) * alpha) / d // /d folds in the normalisation
            na.vx = (na.vx ?? 0) + dx * mag
            na.vy = (na.vy ?? 0) + dy * mag
            nb.vx = (nb.vx ?? 0) - dx * mag
            nb.vy = (nb.vy ?? 0) - dy * mag
            if (opts.dim === 3) {
                na.vz = (na.vz ?? 0) + dz * mag
                nb.vz = (nb.vz ?? 0) - dz * mag
            }
        }
    }) as LinLogForce<N>

    force.initialize = (ns: N[]) => {
        nodes = ns
        const byId = new Map<string, number>()
        ns.forEach((n, i) => byId.set(opts.id(n), i))
        pairs = []
        for (const l of links) {
            const a = byId.get(l.source),
                b = byId.get(l.target)
            if (a === undefined || b === undefined || a === b) continue
            pairs.push({ a, b, s: opts.strength(l) })
        }
    }

    return force
}
