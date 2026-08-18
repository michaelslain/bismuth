// app/src/graph/lod.ts
//
// LEVEL-OF-DETAIL for the ASCII knowledge graph (2D): the pure half.
//
// STATUS: LIVE, the shipped default. GraphView.tsx sets GraphConfig.showLodMasses whenever the
// ascii renderer is active outside "local" mode — which is the app's shipped default view — so the
// field rasterizes AGGREGATE ENTITIES + AGGREGATE EDGES at coarse zoom stops (see rasterize()'s
// `showLodMasses` gate) instead of an individual glyph per node. The hierarchy ALSO still reads
// through zoom-driven node COLOR + the cluster-name labels (see AsciiGraphRenderer.ts's
// LEVEL-DRIVEN COLOR block) once the leaf pass takes over near the deep stops. Wired live in commit
// 3842b68 (2026-07-29) — AsciiGraphRenderer.test.ts / lod.test.ts exercise the flag both on and off.
//
// THE IDEA (the summarizing algorithm, when enabled): zoomed out, the field does NOT rasterize
// every note and every link. It renders each community of the ACTIVE HIERARCHY LEVEL as one
// AGGREGATE ENTITY — a compact ASCII mass whose size encodes member count — connected by AGGREGATE
// EDGES that each summarize every real link between two communities' member sets. Stepping the zoom
// ladder in replaces a parent entity with its children (they are physically nested — layout.ts's
// community forces guarantee child centroids sit inside the parent), and only the deepest stops
// rasterize the actual notes and real edges.
//
// LEVEL MAPPING — one source of truth with the label system: the same `resolutionT` progress
// (0 = fit, 1 = deepest) that drives the cluster-name ladder drives the GEOMETRY. The hierarchy
// levels split `[0, FILE_LABEL_REVEAL_T)` evenly (labelSelection.ts `levelBoundaries`), and
// `lodMix()` below returns per-level draw alphas — `clusterLevelAlphas × massAlpha` — so the stop
// where a level's names take over is exactly the stop where its masses take over.
//
// WHICH BAND owns the field overall is NOT this file's decision any more: `backbone.ts`'s
// `bandsForT` splits the ladder into far (masses) / mid (glyphs + hub-to-hub backbone) / near
// (glyphs + real member edges), and `lodMix` reads its `massAlpha` for the mass band's share. Masses
// therefore hand off to individual glyphs around t≈0.32–0.46, well BEFORE file names appear at
// `FILE_LABEL_REVEAL_T` — the mid band is glyphs with a backbone and no file names. See
// backbone.ts's header and its wiring recipe.
//
// Everything here is DOM-free and unit-tested (lod.test.ts); AsciiGraphRenderer owns the buffers,
// projection and the rAF loop, and calls into this for structure (once per graph build) and the
// per-frame alpha mix (once per frame — a ≤4-entry array, not a hot loop).

import { clusterLevelAlphas } from './labelSelection'
import { bandsForT } from './backbone'

/** One aggregate entity: a community at one hierarchy level, positioned at its members' 2D world
 *  centroid. Built once per graph build — per-frame screen state lives on the renderer's view. */
export interface LodCluster {
    level: number
    community: number
    count: number
    /** Members' centroid in the SAME 2D world space the renderer projects (its `p2`). */
    wx: number
    wy: number
    /** Per-axis population STANDARD DEVIATION of the members about that centroid, same world space.
     *  This is how big the thing the mass summarizes actually IS — the mass GLYPH's own radii
     *  (`massRadii`) are a compact ~√count summary and deliberately are not. Task 24b: NO LONGER the
     *  phosphor bloom's primary input — `emitBloom()` (AsciiGraphRenderer.ts) emits `reps` (below) as
     *  real weighted points instead of a synthesized `sdx`/`sdy` ellipse, which is what stops an
     *  aggregate's light landing in an empty gap between real sub-populations (see `reps`' own doc
     *  comment). `sdx`/`sdy` survive as `emitBloom`'s fallback shape for the one case `reps` cannot
     *  cover — a cluster somehow left with an empty `reps` array — so that path still emits a cloud
     *  (via `densityField.ts`'s `pushCloud`) rather than degenerating to a point. Costs one extra
     *  sum-of-squares in the same single pass that already accumulates the centroid. */
    sdx: number
    sdy: number
    memberIds: string[]
    /** Up to `LOD_REP_POINTS_K` world points standing in for this cluster's members, each carrying
     *  an INTEGER `weight` = how many members it represents. Weights across `reps` sum to `count`
     *  EXACTLY (integer arithmetic, not floating-point-close — see lod.test.ts's "weight sum is an
     *  exact integer" case). The member pass above accumulates the raw sums AND each member's own
     *  coordinate (`pts`) in one walk over `nodes`; `representativePoints()` then runs its own
     *  per-cluster 2D k-means on `pts` in the finalization step below, alongside `sdx`/`sdy`'s
     *  `sqrt` — see that function's doc comment for the full algorithm and its history (two prior
     *  versions each fixed a real, measured failure mode; read it before changing this again).
     *
     *  THE CONVERGENCE PROPERTY THAT MAKES THIS RIGHT RATHER THAN MERELY BETTER, PRECISELY SCOPED:
     *  once `count <= LOD_REP_POINTS_K`, `reps` IS the member set — every member becomes its own
     *  representative point at weight 1, unrounded, so the mass→glyph handover this feeds (Task
     *  24b's phosphor bloom) is EXACT in that regime, not an approximation that happens to look
     *  close. Above it (`count > LOD_REP_POINTS_K`), reps are block CENTROIDS — real but averaged —
     *  and the property is weight conservation, not point-level exactness. See lod.test.ts's
     *  "reproduces the members EXACTLY... once k >= the member count" and its `n = k+1` case for the
     *  exact edge where exactness ends.
     *
     *  Consumed by AsciiGraphRenderer's `emitBloom()` (Task 24b, wired there — NOT through
     *  `densityField.ts`'s `pushCloud` any more): each rep becomes its own weighted `BloomPoint`,
     *  pushed directly at its own projected screen position — instead of synthesizing one Gaussian-ish
     *  cloud from `sdx`/`sdy` centred on (`wx`,`wy`), which places density at the CENTROID even when no
     *  member lives anywhere near it (two well-separated blobs summarized by one ellipse invents mass
     *  in the empty gap between them, exactly the failure `pushCloud`'s header measures) — so a
     *  cluster's real clumpiness and diagonal elongation survive the summary instead of being smoothed
     *  into one ellipse. (`pushCloud` still exists and is still exported — `emitBloom` falls back to it,
     *  sized off `sdx`/`sdy`, only for the pathological empty-`reps` case; see that field's own doc
     *  comment.)
     *
     *  MASS-BLIND BY DESIGN — worth knowing before consuming this for "real clumpiness" (Task 24b's
     *  stated goal): farthest-first seeding spreads `reps` to COVER distinct spatial regions, not to
     *  divide member COUNT evenly. Measured (Round-2 review): a 280-member dense core plus 20 lone,
     *  scattered strays can give the core as few as 4 of 24 reps (each standing for ~70 members)
     *  while each stray earns its own rep (standing for 1) — reps.length ends up denser where members
     *  are SPATIALLY spread out, not where there are MORE of them. Weights stay exact regardless (see
     *  above), and this is arguably the more correct placement of mass (a scattered stray needs its
     *  own point to be seen at all; a dense core's shape is still well summarized by few points close
     *  together) — it is also strictly better than v1, which gave that same kind of lone stray a
     *  single point at 12.5× its true weight. Not re-architected for this (a real, density-weighted
     *  k-means variant would be a bigger change than this task's brief calls for) — recorded here so
     *  Task 24b's bloom-weighting code isn't surprised by a rep that stands for 70 members looking the
     *  same size as one that stands for 1. */
    reps: LodRepPoint[]
}

/** One representative world point standing in for `weight` members of a `LodCluster` (same 2D
 *  world space as `wx`/`wy`). See `LodCluster.reps`. */
export interface LodRepPoint {
    x: number
    y: number
    weight: number
}

/**
 * How many representative points (`LodCluster.reps`) a cluster gets, at most — the brief's own
 * 16-32 band; 24 is its midpoint, honestly: this is NOT derived from a "members per point" budget
 * the way `MASS_ROW_K` is tuned against a measured target. (Round-1 review, IMPORTANT-1: an
 * earlier version of this comment claimed exactly that derivation — "16 points gives ~19
 * members/point, coarse enough to lose a 20-member blob; 24 gives ~13, comfortably resolving it" —
 * and it was checked against the shipped v1 algorithm and found FALSE: k=16 gave that 20-member
 * blob ONE rep at weight 18.75 (-6% error) while k=24 gave it ONE rep at weight 12.50 (-38%
 * error) — MORE wrong, not less, because "members per point" was never the governing statistic;
 * a single blob either earns a rep or it doesn't, and how many members that rep is then off by is
 * a different question entirely.)
 *
 * Since Round 1, `representativePoints()` moved from a fixed-stride sample to real 2D k-means, so
 * the governing statistic for the LOWER bound is different again: whether `k` comfortably exceeds
 * the number of genuinely distinct spatial sub-populations (folder-scale sub-communities, in
 * practice) a single coarse-level mass can contain — k-means can dedicate one cluster to each
 * REAL population as long as there are enough clusters to go around, regardless of any one
 * population's size. Checked directly (not asserted): a synthetic 300-member cluster built from
 * 15 folder-runs of wildly uneven size (6 to 40 members, arranged with no dominant axis so a 1D
 * method has nowhere to hide) came back with every folder's true member count exactly at k = 16,
 * 24, AND 32 — so the lower edge of the band already has headroom for that shape; there was no
 * measurement pushing 24 specifically over 16 here.
 *
 * The UPPER bound is unchanged and still real, though Task 24b's actual wiring turned out simpler
 * than this comment originally predicted: each `reps` point becomes its own single `BloomPoint` push
 * in `emitBloom()` (AsciiGraphRenderer.ts) — ONE point per rep, not a per-rep ring-sampled
 * `pushCloud` splat (`densityField.ts`) — so the per-cluster point budget is exactly `reps.length`,
 * not a multiple of it. `lod.test.ts`'s own upper-bound check here is still only a LITERAL range (see
 * that test's comment for why it cannot be behavioural from inside this file); the real, behavioural
 * ceiling on the shipped value now lives downstream in `AsciiGraphRenderer.test.ts`
 * (`BLOOM_MASS_FRAME_BUDGET`), which imports this constant directly and also cross-checks it against
 * a live renderer's actual per-frame `bloomPoints` — the number this constant was always really about.
 *
 * So: 24 is the brief's band midpoint, chosen for headroom on both sides, not a number this file
 * derives from first principles — say so plainly rather than dress up a coincidence as a proof.
 */
export const LOD_REP_POINTS_K = 24

/** One aggregate edge: every real link between two communities' member sets, summarized.
 *  `a`/`b` index into the level's `clusters` array; `w` is the 0..1 log-scaled visual weight. */
export interface LodAggEdge {
    a: number
    b: number
    count: number
    w: number
}

export interface LodLevel {
    clusters: LodCluster[]
    edges: LodAggEdge[]
    maxEdgeCount: number
}

export interface LodNodeInput {
    id: string
    /** Hierarchy path coarsest → finest (AsciiGraphRenderer's `nodePath` fallback rules). */
    path?: number[]
    x: number
    y: number
}

/**
 * Fewest members a community needs before it is drawn as an aggregate ENTITY. A summary view must not
 * be a scatter of one-note "clusters": on the reference vault 143 of 2114 notes are fully isolated, so
 * they are singleton communities at EVERY hierarchy level, and drawing them turned the coarsest stop
 * into 15 real masses plus 143 indistinguishable unnamed dots. Gating at 4 (the same threshold
 * core/src/layout.ts uses to decide which cluster earns a grid cell — the two must agree, or the field
 * would draw masses the layout never placed) yields a 15 → 46 → 75 → leaves ladder on that vault.
 * Below-threshold notes simply aren't summarized; they appear when the leaf passes fade in.
 */
export const LOD_MIN_CLUSTER = 4

/**
 * Precompute the whole LOD structure for a graph: per level, its clusters (count + world centroid +
 * member ids, sorted largest-first so contested label cells go to the biggest community — the same
 * greedy-by-worth rule the label passes use) and its aggregate edges with per-edge link counts and
 * log-scaled weights. Communities under `minCluster` members are omitted (see LOD_MIN_CLUSTER).
 * O(N·levels + E·levels), run once per graph BUILD — never per frame.
 */
export function buildLodIndex(
    nodes: LodNodeInput[],
    edges: { from: string; to: string }[],
    minCluster = LOD_MIN_CLUSTER,
    repK = LOD_REP_POINTS_K,
): LodLevel[] {
    let levelCount = 0
    for (const n of nodes)
        if (n.path && n.path.length > levelCount) levelCount = n.path.length
    if (levelCount === 0) return []

    const pathById = new Map<string, number[]>()
    for (const n of nodes)
        if (n.path && n.path.length) pathById.set(n.id, n.path)

    // Task 30: at most one console.warn for the WHOLE build, not one per offending cluster/level —
    // this file's own header states buildLodIndex runs once per graph build, never per frame (unlike
    // respace.ts's scaleToSpacing, which needed a module-level, per-process throttle because it can
    // run every frame), so a flag local to this one call already gives "once per build" for free.
    let warnedNonFiniteOnce = false

    const out: LodLevel[] = []
    for (let L = 0; L < levelCount; L++) {
        const groups = new Map<
            number,
            { ids: string[]; pts: { x: number; y: number }[] }
        >()
        for (const n of nodes) {
            const c = n.path?.[L]
            if (c == null) continue
            let g = groups.get(c)
            if (!g) {
                g = { ids: [], pts: [] }
                groups.set(c, g)
            }
            g.ids.push(n.id)
            g.pts.push({ x: n.x, y: n.y })
        }
        const clusters: LodCluster[] = [...groups.entries()]
            .filter(([, g]) => g.ids.length >= minCluster)
            .map(([community, g]): LodCluster | null => {
                const n = g.ids.length
                // Task 30: sanitize the member points ONCE, here — before wx/wy/sdx/sdy OR reps are
                // derived — so all of them come from the SAME point set and therefore agree. Previously
                // this sanitization lived only inside representativePoints(), one layer down: wx/wy/sdx/sdy
                // were computed from the raw (possibly non-finite) sums above, so a single bad member left
                // reps clean while wx/wy/sdx/sdy stayed NaN — an internally inconsistent cluster where a
                // consumer that health-checks reps alone would wrongly conclude the whole cluster is fine.
                let safeSx = 0,
                    safeSy = 0,
                    safeCount = 0
                for (const p of g.pts) {
                    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
                        safeSx += p.x
                        safeSy += p.y
                        safeCount++
                    }
                }
                if (safeCount < n) {
                    if (!warnedNonFiniteOnce) {
                        warnedNonFiniteOnce = true
                        console.warn(
                            `buildLodIndex: non-finite member coordinate(s) at level ${L} (community ${community}) — ` +
                                'sanitized rather than propagated. This points at an upstream layout bug, not expected ' +
                                'input; further occurrences this build are suppressed.',
                        )
                    }
                    // Step 4: every member non-finite means there is no real position to summarize at all —
                    // fabricating one at (0, 0) would draw a mass with no relationship to its members, in
                    // whatever unrelated part of the graph happens to sit at the origin. Omit the cluster
                    // instead, the same choice LOD_MIN_CLUSTER already makes for communities too small to
                    // summarize honestly: a mass that cannot be given a truthful position is not drawn as one.
                    if (safeCount === 0) return null
                }
                const pts =
                    safeCount === n
                        ? g.pts
                        : g.pts.map(p =>
                              Number.isFinite(p.x) && Number.isFinite(p.y)
                                  ? p
                                  : {
                                        x: safeSx / safeCount,
                                        y: safeSy / safeCount,
                                    },
                          )
                let sx = 0,
                    sy = 0,
                    sxx = 0,
                    syy = 0
                for (const p of pts) {
                    sx += p.x
                    sy += p.y
                    sxx += p.x * p.x
                    syy += p.y * p.y
                }
                const mx = sx / n,
                    my = sy / n
                // E[x²] − E[x]² can go very slightly negative on floating-point cancellation for a tight
                // cluster; clamp at 0 so `sdx`/`sdy` are never NaN (a NaN would propagate into a bloom
                // point and silently drop it).
                return {
                    level: L,
                    community,
                    count: n,
                    wx: mx,
                    wy: my,
                    sdx: Math.sqrt(Math.max(0, sxx / n - mx * mx)),
                    sdy: Math.sqrt(Math.max(0, syy / n - my * my)),
                    memberIds: g.ids,
                    reps: representativePoints(pts, repK, mx, my),
                }
            })
            .filter((c): c is LodCluster => c !== null)
            .sort((a, b) => b.count - a.count || a.community - b.community)
        const indexByCommunity = new Map<number, number>()
        clusters.forEach((c, i) => indexByCommunity.set(c.community, i))

        // Aggregate edges: one entry per unordered community pair, counting every real inter-cluster
        // link. Intra-cluster links are the entity's own mass, not a connector.
        const pair = new Map<number, { a: number; b: number; count: number }>()
        for (const e of edges) {
            const ca = pathById.get(e.from)?.[L]
            const cb = pathById.get(e.to)?.[L]
            if (ca == null || cb == null || ca === cb) continue
            const ia = indexByCommunity.get(ca)
            const ib = indexByCommunity.get(cb)
            if (ia === undefined || ib === undefined) continue // endpoint's community is under minCluster, or (Task 30) omitted for having no finite member
            const lo = Math.min(ia, ib),
                hi = Math.max(ia, ib)
            const key = lo * clusters.length + hi
            let p = pair.get(key)
            if (!p) {
                p = { a: lo, b: hi, count: 0 }
                pair.set(key, p)
            }
            p.count++
        }
        let maxEdgeCount = 1
        for (const p of pair.values())
            if (p.count > maxEdgeCount) maxEdgeCount = p.count
        const aggEdges: LodAggEdge[] = [...pair.values()]
            .map(p => ({
                a: p.a,
                b: p.b,
                count: p.count,
                w: aggEdgeWeight(p.count, maxEdgeCount),
            }))
            .sort((x, y) => y.count - x.count || x.a - y.a || x.b - y.b)
        out.push({ clusters, edges: aggEdges, maxEdgeCount })
    }
    return out
}

/** Lloyd's-algorithm iteration cap for `representativePoints`' k-means. Round-2 review: an earlier
 *  version of this comment called it "a termination guarantee, not a tuning constant" — checked
 *  directly and that overclaimed. A 1000-point roughly-gaussian cloud does NOT fully converge by
 *  iteration 20 (measured: inertia — sum of squared member-to-nearest-rep distance — still ~0.3%
 *  above its converged value at 500 iterations; capping at 1 iteration instead of 20 costs ~25%
 *  more on that same shape). So this DOES trade summary quality for iteration cost on some inputs,
 *  same as any other bounded-iteration numerical method — say so rather than imply otherwise.
 *  What stays true regardless of where this is set: `reps`' weights are exact integer counts of
 *  whatever assignment exists when iteration stops, converged or not (Lloyd's iteration only ever
 *  reassigns a point to a DIFFERENT existing cluster and recomputes that cluster's own mean, so the
 *  partition is always a complete, exact accounting of all `n` points) — quality of placement, not
 *  correctness of weight, is what an iteration cap trades away. Cost is O(n·k) per iteration,
 *  trivially cheap at the per-cluster sizes this runs on (tens to a few hundred members) and at
 *  build time (never per frame) — headroom was chosen generously for that reason, not derived from
 *  a convergence proof. */
const KMEANS_MAX_ITERS = 20

/**
 * `LodCluster.reps`: up to `k` representative world points for a cluster whose members are `pts`,
 * each weighted by the INTEGER number of members it stands for (weights sum to `pts.length`
 * exactly — real integer arithmetic, not a floating approximation; see the weight-conservation
 * note below). `n <= k`: every member is its own representative at weight 1 (see the convergence
 * note below). `n > k`: deterministic 2D k-means (Lloyd's algorithm) on the real member
 * coordinates — `k` clusters, each rep is that cluster's own centroid, weighted by its own
 * assigned member count.
 *
 * HISTORY, so the next reviewer doesn't reintroduce either fixed bug: v1 sampled `pts` by a fixed
 * STRIDE over ENCOUNTER order (the order the member pass built it, i.e. `nodes`' own order — for a
 * real vault that is `core/src/files.ts`'s unsorted, folder-contiguous `Bun.Glob` walk, and a
 * folder of densely wikilinked notes is exactly what `communityForce`, layout.ts, pulls into one
 * shared centroid). A cluster's `memberIds` is therefore a sequence of CONTIGUOUS,
 * spatially-coherent runs, one per source folder — and a fixed-stride sample over that order can
 * land every sample outside a run shorter than the stride, deterministically dropping that whole
 * sub-population's weight onto its neighbours, every build, forever (measured: a 6-member sub-blob
 * read zero representation while an 8-member one nearby read 3× its true weight). v2 fixed
 * encounter-order dependence by sorting on projection onto the cluster's own PRINCIPAL AXIS
 * (closed-form PCA) before a contiguous block partition — correct for any cluster with ONE
 * dominant elongation direction, but a 1D projection has its own failure mode: sub-populations
 * arranged with no single dominant axis (measured case: many folder-runs distributed roughly
 * evenly AROUND a shared parent centroid, e.g. a hub with many similarly-sized branches) can
 * project to overlapping ranges regardless of which axis is chosen, so several small runs still
 * lose their representation to a larger neighbour they merely happen to share a projected value
 * with. That is a real 2D arrangement problem; no 1D reduction fixes it in general. v3 (this
 * version) drops the 1D reduction and clusters in the ACTUAL 2D space, which is one of the two
 * techniques the plan's brief named for exactly this reason.
 *
 * DETERMINISM (`buildLodIndex` stays a pure function of its arguments — no RNG): initial centroid
 * SEEDS are picked by deterministic FARTHEST-FIRST traversal (Gonzalez's greedy k-center
 * algorithm — see the seeding block below), not v2's 1D projection, which is what actually fixes
 * the isotropic-arrangement failure: farthest-first spreads seeds by real 2D distance, so it
 * cannot waste two seeds on the same dense region while missing another one entirely, the way a
 * 1D order can. Lloyd's iteration then reassigns every point by true 2D nearest-centroid distance
 * each round. Iteration is bounded (`KMEANS_MAX_ITERS`), and both the seeding traversal and
 * reassignment break ties on the lowest point/cluster index — everything here is deterministic, so
 * two calls on the same graph return identical `reps`.
 *
 * EMPTY CLUSTERS (every point closer to some other centroid) are reseeded to the point currently
 * FARTHEST from its own assigned centroid — a standard k-means repair — so a real sub-population
 * is never silently discarded merely because the initial seed didn't land near it; the next
 * iteration's reassignment pulls that region's real points onto the new seed if the geometry
 * supports it.
 *
 * THE CONVERGENCE PROPERTY, PRECISELY SCOPED: at `n <= k`, `reps` IS the member set — each point is
 * its own representative at weight exactly 1, unrounded — so the mass→glyph handover this feeds
 * (Task 24b) is EXACT in that regime, not merely close. Above it (`n > k`), reps are k-means
 * CENTROIDS (a mean of several real members) — real but approximate; see lod.test.ts's `n = k+1`
 * case for the exact boundary where exactness ends.
 *
 * WEIGHT CONSERVATION IS EXACT INTEGER ARITHMETIC: every point is assigned to exactly one cluster
 * (ties broken deterministically), so summed cluster sizes are `n` by construction — no
 * `n / k`-style floating division ever touches a weight. See lod.test.ts's "weight sum is an exact
 * integer" case.
 */
function representativePoints(
    pts0: { x: number; y: number }[],
    k: number,
    mx0: number,
    my0: number,
): LodRepPoint[] {
    const n = pts0.length
    if (n === 0) return []
    // Round-2 review: a non-finite member coordinate (or a centroid corrupted by summing one — even
    // though `sdx`/`sdy`'s OWN clamp above only guards floating-point cancellation, not a literal
    // NaN/Infinity input) must never reach a distance computation below: one bad point turned a
    // whole cluster's `reps` into a single NaN rep, or silently shrank the rep count. Same house
    // pattern as `sdx`/`sdy`'s clamp and densityField.ts's `sanitizeSpread` — degrade a bad point to
    // a safe stand-in (the centroid over its FINITE members) rather than propagate it, which keeps
    // the weight sum exactly `n` (the point is still counted, just relocated) instead of dropping it.
    //
    // UNREACHABLE TODAY, not load-bearing: this function's only caller (`buildLodIndex` above) already
    // sanitizes `pts` and derives `mx0`/`my0` from that sanitized set (Task 30's sanitize-once step),
    // so both inputs here are already finite by the time they arrive. Proved by mutation, not just
    // argued: replacing this guard's body leaves `lod.test.ts` fully green (30/30). Kept anyway as
    // defence-in-depth — a future caller that skips that guarantee should still degrade safely rather
    // than propagate a NaN.
    let safeSx = 0,
        safeSy = 0,
        safeCount = 0
    for (const p of pts0)
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
            safeSx += p.x
            safeSy += p.y
            safeCount++
        }
    const fbX = Number.isFinite(mx0)
        ? mx0
        : safeCount > 0
          ? safeSx / safeCount
          : 0
    const fbY = Number.isFinite(my0)
        ? my0
        : safeCount > 0
          ? safeSy / safeCount
          : 0
    const pts =
        safeCount === n
            ? pts0
            : pts0.map(p =>
                  Number.isFinite(p.x) && Number.isFinite(p.y)
                      ? p
                      : { x: fbX, y: fbY },
              )
    const mx = fbX,
        my = fbY

    if (n <= k) return pts.map(p => ({ x: p.x, y: p.y, weight: 1 }))

    // Deterministic FARTHEST-FIRST seeding (Gonzalez's greedy k-center traversal): start from the
    // member closest to the cluster's own centroid (a geometric, encounter-order-independent anchor
    // — no `pts[0]` first-in-array pick), then repeatedly add whichever remaining point is farthest
    // from every seed chosen so far. This is what makes k-means actually find EVERY distinct
    // sub-population instead of wasting seeds on one dense area: an earlier version of this function
    // seeded from a 1D principal-axis projection, which (measured) still left several real,
    // well-separated sub-populations at zero represented weight when the cluster's sub-populations
    // were arranged with no single dominant axis (e.g. many similarly-sized branches spread roughly
    // evenly around a shared parent centroid) — the 1D order placed multiple seeds in the same
    // region and never reached the rest within the iteration budget. Farthest-first seeding spreads
    // seeds by real 2D distance, so it cannot make that mistake: each new seed is, by construction,
    // as far as possible from every population already claimed by an earlier seed. Ties broken by
    // lowest point index — deterministic, so two calls on the same graph return identical `reps`.
    let anchor = 0,
        anchorD = Infinity
    for (let i = 0; i < n; i++) {
        const dx = pts[i].x - mx,
            dy = pts[i].y - my
        const d = dx * dx + dy * dy
        if (d < anchorD) {
            anchorD = d
            anchor = i
        }
    }
    const cx: number[] = [pts[anchor].x],
        cy: number[] = [pts[anchor].y]
    const nearestSeedD2 = new Array<number>(n)
    for (let i = 0; i < n; i++) {
        const dx = pts[i].x - cx[0],
            dy = pts[i].y - cy[0]
        nearestSeedD2[i] = dx * dx + dy * dy
    }
    for (let s = 1; s < k; s++) {
        let farI = 0,
            farD = -1
        for (let i = 0; i < n; i++)
            if (nearestSeedD2[i] > farD) {
                farD = nearestSeedD2[i]
                farI = i
            }
        cx.push(pts[farI].x)
        cy.push(pts[farI].y)
        for (let i = 0; i < n; i++) {
            const dx = pts[i].x - cx[s],
                dy = pts[i].y - cy[s]
            const d = dx * dx + dy * dy
            if (d < nearestSeedD2[i]) nearestSeedD2[i] = d
        }
    }

    const assign = new Array<number>(n).fill(-1)
    for (let iter = 0; iter < KMEANS_MAX_ITERS; iter++) {
        let changed = false
        for (let i = 0; i < n; i++) {
            let best = 0,
                bestD = Infinity
            for (let j = 0; j < k; j++) {
                const dx = pts[i].x - cx[j],
                    dy = pts[i].y - cy[j]
                const d = dx * dx + dy * dy
                if (d < bestD) {
                    bestD = d
                    best = j
                }
            }
            if (assign[i] !== best) {
                assign[i] = best
                changed = true
            }
        }
        // `assign` starts at -1, so `changed` is unconditionally true on the first pass — no `iter > 0`
        // guard needed.
        if (!changed) break
        const sx = new Array(k).fill(0),
            sy = new Array(k).fill(0),
            cnt = new Array(k).fill(0)
        for (let i = 0; i < n; i++) {
            const j = assign[i]
            sx[j] += pts[i].x
            sy[j] += pts[i].y
            cnt[j]++
        }
        // Empty clusters (every point closer to some other centroid): reseed to the point currently
        // farthest from ITS assigned centroid, so the next reassignment pass can pull a real,
        // under-served region onto this centroid instead of leaving it a dead, zero-weight slot. Not
        // observed to fire on any fixture this file's tests exercise (farthest-first seeding rarely
        // leaves a centroid with nothing nearest to it) — kept as a defensive repair for shapes this
        // suite doesn't cover, not because it's load-bearing today. `usedFarI` stops two empty clusters
        // in the SAME round from both reseeding to the identical point: without it, each scan measures
        // distance against its OWN point's current cluster, so two independent scans can pick the same
        // farthest point.
        const usedFarI = new Set<number>()
        for (let j = 0; j < k; j++) {
            if (cnt[j] > 0) {
                cx[j] = sx[j] / cnt[j]
                cy[j] = sy[j] / cnt[j]
                continue
            }
            let farI = -1,
                farD = -1
            for (let i = 0; i < n; i++) {
                if (usedFarI.has(i)) continue
                const cj = assign[i]
                const dx = pts[i].x - cx[cj],
                    dy = pts[i].y - cy[cj]
                const d = dx * dx + dy * dy
                if (d > farD) {
                    farD = d
                    farI = i
                }
            }
            if (farI === -1) continue // every point already claimed as a reseed target this round
            usedFarI.add(farI)
            cx[j] = pts[farI].x
            cy[j] = pts[farI].y
        }
    }

    const sx = new Array(k).fill(0),
        sy = new Array(k).fill(0),
        cnt = new Array(k).fill(0)
    for (let i = 0; i < n; i++) {
        const j = assign[i]
        sx[j] += pts[i].x
        sy[j] += pts[i].y
        cnt[j]++
    }
    const reps: LodRepPoint[] = []
    for (let j = 0; j < k; j++) {
        if (cnt[j] === 0) continue // only reachable with fewer than k distinct point locations in pts
        reps.push({ x: sx[j] / cnt[j], y: sy[j] / cnt[j], weight: cnt[j] })
    }
    return reps
}

/** Log-scaled 0..1 visual weight for an aggregate edge carrying `count` real links, against the
 *  level's heaviest connector. A single link still reads (w > 0); the heaviest reads full. */
export function aggEdgeWeight(count: number, maxCount: number): number {
    if (count <= 0) return 0
    if (maxCount <= 1) return 1
    return Math.log1p(count) / Math.log1p(maxCount)
}

/** Aggregate edges at/above this weight draw DOUBLED (a second parallel trace) — char-density
 *  thickness, never a wider glyph. */
export const AGG_EDGE_DOUBLE_W = 0.66
/** Aggregate edge alpha ramp: alpha = base × (MIN + (1−MIN)·w) — the lightest connector is still
 *  legible, the heaviest is full-strength. */
export const AGG_EDGE_ALPHA_MIN = 0.35

// --- Entity mass form ---------------------------------------------------------------------------
// A compact elliptical ASCII mass on the grid: "@" core, "o" body, "." fringe — the SAME degree
// ramp vocabulary the notes use, so an entity reads as "a heavier kind of node", not a new alphabet.
// Its size encodes member count with ~sqrt scaling (area ∝ count-ish without huge clusters
// swallowing the field). The ellipse is expressed in CELLS: rows are ~2.9× taller than columns are
// wide (CELL_H/CELL_W), so a visually round mass needs its column radius stretched by that ratio.

/** Row-radius scale: rowR = max(1, round(K·√count)). Tuned so the reference vault's coarsest level
 *  (19 clusters, ~40–300 members) yields 2–4-row masses on a full-pane grid. */
export const MASS_ROW_K = 0.22

export function massRadii(
    count: number,
    cellW: number,
    cellH: number,
): { rowR: number; colR: number } {
    const rowR = Math.max(
        1,
        Math.round(MASS_ROW_K * Math.sqrt(Math.max(1, count))),
    )
    const colR = Math.max(2, Math.round(rowR * (cellH / Math.max(1e-6, cellW))))
    return { rowR, colR }
}

/** Squared-normalized-radius thresholds for the mass ramp ("@" core / "o" body / "." fringe). */
export const MASS_CORE_D2 = 0.3
export const MASS_BODY_D2 = 0.72
const CODE_AT = 64,
    CODE_O = 111,
    CODE_DOT = 46

/** Char CODE for a mass cell at squared normalized radius `d2` (0 centre → 1 rim). Codes, not
 *  strings — this runs inside the raster loop. */
export function massCellCode(d2: number): number {
    return d2 < MASS_CORE_D2 ? CODE_AT : d2 < MASS_BODY_D2 ? CODE_O : CODE_DOT
}

/** Per-cell alpha for the mass at squared normalized radius `d2`: solid core, soft fringe. */
export function massCellAlpha(d2: number): number {
    return d2 < MASS_CORE_D2 ? 1 : d2 < MASS_BODY_D2 ? 0.85 : 0.55
}

// --- Per-frame level mix ------------------------------------------------------------------------

export interface LodMix {
    /** Draw alpha per hierarchy level (coarsest → finest): `clusterLevelAlphas × massAlpha`. At most
     *  two adjacent levels are nonzero mid-crossfade; all go to 0 as the mass band hands over. */
    levelAlphas: number[]
    /** How much of the field the territory MASSES own (`bandsForT`'s far band). The per-level split
     *  above is this number distributed over the levels. */
    massAlpha: number
    /** The leaf/glyph RASTER gate — `1 - massAlpha`, i.e. `backboneAlpha + memberAlpha`. Individual
     *  note glyphs rasterize across BOTH the mid and the near band, not only the near one: the mid
     *  band is "individual glyphs joined by a hub-to-hub backbone". This is NOT the member-edge
     *  alpha; see `memberAlpha`. */
    glyphAlpha: number
    /** How much of the field the hub-to-hub BACKBONE owns (`bandsForT`'s mid band) — the multiplier
     *  on `backbone.ts`'s `computeEdgeLevelWeights` per-level group-line weights. */
    backboneAlpha: number
    /** How much of the field the REAL, individual member edges own (`bandsForT`'s near band). The
     *  renderer's `strokeEdges()` member passes take THIS, never `glyphAlpha` — in the mid band the
     *  two are numerically different (glyphs ≈ 1, member edges ≈ 0), and collapsing them onto one
     *  field draws the hairball the backbone exists to replace. See backbone.ts's wiring recipe. */
    memberAlpha: number
}

/**
 * The per-frame LOD alpha mix at zoom progress `t` (0 = fit, 1 = deepest) for a graph with
 * `levelCount` hierarchy levels. This is the ONE function tying geometry to the existing label
 * crossfade machinery: entities render at exactly the alpha their names do, and leaves render at
 * exactly the alpha file names crossfade in with.
 *
 * THE MASS WEIGHT IS `bandsForT`'s `massAlpha`, NOT `1 - fileLabelAlpha(t)`. Those two disagree
 * across the whole mid band and the disagreement is not cosmetic: keyed off `fileLabelAlpha`, the
 * masses owned the field outright until t = FILE_LABEL_REVEAL_T (0.75) — which, once the renderer
 * gates its leaf raster pass on the same number, means t = 0.60 renders a hub-to-hub backbone
 * painted over solid territory masses with ZERO individual glyphs: neither the mid band nor the far
 * band. `bandsForT` (backbone.ts) is the single owner of that handover now; this function
 * only distributes the mass band's share over the hierarchy levels, which is unchanged.
 */
export function lodMix(t: number, levelCount: number): LodMix {
    const bands = bandsForT(t, levelCount)
    const levelAlphas = clusterLevelAlphas(t, levelCount)
    for (let i = 0; i < levelAlphas.length; i++)
        levelAlphas[i] *= bands.massAlpha
    return {
        levelAlphas,
        massAlpha: bands.massAlpha,
        glyphAlpha: 1 - bands.massAlpha,
        backboneAlpha: bands.backboneAlpha,
        memberAlpha: bands.memberAlpha,
    }
}

/** Below this alpha a level (or the leaf pass) is skipped entirely — the raster work never runs. */
export const LOD_ALPHA_EPS = 0.02
