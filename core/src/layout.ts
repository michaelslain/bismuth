// Graph layout computation shared by the backend (precompute on graph change) and the app's
// layout Web Worker. Two stages:
//   1. PivotMDS (Brandes & Pich) — a fast, deterministic GLOBAL placement from graph-theoretic
//      distances to a handful of pivot nodes. Gets the overall shape right in O(k·(V+E)).
//   2. A short d3-force-3d REFINEMENT using the same forces/constants as the renderer, to polish
//      local spacing. Starting from PivotMDS means it converges in a fraction of the iterations a
//      random start needs — that's the whole point, since the force solve is the expensive part.
//   3. Link attraction is LinLog by default (see LayoutOptions.energyModel / linlog.ts): pull grows
//      only as ln(1+d) instead of proportionally (a Hooke spring), so a meaningful share of cluster
//      separation is a property of the energy model rather than something a corrective force has to
//      impose — but not all of it: the community-aware forces (see the COMMUNITY_* block below,
//      gravity AND separation) still run alongside it and are both measurably load-bearing even under
//      LinLog (a d2 NP-degree loss of 7.9% and a ~2x separation regression on tag-hub-heavy topology
//      were measured from deleting just the separation half — see its own comment for the numbers).
//      Only the already-inactive grid-lattice placement, per-member containment, and disc-flatten bias
//      were genuinely dead code and are gone for good.
//
// Pure (no DOM, no Bun/fs) so it runs in both Bun (core) and a browser Worker (app).
import {
    forceSimulation,
    forceManyBody,
    forceLink,
    forceCollide,
    forceX,
    forceY,
    forceZ,
    type SimNode,
    type SimLink,
} from 'd3-force-3d'
import { linLogLinkForce } from './linlog'

export interface LayoutInput {
    /** `community` is the FINEST detected community id already stamped on every graph node by
     *  `engine.ts stampCommunities` (see community.ts). When present on 2+ distinct communities the
     *  layout adds community-aware forces (see COMMUNITY_* below); when absent the layout is
     *  byte-identical to the community-unaware behaviour.
     *  `communityPath` (coarsest → finest, last element === `community`) additionally arms the
     *  NESTED forces: one extra gravity + separation pair per ancestor level, at decaying strength,
     *  so super-clusters clump and spread the same way individual clusters do. A node array with no
     *  `communityPath` (or a 1-element one) behaves exactly as it did before hierarchies existed. */
    nodes: { id: string; community?: number; communityPath?: number[] }[]
    edges: { from: string; to: string }[]
}

export interface LayoutOptions {
    dimensions?: 2 | 3 // default 3
    numPivots?: number // PivotMDS pivots (default 100); clamped to node count
    refineTicks?: number // d3-force ticks after the PivotMDS init (default 150)
    repulsion?: number // forceManyBody strength (default -10)
    linkDistance?: number // default 5
    centering?: number // forceX/Y/Z strength toward origin (default 0.13)
    /**
     * Optional id → [x,y,z] starting coordinates used INSTEAD of PivotMDS. Seeding the 2D layout from
     * the (flattened) 3D layout keeps the two aligned, so a 2D↔3D morph flattens in place rather than
     * scrambling — and it converges faster than a cold PivotMDS start. Missing ids (e.g. newly-added
     * nodes) get a deterministic position seeded from a hash of the id, so the layout stays reproducible.
     */
    initialPositions?: Positions
    /**
     * Ids to PIN at their `initialPositions` coordinates for the whole settle (sets d3 fx/fy/fz). Used by
     * the incremental "add-only" rebuild (see layout-cache.ts): when a note is created, every pre-existing
     * node is pinned exactly where it already was and only the new node(s) settle in among them — so an
     * edit never scrambles the established layout and the refine converges in a fraction of the ticks.
     * Requires `initialPositions` to contain these ids. Pairs with the convergence early-exit below.
     */
    fixedIds?: string[]
    /**
     * Tuning for the disconnected-component "reel-in" (see prepareLayout). A note with no in-view links is
     * its own connected component; without this it gets flung into an empty direction at the cloud edge.
     * Each node of a SMALL non-main component gets `virtualAnchors` layout-only virtual links to the main
     * mass — strength `virtualLinkStrength`, and (under the "spring" energy model only — see `energyModel`
     * below) rest length `linkDistance·virtualDistMult` — so the force solve pulls it into the cloud (the
     * existing collide force keeps it overlap-free). Defaults reel orphan memory notes into the 3rd-brain
     * cloud; set virtualAnchors to 0 to disable.
     *
     * `virtualDistMult` only has an effect under `energyModel: "spring"`. Under the shipped default,
     * `"linlog"`, the tether's rest length is never consulted (`linkForce.distance()` is built but never
     * attached to the sim — see the `energyModel` branch around line 981) — LinLog attraction has no rest
     * length, only strength (`ln(1+d)`), so `virtualLinkStrength` alone governs a tether under the default;
     * `virtualDistMult` is inert dead weight there. See the "One link force" comment near `linkStrengthFor`
     * for the general strength-vs-distance split.
     */
    virtualLinkStrength?: number
    virtualAnchors?: number
    virtualDistMult?: number
    /**
     * Community-aware clustering forces (default ON). Requires `community` on the input nodes — with
     * fewer than 2 distinct communities this is a no-op and output is identical either way. Set false
     * to reproduce the community-unaware layout exactly (used by the tuning harness / A-B tests).
     */
    communityForces?: boolean
    /** Multiplier on LINK_STRENGTH for edges INSIDE a community (>1 = tighter clusters). LIVE under
     *  both energy models — under "linlog" (the shipped default) this feeds `linLogLinkForce`'s
     *  `strength` option directly (see `linkStrengthFor`, used at line ~984); under "spring" it feeds
     *  `forceLink.strength()`. */
    communityIntraLink?: number
    /** Multiplier on LINK_STRENGTH for edges BETWEEN communities (<1 = looser coupling). Same
     *  live-under-both-models note as `communityIntraLink` above. */
    communityInterLink?: number
    /** Multiplier on the link rest length for intra-/inter-community edges. INERT under the shipped
     *  default (`energyModel: "linlog"`): rest length is a "spring" (`forceLink.distance()`) concept
     *  only — LinLog has no rest length, just `ln(1+d)` attraction scaled by strength. The `forceLink`
     *  instance that reads this (`linkDistFor`, built at line ~955) is constructed unconditionally but
     *  only ever attached to the simulation in the "spring" branch (line ~981); under "linlog" it's
     *  built and discarded. Only takes effect if `energyModel` is explicitly set to `"spring"`. */
    communityIntraDist?: number
    communityInterDist?: number
    /** Per-tick pull of each node toward its own community's centroid (0 = off). */
    communityGravity?: number
    /** Strength (0..1, 0 = off) of the community-level collide that pushes whole communities apart
     *  until their packing radii clear. Same semantics as d3's forceCollide strength. */
    communitySeparation?: number
    /** Per-ancestor-level falloff for the NESTED community forces: an ancestor `a` levels above the
     *  finest gets `communityGravity · decay^a` and `communitySeparation · decay^a`. 0 disables the
     *  coarse levels entirely (finest-only = the pre-hierarchy behaviour). See the COMMUNITY_* block. */
    communityLevelDecay?: number
    /**
     * Which attraction model links use.
     *   - "spring"  — d3 forceLink (Hooke). The pre-2026-07 behaviour.
     *   - "linlog"  — Noack's LinLog: attraction ~ ln(1+d), so a lot of cluster separation is a
     *                 property of the model rather than something a corrective force has to impose —
     *                 but NOT all of it: the community-level SEPARATION force below is still measurably
     *                 load-bearing under LinLog (see COMMUNITY_SEP_MULT's comment; a tag-hub-heavy
     *                 synthetic fixture regresses ~2x without it, and the reference vault's own d2
     *                 NP-degree loses 7.9% — this was nearly deleted on a d3-only reading of the
     *                 evidence, see the git history around Task 5, fix round 1). DEFAULT as of Task 5's
     *                 measurement (d3 NP-degree separation 0.0557→0.1242, d2 0.0398→0.1302 on the
     *                 reference vault, both better than spring, WITH both community forces active).
     */
    energyModel?: 'spring' | 'linlog'
    /**
     * Scale many-body repulsion by (degree + 1), per ForceAtlas2. A vault is scale-free; uniform
     * repulsion crushes leaf nodes against their hubs ("forests of leaves").
     */
    degreeRepulsion?: boolean
}

export type Positions = Record<string, [number, number, number]>

// Force constants mirrored from the renderer (WebGLRenderer.ts) so a precomputed layout matches
// what the live renderer would settle to — otherwise the renderer's warm-skip would re-settle them.
// numPivots 50 (was 100): the PivotMDS Gram build is O(k²·n), so halving pivots is ~4× cheaper on
// the cold path and visually indistinguishable (PivotMDS only seeds the force refine, which sets the
// final shape). Warm rebuilds skip PivotMDS entirely (initialPositions), so this only bites first-ever
// builds. NOTE: changing this changes cold-layout output — keep CACHE_VERSION in layout-cache.ts in sync.
// virtualLinkStrength/Anchors/DistMult: tuned against the live 156-node 3rd-brain graph (8 components)
// so orphan notes (degree-0 singletons) reel from ~1.5× the cloud radius to ~1× (at the rim, integrated)
// without overlaps, while small multi-node clusters stay recognizable lobes. Short (0.8× linkDist) +
// strong (1.2) + 4 anchors: short/strong beats the long-range repulsion; the extra anchors distribute
// each stray around the mass instead of piling it at one point. See prepareLayout's "Reel in" block.
// NOTE: "short" (virtualDistMult 0.8, i.e. the rest-length half of that tuning) was measured under the
// "spring" energy model and is INERT under the shipped default, "linlog" — LinLog has no rest length,
// so only "strong" (virtualLinkStrength 1.2, still live under both models) actually governs a tether's
// pull today. See LayoutOptions.virtualDistMult's doc for the mechanism.
// repulsion -7 (was -10): "edges extend too far out" on a real 2246-node/4957-edge vault, measured
// against the actual /graph output (core/test/layout.test.ts documents the measurement method).
// Linked-pair distance was ~5× the local nearest-neighbour spacing (mean 69 vs 13 in 3D) — most edges
// crossed past several other nodes rather than connecting adjacent-looking dots. Softening many-body
// repulsion (the force that competes against the link spring) shrinks that gap directly: on the same
// vault, 3D edge length p99 156→132 and max 211→188, with 2D following similarly (p99 645→464,
// max 987→780) — all measured with `refineTicks`/`repulsion` left otherwise at their defaults. Tried
// strengthening LINK_STRENGTH instead first: it shrinks edges just as well but reliably breaks the
// "roughly spherical" hub-topology invariant below (a single high-degree hub + many degree-1 leaves,
// same shape as a real vault's heaviest tags) — repulsion doesn't carry that risk and this whole
// suite still passes with comfortable margins (see the sphericity/reel-in tests). -7 is an EMPIRICAL
// choice, not a bound: it is simply the best of the values sampled. On the 400-note/8-hub fixture,
// 3D p99 edge length is 46.5 at -7, 47.7 at -6, 49.3 at -5 — so the effect is non-monotone and -7 sits
// at a local minimum of the sampled range. The 2D collide floor is NOT the binding constraint and does
// not pick this value: measured min-pairwise-distance / collide-floor is ~1.20 at every one of
// -10/-7/-6/-5, i.e. never violated. Treat -7 as "measured best so far", and re-measure rather than
// reason from this comment if you change it.
// NOTE: changing this changes cold-layout output — keep CACHE_VERSION in layout-cache.ts in sync.
// Declared up here (not with the rest of the COMMUNITY_* block) only because DEFAULTS below reads
// it at module-init time. Full rationale lives in the "Nesting" block further down.
const COMMUNITY_LEVEL_DECAY = 0.4
const DEFAULTS = {
    dimensions: 3 as 2 | 3,
    numPivots: 50,
    refineTicks: 150,
    repulsion: -7,
    linkDistance: 5,
    centering: 0.13,
    virtualLinkStrength: 1.2,
    virtualAnchors: 4,
    virtualDistMult: 0.8,
    // --- Community-aware clustering (see the COMMUNITY_* block below) ---
    communityForces: true,
    // Cranked 2026-07-25 (user: tighter clumps, wider lanes, "like the design example"):
    // gravity .4→.6, separation .6→.85, inter links .35→.2 @ 1.9→2.6× rest length.
    // The "@ 1.9→2.6× rest length" (communityIntraDist/communityInterDist) half of that tuning is INERT
    // under the shipped default, energyModel "linlog" — LinLog has no rest length concept, only strength.
    // Only "inter links .35→.2" (communityInterLink, and communityIntraLink alongside it) is live under
    // the default; the *Dist pair below only takes effect if energyModel is explicitly set to "spring".
    communityIntraLink: 1.8,
    communityInterLink: 0.2,
    communityIntraDist: 1.0,
    communityInterDist: 2.6,
    communityGravity: 0.6,
    communitySeparation: 0.85,
    // Hierarchical ("clusters in clusters") nesting — see the COMMUNITY_LEVEL_DECAY block below.
    communityLevelDecay: COMMUNITY_LEVEL_DECAY,
}
const LINK_STRENGTH = 0.18
// 2D-only force tuning (see prepareLayout): the flat layout has one less dimension of room, so without
// help it collapses into a hairball. Push communities apart (repulsion ×), let them breathe (centering
// ×) — 3D keeps the gentler defaults for both.
const MODE_2D_REPULSION_MULT = 3
const MODE_2D_CENTERING_MULT = 0.5
// 0.65 (was 1.2): that extra padding on TOP of the already-larger 2D collide floor (COLLIDE_RATIO ×
// MODE_2D_SPACING) is what produced the "condensed honeycomb" look — on the real 2246-node vault it
// forced ~every leaf node to the exact same collide radius, so nearly all of them settled at a
// near-identical spacing (nearest-neighbour distance had a coefficient of variation of just 0.25 —
// a near-regular grid) regardless of which community/cluster they actually belonged to. Shrinking
// this multiplier lets real link/community structure set the local spacing instead of the collide
// floor: CV nearly doubles to 0.42 (organic, uneven spacing) with the 2D collide-floor minimum still
// comfortably respected (measured minimum pairwise distance stayed ~1.8× the theoretical floor).
// 3D is completely unaffected — this multiplier only ever applies in the `dim === 2` branch below.
const MODE_2D_COLLIDE_MULT = 0.65
const COLLIDE_RATIO = 1.25
// 6 (was 3): more solver passes per tick so overlaps actually resolve within the refine budget —
// notably in the 2D view, where nodes separated only along Z in 3D collapse onto the same XY and
// need the collide force to push them apart. Must match the renderer (WebGLRenderer.ts).
const COLLIDE_ITERATIONS = 6
const MANYBODY_THETA = 1.5
const MODE_2D_SPACING = 1.8
const PIVOT_TARGET_RADIUS = 100 // PivotMDS output is scaled to this RMS radius; force refine sets the final scale

// Per-node collision sizing, mirrored from the renderer (WebGLRenderer.ts SIZE_* + nodeSize + fov).
// Nodes are DRAWN at a degree-scaled size (hubs up to ~6x a leaf), but collision used one uniform
// radius — so big hubs collided as points and overlapped. A node's drawn world radius is
// nodeSize*scale*tan(fov/2)/2 (sizeAttenuation); we space by that (×padding) when it beats the floor.
const NODE_SIZE = 6 // renderer DEFAULT_CONFIG.nodeSize
const NODE_FOV_DEG = 60 // renderer PerspectiveCamera fov
const SIZE_MIN_MULT = 0.4
const SIZE_DEGREE_GAIN = 0.45
const SIZE_MAX_MULT = 6
const COLLIDE_SIZE_PADDING = 1.55 // gap around big hubs (was 1.25) so they don't visually cover neighbors
const degreeScale = (deg: number) =>
    Math.min(SIZE_MAX_MULT, SIZE_MIN_MULT + SIZE_DEGREE_GAIN * Math.sqrt(deg))
const drawnNodeRadius = (scale: number) =>
    (NODE_SIZE * scale * Math.tan((NODE_FOV_DEG * Math.PI) / 180 / 2)) / 2

// --- Community-aware clustering ------------------------------------------------------------------
// Zoomed out, a graph whose communities intermingle reads as one undifferentiated blob: the detected
// communities (community.ts, stamped onto every node by engine.ts BEFORE layout) were used only for
// COLOR, never for position, so link topology alone had to separate them — and it doesn't, because a
// handful of inter-community bridges pull clusters into each other while uniform many-body repulsion
// pushes intra-community members apart just as hard as it pushes whole clusters apart.
//
// Three cooperating forces fix that, all gated on `community` being present on 2+ distinct
// communities — so a community-less caller (embedded graph blocks, the daemon graph, every existing
// test fixture) gets byte-identical output to before, and `communityForces: false` reproduces the
// old layout exactly for A/B measurement:
//   1. Anisotropic links: an intra-community edge gets a stronger spring, an inter-community edge a
//      weaker + longer one. Turns the modularity structure directly into geometry. Note the intra
//      REST LENGTH is deliberately left at 1.0× — shortening it to 0.7× measurably improved the
//      separation ratio but pulled linked pairs inside their collide radii (152 overlapping pairs on
//      the reference vault's 2D layout, vs 18 at 1.0×), and the extra separation wasn't worth it.
//      NOTE: this whole rest-length half (the "weaker + longer"/"REST LENGTH" part, i.e.
//      communityIntraDist/communityInterDist) was measured under and only applies to the "spring"
//      energy model — it's INERT under the shipped default, "linlog", which has no rest-length concept.
//      The "stronger/weaker" STRENGTH half (communityIntraLink/communityInterLink) is unaffected and
//      remains live under both models — see linkStrengthFor and the energyModel branch below.
//   2. Centroid gravity: every member of a >=2-node community is pulled toward that community's
//      running centroid. This is what actually compacts a cluster (links alone only bind neighbours,
//      not the community's far side). It is gated by a PACKING FLOOR (packRadius below): a node
//      already inside its community's jammed-packing radius feels nothing, so gravity gathers a
//      community's strays without squeezing its core past what forceCollide can resolve. Ungated it
//      compressed a 650-node community until 2% of ALL the vault's nodes overlapped.
//      Separation then has to come from communities moving APART (3), not from each one shrinking.
//   3. Community-level COLLIDE: each community is treated as one soft body of radius packRadius, and
//      an overlapping pair is pushed apart (mass-weighted, exactly like d3's forceCollide) until
//      their radii clear with a COMMUNITY_SEP_MULT margin. This is the piece that opens visible lanes.
//      An inverse-square centroid repulsion was tried first and is strictly worse: a settled layout
//      is near collide-jammed, so a 1/d² push is immediately balanced by the linear centering spring
//      (raising it 2×→6× moved the 3D separation ratio by <2%). A bounded overlap-resolving
//      constraint has no such equilibrium — it dilates the assembly just until the gap exists and
//      then switches off, so it also can't inflate an already-separated graph. A per-node variant
//      (evict a node from foreign community discs) was also tried and separated distinctly worse
//      (vault 3D 41% vs 46% improvement) for no overlap benefit.
//
// NEARLY DELETED (Task 5, fix round 1 — kept, and this is why): Task 4's ablation under the LinLog
// energy model measured (3) as only ~1.6% of the combined win by the d3 (3D) NP-degree statistic
// alone (linlog+degreeRepulsion+both forces: d3 0.1242; gravity alone: d3 0.1221) and it was deleted
// on that basis. Two things were missed, both since corrected:
//   - The SAME ablation's d2 (2D) statistic loses 7.9%, not ~1.6% (0.1302 full → 0.1199 gravity-only)
//     — the "~1.6%" figure was read off d3 only and never cross-checked against d2.
//   - A synthetic tag-hub-heavy fixture purpose-built to guard exactly this failure mode
//     (`plantedHierarchyWithHubs`, core/test/layout.test.ts) regresses from ~0.31 (both forces) to
//     ~0.72 (gravity-only) on its separation-ratio statistic — roughly 2x worse, not ~1.6%. The
//     reference vault's own NP-degree ablation did not show this sensitivity, but the user's real
//     vault has 88 tag nodes and max degree 687 — genuinely hub-heavy — so a single vault's NP-degree
//     reading is not enough evidence that gravity-only generalizes. See the Task 5 report for the
//     full isolation (confirmed via the pre-deletion code re-run with the same options, to rule out
//     the regression being an implementation bug rather than the force itself).
// Only communities of >= COMMUNITY_MIN_SIZE take part in (3): a real vault has a long tail of
// singleton/pair communities (isolated notes), and pairing all of them would be O(k²) for no visual
// gain. Gravity applies to any community with >= 2 members. Cost is O(n + k_big²) per tick with
// k_big in the low tens even on a big vault (28 qualifying communities out of 196 on the reference
// 2248-node vault) — measured at +7% (3D) / +6% (2D) on total settle time.
//
// Measured on the reference 2248-node/4959-edge vault and a 300-node/6-community synthetic, as
// mean-intra-community-spread / mean-nearest-other-community-centroid-distance (lower = clusters
// read as distinct blobs), 120 refine ticks, `communityForces:false` vs the defaults below:
//   vault   3D 1.675 → 0.952 (-43%),  2D 2.999 → 1.058 (-65%)
//   synth   3D 0.522 → 0.326 (-38%),  2D 0.464 → 0.270 (-42%)
// with intra-community spread retained at 0.76-0.90× (no degenerate collapse into points) and the
// collide invariant essentially intact (worst pairwise distance / (rᵢ+rⱼ): vault 3D 0.90 → 0.90,
// 2D 0.88 → 0.77; synthetic unchanged at 0.94).
const COMMUNITY_MIN_SIZE = 4 // min members for a community to take part in community-level collide
// Radius a community occupies once its members are jam-packed at their own collide radii:
//   R = (Σ rᵢ^dim / φ)^(1/dim),  φ = the fraction a random (not crystalline) packing fills.
// Summing rᵢ^dim rather than using k·r^dim matters: a community's hubs carry a collide radius up to
// ~6× a leaf's (degreeScale), so a uniform-radius estimate under-reads a hub-heavy community's real
// footprint. Gravity is switched off inside this radius, and it is the "body radius" the
// community-level collide separates on.
const COMMUNITY_PACK_FILL_2D = 0.55 // random-loose disc packing
const COMMUNITY_PACK_FILL_3D = 0.5 // random-loose sphere packing
// Target clearance between two communities' packing radii — >1 leaves an actual empty lane.
// 1.6 → 2.4 (2026-07-27, ASCII redesign: "things more separated and clustered", edges now drawn as
// real vector lines rather than character-grid glyphs — see AsciiGraphRenderer.ts / docs/bismuth-design/ascii).
//
// CORRECTION (an adversarial review caught this): this was originally swept ONLY on
// plantedCommunities([80,70,60,40,30,20], cross=0.25) — a FLAT, single-level partition — measuring
// intra-community nearest-neighbour distance (a) vs. inter-centroid distance (b). On that fixture (a)
// held flat across the whole sweep and the comment claimed intra-cluster spacing was "untouched by
// construction". That claim is only true for a single-level partition: the constant enters the
// separation-force target at EVERY level of a real hierarchy (finest + every ancestor, decayed — see
// the "Nesting" block below), and a flat fixture has no ancestor level to expose that. Re-swept
// 1.6/2.0/2.4/2.8 on the REAL reference vault (2121 nodes / 3-level Louvain hierarchy) at the
// PRODUCTION tick budget (240 — see REFINE_TICKS in layout-cache.ts), measuring mean distance from a
// member to its OWN level-community centroid (intra) vs. mean distance to the NEAREST OTHER
// level-community's centroid (inter), per hierarchy level L0 (coarsest) / L1 / L2 (finest):
//   3D intra        L0      L1      L2     3D inter (nearest centroid)   L0      L1      L2
//   1.6             53.46   43.91   33.83                                69.34   59.50   40.50
//   2.0             60.82   48.69   37.22                                84.69   69.26   48.24
//   2.4             68.84   54.00   41.49                                99.84   80.82   54.42
//   2.8             76.73   59.69   45.98                               113.03   93.41   61.51
//   2D intra        L0      L1      L2     2D inter                     L0      L1      L2
//   1.6            164.36  132.95  101.11                               181.74  126.38   77.89
//   2.0            181.60  148.40  112.79                               213.77  145.02   88.58
//   2.4            203.82  166.13  126.84                               246.83  163.36   97.48
//   2.8            226.79  182.53  139.94                               283.91  179.25  113.52
// Both columns grow substantially with the multiplier at EVERY level, in both dimensions — intra by
// +36% to +44% (1.6→2.8), inter by +42% to +63%. So the honest statement is: raising this constant
// widens spacing everywhere a real hierarchy has more than one level, not just the gaps between
// clusters — DELETE the old "untouched by construction" claim, it does not hold once communities nest.
// What still justifies the change: intra grows more slowly than inter at every level/dimension sampled,
// so the RATIO the tests actually assert on (separation() — lower is clusters reading as distinct
// blobs) keeps improving rather than standing still. Confirmed through the full production pipeline on
// this same vault (see REFINE_TICKS's comment in layout-cache.ts for the paired tick-budget measurement
// this depends on): coarsest-level 2D ratio 0.851 (1.6@120, pre-change) → 0.700 (2.4@240, shipped). 2.4
// is kept as a comfortable middle value rather than the most extreme sampled: both columns keep scaling
// smoothly out to 2.8 with no sign of instability, so 2.4 is "a clear, wide-enough step" rather than
// "the ceiling before something breaks".
//
// HAZARD, confirmed twice now (original ASCII-redesign sweep above, then independently by Task 5's
// near-deletion of the whole force): raising this constant does NOT automatically widen cluster gaps.
// It sizes a BOUNDED constraint (3) — the force switches off once a pair clears its target — so a
// wider target needs proportionally more ticks to actually reach before REFINE_TICKS runs out, and
// short of that it can measure WORSE than not raising it at all. Measured on the reference vault at
// the coarsest level's 2D separation ratio (lower is better): 1.6 @ 120 ticks = 0.851; 2.4 @ 120
// ticks = 0.884 — WORSE, because 120 ticks doesn't reach the wider (2.4) target. 2.4 only becomes an
// improvement (0.700) once REFINE_TICKS is also raised to 240 (see layout-cache.ts). Any future change
// to this constant — or to COMMUNITY_MAX_STEP, which caps how fast a pair can close on the target —
// must be re-measured at the ACTUAL shipped tick budget, not assumed to transfer from a smaller one.
const COMMUNITY_SEP_MULT = 2.4
// Per-tick speed limit for everything this force adds, as a multiple of the node's OWN collide
// radius. Both community terms can be large on the first ticks (alpha=1, communities still deeply
// interpenetrating), and an uncapped step drags a whole community across the field faster than the
// collide relaxation can track. Measured on the reference vault's 2D layout: uncapped, the worst
// pairwise distance/(rᵢ+rⱼ) is 0.65 and the separation ratio 1.111; at 1.5 they are 0.77 and 1.058
// (better on both counts). Clamping harder (0.5) is worse again (ratio 1.381) — the communities no
// longer reach their targets inside the tick budget.
const COMMUNITY_MAX_STEP = 1.5

// --- Nesting (hierarchical communities) -----------------------------------------------------------
// Communities now come as a PATH (coarsest → finest; see community.ts / GraphNode.communityPath),
// so the two shape-setting forces above are applied once per level instead of once, total:
//   - the FINEST level keeps the constants above verbatim — it is the tuned baseline and a graph
//     with a 1-level path (or none) produces byte-identical output to before hierarchies existed;
//   - each ancestor level `a` above it gets the SAME two forces at COMMUNITY_LEVEL_DECAY^a strength,
//     so a super-cluster gathers its member clusters and shoulders other super-clusters aside, more
//     weakly than its children do among themselves.
//
// COMMUNITY_LEVEL_DECAY = 0.4, swept on the reference 2251-node/4979-edge vault (3 levels, 120
// refine ticks) as per-level separation ratio (intra spread / nearest-other-centroid; LOWER is
// better) plus the collide invariant (worst pairwise distance / (rᵢ+rⱼ); the flat baseline is 0.89):
//     decay   L0 3D   L1 3D   L2 3D    L0 2D   L1 2D   L2 2D    2D collide
//     0.00    1.985   1.668   1.090    2.421   2.745   1.936    0.89 (0 pairs)   ← finest-level only
//     0.30    0.996   0.915   0.993    1.358   1.384   1.856    0.83 (2 pairs)
//     0.40    0.926   0.869   0.926    1.248   1.404   1.951    0.82 (1 pair)    ← shipped
//     0.50    0.882   0.838   0.919    1.251   1.412   1.933    0.71 (2 pairs)
//     0.65    0.809   0.821   0.941    1.254   1.494   2.057    0.78 (4 pairs)
// 0.5 buys ~4% more 3D separation than 0.4 and gives back a chunk of the collide invariant for it
// (0.82 → 0.71); 0.65 starts pulling the FINEST level back apart (L2 worsens) because the coarse
// gravity begins to outweigh the level that actually sets local structure. 0.4 is the knee.
//
// TWO invariants from the flat version have to be preserved deliberately here:
//
// 1. ONE speed cap for the WHOLE stack, not one per level. COMMUNITY_MAX_STEP exists because an
//    uncapped community step outruns the collide relaxation; capping each level separately would let
//    L levels contribute up to L× the cap and silently reintroduce the overlap it was added to stop.
//    So every level's gravity + separation is summed into one velocity delta and clamped once.
// 2. The packing radius has to be computed RECURSIVELY, not from raw node radii. Summing rᵢ^dim over
//    a 500-node super-community answers "how big if you jam-packed its NODES", but its members are
//    not jam-packed — they sit in sub-clusters that are themselves held apart by COMMUNITY_SEP_MULT
//    lanes, so the real footprint is several times bigger. Feed that underestimate to the separation
//    force and it reads every super-cluster pair as already clear and barely fires. So each level
//    packs its CHILDREN's radii instead of the raw node radii:
//        R_a(C) = ( Σ_{child ∈ C} R_{a-1}(child)^dim / fill )^(1/dim)
//    with the finest level still packing raw node radii exactly as before. Note the children go in
//    UNPADDED: the pairwise target already multiplies by COMMUNITY_SEP_MULT, so padding them here
//    too compounds 1.6× per level. Measured with the padding on, the reference vault's coarse
//    separation over-inflated the whole field — the FINEST level's ratio got 23% (3D) / 50% (2D)
//    WORSE than finest-only, intra spread nearly doubled (1.83× baseline), and the 2D collide
//    invariant fell to 0.56. Unpadded, the same run improves every level and holds 0.82.
// (COMMUNITY_LEVEL_DECAY itself is declared next to DEFAULTS, which needs it at module init.)

/** One level of the community hierarchy as the force sees it: a dense per-node community index
 *  (-1 = not in a community at this level) and the strength this level acts at. */
interface CommunityLevel {
    comm: Int32Array
    numComms: number
    gravity: number
    separation: number
}

/** Per-level precomputed geometry (sizes, packing radii, participating communities, scratch). */
interface LevelState extends CommunityLevel {
    count: Float64Array
    packRadius: Float64Array
    big: number[]
    cx: Float64Array
    cy: Float64Array
    cz: Float64Array
    rx: Float64Array
    ry: Float64Array
    rz: Float64Array
}

/**
 * Per-level member counts + packing radii for a level stack (finest first). The recursive definition
 * (a coarse level packs its CHILDREN's radii, not raw node radii; see the "Nesting" block) is what
 * makes both gravity's packing floor AND separation's pairwise target realistic at every level of the
 * hierarchy, not just the finest — without it a super-community's radius would be computed as if its
 * members were flatly jam-packed, when they actually sit in sub-clusters with their own room around
 * them (and, for separation, held apart by their own COMMUNITY_SEP_MULT lanes on top of that).
 */
function levelPackRadii(
    levels: CommunityLevel[],
    radii: Float64Array,
    dim: 2 | 3,
    n: number,
): { counts: Float64Array[]; packRadius: Float64Array[] } {
    const fill = dim === 2 ? COMMUNITY_PACK_FILL_2D : COMMUNITY_PACK_FILL_3D
    const counts: Float64Array[] = []
    const packRadius: Float64Array[] = []
    for (let li = 0; li < levels.length; li++) {
        const { comm, numComms } = levels[li]
        const count = new Float64Array(numComms)
        for (let i = 0; i < n; i++) if (comm[i] >= 0) count[comm[i]]++
        const pr = new Float64Array(numComms)
        if (li === 0) {
            for (let i = 0; i < n; i++)
                if (comm[i] >= 0) pr[comm[i]] += Math.pow(radii[i], dim)
        } else {
            const childComm = levels[li - 1].comm
            const childN = levels[li - 1].numComms
            const childPr = packRadius[li - 1]
            // child community → this level's community (well-defined: the levels are strictly nested).
            const parentOf = new Int32Array(childN).fill(-1)
            for (let i = 0; i < n; i++) {
                const ch = childComm[i]
                if (ch >= 0 && comm[i] >= 0) parentOf[ch] = comm[i]
            }
            for (let c = 0; c < childN; c++) {
                const p = parentOf[c]
                if (p >= 0) pr[p] += Math.pow(childPr[c], dim)
            }
            // Nodes with no community at the finer level still occupy room in this one.
            for (let i = 0; i < n; i++)
                if (comm[i] >= 0 && childComm[i] < 0)
                    pr[comm[i]] += Math.pow(radii[i], dim)
        }
        for (let c = 0; c < numComms; c++)
            pr[c] = Math.pow(pr[c] / fill, 1 / dim)
        counts.push(count)
        packRadius.push(pr)
    }
    return { counts, packRadius }
}

/**
 * Per-tick community gravity + community-level collide, applied at every level of the hierarchy.
 * `levels[0]` is the FINEST (its `gravity`/`separation` are the tuned baseline); later entries are
 * successively coarser ancestors at decayed strength. Pure function of the node array —
 * deterministic, no RNG. `radii` holds each node's own collide radius (the same values the sim's
 * forceCollide uses); they seed the finest level's packing radius, inside which gravity stops
 * pulling (so a community is never squeezed into an overlap) and which doubles as the
 * community-level collide's body radius. Coarser levels derive theirs from the level below (see the
 * nesting block above).
 */
function communityForce(
    nodes: RN[],
    levels: CommunityLevel[],
    dim: 2 | 3,
    radii: Float64Array,
): (alpha: number) => void {
    const n = nodes.length
    const { counts, packRadius: packRadii } = levelPackRadii(
        levels,
        radii,
        dim,
        n,
    )
    const states: LevelState[] = levels.map((lv, li) => {
        const count = counts[li]
        // Communities big enough to repel each other as coarse bodies (index list, computed once).
        const big: number[] = []
        for (let c = 0; c < lv.numComms; c++)
            if (count[c] >= COMMUNITY_MIN_SIZE) big.push(c)
        return {
            ...lv,
            count,
            packRadius: packRadii[li],
            big,
            cx: new Float64Array(lv.numComms),
            cy: new Float64Array(lv.numComms),
            cz: new Float64Array(lv.numComms),
            rx: new Float64Array(lv.numComms),
            ry: new Float64Array(lv.numComms),
            rz: new Float64Array(lv.numComms),
        }
    })

    return (alpha: number) => {
        for (const s of states) {
            const {
                comm,
                numComms,
                count,
                packRadius,
                big,
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                separation,
            } = s
            cx.fill(0)
            cy.fill(0)
            cz.fill(0)
            for (let i = 0; i < n; i++) {
                const c = comm[i]
                if (c < 0) continue
                const nd = nodes[i]
                cx[c] += nd.x ?? 0
                cy[c] += nd.y ?? 0
                if (dim === 3) cz[c] += nd.z ?? 0
            }
            for (let c = 0; c < numComms; c++) {
                const k = count[c]
                if (k > 0) {
                    cx[c] /= k
                    cy[c] /= k
                    cz[c] /= k
                }
            }

            // (3) Community-level collide: resolve the overlap of two soft bodies of radius packRadius,
            // split between them by MASS (the smaller community yields more), exactly like d3's forceCollide.
            // Bounded by construction — zero force once the pair clears, so it dilates the assembly just
            // enough to open a lane and never inflates an already-separated graph.
            rx.fill(0)
            ry.fill(0)
            rz.fill(0)
            if (separation > 0 && big.length > 1) {
                for (let a = 0; a < big.length; a++) {
                    const ca = big[a]
                    for (let b = a + 1; b < big.length; b++) {
                        const cb = big[b]
                        const target =
                            (packRadius[ca] + packRadius[cb]) *
                            COMMUNITY_SEP_MULT
                        let dx = cx[ca] - cx[cb],
                            dy = cy[ca] - cy[cb],
                            dz = dim === 3 ? cz[ca] - cz[cb] : 0
                        let d = Math.sqrt(dx * dx + dy * dy + dz * dz)
                        if (d >= target) continue
                        if (d === 0) {
                            // Exactly coincident centroids: deterministic (no RNG) unit axis so they still separate.
                            dx = 1
                            dy = ca & 1 ? 1 : -1
                            dz = dim === 3 ? (cb & 1 ? 1 : -1) : 0
                            d = Math.sqrt(dx * dx + dy * dy + dz * dz)
                        }
                        // Displacement vector that would exactly clear the pair, split by mass share.
                        const push = ((target - d) / d) * separation
                        const total = count[ca] + count[cb]
                        const wa = count[cb] / total,
                            wb = count[ca] / total
                        rx[ca] += dx * push * wa
                        ry[ca] += dy * push * wa
                        rz[ca] += dz * push * wa
                        rx[cb] -= dx * push * wb
                        ry[cb] -= dy * push * wb
                        rz[cb] -= dz * push * wb
                    }
                }
            }
        }

        // (2) Centroid gravity + the accumulated (3) push, summed over EVERY level, both scaled by alpha
        // like every d3 force. Gravity only acts on the part of a node's offset that exceeds that level's
        // packing radius, so a cluster's (or super-cluster's) already-dense core is left alone — no
        // collide fight, no overlaps.
        for (let i = 0; i < n; i++) {
            const nd = nodes[i]
            let vx = 0,
                vy = 0,
                vz = 0
            for (const s of states) {
                const c = s.comm[i]
                if (c < 0) continue
                if (s.count[c] >= 2) {
                    const ox = s.cx[c] - (nd.x ?? 0),
                        oy = s.cy[c] - (nd.y ?? 0),
                        oz = dim === 3 ? s.cz[c] - (nd.z ?? 0) : 0
                    const d = Math.sqrt(ox * ox + oy * oy + oz * oz)
                    // Fraction of the offset that lies outside the packing radius (0 inside it → no pull at all).
                    const excess =
                        d > s.packRadius[c] ? (d - s.packRadius[c]) / d : 0
                    const g = s.gravity * alpha * excess
                    vx += ox * g
                    vy += oy * g
                    vz += oz * g
                }
                // Community-level collide (3) is accumulated per community, so every member gets the same push.
                vx += s.rx[c] * alpha
                vy += s.ry[c] * alpha
                if (dim === 3) vz += s.rz[c] * alpha
            }
            if (vx === 0 && vy === 0 && vz === 0) continue
            // ONE speed limit for the whole stack (see COMMUNITY_MAX_STEP + invariant 1 above) — keeps the
            // motion collide-trackable no matter how many levels contributed to it.
            const step = Math.sqrt(vx * vx + vy * vy + vz * vz)
            const cap = COMMUNITY_MAX_STEP * radii[i]
            if (step > cap) {
                const k = cap / step
                vx *= k
                vy *= k
                vz *= k
            }
            nd.vx = (nd.vx ?? 0) + vx
            nd.vy = (nd.vy ?? 0) + vy
            if (dim === 3) nd.vz = (nd.vz ?? 0) + vz
        }
    }
}

/** Deterministic LCG so layouts are reproducible (stable disk cache, testable). */
function lcg(seed: number): () => number {
    let s = seed >>> 0
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
}

/** FNV-1a hash of a string → 32-bit seed, so a node id maps to a reproducible LCG stream. */
function fnv1a(str: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return h >>> 0
}

/** Unweighted BFS shortest-path distances from `src`; unreachable nodes stay Infinity. */
function bfs(src: number, adj: number[][], n: number): Float64Array {
    const dist = new Float64Array(n).fill(Infinity)
    dist[src] = 0
    const queue = [src]
    let head = 0
    while (head < queue.length) {
        const u = queue[head++]
        const du = dist[u]
        for (const v of adj[u])
            if (dist[v] === Infinity) {
                dist[v] = du + 1
                queue.push(v)
            }
    }
    return dist
}

/** Connected-component id per node (0-based, in node-index discovery order). Deterministic BFS over the
 *  undirected adjacency — used to find the main mass so small disconnected components can be tethered to it. */
function connectedComponents(adj: number[][], n: number): Int32Array {
    const comp = new Int32Array(n).fill(-1)
    let next = 0
    const queue: number[] = []
    for (let s = 0; s < n; s++) {
        if (comp[s] !== -1) continue
        comp[s] = next
        queue.length = 0
        queue.push(s)
        let head = 0
        while (head < queue.length) {
            const u = queue[head++]
            for (const v of adj[u])
                if (comp[v] === -1) {
                    comp[v] = next
                    queue.push(v)
                }
        }
        next++
    }
    return comp
}

/**
 * PivotMDS initial coordinates. Picks k pivots by a max-min (k-center) sweep, BFS-distances every
 * node to each pivot, double-centers the squared-distance matrix, and projects onto the top `dim`
 * eigenvectors (power iteration + deflation on the small k×k Gram matrix). Returns an n×dim array.
 */
export function pivotMDS(
    adj: number[][],
    n: number,
    dim: number,
    numPivots: number,
): number[][] {
    if (n === 0) return []
    const k = Math.max(1, Math.min(numPivots, n))

    // Choose pivots: first arbitrary, each next maximizes its min-distance to the chosen set (spread).
    const dists: Float64Array[] = [bfs(0, adj, n)]
    const mind = Float64Array.from(dists[0])
    while (dists.length < k) {
        let best = -1,
            bestD = -1
        for (let i = 0; i < n; i++) {
            const d = mind[i] === Infinity ? -1 : mind[i]
            if (d > bestD) {
                bestD = d
                best = i
            }
        }
        if (best < 0 || bestD <= 0) best = dists.length % n // disconnected / covered — fill arbitrarily
        const db = bfs(best, adj, n)
        dists.push(db)
        for (let i = 0; i < n; i++) if (db[i] < mind[i]) mind[i] = db[i]
    }

    // Cap unreachable distances at maxFinite+1 so disconnected components stay finite but far.
    let maxFinite = 1
    for (const d of dists)
        for (let i = 0; i < n; i++)
            if (d[i] !== Infinity && d[i] > maxFinite) maxFinite = d[i]
    const cap = maxFinite + 1

    // Double-center the squared-distance matrix into C (n×k).
    const C: Float64Array[] = Array.from(
        { length: n },
        () => new Float64Array(k),
    )
    const colMean = new Float64Array(k)
    const rowMean = new Float64Array(n)
    let grand = 0
    for (let i = 0; i < n; i++) {
        let rm = 0
        for (let j = 0; j < k; j++) {
            const dij = dists[j][i] === Infinity ? cap : dists[j][i]
            const d2 = dij * dij
            C[i][j] = d2 // hold D² for now
            rm += d2
            colMean[j] += d2
            grand += d2
        }
        rowMean[i] = rm / k
    }
    for (let j = 0; j < k; j++) colMean[j] /= n
    grand /= n * k
    for (let i = 0; i < n; i++)
        for (let j = 0; j < k; j++) {
            C[i][j] = -0.5 * (C[i][j] - rowMean[i] - colMean[j] + grand)
        }

    // Gram matrix S = CᵀC (k×k, small).
    const S: Float64Array[] = Array.from(
        { length: k },
        () => new Float64Array(k),
    )
    for (let a = 0; a < k; a++)
        for (let b = a; b < k; b++) {
            let s = 0
            for (let i = 0; i < n; i++) s += C[i][a] * C[i][b]
            S[a][b] = s
            S[b][a] = s
        }

    // Top `dim` eigenvectors of S via power iteration with Gram-Schmidt deflation.
    const rand = lcg(0x9e3779b1)
    const eigvecs: Float64Array[] = []
    for (let a = 0; a < dim; a++) {
        let v = new Float64Array(k)
        for (let j = 0; j < k; j++) v[j] = rand() - 0.5
        for (let iter = 0; iter < 100; iter++) {
            for (const e of eigvecs) {
                // orthogonalize against already-found eigenvectors
                let dot = 0
                for (let j = 0; j < k; j++) dot += v[j] * e[j]
                for (let j = 0; j < k; j++) v[j] -= dot * e[j]
            }
            const w = new Float64Array(k) // w = S·v
            for (let p = 0; p < k; p++) {
                let s = 0
                const Sp = S[p]
                for (let j = 0; j < k; j++) s += Sp[j] * v[j]
                w[p] = s
            }
            let norm = 0
            for (let j = 0; j < k; j++) norm += w[j] * w[j]
            norm = Math.sqrt(norm) || 1
            for (let j = 0; j < k; j++) w[j] /= norm
            v = w
        }
        eigvecs.push(v)
    }

    // Coordinates X = C · eigvec (n×dim).
    const X: number[][] = Array.from({ length: n }, () =>
        new Array(dim).fill(0),
    )
    for (let i = 0; i < n; i++) {
        const Ci = C[i]
        for (let a = 0; a < dim; a++) {
            const e = eigvecs[a]
            let s = 0
            for (let j = 0; j < k; j++) s += Ci[j] * e[j]
            X[i][a] = s
        }
    }

    // Scale to a sane RMS radius and add a tiny deterministic jitter so no two nodes coincide
    // (coincident nodes trigger d3's random jiggle, which would make the refine non-deterministic).
    let rms = 0
    for (let i = 0; i < n; i++) {
        let r = 0
        for (let a = 0; a < dim; a++) r += X[i][a] * X[i][a]
        rms += r
    }
    rms = Math.sqrt(rms / n) || 1
    const scale = PIVOT_TARGET_RADIUS / rms
    const jit = lcg(0x85ebca6b)
    for (let i = 0; i < n; i++)
        for (let a = 0; a < dim; a++)
            X[i][a] = X[i][a] * scale + (jit() - 0.5) * 0.5
    return X
}

type RN = SimNode & { id: string }
type RL = SimLink<RN>
/** A force-link, with an optional flag marking a layout-only "tether" link that reels a disconnected
 *  component into the main mass (stronger + shorter than a real link; see prepareLayout's reel-in),
 *  and (when community forces are active) whether both endpoints sit in the SAME community. */
type VL = RL & { virtual?: boolean; intra?: boolean }
/** Same shape as `VL`, but with `source`/`target` narrowed to plain strings instead of `string |
 *  RN`. `SimLink.source`/`.target` widen to the resolved node once d3's `forceLink` mutates them
 *  in place during its own `initialize()` — `linLogLinkForce` never does that mutation (it looks
 *  ids up into a side `Map` instead), so at every point IT touches `links`, `source`/`target` are
 *  still the plain ids `prepareLayout` constructed them with. Exists only so
 *  `linLogLinkForce`'s `L extends { source: string; target: string }` constraint is satisfied
 *  without loosening that constraint (which exists to keep the module's own id-lookup code honest)
 *  or duplicating the module. */
type LLLink = Omit<VL, 'source' | 'target'> & { source: string; target: string }

/** Everything the community force needs that depends ONLY on the input — never on the seed or the
 *  settle: the undirected adjacency, the per-node collide radii, and the community level stack
 *  (finest first). Extracted from `prepareLayout` so it's built once and shared cleanly. */
interface LayoutGeometry {
    ids: string[]
    n: number
    adj: number[][]
    edgePairs: { a: number; b: number }[]
    realDeg: number[]
    linkDist: number
    radii: Float64Array
    comm: Int32Array
    numComms: number
    useCommunity: boolean
    levels: CommunityLevel[]
}

function layoutGeometry(
    input: LayoutInput,
    o: typeof DEFAULTS & LayoutOptions,
): LayoutGeometry {
    const dim = o.dimensions
    const ids = input.nodes.map(nd => nd.id)
    const n = ids.length

    const index = new Map<string, number>()
    ids.forEach((id, i) => index.set(id, i))

    // Dense per-node community index (-1 = unassigned). Community forces are only armed when the
    // caller actually supplied 2+ distinct communities — otherwise every knob below is skipped and the
    // layout is bit-for-bit the community-unaware one.
    const comm = new Int32Array(n).fill(-1)
    let numComms = 0
    if (o.communityForces) {
        const dense = new Map<number, number>()
        for (let i = 0; i < n; i++) {
            const c = input.nodes[i].community
            if (c === undefined || c === null || !Number.isFinite(c)) continue
            let d = dense.get(c)
            if (d === undefined) {
                d = dense.size
                dense.set(c, d)
            }
            comm[i] = d
        }
        numComms = dense.size
    }
    const useCommunity = numComms >= 2

    // Ancestor levels of the community hierarchy (coarsest → finest is how `communityPath` arrives;
    // here they are indexed by DISTANCE ABOVE THE FINEST, so `ancestors[0]` is the finest's parent).
    // Paths are read from the RIGHT so a node with a shorter path (there shouldn't be one, but a
    // hand-built or partially-stamped graph can produce one) simply contributes to fewer levels
    // instead of being misaligned into the wrong one. A level is kept only if it is a genuinely
    // COARSER grouping than the level below: strict nesting means an equal community count implies an
    // identical partition, and re-applying the same partition would just silently scale the finest
    // level's constants up. See the "Nesting" block above the force for what these levels do.
    const ancestors: CommunityLevel[] = []
    if (useCommunity && o.communityLevelDecay > 0) {
        let maxDepth = 0
        for (const nd of input.nodes) {
            const p = nd.communityPath
            if (p && p.length > maxDepth) maxDepth = p.length
        }
        let finerCount = numComms
        for (let up = 1; up < maxDepth; up++) {
            const dense = new Map<number, number>()
            const levelComm = new Int32Array(n).fill(-1)
            for (let i = 0; i < n; i++) {
                const p = input.nodes[i].communityPath
                if (!p || p.length <= up) continue
                const c = p[p.length - 1 - up]
                if (c === undefined || !Number.isFinite(c)) continue
                let d = dense.get(c)
                if (d === undefined) {
                    d = dense.size
                    dense.set(c, d)
                }
                levelComm[i] = d
            }
            if (dense.size < 2 || dense.size >= finerCount) break // degenerate or a duplicate of the level below
            const decay = Math.pow(o.communityLevelDecay, up)
            ancestors.push({
                comm: levelComm,
                numComms: dense.size,
                gravity: o.communityGravity * decay,
                separation: o.communitySeparation * decay,
            })
            finerCount = dense.size
        }
    }

    const adj: number[][] = Array.from({ length: n }, () => [])
    const edgePairs: { a: number; b: number }[] = []
    for (const e of input.edges) {
        const a = index.get(e.from),
            b = index.get(e.to)
        if (a === undefined || b === undefined || a === b) continue
        adj[a].push(b)
        adj[b].push(a)
        edgePairs.push({ a, b })
    }

    // Node spacing (mirrors the renderer): scale link distance UP as the graph shrinks so a handful of
    // nodes spreads into an airy field instead of a tight knot (~8× at a few nodes → 1× by ~400 nodes).
    // Needed up here so the collide floor + the virtual-link rest length below share one spacing budget.
    const smallBoost = n > 0 ? Math.min(8, Math.max(1, 400 / n)) : 1
    const linkDist =
        o.linkDistance * smallBoost * (dim === 2 ? MODE_2D_SPACING : 1)
    const collideFloor = linkDist * COLLIDE_RATIO

    // Real-edge degree per node, captured BEFORE the virtual tether links below — collide sizing reflects
    // the node as DRAWN (the renderer sizes by real degree), and the layout-only tethers must not inflate it.
    const realDeg = adj.map(a => a.length)

    // Per-node collide radius: leaves keep the uniform spacing floor; hubs get their actual drawn
    // radius (degree-scaled) so big nodes repel as the circles they're drawn as, not as points. `i`
    // indexes `nodes`, the same order as `adj`. Degree uses realDeg (real edges only) so the layout-only
    // tether links below don't inflate an orphan's drawn-size collision radius.
    const collideMult = dim === 2 ? MODE_2D_COLLIDE_MULT : 1
    const radii = Float64Array.from(
        realDeg,
        d =>
            collideMult *
            Math.max(
                collideFloor,
                drawnNodeRadius(degreeScale(d)) * COLLIDE_SIZE_PADDING,
            ),
    )

    // The community force's level stack, finest first (see the "Nesting" block).
    const levels: CommunityLevel[] = useCommunity
        ? [
              {
                  comm,
                  numComms,
                  gravity: o.communityGravity,
                  separation: o.communitySeparation,
              },
              ...ancestors,
          ]
        : []

    return {
        ids,
        n,
        adj,
        edgePairs,
        realDeg,
        linkDist,
        radii,
        comm,
        numComms,
        useCommunity,
        levels,
    }
}

/** Starting coordinates for the refine: the caller's `initialPositions` (warm start — the 2D layout
 *  is seeded from the flattened 3D one) or a cold PivotMDS. */
function seedCoords(
    g: Pick<LayoutGeometry, 'ids' | 'n' | 'adj'>,
    o: typeof DEFAULTS & LayoutOptions,
): number[][] {
    const dim = o.dimensions
    const RANDOM_COORD_RADIUS = 160
    const seed = o.initialPositions
    if (!seed) return pivotMDS(g.adj, g.n, dim, o.numPivots)
    return g.ids.map(id => {
        const p = seed[id]
        if (p) return [p[0], p[1], dim === 3 ? p[2] : 0]
        // Missing id (e.g. a newly-added node): pick a deterministic position seeded from a hash
        // of the id, so the warm-start layout stays reproducible instead of using Math.random().
        const rand = lcg(fnv1a(id))
        return [
            (rand() - 0.5) * RANDOM_COORD_RADIUS,
            (rand() - 0.5) * RANDOM_COORD_RADIUS,
            dim === 3 ? (rand() - 0.5) * RANDOM_COORD_RADIUS : 0,
        ]
    })
}

/** All layout setup short of running the tick loop: build the adjacency, seed coordinates
 *  (PivotMDS or `initialPositions`), and construct the stopped d3-force simulation. Shared by the
 *  sync `computeLayout` and the async, event-loop-yielding `computeLayoutAsync`. */
function prepareLayout(
    input: LayoutInput,
    o: typeof DEFAULTS & LayoutOptions,
): {
    sim: ReturnType<typeof forceSimulation<RN>>
    nodes: RN[]
    dim: 2 | 3
    mainIdx: number[]
} {
    const dim = o.dimensions
    const {
        ids,
        n,
        adj,
        edgePairs,
        realDeg,
        linkDist,
        radii,
        comm,
        useCommunity,
        levels,
    } = layoutGeometry(input, o)
    const collideRadiusFor = (_n: RN, i: number) => radii[i]

    // --- Reel in disconnected components --------------------------------------------------------------
    // A note with no in-view links is its own connected component; many-body repulsion flings it into an
    // empty angular direction at the cloud's edge (reads as a lone node "off to the side", and the recoil
    // shoves the main mass off-center so the pinned "You" hub drifts away from it). Fix: tie every node of
    // a SMALL non-main component to a few deterministically-chosen anchors in the main mass via virtual
    // links fed to the SAME force sim. Because the strays settle through the existing forceCollide (no
    // teleport), the emitted layout never has overlaps the warm renderer can't fix. The links are
    // layout-only (never shown as graph edges). Genuinely large separate islands (>= the gate) are left
    // alone so a legitimately multi-topic vault keeps its distinct clusters. The tether links go into the
    // SAME `links` array as real edges (flagged `virtual`) so forceLink's degree-bias is computed over the
    // combined set — the heavily-real-linked anchor stays put and the (real-edge-less) stray moves IN.
    const mainIdx: number[] = []
    const tetherPairs: { a: number; b: number }[] = []
    if (n > 0 && o.virtualAnchors > 0) {
        const comp = connectedComponents(adj, n)
        const compSize: number[] = []
        const compMin: number[] = []
        for (let i = 0; i < n; i++) {
            const c = comp[i]
            compSize[c] = (compSize[c] ?? 0) + 1
            if (compMin[c] === undefined) compMin[c] = i
        }
        let main = 0 // largest component; ties broken by the lowest member index for determinism
        for (let c = 1; c < compSize.length; c++) {
            if (
                compSize[c] > compSize[main] ||
                (compSize[c] === compSize[main] && compMin[c] < compMin[main])
            )
                main = c
        }
        for (let i = 0; i < n; i++) if (comp[i] === main) mainIdx.push(i)
        const mainSize = mainIdx.length
        if (mainSize > 0 && mainSize < n) {
            const gate = Math.max(4, mainSize * 0.25) // components at/above this are genuine islands — leave them
            for (let i = 0; i < n; i++) {
                if (comp[i] === main || compSize[comp[i]] >= gate) continue
                const picked = new Set<number>()
                for (let a = 0; a < o.virtualAnchors; a++) {
                    const anchor = mainIdx[fnv1a(`${ids[i]}:${a}`) % mainSize]
                    if (anchor === i || picked.has(anchor)) continue
                    picked.add(anchor)
                    adj[i].push(anchor)
                    adj[anchor].push(i) // connect for the PivotMDS seed too (no cap-distance fling)
                    tetherPairs.push({ a: i, b: anchor })
                }
            }
        }
    }
    // -------------------------------------------------------------------------------------------------

    const X = seedCoords({ ids, n, adj }, o)

    const nodes: RN[] = ids.map((id, i) => ({
        id,
        x: X[i][0] ?? 0,
        y: X[i][1] ?? 0,
        z: dim === 3 ? (X[i][2] ?? 0) : 0,
    }))

    // Pin pre-existing nodes for an incremental settle (see LayoutOptions.fixedIds): they hold their
    // seeded positions via d3's fx/fy/fz while the new nodes settle around them. Pinned nodes still
    // EXERT forces (so new nodes are repelled/spaced/linked correctly) but never move themselves — so an
    // add provably cannot disturb the established layout, and far fewer ticks are needed to converge.
    if (o.fixedIds && o.fixedIds.length > 0) {
        const fixed = new Set(o.fixedIds)
        for (const nd of nodes) {
            if (!fixed.has(nd.id)) continue
            nd.fx = nd.x
            nd.fy = nd.y
            if (dim === 3) nd.fz = nd.z
        }
    }

    // One link force over real + tether links. Tethers (virtual) are shorter and stronger so a stray is
    // held inside the cloud against the long-range many-body repulsion; real edges keep their own spacing.
    // Community-anisotropic springs (see the COMMUNITY_* block): intra-community edges pull harder over
    // a shorter rest length, inter-community edges are weak + long, so modularity turns into geometry.
    // Tethers are exempt (they exist to reel orphans in, not to express community structure).
    // NOTE (rest length vs strength under the shipped "linlog" default): the "shorter rest length"/
    // "long" half of that description is a "spring"-model-only effect — `linkDistFor` below (and
    // `.distance()` on `linkForce`) is built unconditionally but only ever attached to the sim in the
    // "spring" branch a little further down; under "linlog" it's computed and discarded. `linkStrengthFor`
    // is the live half under BOTH models — it feeds `linLogLinkForce`'s `strength` option directly under
    // the default. So today, "harder pull" (communityIntraLink/communityInterLink via linkStrengthFor) is
    // load-bearing; "shorter/longer rest length" (communityIntraDist/communityInterDist via linkDistFor)
    // is not.
    const links: VL[] = edgePairs.map(({ a, b }) => {
        const l: VL = { source: ids[a], target: ids[b] }
        if (useCommunity) l.intra = comm[a] >= 0 && comm[a] === comm[b]
        return l
    })
    for (const { a, b } of tetherPairs)
        links.push({ source: ids[a], target: ids[b], virtual: true })
    // INERT under the shipped "linlog" default — see the NOTE above. Only consulted by `linkForce`'s
    // `.distance()`, which is built below but only attached to the sim under `energyModel: "spring"`.
    const linkDistFor = !useCommunity
        ? (_l: VL) => linkDist
        : (l: VL) =>
              linkDist * (l.intra ? o.communityIntraDist : o.communityInterDist)
    // LIVE under both energy models — feeds `forceLink.strength()` under "spring" AND
    // `linLogLinkForce`'s `strength` option directly under "linlog" (see below).
    const linkStrengthFor = !useCommunity
        ? (_l: VL) => LINK_STRENGTH
        : (l: VL) =>
              LINK_STRENGTH *
              (l.intra ? o.communityIntraLink : o.communityInterLink)
    // Built unconditionally (cheap), but only ATTACHED to the sim under `energyModel: "spring"` — see
    // the branch below. Under the shipped "linlog" default this whole force object, and therefore its
    // `.distance()`/`linkDistFor`, is discarded unused.
    const linkForce = forceLink<RN, VL>(links)
        .id((d: RN) => d.id)
        .distance((l: VL) =>
            l.virtual ? linkDist * o.virtualDistMult : linkDistFor(l),
        )
        .strength((l: VL) =>
            l.virtual ? o.virtualLinkStrength : linkStrengthFor(l),
        )
    // Flattening to 2D loses a whole dimension of room, so the same forces that spread nicely in 3D
    // collapse into a dense blob in 2D. Compensate in 2D: stronger many-body repulsion pushes communities
    // apart (so clusters stay distinct, not one hairball) and weaker pull-to-center lets them breathe into
    // an even, honeycomb-spaced spread. 3D keeps the gentler defaults.
    const repulsion =
        dim === 2 ? o.repulsion * MODE_2D_REPULSION_MULT : o.repulsion
    const centering =
        dim === 2 ? o.centering * MODE_2D_CENTERING_MULT : o.centering
    // degreeRepulsion (ForceAtlas2-style): scale many-body repulsion by (degree + 1) instead of the
    // uniform default, so hubs push harder than leaves — see LayoutOptions.degreeRepulsion. This scales
    // TOTAL system repulsion, not just its distribution across nodes: mean degree is ~4.5 on the
    // reference vault, so this multiplies AGGREGATE many-body force by roughly (mean degree + 1) ≈ 5.5×
    // rather than merely redistributing a fixed budget from leaves toward hubs.
    const chargeStrength = o.degreeRepulsion
        ? (_n: RN, i: number) => repulsion * (realDeg[i] + 1)
        : () => repulsion
    const sim = forceSimulation<RN>(nodes, dim)
        .alpha(1)
        .force(
            'charge',
            forceManyBody<RN>().strength(chargeStrength).theta(MANYBODY_THETA),
        )
    // Link force per LayoutOptions.energyModel:
    //   - "linlog" (default) replaces the spring entirely — no rest length, so linkDistFor is unused
    //     here. Attraction ~ ln(1+d) is what makes cluster separation a property of the energy model —
    //     see linlog.ts and this module's header comment.
    //   - "spring" keeps the original forceLink instance built above (the pre-2026-07 behaviour).
    if (o.energyModel === 'linlog') {
        sim.force(
            'link',
            linLogLinkForce<RN, LLLink>(links as LLLink[], {
                id: (d: RN) => d.id,
                strength: (l: LLLink) =>
                    l.virtual ? o.virtualLinkStrength : linkStrengthFor(l),
                dim,
            }) as unknown as Parameters<typeof sim.force>[1],
        )
    } else {
        sim.force('link', linkForce)
    }
    // ORDER MATTERS: the community force must be registered BEFORE "collide". d3 runs forces in
    // insertion order and forceCollide resolves overlaps against `x + vx` — i.e. it can only see (and
    // undo) the velocity contributed by forces that ran earlier in the same tick. Registered after
    // collide, the community pull lands unchecked and only gets corrected a tick late, which on a
    // dense vault leaves permanently overlapping nodes.
    if (useCommunity && (o.communityGravity > 0 || o.communitySeparation > 0)) {
        // The community body radius is derived from the SAME per-node collide radii the sim's own
        // forceCollide uses, so both community forces automatically track every spacing/size multiplier.
        // ONE force for the whole hierarchy (finest first, then ancestors) — see invariant 1 in the
        // "Nesting" block: the per-tick speed cap has to bound the SUM of every level's contribution.
        sim.force('community', communityForce(nodes, levels, dim, radii))
    }
    sim.force(
        'collide',
        forceCollide<RN>(collideRadiusFor).iterations(COLLIDE_ITERATIONS),
    )
        .force('x', forceX<RN>(0).strength(centering))
        .force('y', forceY<RN>(0).strength(centering))
    if (dim === 3) sim.force('z', forceZ<RN>(0).strength(o.centering))
    sim.stop()
    return { sim, nodes, dim, mainIdx }
}

/** Round out the settled simulation into the id → [x,y,z] integer-coordinate map (z=0 in 2D). */
function extractPositions(nodes: RN[], dim: 2 | 3): Positions {
    const positions: Positions = {}
    for (const nd of nodes)
        positions[nd.id] = [
            Math.round(nd.x ?? 0),
            Math.round(nd.y ?? 0),
            Math.round(dim === 3 ? (nd.z ?? 0) : 0),
        ]
    return positions
}

/**
 * Full layout: PivotMDS initial placement (or `initialPositions` warm-start) + a short d3-force-3d
 * refinement (same forces as the renderer). Returns id → [x, y, z] with integer coordinates (z = 0
 * in 2D mode). Synchronous: the whole tick loop runs to completion on the calling thread — use
 * `computeLayoutAsync` on the server hot path so a big graph doesn't stall concurrent requests.
 */
/** DEFAULTS merged with the caller's options, plus the two defaults that aren't plain constants:
 *  `energyModel` defaults to `"linlog"` and `degreeRepulsion` to `true` (Task 5 — measured on the
 *  reference vault: d3 NP-degree separation 0.0557→0.1242, d2 0.0398→0.1302, both better than the
 *  "spring" pre-2026-07 default). Kept out of DEFAULTS only so this stays the one place every entry
 *  point resolves them through. */
function withDefaults(options: LayoutOptions): typeof DEFAULTS & LayoutOptions {
    const dimensions = options.dimensions ?? DEFAULTS.dimensions
    return {
        ...DEFAULTS,
        ...options,
        dimensions,
        energyModel: options.energyModel ?? 'linlog',
        degreeRepulsion: options.degreeRepulsion ?? true,
    }
}

export function computeLayout(
    input: LayoutInput,
    options: LayoutOptions = {},
): Positions {
    const o = withDefaults(options)
    if (input.nodes.length === 0) return {}
    const { sim, nodes, dim } = prepareLayout(input, o)
    for (let i = 0; i < o.refineTicks; i++) sim.tick()
    return extractPositions(nodes, dim)
}

/**
 * Identical result to `computeLayout`, but yields to the event loop on a WALL-CLOCK budget so a
 * multi-thousand-node settle doesn't monopolize Bun's single thread and block other requests —
 * and the /terminal WS pump — for seconds. A fixed tick-count granularity (the old YIELD_EVERY=16)
 * failed to bound the blocking interval because a single tick's cost scales with total node/edge
 * count (Barnes-Hut + 6-iteration collide): at a ~2k-node vault one tick is ~60ms, so 16 ticks
 * froze everything for ~1s per chunk on ordinary structural edits — the residual "terminal gets
 * laggy randomly" after the round-1 fixes. The budget degenerates to yield-every-tick on big
 * graphs (the best achievable without splitting a tick), cutting the worst chunk ~16x. d3-force
 * ticks are deterministic regardless of when we yield between them, so output is unchanged.
 */
const YIELD_BUDGET_MS = 8
// Convergence early-exit for an incremental (pinned) settle: once the only moving nodes (the new ones)
// stop moving more than EPSILON units in a tick, further ticks are no-ops, so we stop. Only armed when
// `fixedIds` is set — a full cold/warm settle runs at alpha(1) and keeps drifting (it would never fire),
// so this never changes non-incremental output. MIN guards against quitting before a far-seeded new node
// has begun travelling toward its links.
const INCREMENTAL_EXIT_EPSILON = 0.3
const INCREMENTAL_EXIT_MIN_TICKS = 8
const yieldToEventLoop = (): Promise<void> =>
    new Promise<void>(resolve => setImmediate(resolve))
export async function computeLayoutAsync(
    input: LayoutInput,
    options: LayoutOptions = {},
): Promise<Positions> {
    const o = withDefaults(options)
    if (input.nodes.length === 0) return {}
    const { sim, nodes, dim } = prepareLayout(input, o)
    const fixed =
        o.fixedIds && o.fixedIds.length > 0 ? new Set(o.fixedIds) : null
    // Snapshot of the previous tick's free-node positions, for the convergence check above.
    const px = fixed ? new Float64Array(nodes.length) : null
    const py = fixed ? new Float64Array(nodes.length) : null
    const pz = fixed ? new Float64Array(nodes.length) : null
    const snapshot = () => {
        if (!px || !py || !pz) return
        for (let j = 0; j < nodes.length; j++) {
            px[j] = nodes[j].x ?? 0
            py[j] = nodes[j].y ?? 0
            pz[j] = nodes[j].z ?? 0
        }
    }
    snapshot()
    let lastYield = performance.now()
    for (let i = 0; i < o.refineTicks; i++) {
        sim.tick()
        if (fixed && px && py && pz && i >= INCREMENTAL_EXIT_MIN_TICKS) {
            let maxMove2 = 0
            for (let j = 0; j < nodes.length; j++) {
                if (fixed.has(nodes[j].id)) continue // pinned: never moves
                const dx = (nodes[j].x ?? 0) - px[j]
                const dy = (nodes[j].y ?? 0) - py[j]
                const dz = dim === 3 ? (nodes[j].z ?? 0) - pz[j] : 0
                const m = dx * dx + dy * dy + dz * dz
                if (m > maxMove2) maxMove2 = m
            }
            if (maxMove2 < INCREMENTAL_EXIT_EPSILON * INCREMENTAL_EXIT_EPSILON)
                break
        }
        snapshot()
        if (performance.now() - lastYield >= YIELD_BUDGET_MS) {
            await yieldToEventLoop()
            lastYield = performance.now() // reset AFTER the await — only our own compute counts
        }
    }
    return extractPositions(nodes, dim)
}
