// Graph layout computation shared by the backend (precompute on graph change) and the app's
// layout Web Worker. Two stages:
//   1. PivotMDS (Brandes & Pich) — a fast, deterministic GLOBAL placement from graph-theoretic
//      distances to a handful of pivot nodes. Gets the overall shape right in O(k·(V+E)).
//   2. A short d3-force-3d REFINEMENT using the same forces/constants as the renderer, to polish
//      local spacing — this stage also carries a degree-weighted disc-flatten bias in 3D (see
//      discFlattenForce) so hub-heavy graphs settle into a "planet with rings" shape: heavily-linked
//      hubs stay roughly spherical while sparse leaves flatten toward the Y=0 plane.
//      Starting from PivotMDS means it converges in a fraction of the iterations a
//      random start needs — that's the whole point, since the force solve is the expensive part.
//   3. `LayoutOptions.clusterLayout` picks how the TOP-level clusters are arranged. DEFAULT (both
//      2D and 3D) is `"organic"` — the plain force settle (community gravity + community-level
//      collide), which is what the ASCII redesign renders: every individual node as a glyph, with
//      the hierarchy read through zoom-driven color + labels (AsciiGraphRenderer.ts), not a lattice.
//      `"grid"` is kept as an explicit 2D-only opt-in: a GRID-ISLAND post-pass on the seed translates
//      every top-level cluster rigidly onto a coarse lattice cell with provable empty lanes between
//      neighbours, and the refine then settles its members around that fixed anchor. See the
//      "GRID ISLANDS" block for why the organic settle alone could not separate this vault's clusters
//      (measured: it IS clusterable — Q = 0.45 — but 75% of its edges run through shared tag hubs) —
//      the grid mode remains available for callers that want that stronger separation.
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
} from "d3-force-3d";

export interface LayoutInput {
  /** `community` is the FINEST detected community id already stamped on every graph node by
   *  `engine.ts stampCommunities` (see community.ts). When present on 2+ distinct communities the
   *  layout adds community-aware forces (see COMMUNITY_* below); when absent the layout is
   *  byte-identical to the community-unaware behaviour.
   *  `communityPath` (coarsest → finest, last element === `community`) additionally arms the
   *  NESTED forces: one extra gravity + separation pair per ancestor level, at decaying strength,
   *  so super-clusters clump and spread the same way individual clusters do. A node array with no
   *  `communityPath` (or a 1-element one) behaves exactly as it did before hierarchies existed. */
  nodes: { id: string; community?: number; communityPath?: number[] }[];
  edges: { from: string; to: string }[];
}

export interface LayoutOptions {
  dimensions?: 2 | 3; // default 3
  numPivots?: number; // PivotMDS pivots (default 100); clamped to node count
  refineTicks?: number; // d3-force ticks after the PivotMDS init (default 150)
  repulsion?: number; // forceManyBody strength (default -10)
  linkDistance?: number; // default 5
  centering?: number; // forceX/Y/Z strength toward origin (default 0.13)
  /**
   * Optional id → [x,y,z] starting coordinates used INSTEAD of PivotMDS. Seeding the 2D layout from
   * the (flattened) 3D layout keeps the two aligned, so a 2D↔3D morph flattens in place rather than
   * scrambling — and it converges faster than a cold PivotMDS start. Missing ids (e.g. newly-added
   * nodes) get a deterministic position seeded from a hash of the id, so the layout stays reproducible.
   */
  initialPositions?: Positions;
  /**
   * Ids to PIN at their `initialPositions` coordinates for the whole settle (sets d3 fx/fy/fz). Used by
   * the incremental "add-only" rebuild (see layout-cache.ts): when a note is created, every pre-existing
   * node is pinned exactly where it already was and only the new node(s) settle in among them — so an
   * edit never scrambles the established layout and the refine converges in a fraction of the ticks.
   * Requires `initialPositions` to contain these ids. Pairs with the convergence early-exit below.
   */
  fixedIds?: string[];
  /**
   * Tuning for the disconnected-component "reel-in" (see prepareLayout). A note with no in-view links is
   * its own connected component; without this it gets flung into an empty direction at the cloud edge.
   * Each node of a SMALL non-main component gets `virtualAnchors` layout-only virtual links to the main
   * mass — springs of rest length `linkDistance·virtualDistMult` and strength `virtualLinkStrength` —
   * so the force solve pulls it into the cloud (the existing collide force keeps it overlap-free).
   * Defaults reel orphan memory notes into the 3rd-brain cloud; set virtualAnchors to 0 to disable.
   */
  virtualLinkStrength?: number;
  virtualAnchors?: number;
  virtualDistMult?: number;
  /**
   * "Planet with rings" 3D shape bias — extra pull toward the Y=0 plane (dim===3 only), weighted by
   * how peripheral a node is (see discFlattenForce). 0 (the default) = the roughly-spherical
   * behavior; higher = flatter disc. Shipped OFF: on a real vault the flattening read as a squashed
   * blob rather than a planet (rings need radial structure, not just flattening) — kept as an
   * option for the future ring-structure iteration. Purely a function of each node's OWN existing
   * (real-edge) degree — no extra analysis pass, no change to 2D output or the tick budget.
   */
  discBias?: number;
  /**
   * Community-aware clustering forces (default ON). Requires `community` on the input nodes — with
   * fewer than 2 distinct communities this is a no-op and output is identical either way. Set false
   * to reproduce the community-unaware layout exactly (used by the tuning harness / A-B tests).
   */
  communityForces?: boolean;
  /** Multiplier on LINK_STRENGTH for edges INSIDE a community (>1 = tighter clusters). */
  communityIntraLink?: number;
  /** Multiplier on LINK_STRENGTH for edges BETWEEN communities (<1 = looser coupling). */
  communityInterLink?: number;
  /** Multiplier on the link rest length for intra-/inter-community edges. */
  communityIntraDist?: number;
  communityInterDist?: number;
  /** Per-tick pull of each node toward its own community's centroid (0 = off). */
  communityGravity?: number;
  /** Strength (0..1, 0 = off) of the community-level collide that pushes whole communities apart
   *  until their packing radii clear. Same semantics as d3's forceCollide strength. */
  communitySeparation?: number;
  /** Per-ancestor-level falloff for the NESTED community forces: an ancestor `a` levels above the
   *  finest gets `communityGravity · decay^a` and `communitySeparation · decay^a`. 0 disables the
   *  coarse levels entirely (finest-only = the pre-hierarchy behaviour). See the COMMUNITY_* block. */
  communityLevelDecay?: number;
  /**
   * How the TOP-level clusters are arranged (see the GRID_* block below).
   *   - `"grid"`  — each top-level cluster ("island") is anchored on a coarse GRID cell, biggest
   *                 islands nearest the centre, with generous empty lanes between neighbours. Its
   *                 members settle around that fixed anchor; sub-clusters arrange INSIDE the island
   *                 via the unchanged nested community forces.
   *   - `"organic"` — the pure force settle (islands find their own places via community gravity +
   *                 community-level collide). This is the pre-grid behaviour, bit-for-bit.
   * DEFAULT: `"organic"` in both 2D and 3D (the ASCII redesign's ORGANIC layout — see
   * design/ascii/redesign — renders every individual node as a glyph, with the hierarchy read
   * through zoom-driven color + labels rather than a lattice of grid-cell "islands"; see
   * AsciiGraphRenderer.ts). `"grid"` is kept as an explicit opt-in (only takes effect in 2D — a flat
   * lattice would squash a 3D cloud — and only when the nodes actually carry communities; it is also
   * skipped for an incremental (`fixedIds`) rebuild, where pinned nodes must hold the positions the
   * previous — already gridded — build gave them).
   */
  clusterLayout?: "grid" | "organic";
}

export type Positions = Record<string, [number, number, number]>;

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
const COMMUNITY_LEVEL_DECAY = 0.4;
const DEFAULTS = {
  dimensions: 3 as 2 | 3, numPivots: 50, refineTicks: 150, repulsion: -7, linkDistance: 5, centering: 0.13,
  virtualLinkStrength: 1.2, virtualAnchors: 4, virtualDistMult: 0.8, discBias: 0,
  // --- Community-aware clustering (see the COMMUNITY_* block below) ---
  communityForces: true,
  // Cranked 2026-07-25 (user: tighter clumps, wider lanes, "like the design example"):
  // gravity .4→.6, separation .6→.85, inter links .35→.2 @ 1.9→2.6× rest length.
  communityIntraLink: 1.8, communityInterLink: 0.2,
  communityIntraDist: 1.0, communityInterDist: 2.6,
  communityGravity: 0.6, communitySeparation: 0.85,
  // Hierarchical ("clusters in clusters") nesting — see the COMMUNITY_LEVEL_DECAY block below.
  communityLevelDecay: COMMUNITY_LEVEL_DECAY,
};
const LINK_STRENGTH = 0.18;
// 2D-only force tuning (see prepareLayout): the flat layout has one less dimension of room, so without
// help it collapses into a hairball. Push communities apart (repulsion ×), let them breathe (centering
// ×) — 3D keeps the gentler defaults for both.
const MODE_2D_REPULSION_MULT = 3;
const MODE_2D_CENTERING_MULT = 0.5;
// Grid mode retargets the centering spring from the origin to each node's island ANCHOR, which makes
// it the force that holds the placement rather than a gentle pull to the middle — so it keeps the full
// `centering` strength instead of the halved 2D value. (The "let communities breathe" reason for
// halving it is served by the lattice's own lanes in grid mode.)
const GRID_CENTERING_MULT = 1;
// 0.65 (was 1.2): that extra padding on TOP of the already-larger 2D collide floor (COLLIDE_RATIO ×
// MODE_2D_SPACING) is what produced the "condensed honeycomb" look — on the real 2246-node vault it
// forced ~every leaf node to the exact same collide radius, so nearly all of them settled at a
// near-identical spacing (nearest-neighbour distance had a coefficient of variation of just 0.25 —
// a near-regular grid) regardless of which community/cluster they actually belonged to. Shrinking
// this multiplier lets real link/community structure set the local spacing instead of the collide
// floor: CV nearly doubles to 0.42 (organic, uneven spacing) with the 2D collide-floor minimum still
// comfortably respected (measured minimum pairwise distance stayed ~1.8× the theoretical floor).
// 3D is completely unaffected — this multiplier only ever applies in the `dim === 2` branch below.
const MODE_2D_COLLIDE_MULT = 0.65;
const COLLIDE_RATIO = 1.25;
// 6 (was 3): more solver passes per tick so overlaps actually resolve within the refine budget —
// notably in the 2D view, where nodes separated only along Z in 3D collapse onto the same XY and
// need the collide force to push them apart. Must match the renderer (WebGLRenderer.ts).
const COLLIDE_ITERATIONS = 6;
const MANYBODY_THETA = 1.5;
const MODE_2D_SPACING = 1.8;
const PIVOT_TARGET_RADIUS = 100; // PivotMDS output is scaled to this RMS radius; force refine sets the final scale

// Per-node collision sizing, mirrored from the renderer (WebGLRenderer.ts SIZE_* + nodeSize + fov).
// Nodes are DRAWN at a degree-scaled size (hubs up to ~6x a leaf), but collision used one uniform
// radius — so big hubs collided as points and overlapped. A node's drawn world radius is
// nodeSize*scale*tan(fov/2)/2 (sizeAttenuation); we space by that (×padding) when it beats the floor.
const NODE_SIZE = 6;             // renderer DEFAULT_CONFIG.nodeSize
const NODE_FOV_DEG = 60;         // renderer PerspectiveCamera fov
const SIZE_MIN_MULT = 0.4;
const SIZE_DEGREE_GAIN = 0.45;
const SIZE_MAX_MULT = 6;
const COLLIDE_SIZE_PADDING = 1.55; // gap around big hubs (was 1.25) so they don't visually cover neighbors
const degreeScale = (deg: number) => Math.min(SIZE_MAX_MULT, SIZE_MIN_MULT + SIZE_DEGREE_GAIN * Math.sqrt(deg));
const drawnNodeRadius = (scale: number) => (NODE_SIZE * scale * Math.tan(((NODE_FOV_DEG * Math.PI) / 180) / 2)) / 2;

/** Extra per-node pull toward Y=0, weighted by peripherality (1 - hub-ness on the SAME degreeScale
 *  curve used for collide sizing/draw size). Hubs (hubT→1) barely move; leaves (hubT→0) flatten hard.
 *  A pure function of realDeg — reused across full-graph/2nd-brain/3rd-brain/daemon layouts alike. */
function discFlattenForce(nodes: RN[], realDeg: number[], bias: number): (alpha: number) => void {
  const hubT = realDeg.map((d) => {
    const s = degreeScale(d);
    return (s - SIZE_MIN_MULT) / (SIZE_MAX_MULT - SIZE_MIN_MULT);
  });
  return (alpha: number) => {
    for (let i = 0; i < nodes.length; i++) {
      const flatten = bias * (1 - hubT[i]);
      if (flatten <= 0) continue;
      const nd = nodes[i];
      nd.vy = (nd.vy ?? 0) - (nd.y ?? 0) * flatten * alpha;
    }
  };
}

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
const COMMUNITY_MIN_SIZE = 4; // min members for a community to take part in community-level collide
// Radius a community occupies once its members are jam-packed at their own collide radii:
//   R = (Σ rᵢ^dim / φ)^(1/dim),  φ = the fraction a random (not crystalline) packing fills.
// Summing rᵢ^dim rather than using k·r^dim matters: a community's hubs carry a collide radius up to
// ~6× a leaf's (degreeScale), so a uniform-radius estimate under-reads a hub-heavy community's real
// footprint. Gravity is switched off inside this radius, and it is the "body radius" the
// community-level collide separates on.
const COMMUNITY_PACK_FILL_2D = 0.55; // random-loose disc packing
const COMMUNITY_PACK_FILL_3D = 0.5;  // random-loose sphere packing
// Target clearance between two communities' packing radii — >1 leaves an actual empty lane.
const COMMUNITY_SEP_MULT = 1.6; // 1.25 → 1.6 (2026-07-25): visibly wider empty lanes between clusters
// Per-tick speed limit for everything this force adds, as a multiple of the node's OWN collide
// radius. Both community terms can be large on the first ticks (alpha=1, communities still deeply
// interpenetrating), and an uncapped step drags a whole community across the field faster than the
// collide relaxation can track. Measured on the reference vault's 2D layout: uncapped, the worst
// pairwise distance/(rᵢ+rⱼ) is 0.65 and the separation ratio 1.111; at 1.5 they are 0.77 and 1.058
// (better on both counts). Clamping harder (0.5) is worse again (ratio 1.381) — the communities no
// longer reach their targets inside the tick budget.
const COMMUNITY_MAX_STEP = 1.5;

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

// --- GRID ISLANDS (2D opt-in; LayoutOptions.clusterLayout: "grid") ---------------------------------
// Measured verdict on the reference vault (2114 nodes / 4535 deduped edges): its Louvain partition
// has modularity Q = 0.45 at the finest level, 0.57 mid, 0.62 coarsest, against ~0.00 for a random
// partition of the same group count. The vault is GENUINELY, strongly clusterable — so when the
// picture still read as "one intermingled blob", the failure was the LAYOUT's, not the data's.
//
// Why the organic settle can't win it: the same partition also shows the vault is heavily
// TAG-MEDIATED hub-and-spoke — 75% of all edges are incident to a tag node, and the top 1% of nodes
// by degree touch 73% of the edges. Communities therefore share hubs, and a shared hub can only sit
// in one place: whatever the community forces do, a few very heavy bridges keep dragging clusters
// back into each other. (For comparison: with tag nodes removed the note-only graph scores Q = 0.86,
// and the vault's own FOLDER tree scores Q = -0.07 — folders carry no structure at all.)
//
// So the top level's positions are IMPOSED rather than negotiated: each top-level cluster (an
// "island") gets a cell on a coarse square lattice, ordered largest-first from the centre outward,
// and its members settle around that fixed anchor. Sub-clusters still arrange themselves INSIDE the
// island through the unchanged nested community forces — the grid replaces exactly one level of
// negotiation, the one the bridges were winning.
//
// LANE GUARANTEE (why the empty space is provable, not hoped for). An island of packing radius R
// gets a square block of `span = ceil(R / unit)` cells at pitch `P = 2·unit·(1 + GRID_LANE)`, so
//     R ≤ span·unit = span·P / (2·(1 + GRID_LANE)).
// Blocks never overlap, so two islands' anchors are ≥ (spanᵢ + spanⱼ)·P/2 apart along some axis, and
// the gap between their packing DISCS is
//     gap ≥ (spanᵢ + spanⱼ)·P/2 − Rᵢ − Rⱼ ≥ GRID_LANE · (Rᵢ + Rⱼ).
// At GRID_LANE = 0.75 that is 1.5× the mean of the two radii of clear space — comfortably the
// "at least one island-radius" the design asks for, and independent of `unit`, so the cell-count cap
// below can only ever make the lanes wider.
const GRID_LANE = 0.75;
// An island needs this many members to earn its own cell. Smaller top-level groups (on the reference
// vault: 143 fully-isolated notes, which are singleton communities at every level) have no structure
// to summarize — they ride along with the island they already settled nearest to.
const GRID_MIN_ISLAND = COMMUNITY_MIN_SIZE;
// Fewest islands a level must yield to be worth gridding. The grid takes the COARSEST level that
// clears this — 2 is the real floor (one island is not an arrangement), and it must stay that low on
// purpose: raising it lets a coarse level with only 3 super-clusters be REJECTED, at which point the
// grid drops down to a finer level and the levels above it get discarded — i.e. sub-clusters land on
// the lattice with no regard for which parent they belong to, which is exactly the nesting the grid is
// supposed to preserve ("sub-clusters arrange INSIDE their parent's island").
const GRID_MIN_ISLANDS = 2;
// The cell size ("unit" island radius) is a low quantile of the island radii rather than the max, so
// a single huge island doesn't set the pitch for the whole field and strand the small ones in
// oversized cells — it takes a multi-cell block instead.
const GRID_UNIT_QUANTILE = 0.25;
// Cap on the lattice's WIDTH in cells. This is a READABILITY constraint, not a geometric one: at the
// 100% (fit) stop the whole lattice maps to ~92% of the field, so two adjacent island anchors land
// ~0.92·cols/width columns apart on screen — and a capped 20-char cluster name is 26 columns wide
// (app/src/graph/labelSelection.ts `eyebrowWidthCells`, 0.14em tracking at 11.5px on a 6.3px cell).
// Measured on the reference vault at 1400×900 (219 columns): the mosaic spans 182 columns, so a width
// of 6 gives ~30 columns per cell step — a name per island with clear space, where 8 gave only ~23 and
// two adjacent islands would contend. When the packing wants a wider lattice the unit is grown until
// it fits, which only widens the lanes (see above). A level with more than ~GRID_MAX_SIDE² islands
// can't be satisfied and degrades to best-effort; the renderer then drops contending names rather than
// overlapping them, which is also what happens at the FINER aggregate stops (46 and 75 entities on the
// reference vault) where contention is inherent.
const GRID_MAX_SIDE = 6;
const GRID_UNIT_GROWTH = 1.25;
// Target width:height of the whole mosaic. A graph pane is LANDSCAPE (~1.6:1 on a normal window), and
// the world→screen projection is isotropic, so a SQUARE mosaic fitted to the pane's height leaves ~40%
// of the width empty — measured as an ink coverage of 0.53 against 0.85 for an aspect-matched one.
// Implemented as an anisotropic placement score (x compressed by this factor), so the spiral grows a
// wide ellipse instead of a circle. Not a hard bound — one enormous island can still make the mosaic
// taller than this — just the preference the placement order expresses.
const GRID_ASPECT = 1.6;
// Spring strength multiplier for a link that CROSSES an island boundary (and for the orphan tethers,
// which are hash-picked and therefore cross freely). 0 = released entirely.
// This is the piece without which the whole thing does not work, and it took a measurement to see:
// with the inter-community multiplier (0.2) still applied across islands, the reference vault's
// mosaic formed in the right ARRANGEMENT but contracted to ~0.5× its lattice — settled island
// centroids sat at 0.26-0.68 of their anchor magnitude, and 64 of 105 island pairs still overlapped.
// The cause is arithmetic, not subtle: 4535 edges, most of them island-crossing and stretched to
// ~1000 world units against a 29-unit rest length, each contributing ~0.036 of that separation per
// tick, collectively overwhelm a single 0.13 anchor spring per node. The same applies to the 572
// orphan tethers (strength 1.2 each, endpoints chosen by hash so they criss-cross the whole mosaic).
// Releasing them is not a fudge — it is the definition of "imposed rather than negotiated": inter-island
// edges are still DRAWN, they just no longer vote on where the islands go. Orphans lose nothing by it
// either: the anchor spring places each one on its host island, which is what the tethers were for.
const GRID_INTER_ISLAND_LINK = 0;

// --- CONTAINMENT (grid mode) ----------------------------------------------------------------------
// The grid pass above fixes where an island's CENTROID sits; on its own it does not bound where the
// island's MEMBERS end up — "the clusters are visual, but once I zoom in the notes are all over the
// place, even outside where the cluster was". The anchor spring (`centering` = 0.13) is a linear
// pull, so a member settles wherever it balances the many-body repulsion of ~2000 other nodes, and
// nothing says where that is. Measured on the reference vault (2114 nodes, 15 islands):
//   - against the lattice BLOCK alone, 98.7% of nodes were already inside — the blocks are much
//     larger than most islands need, so that bound was never the binding one;
//   - against the disc this block defines below (the island's own footprint wherever that is tighter
//     than its block), 95.7% — and the miss is concentrated exactly where it is most visible: only
//     50% of the 172 RIDERS (notes whose own top-level group is too small to earn a cell — on this
//     vault, the fully-isolated ones) were inside the island they were placed on, individual notes
//     sat up to 73× the radius away, and once riders are counted as part of the island they were
//     placed on, 42 of the 105 island PAIRS overlapped.
// So the lanes were not empty, and an island expanded to fill whatever cell it was given: a 15-note
// island's members spread over a p95 radius of 4827 world units against a footprint of 51 — a haze
// across the entire mosaic rather than a container, with the aggregate mass drawn at its centroid
// summarizing notes that were nowhere near it.
//
// So membership is CONSTRAINED, not merely encouraged: each node is held inside a disc centred on its
// island's anchor, of radius
//     Rc = min( span·unit,  CONTAIN_ISLAND_SLACK · hostedRadius )
// The two terms do different jobs and both are needed.
//   - `span·unit` is the block's INSCRIBED radius, and it is what keeps the lanes provably empty:
//     two blocks of spans sᵢ,sⱼ never overlap, so their anchors are at least
//     (sᵢ+sⱼ)·P/2 = (sᵢ+sⱼ)·unit·(1+GRID_LANE) apart along some axis, hence the gap between the two
//     CONTAINMENT discs is
//         gap ≥ (sᵢ+sⱼ)·unit·(1+GRID_LANE) − sᵢ·unit − sⱼ·unit = GRID_LANE · (Rcᵢ + Rcⱼ),
//     i.e. the same guarantee the lattice already gave the packing discs, now extended to every
//     individual member. Capping at this term is what makes "nothing crosses into a lane" provable
//     rather than measured.
//   - `CONTAIN_ISLAND_SLACK · hostedRadius` sizes the disc to the island ITSELF (see
//     PlannedIsland.hostedRadius — its own packing radius plus the riders it hosts), which is what
//     turns it into a container: a small island contracts to a compact blob with clear space around
//     it instead of dilating into its cell.
//
// Shape of the constraint (per tick, on the projected position `x + vx` — see the ordering note where
// it is registered):
//   - inside CONTAIN_FREE_FRAC·Rc: nothing at all. The interior is where the organic settle lives.
//   - in the band up to Rc: a quadratically-ramped inward spring, so the wall is felt before it is
//     hit and the rim doesn't read as a hard circular cut.
//   - past Rc: a PROJECTION back onto the boundary (not a spring): the node's velocity is corrected
//     by exactly the overshoot. This is deliberately NOT alpha-scaled — alpha is ~0.03 by the end of
//     the refine, which is exactly when the constraint has to hold.
// Nested: every level FINER than the gridded one gets the same treatment around its own running
// centroid at CONTAIN_CHILD_SLACK × its packing radius, so a sub-cluster stays a compact blob inside
// its parent island instead of smearing across it (the child centroid is a mean of points already
// confined to the parent disc, so it is inside the parent by construction — the nested discs only
// have to bound the spread).
/** Multiple of an island's own footprint (`PlannedIsland.hostedRadius`) it is allowed to occupy, when
 *  that is tighter than its lattice block. > 1 because a settled island is not packed to its
 *  estimate exactly — it has to be able to hold its internal structure without fighting forceCollide.
 *  Swept on the reference vault (2114 nodes / 15 islands, 120 refine ticks; DILATION = per-island p95
 *  member spread / hostedRadius, collide = worst pairwise distance / (rᵢ+rⱼ) over the whole graph):
 *      slack   contained   riders   DILATION p50 / max   collide   overlapping pairs
 *      (none)      0.943    0.477   1.15 / 95.04          0.80      2359
 *      1.00        1.000    0.994   0.90 /  1.00          0.75      2636
 *      1.15        1.000    1.000   1.01 /  1.13          0.78      2521
 *      1.30        1.000    1.000   1.11 /  1.26          0.83      2460   ← shipped
 *      1.50        1.000    1.000   1.12 /  1.42          0.83      2490
 *  1.3 is the knee: containment is already total at 1.0, so the only thing left to buy is room, and
 *  1.3 buys enough of it to come in AHEAD of the unconstrained baseline on the collide invariant
 *  (0.83 vs 0.80) — i.e. islands are contained AND less jammed than before. Past it the constraint
 *  stops binding for most islands (DILATION p50 flat from 1.3 to 1.5) and only the containers get
 *  loose again (max 1.26 → 1.42). Tighter is measurably worse on collide for no containment gain. */
const CONTAIN_ISLAND_SLACK = 1.3;
/** Fraction of the containment radius that is completely free of the constraint. */
const CONTAIN_FREE_FRAC = 0.8;
/** Strength of the soft inward spring in the [free, Rc] band, as a fraction of the band width per
 *  tick at the rim. Deliberately much weaker than the anchor spring (`centering` = 0.13, which is
 *  already pulling every member in): the soft band exists to take the discontinuity off the wall,
 *  the projection past Rc is what actually contains. */
const CONTAIN_SPRING = 0.25;
/** Multiple of a FINER level's packing radius used as its nested containment disc. > 1 because a
 *  settled sub-cluster is not jam-packed: it holds its own children apart with COMMUNITY_SEP_MULT
 *  lanes, so its real footprint is a multiple of the jammed estimate. Sized to catch strays without
 *  compacting the sub-cluster (which is the community GRAVITY's job, gated at 1× the same radius). */
const CONTAIN_CHILD_SLACK = 2;
/** Per-tick speed limit for everything this force adds, as a multiple of the node's OWN collide
 *  radius — the same bound and for the same reason as COMMUNITY_MAX_STEP: a node can start hundreds
 *  of units outside its island (the seed is the flattened 3D layout, at a completely different
 *  scale), and an instant projection would drag it across the field faster than the collide
 *  relaxation can track, leaving overlaps behind it. Capped ONCE over all levels' contributions. */
const CONTAIN_MAX_STEP = 1.5;

/** One island's square block on the lattice. */
export interface IslandCell { comm: number; col: number; row: number; span: number }

/**
 * Place each island on the coarse lattice and return its ANCHOR in world coordinates (the block's
 * centre, recentred so the whole mosaic straddles the origin). Pure + deterministic: islands are
 * placed largest-radius-first (ties → smaller community id) into the free block whose centre is
 * nearest the origin (ties → smaller row, then column), so the biggest masses end up central and the
 * same island set always produces the same mosaic. See the GRID_* block above for the lane
 * guarantee and the cell-count cap.
 *
 * O(islands · side²) with `side` in the low tens — run once per layout, never per tick.
 */
export function gridIslandAnchors(
  islands: { comm: number; radius: number }[],
  opts: { lane?: number; unitQuantile?: number; maxSide?: number; aspect?: number } = {},
): { anchors: Map<number, [number, number]>; cells: IslandCell[]; pitch: number; unit: number; side: number } {
  const lane = opts.lane ?? GRID_LANE;
  const quantile = opts.unitQuantile ?? GRID_UNIT_QUANTILE;
  const maxSide = opts.maxSide ?? GRID_MAX_SIDE;
  const aspect = Math.max(1e-6, opts.aspect ?? GRID_ASPECT);
  const anchors = new Map<number, [number, number]>();
  if (islands.length === 0) return { anchors, cells: [], pitch: 0, unit: 0, side: 0 };

  // Cell size: a low quantile of the island radii, grown until the lattice's WIDTH fits `maxSide` (see
  // the GRID_MAX_SIDE comment — the cap is about label width, so it is the column count that matters,
  // and growing the unit shrinks every span, which can only widen the lanes).
  const ascending = islands.map((i) => Math.max(1e-6, i.radius)).sort((a, b) => a - b);
  let unit = ascending[Math.min(ascending.length - 1, Math.floor(ascending.length * quantile))];
  const spanFor = (r: number, u: number) => Math.max(1, Math.ceil(r / u - 1e-9));
  const sideFor = (u: number) => {
    let area = 0;
    for (const it of islands) area += spanFor(it.radius, u) ** 2;
    return Math.ceil(Math.sqrt(area * aspect)); // width of an `aspect`-shaped block of that many cells
  };
  // Bounded: each step shrinks every span, and all-spans-1 gives side = ceil(sqrt(k)), the floor.
  for (let guard = 0; guard < 64 && sideFor(unit) > maxSide && unit < ascending[ascending.length - 1]; guard++) {
    unit *= GRID_UNIT_GROWTH;
  }
  const pitch = 2 * unit * (1 + lane);

  const order = [...islands].sort((a, b) => b.radius - a.radius || a.comm - b.comm);
  const spans = new Map<number, number>();
  for (const it of order) spans.set(it.comm, spanFor(it.radius, unit));
  // Search window: big enough to hold every block even in the degenerate "one long row" case.
  let maxSpan = 1;
  for (const s of spans.values()) if (s > maxSpan) maxSpan = s;
  const W = sideFor(unit) + maxSpan + 1;
  const stride = 2 * W + 1;
  const occupied = new Set<number>();
  const key = (c: number, r: number) => (c + W) * stride + (r + W);
  const blockFree = (c: number, r: number, s: number) => {
    for (let dc = 0; dc < s; dc++) for (let dr = 0; dr < s; dr++) if (occupied.has(key(c + dc, r + dr))) return false;
    return true;
  };
  // Candidate top-left positions per span, pre-ordered by |block centre| (then row, then col) so
  // placement is a single scan to the first free slot instead of a full O(W²) argmin per island.
  const candCache = new Map<number, { c: number; r: number }[]>();
  const candidates = (s: number) => {
    let list = candCache.get(s);
    if (!list) {
      list = [];
      for (let c = -W; c + s <= W; c++) for (let r = -W; r + s <= W; r++) list.push({ c, r });
      // Anisotropic: x compressed by `aspect`, so equal score is an ellipse and the mosaic grows
      // wider than tall — matching the landscape pane it will be fitted into.
      const score = (c: number, r: number) => ((c + s / 2) / aspect) ** 2 + (r + s / 2) ** 2;
      list.sort((a, b) => score(a.c, a.r) - score(b.c, b.r) || a.r - b.r || a.c - b.c);
      candCache.set(s, list);
    }
    return list;
  };

  const cells: IslandCell[] = [];
  for (const it of order) {
    const s = spans.get(it.comm)!;
    for (const cand of candidates(s)) {
      if (!blockFree(cand.c, cand.r, s)) continue;
      for (let dc = 0; dc < s; dc++) for (let dr = 0; dr < s; dr++) occupied.add(key(cand.c + dc, cand.r + dr));
      cells.push({ comm: it.comm, col: cand.c, row: cand.r, span: s });
      break;
    }
  }
  // Recentre on the mosaic's bounding box so the field straddles the origin (the renderer fits a
  // symmetric box; an off-centre mosaic would waste a margin on one side).
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const cl of cells) {
    if (cl.col < minC) minC = cl.col;
    if (cl.col + cl.span > maxC) maxC = cl.col + cl.span;
    if (cl.row < minR) minR = cl.row;
    if (cl.row + cl.span > maxR) maxR = cl.row + cl.span;
  }
  const ox = (minC + maxC) / 2, oy = (minR + maxR) / 2;
  for (const cl of cells) {
    anchors.set(cl.comm, [(cl.col + cl.span / 2 - ox) * pitch, (cl.row + cl.span / 2 - oy) * pitch]);
  }
  return { anchors, cells, pitch, unit, side: Math.max(maxC - minC, maxR - minR) };
}

/** One island of the gridded level, as planned onto the lattice. */
export interface PlannedIsland {
  /** Its community id AT THE GRIDDED LEVEL (an index into that level's dense community numbering). */
  comm: number;
  /** Nodes whose OWN gridded-level community this is. */
  count: number;
  /** Everything the island actually holds: `count` + the riders hosted on it (see `hostIsland`). */
  hosted: number;
  /** Packing radius of `count` (`levelPackRadii`) — what sized its lattice block. */
  packRadius: number;
  /** The island's real footprint: `packRadius` plus the area of the riders hosted on it (riders are
   *  members of no island, so they are in nobody's `packRadius`). */
  hostedRadius: number;
  /** Block side, in lattice cells. */
  span: number;
  /** World position of the block's centre — where the island's centroid is pinned. */
  anchor: [number, number];
  /** The island's centroid IN THE SEED, which the rigid translation onto `anchor` is measured from. */
  seedCentroid: [number, number];
  /** CONTAINMENT radius (see the CONTAINMENT block): the smaller of the block's inscribed radius
   *  (`span·unit`, which is what keeps the lattice's lanes provably empty) and the island's own
   *  footprint with slack (`CONTAIN_ISLAND_SLACK · hostedRadius`, which is what makes a small island
   *  read as a compact container instead of a haze filling an oversized cell). */
  containRadius: number;
}

/** The whole grid-island plan for one input: which level was gridded, the lattice it was gridded on,
 *  every island placed on it, which island each NODE belongs to, and the per-level packing radii the
 *  nested containment discs are sized from. */
export interface IslandPlan {
  /** Index into the level stack (0 = finest) of the gridded level. */
  level: number;
  islands: PlannedIsland[];
  unit: number;
  pitch: number;
  /** Per NODE (input order): the island (a gridded-level community id) it is placed on and contained
   *  in — its own island, or, for a node whose gridded-level group is too small to earn a cell, the
   *  island it rides along with. Always a real island. */
  hostIsland: Int32Array;
  /** Per level (finest first), per community: member count / packing radius. */
  counts: Float64Array[];
  packRadius: Float64Array[];
}

/**
 * The whole grid placement decision: which level to grid, the lattice, each island's block + anchor,
 * which island every node belongs to, and each island's containment radius. Split out of
 * `prepareLayout` (which now only APPLIES it) so the plan is one thing that can be inspected and
 * measured — `gridIslandPlan` is the exported door onto it.
 *
 * `X` is the SEED (pre-translation): riders are hosted on the island they already settled nearest to,
 * which is the only part of the plan that depends on it. Returns null when no level yields a mosaic
 * worth drawing (see GRID_MIN_ISLANDS).
 */
function planIslands(
  levels: CommunityLevel[], radii: Float64Array, dim: 2 | 3, n: number, X: number[][],
): IslandPlan | null {
  const { counts, packRadius } = levelPackRadii(levels, radii, dim, n);
  // Grid the COARSEST level that still yields a mosaic worth drawing (see GRID_MIN_ISLANDS). Levels
  // COARSER than the gridded one are dropped by the caller: their separation force would shove whole
  // super-clusters off the absolute anchors the grid just handed out.
  let gi = -1;
  for (let l = levels.length - 1; l >= 0; l--) {
    let islands = 0;
    for (let c = 0; c < levels[l].numComms; c++) if (counts[l][c] >= GRID_MIN_ISLAND) islands++;
    if (islands >= GRID_MIN_ISLANDS) { gi = l; break; }
  }
  if (gi < 0) return null;
  const lvl = levels[gi];
  const list: { comm: number; radius: number }[] = [];
  for (let c = 0; c < lvl.numComms; c++) if (counts[gi][c] >= GRID_MIN_ISLAND) list.push({ comm: c, radius: packRadius[gi][c] });
  const { anchors, cells, pitch, unit } = gridIslandAnchors(list);
  const spanOf = new Map(cells.map((cl) => [cl.comm, cl.span]));
  // Islands are the placed ones: an unplaceable group (no free block — degenerate, past
  // GRID_MAX_SIDE²) has no anchor and rides along like any other too-small group.
  const placed = list.filter((it) => anchors.has(it.comm));
  if (placed.length === 0) return null;
  const islandComms = placed.map((it) => it.comm);
  const isIsland = new Uint8Array(lvl.numComms);
  for (const c of islandComms) isIsland[c] = 1;

  // Seed centroid per gridded-level community — the rigid translation's origin, and what a rider's
  // host is chosen by.
  const scx = new Float64Array(lvl.numComms), scy = new Float64Array(lvl.numComms);
  for (let i = 0; i < n; i++) {
    const c = lvl.comm[i];
    if (c < 0) continue;
    scx[c] += X[i][0] ?? 0; scy[c] += X[i][1] ?? 0;
  }
  for (let c = 0; c < lvl.numComms; c++) if (counts[gi][c] > 0) { scx[c] /= counts[gi][c]; scy[c] /= counts[gi][c]; }

  // Host every node: its own island, else the island whose seed centroid it is nearest to, so it
  // stays with the neighbourhood it visually belongs to instead of piling up at the origin.
  //
  // Hosting is decided per GROUP, not per node: every member of a too-small gridded-level community
  // rides along with the SAME island. Choosing per node splits such a group across islands, and a
  // split group's nested containment disc — centred on its own centroid, which then sits in a lane
  // between the two — pulls its members straight back out of the islands they were placed on. The two
  // constraints cancel (they are summed before the one speed cap), so the members simply stop moving:
  // measured on the reference vault, 3 islands were left with a p95 member spread of 1.1k-1.9k world
  // units (a whole lattice cell) against a containment radius of ~50.
  const nearestIsland = (x: number, y: number): number => {
    let host = islandComms[0], best = Infinity;
    for (const ic of islandComms) {
      const d = (x - scx[ic]) ** 2 + (y - scy[ic]) ** 2;
      if (d < best) { best = d; host = ic; }
    }
    return host;
  };
  const hostOfComm = new Int32Array(lvl.numComms).fill(-1);
  for (let c = 0; c < lvl.numComms; c++) {
    if (counts[gi][c] <= 0) continue;
    hostOfComm[c] = isIsland[c] ? c : nearestIsland(scx[c], scy[c]);
  }
  const hostIsland = new Int32Array(n);
  const hosted = new Float64Array(lvl.numComms);
  const riderPow = new Float64Array(lvl.numComms);
  for (let i = 0; i < n; i++) {
    const c = lvl.comm[i];
    // A node with no community at all at this level (a partially-stamped graph) has no group to ride
    // with, so it falls back to its own nearest island.
    const host = c >= 0 && hostOfComm[c] >= 0 ? hostOfComm[c] : nearestIsland(X[i][0] ?? 0, X[i][1] ?? 0);
    hostIsland[i] = host;
    hosted[host]++;
    if (host !== c) riderPow[host] += Math.pow(radii[i], dim);
  }
  const fill = dim === 2 ? COMMUNITY_PACK_FILL_2D : COMMUNITY_PACK_FILL_3D;

  const islands: PlannedIsland[] = placed.map((it) => {
    const span = spanOf.get(it.comm) ?? 1;
    // The island's real footprint: its own (recursively-packed — see invariant 2 in the "Nesting"
    // block, which is why this is bigger than a flat sum over its nodes) packing radius, plus the
    // area of the riders it hosts. Riders belong to no island, so they are in nobody's packRadius.
    const hostedRadius = Math.pow(Math.pow(it.radius, dim) + riderPow[it.comm] / fill, 1 / dim);
    return {
      comm: it.comm, count: counts[gi][it.comm], hosted: hosted[it.comm],
      packRadius: it.radius, hostedRadius, span,
      anchor: anchors.get(it.comm)!, seedCentroid: [scx[it.comm], scy[it.comm]],
      containRadius: Math.min(span * unit, CONTAIN_ISLAND_SLACK * hostedRadius),
    };
  });
  return { level: gi, islands, unit, pitch, hostIsland, counts, packRadius };
}

/**
 * The grid-island plan `computeLayout`'s 2D grid mode will use for this input — the lattice, the
 * islands on it, which island each node belongs to, and each island's containment radius. Exported
 * for the layout tests and the tuning harness, which measure whether members actually land inside
 * their island's disc. Returns null when the input isn't gridded at all (3D, `clusterLayout:
 * "organic"`, fewer than 2 communities / islands).
 *
 * Pass the same `initialPositions` the real layout will use (the flattened 3D layout — see
 * layout-cache.ts): the seed decides which island a rider is hosted on, so without it this reports
 * the plan for a COLD (PivotMDS-seeded) build instead, which is a different — if equally valid — one.
 */
export function gridIslandPlan(input: LayoutInput, options: LayoutOptions = {}): IslandPlan | null {
  const o = withDefaults({ dimensions: 2, ...options });
  if (o.clusterLayout !== "grid" || o.dimensions !== 2) return null;
  const g = layoutGeometry(input, o);
  if (!g.useCommunity) return null;
  return planIslands(g.levels, g.radii, o.dimensions, g.n, seedCoords(g, o));
}
// -------------------------------------------------------------------------------------------------

/** One level of the community hierarchy as the force sees it: a dense per-node community index
 *  (-1 = not in a community at this level) and the strength this level acts at. `anchorX/anchorY`
 *  (grid mode only, see the GRID_* block) replace the level's running CENTROID with a fixed target
 *  per community — NaN for a community with no anchor, which falls back to the centroid. */
interface CommunityLevel {
  comm: Int32Array;
  numComms: number;
  gravity: number;
  separation: number;
  anchorX?: Float64Array;
  anchorY?: Float64Array;
}

/** Per-level precomputed geometry (sizes, packing radii, participating communities, scratch). */
interface LevelState extends CommunityLevel {
  count: Float64Array;
  packRadius: Float64Array;
  big: number[];
  cx: Float64Array; cy: Float64Array; cz: Float64Array;
  rx: Float64Array; ry: Float64Array; rz: Float64Array;
}

/**
 * Per-level member counts + packing radii for a level stack (finest first). Extracted from
 * `communityForce` because grid placement needs the SAME radii the separation force uses — the
 * recursive definition (a coarse level packs its CHILDREN's radii, not raw node radii; see invariant
 * 2 in the "Nesting" block) is exactly what makes a super-cluster's footprint realistic, and sizing
 * grid cells from the flat estimate instead would let islands bleed into their lanes.
 */
function levelPackRadii(
  levels: CommunityLevel[],
  radii: Float64Array,
  dim: 2 | 3,
  n: number,
): { counts: Float64Array[]; packRadius: Float64Array[] } {
  const fill = dim === 2 ? COMMUNITY_PACK_FILL_2D : COMMUNITY_PACK_FILL_3D;
  const counts: Float64Array[] = [];
  const packRadius: Float64Array[] = [];
  for (let li = 0; li < levels.length; li++) {
    const { comm, numComms } = levels[li];
    const count = new Float64Array(numComms);
    for (let i = 0; i < n; i++) if (comm[i] >= 0) count[comm[i]]++;
    const pr = new Float64Array(numComms);
    if (li === 0) {
      for (let i = 0; i < n; i++) if (comm[i] >= 0) pr[comm[i]] += Math.pow(radii[i], dim);
    } else {
      const childComm = levels[li - 1].comm;
      const childN = levels[li - 1].numComms;
      const childPr = packRadius[li - 1];
      // child community → this level's community (well-defined: the levels are strictly nested).
      const parentOf = new Int32Array(childN).fill(-1);
      for (let i = 0; i < n; i++) {
        const ch = childComm[i];
        if (ch >= 0 && comm[i] >= 0) parentOf[ch] = comm[i];
      }
      for (let c = 0; c < childN; c++) {
        const p = parentOf[c];
        if (p >= 0) pr[p] += Math.pow(childPr[c], dim);
      }
      // Nodes with no community at the finer level still occupy room in this one.
      for (let i = 0; i < n; i++) if (comm[i] >= 0 && childComm[i] < 0) pr[comm[i]] += Math.pow(radii[i], dim);
    }
    for (let c = 0; c < numComms; c++) pr[c] = Math.pow(pr[c] / fill, 1 / dim);
    counts.push(count);
    packRadius.push(pr);
  }
  return { counts, packRadius };
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
  const n = nodes.length;
  const { counts, packRadius: packRadii } = levelPackRadii(levels, radii, dim, n);
  const states: LevelState[] = levels.map((lv, li) => {
    const count = counts[li];
    // Communities big enough to repel each other as coarse bodies (index list, computed once).
    const big: number[] = [];
    for (let c = 0; c < lv.numComms; c++) if (count[c] >= COMMUNITY_MIN_SIZE) big.push(c);
    return {
      ...lv, count, packRadius: packRadii[li], big,
      cx: new Float64Array(lv.numComms), cy: new Float64Array(lv.numComms), cz: new Float64Array(lv.numComms),
      rx: new Float64Array(lv.numComms), ry: new Float64Array(lv.numComms), rz: new Float64Array(lv.numComms),
    };
  });

  return (alpha: number) => {
    for (const s of states) {
      const { comm, numComms, count, packRadius, big, cx, cy, cz, rx, ry, rz, separation } = s;
      cx.fill(0); cy.fill(0); cz.fill(0);
      for (let i = 0; i < n; i++) {
        const c = comm[i];
        if (c < 0) continue;
        const nd = nodes[i];
        cx[c] += nd.x ?? 0; cy[c] += nd.y ?? 0;
        if (dim === 3) cz[c] += nd.z ?? 0;
      }
      for (let c = 0; c < numComms; c++) {
        const k = count[c];
        if (k > 0) { cx[c] /= k; cy[c] /= k; cz[c] /= k; }
      }

      // (3) Community-level collide: resolve the overlap of two soft bodies of radius packRadius,
      // split between them by MASS (the smaller community yields more), exactly like d3's forceCollide.
      // Bounded by construction — zero force once the pair clears, so it dilates the assembly just
      // enough to open a lane and never inflates an already-separated graph.
      rx.fill(0); ry.fill(0); rz.fill(0);
      if (separation > 0 && big.length > 1) {
        for (let a = 0; a < big.length; a++) {
          const ca = big[a];
          for (let b = a + 1; b < big.length; b++) {
            const cb = big[b];
            const target = (packRadius[ca] + packRadius[cb]) * COMMUNITY_SEP_MULT;
            let dx = cx[ca] - cx[cb], dy = cy[ca] - cy[cb], dz = dim === 3 ? cz[ca] - cz[cb] : 0;
            let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d >= target) continue;
            if (d === 0) {
              // Exactly coincident centroids: deterministic (no RNG) unit axis so they still separate.
              dx = 1; dy = ca & 1 ? 1 : -1; dz = dim === 3 ? (cb & 1 ? 1 : -1) : 0;
              d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
            // Displacement vector that would exactly clear the pair, split by mass share.
            const push = ((target - d) / d) * separation;
            const total = count[ca] + count[cb];
            const wa = count[cb] / total, wb = count[ca] / total;
            rx[ca] += dx * push * wa; ry[ca] += dy * push * wa; rz[ca] += dz * push * wa;
            rx[cb] -= dx * push * wb; ry[cb] -= dy * push * wb; rz[cb] -= dz * push * wb;
          }
        }
      }
    }

    // (2) Centroid gravity + the accumulated (3) push, summed over EVERY level, both scaled by alpha
    // like every d3 force. Gravity only acts on the part of a node's offset that exceeds that level's
    // packing radius, so a cluster's (or super-cluster's) already-dense core is left alone — no
    // collide fight, no overlaps.
    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      let vx = 0, vy = 0, vz = 0;
      for (const s of states) {
        const c = s.comm[i];
        if (c < 0) continue;
        // Gravity target: the level's running CENTROID, or — in grid mode, for a community that owns
        // a lattice cell — that cell's FIXED anchor, so the island gathers itself onto the grid
        // instead of drifting with its own centre of mass.
        const anchored = s.anchorX !== undefined && s.anchorY !== undefined && Number.isFinite(s.anchorX[c]);
        if (s.count[c] >= 2 || anchored) {
          const tx = anchored ? s.anchorX![c] : s.cx[c];
          const ty = anchored ? s.anchorY![c] : s.cy[c];
          const ox = tx - (nd.x ?? 0), oy = ty - (nd.y ?? 0), oz = dim === 3 ? s.cz[c] - (nd.z ?? 0) : 0;
          const d = Math.sqrt(ox * ox + oy * oy + oz * oz);
          // Fraction of the offset that lies outside the packing radius (0 inside it → no pull at all).
          const excess = d > s.packRadius[c] ? (d - s.packRadius[c]) / d : 0;
          const g = s.gravity * alpha * excess;
          vx += ox * g; vy += oy * g; vz += oz * g;
        }
        // Community-level collide (3) is accumulated per community, so every member gets the same push.
        vx += s.rx[c] * alpha; vy += s.ry[c] * alpha; if (dim === 3) vz += s.rz[c] * alpha;
      }
      if (vx === 0 && vy === 0 && vz === 0) continue;
      // ONE speed limit for the whole stack (see COMMUNITY_MAX_STEP + invariant 1 above) — keeps the
      // motion collide-trackable no matter how many levels contributed to it.
      const step = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const cap = COMMUNITY_MAX_STEP * radii[i];
      if (step > cap) {
        const k = cap / step;
        vx *= k; vy *= k; vz *= k;
      }
      nd.vx = (nd.vx ?? 0) + vx;
      nd.vy = (nd.vy ?? 0) + vy;
      if (dim === 3) nd.vz = (nd.vz ?? 0) + vz;
    }
  };
}

/** One containment disc per node: the community it belongs to at that level, that community's
 *  containment radius, and the disc's centre — a FIXED per-community anchor (the gridded island
 *  level) or, when `anchorX`/`anchorY` are absent, the community's own running centroid (the finer,
 *  nested levels). 2D only: grid mode is 2D-only, so there is no z term. */
interface ContainLevel {
  comm: Int32Array;
  numComms: number;
  radius: Float64Array;
  anchorX?: Float64Array;
  anchorY?: Float64Array;
}

/**
 * Per-tick radial CONTAINMENT (see the CONTAINMENT block above): hold every node inside its
 * community's disc at each level, finest first so the island level (last) wins. Works on the
 * PROJECTED position `x + vx` — the same thing forceCollide reads on the very next force — so an
 * overshoot contributed by the charge/link/community forces in THIS tick is corrected in this tick,
 * not a tick late. Pure + deterministic (no RNG); O(n · levels) per tick.
 */
function containmentForce(
  nodes: RN[],
  levels: ContainLevel[],
  radii: Float64Array,
): (alpha: number) => void {
  const n = nodes.length;
  // Scratch centroids, one set per centroid-centred level (null for an anchored one).
  const centroids = levels.map((lv) =>
    lv.anchorX && lv.anchorY
      ? null
      : { cx: new Float64Array(lv.numComms), cy: new Float64Array(lv.numComms), k: new Float64Array(lv.numComms) });
  return (_alpha: number) => {
    for (let li = 0; li < levels.length; li++) {
      const ct = centroids[li];
      if (!ct) continue;
      const comm = levels[li].comm;
      ct.cx.fill(0); ct.cy.fill(0); ct.k.fill(0);
      for (let i = 0; i < n; i++) {
        const c = comm[i];
        if (c < 0) continue;
        ct.cx[c] += nodes[i].x ?? 0; ct.cy[c] += nodes[i].y ?? 0; ct.k[c]++;
      }
      for (let c = 0; c < levels[li].numComms; c++) if (ct.k[c] > 0) { ct.cx[c] /= ct.k[c]; ct.cy[c] /= ct.k[c]; }
    }
    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      if (nd.fx != null) continue; // pinned by an incremental rebuild — it never moves
      let dvx = 0, dvy = 0;
      for (let li = 0; li < levels.length; li++) {
        const lv = levels[li];
        const c = lv.comm[i];
        if (c < 0) continue;
        const R = lv.radius[c];
        if (!(R > 0)) continue;
        const ct = centroids[li];
        const tx = ct ? ct.cx[c] : lv.anchorX![c];
        const ty = ct ? ct.cy[c] : lv.anchorY![c];
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
        const ox = (nd.x ?? 0) + (nd.vx ?? 0) + dvx - tx;
        const oy = (nd.y ?? 0) + (nd.vy ?? 0) + dvy - ty;
        const d = Math.sqrt(ox * ox + oy * oy);
        const free = R * CONTAIN_FREE_FRAC;
        if (d <= free || d === 0) continue;
        const band = Math.max(1e-9, R - free);
        const soft = Math.min(d - free, band);
        // Quadratic ramp through the band, plus the exact overshoot past the boundary.
        const step = CONTAIN_SPRING * soft * (soft / band) + Math.max(0, d - R);
        const k = step / d;
        dvx -= ox * k; dvy -= oy * k;
      }
      if (dvx === 0 && dvy === 0) continue;
      // ONE speed limit over every level's contribution (see CONTAIN_MAX_STEP).
      const mag = Math.sqrt(dvx * dvx + dvy * dvy);
      const cap = CONTAIN_MAX_STEP * radii[i];
      if (mag > cap) { const k = cap / mag; dvx *= k; dvy *= k; }
      nd.vx = (nd.vx ?? 0) + dvx;
      nd.vy = (nd.vy ?? 0) + dvy;
    }
  };
}
// -------------------------------------------------------------------------------------------------

/** Deterministic LCG so layouts are reproducible (stable disk cache, testable). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** FNV-1a hash of a string → 32-bit seed, so a node id maps to a reproducible LCG stream. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Unweighted BFS shortest-path distances from `src`; unreachable nodes stay Infinity. */
function bfs(src: number, adj: number[][], n: number): Float64Array {
  const dist = new Float64Array(n).fill(Infinity);
  dist[src] = 0;
  const queue = [src];
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    const du = dist[u];
    for (const v of adj[u]) if (dist[v] === Infinity) { dist[v] = du + 1; queue.push(v); }
  }
  return dist;
}

/** Connected-component id per node (0-based, in node-index discovery order). Deterministic BFS over the
 *  undirected adjacency — used to find the main mass so small disconnected components can be tethered to it. */
function connectedComponents(adj: number[][], n: number): Int32Array {
  const comp = new Int32Array(n).fill(-1);
  let next = 0;
  const queue: number[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    comp[s] = next;
    queue.length = 0; queue.push(s);
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      for (const v of adj[u]) if (comp[v] === -1) { comp[v] = next; queue.push(v); }
    }
    next++;
  }
  return comp;
}

/**
 * PivotMDS initial coordinates. Picks k pivots by a max-min (k-center) sweep, BFS-distances every
 * node to each pivot, double-centers the squared-distance matrix, and projects onto the top `dim`
 * eigenvectors (power iteration + deflation on the small k×k Gram matrix). Returns an n×dim array.
 */
export function pivotMDS(adj: number[][], n: number, dim: number, numPivots: number): number[][] {
  if (n === 0) return [];
  const k = Math.max(1, Math.min(numPivots, n));

  // Choose pivots: first arbitrary, each next maximizes its min-distance to the chosen set (spread).
  const dists: Float64Array[] = [bfs(0, adj, n)];
  const mind = Float64Array.from(dists[0]);
  while (dists.length < k) {
    let best = -1, bestD = -1;
    for (let i = 0; i < n; i++) {
      const d = mind[i] === Infinity ? -1 : mind[i];
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best < 0 || bestD <= 0) best = dists.length % n; // disconnected / covered — fill arbitrarily
    const db = bfs(best, adj, n);
    dists.push(db);
    for (let i = 0; i < n; i++) if (db[i] < mind[i]) mind[i] = db[i];
  }

  // Cap unreachable distances at maxFinite+1 so disconnected components stay finite but far.
  let maxFinite = 1;
  for (const d of dists) for (let i = 0; i < n; i++) if (d[i] !== Infinity && d[i] > maxFinite) maxFinite = d[i];
  const cap = maxFinite + 1;

  // Double-center the squared-distance matrix into C (n×k).
  const C: Float64Array[] = Array.from({ length: n }, () => new Float64Array(k));
  const colMean = new Float64Array(k);
  const rowMean = new Float64Array(n);
  let grand = 0;
  for (let i = 0; i < n; i++) {
    let rm = 0;
    for (let j = 0; j < k; j++) {
      const dij = dists[j][i] === Infinity ? cap : dists[j][i];
      const d2 = dij * dij;
      C[i][j] = d2; // hold D² for now
      rm += d2; colMean[j] += d2; grand += d2;
    }
    rowMean[i] = rm / k;
  }
  for (let j = 0; j < k; j++) colMean[j] /= n;
  grand /= n * k;
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) {
    C[i][j] = -0.5 * (C[i][j] - rowMean[i] - colMean[j] + grand);
  }

  // Gram matrix S = CᵀC (k×k, small).
  const S: Float64Array[] = Array.from({ length: k }, () => new Float64Array(k));
  for (let a = 0; a < k; a++) for (let b = a; b < k; b++) {
    let s = 0; for (let i = 0; i < n; i++) s += C[i][a] * C[i][b];
    S[a][b] = s; S[b][a] = s;
  }

  // Top `dim` eigenvectors of S via power iteration with Gram-Schmidt deflation.
  const rand = lcg(0x9e3779b1);
  const eigvecs: Float64Array[] = [];
  for (let a = 0; a < dim; a++) {
    let v = new Float64Array(k);
    for (let j = 0; j < k; j++) v[j] = rand() - 0.5;
    for (let iter = 0; iter < 100; iter++) {
      for (const e of eigvecs) { // orthogonalize against already-found eigenvectors
        let dot = 0; for (let j = 0; j < k; j++) dot += v[j] * e[j];
        for (let j = 0; j < k; j++) v[j] -= dot * e[j];
      }
      const w = new Float64Array(k); // w = S·v
      for (let p = 0; p < k; p++) { let s = 0; const Sp = S[p]; for (let j = 0; j < k; j++) s += Sp[j] * v[j]; w[p] = s; }
      let norm = 0; for (let j = 0; j < k; j++) norm += w[j] * w[j];
      norm = Math.sqrt(norm) || 1;
      for (let j = 0; j < k; j++) w[j] /= norm;
      v = w;
    }
    eigvecs.push(v);
  }

  // Coordinates X = C · eigvec (n×dim).
  const X: number[][] = Array.from({ length: n }, () => new Array(dim).fill(0));
  for (let i = 0; i < n; i++) {
    const Ci = C[i];
    for (let a = 0; a < dim; a++) {
      const e = eigvecs[a]; let s = 0;
      for (let j = 0; j < k; j++) s += Ci[j] * e[j];
      X[i][a] = s;
    }
  }

  // Scale to a sane RMS radius and add a tiny deterministic jitter so no two nodes coincide
  // (coincident nodes trigger d3's random jiggle, which would make the refine non-deterministic).
  let rms = 0;
  for (let i = 0; i < n; i++) { let r = 0; for (let a = 0; a < dim; a++) r += X[i][a] * X[i][a]; rms += r; }
  rms = Math.sqrt(rms / n) || 1;
  const scale = PIVOT_TARGET_RADIUS / rms;
  const jit = lcg(0x85ebca6b);
  for (let i = 0; i < n; i++) for (let a = 0; a < dim; a++) X[i][a] = X[i][a] * scale + (jit() - 0.5) * 0.5;
  return X;
}

type RN = SimNode & { id: string };
type RL = SimLink<RN>;
/** A force-link, with an optional flag marking a layout-only "tether" link that reels a disconnected
 *  component into the main mass (stronger + shorter than a real link; see prepareLayout's reel-in),
 *  and (when community forces are active) whether both endpoints sit in the SAME community. */
type VL = RL & { virtual?: boolean; intra?: boolean; island?: boolean };

/** Everything the grid plan and the forces need that depends ONLY on the input — never on the seed
 *  or the settle: the undirected adjacency, the per-node collide radii, and the community level
 *  stack (finest first). Extracted from `prepareLayout` so `gridIslandPlan` reproduces the exact
 *  plan a real layout will use without paying for a PivotMDS + settle. */
interface LayoutGeometry {
  ids: string[]; n: number;
  adj: number[][]; edgePairs: { a: number; b: number }[]; realDeg: number[];
  linkDist: number; radii: Float64Array;
  comm: Int32Array; numComms: number; useCommunity: boolean;
  levels: CommunityLevel[];
}

function layoutGeometry(input: LayoutInput, o: typeof DEFAULTS & LayoutOptions): LayoutGeometry {
  const dim = o.dimensions;
  const ids = input.nodes.map((nd) => nd.id);
  const n = ids.length;

  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));

  // Dense per-node community index (-1 = unassigned). Community forces are only armed when the
  // caller actually supplied 2+ distinct communities — otherwise every knob below is skipped and the
  // layout is bit-for-bit the community-unaware one.
  const comm = new Int32Array(n).fill(-1);
  let numComms = 0;
  if (o.communityForces) {
    const dense = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const c = input.nodes[i].community;
      if (c === undefined || c === null || !Number.isFinite(c)) continue;
      let d = dense.get(c);
      if (d === undefined) { d = dense.size; dense.set(c, d); }
      comm[i] = d;
    }
    numComms = dense.size;
  }
  const useCommunity = numComms >= 2;

  // Ancestor levels of the community hierarchy (coarsest → finest is how `communityPath` arrives;
  // here they are indexed by DISTANCE ABOVE THE FINEST, so `ancestors[0]` is the finest's parent).
  // Paths are read from the RIGHT so a node with a shorter path (there shouldn't be one, but a
  // hand-built or partially-stamped graph can produce one) simply contributes to fewer levels
  // instead of being misaligned into the wrong one. A level is kept only if it is a genuinely
  // COARSER grouping than the level below: strict nesting means an equal community count implies an
  // identical partition, and re-applying the same partition would just silently scale the finest
  // level's constants up. See the "Nesting" block above the force for what these levels do.
  const ancestors: CommunityLevel[] = [];
  if (useCommunity && o.communityLevelDecay > 0) {
    let maxDepth = 0;
    for (const nd of input.nodes) {
      const p = nd.communityPath;
      if (p && p.length > maxDepth) maxDepth = p.length;
    }
    let finerCount = numComms;
    for (let up = 1; up < maxDepth; up++) {
      const dense = new Map<number, number>();
      const levelComm = new Int32Array(n).fill(-1);
      for (let i = 0; i < n; i++) {
        const p = input.nodes[i].communityPath;
        if (!p || p.length <= up) continue;
        const c = p[p.length - 1 - up];
        if (c === undefined || !Number.isFinite(c)) continue;
        let d = dense.get(c);
        if (d === undefined) { d = dense.size; dense.set(c, d); }
        levelComm[i] = d;
      }
      if (dense.size < 2 || dense.size >= finerCount) break; // degenerate or a duplicate of the level below
      const decay = Math.pow(o.communityLevelDecay, up);
      ancestors.push({
        comm: levelComm,
        numComms: dense.size,
        gravity: o.communityGravity * decay,
        separation: o.communitySeparation * decay,
      });
      finerCount = dense.size;
    }
  }

  // Adjacency first; the force LINKS are materialized further down (after the grid pass), because in
  // grid mode a link's strength depends on whether it crosses an island boundary — which isn't known
  // until the islands have been placed.
  const adj: number[][] = Array.from({ length: n }, () => []);
  const edgePairs: { a: number; b: number }[] = [];
  for (const e of input.edges) {
    const a = index.get(e.from), b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    adj[a].push(b); adj[b].push(a);
    edgePairs.push({ a, b });
  }

  // Node spacing (mirrors the renderer): scale link distance UP as the graph shrinks so a handful of
  // nodes spreads into an airy field instead of a tight knot (~8× at a few nodes → 1× by ~400 nodes).
  // Needed up here so the collide floor + the virtual-link rest length below share one spacing budget.
  const smallBoost = n > 0 ? Math.min(8, Math.max(1, 400 / n)) : 1;
  const linkDist = o.linkDistance * smallBoost * (dim === 2 ? MODE_2D_SPACING : 1);
  const collideFloor = linkDist * COLLIDE_RATIO;

  // Real-edge degree per node, captured BEFORE the virtual tether links below — collide sizing reflects
  // the node as DRAWN (the renderer sizes by real degree), and the layout-only tethers must not inflate it.
  const realDeg = adj.map((a) => a.length);

  // Per-node collide radius: leaves keep the uniform spacing floor; hubs get their actual drawn
  // radius (degree-scaled) so big nodes repel as the circles they're drawn as, not as points. `i`
  // indexes `nodes`, the same order as `adj`. Degree uses realDeg (real edges only) so the layout-only
  // tether links below don't inflate an orphan's drawn-size collision radius. Computed HERE (before
  // the seed) because the grid pass needs it to size islands.
  const collideMult = dim === 2 ? MODE_2D_COLLIDE_MULT : 1;
  const radii = Float64Array.from(realDeg, (d) =>
    collideMult * Math.max(collideFloor, drawnNodeRadius(degreeScale(d)) * COLLIDE_SIZE_PADDING));

  // The community force's level stack, finest first (see the "Nesting" block). Built here so the grid
  // pass can read the top level's membership + packing radii before the sim is constructed.
  const levels: CommunityLevel[] = useCommunity
    ? [{ comm, numComms, gravity: o.communityGravity, separation: o.communitySeparation }, ...ancestors]
    : [];

  return { ids, n, adj, edgePairs, realDeg, linkDist, radii, comm, numComms, useCommunity, levels };
}

/** Starting coordinates for the refine: the caller's `initialPositions` (warm start — the 2D layout
 *  is seeded from the flattened 3D one) or a cold PivotMDS. Shared by `prepareLayout` and
 *  `gridIslandPlan`, which has to see the SAME seed to report the same island hosting. */
function seedCoords(
  g: Pick<LayoutGeometry, "ids" | "n" | "adj">,
  o: typeof DEFAULTS & LayoutOptions,
): number[][] {
  const dim = o.dimensions;
  const RANDOM_COORD_RADIUS = 160;
  const seed = o.initialPositions;
  if (!seed) return pivotMDS(g.adj, g.n, dim, o.numPivots);
  return g.ids.map((id) => {
    const p = seed[id];
    if (p) return [p[0], p[1], dim === 3 ? p[2] : 0];
    // Missing id (e.g. a newly-added node): pick a deterministic position seeded from a hash
    // of the id, so the warm-start layout stays reproducible instead of using Math.random().
    const rand = lcg(fnv1a(id));
    return [
      (rand() - 0.5) * RANDOM_COORD_RADIUS,
      (rand() - 0.5) * RANDOM_COORD_RADIUS,
      dim === 3 ? (rand() - 0.5) * RANDOM_COORD_RADIUS : 0,
    ];
  });
}

/** All layout setup short of running the tick loop: build the adjacency, seed coordinates
 *  (PivotMDS or `initialPositions`), and construct the stopped d3-force simulation. Shared by the
 *  sync `computeLayout` and the async, event-loop-yielding `computeLayoutAsync`. */
function prepareLayout(input: LayoutInput, o: typeof DEFAULTS & LayoutOptions): { sim: ReturnType<typeof forceSimulation<RN>>; nodes: RN[]; dim: 2 | 3; mainIdx: number[] } {
  const dim = o.dimensions;
  const { ids, n, adj, edgePairs, realDeg, linkDist, radii, comm, useCommunity, levels } = layoutGeometry(input, o);
  const collideRadiusFor = (_n: RN, i: number) => radii[i];

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
  const mainIdx: number[] = [];
  const tetherPairs: { a: number; b: number }[] = [];
  if (n > 0 && o.virtualAnchors > 0) {
    const comp = connectedComponents(adj, n);
    const compSize: number[] = [];
    const compMin: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = comp[i];
      compSize[c] = (compSize[c] ?? 0) + 1;
      if (compMin[c] === undefined) compMin[c] = i;
    }
    let main = 0; // largest component; ties broken by the lowest member index for determinism
    for (let c = 1; c < compSize.length; c++) {
      if (compSize[c] > compSize[main] || (compSize[c] === compSize[main] && compMin[c] < compMin[main])) main = c;
    }
    for (let i = 0; i < n; i++) if (comp[i] === main) mainIdx.push(i);
    const mainSize = mainIdx.length;
    if (mainSize > 0 && mainSize < n) {
      const gate = Math.max(4, mainSize * 0.25); // components at/above this are genuine islands — leave them
      for (let i = 0; i < n; i++) {
        if (comp[i] === main || compSize[comp[i]] >= gate) continue;
        const picked = new Set<number>();
        for (let a = 0; a < o.virtualAnchors; a++) {
          const anchor = mainIdx[fnv1a(`${ids[i]}:${a}`) % mainSize];
          if (anchor === i || picked.has(anchor)) continue;
          picked.add(anchor);
          adj[i].push(anchor); adj[anchor].push(i); // connect for the PivotMDS seed too (no cap-distance fling)
          tetherPairs.push({ a: i, b: anchor });
        }
      }
    }
  }
  // -------------------------------------------------------------------------------------------------

  const X = seedCoords({ ids, n, adj }, o);

  // --- Grid islands (2D opt-in — see the GRID_* block) ----------------------------------------------
  // A POST-PASS ON THE SEED, not a second simulation: the 2D seed is the settled 3D layout flattened,
  // so every island already carries its organically-settled internal structure. Each island is
  // translated RIGIDLY onto its lattice cell (structure intact, position imposed), and the settle that
  // follows then only has to relax the seams — which is why it converges inside the normal tick budget.
  let anchorX: Float64Array | null = null;
  let anchorY: Float64Array | null = null;
  /** Per-node community at the GRIDDED level (null when not in grid mode) — the island boundary the
   *  link force needs to know about (see GRID_INTER_ISLAND_LINK). */
  let islandOf: Int32Array | null = null;
  let forceLevels = levels;
  /** The containment discs the CONTAINMENT force enforces (null outside grid mode). */
  let containLevels: ContainLevel[] | null = null;
  const gridMode = o.clusterLayout === "grid" && dim === 2 && useCommunity
    && !(o.fixedIds && o.fixedIds.length > 0);
  const plan = gridMode ? planIslands(levels, radii, dim, n, X) : null;
  if (plan) {
    const gi = plan.level;
    const lvl = levels[gi];
    const ax = new Float64Array(lvl.numComms).fill(NaN);
    const ay = new Float64Array(lvl.numComms).fill(NaN);
    const scx = new Float64Array(lvl.numComms), scy = new Float64Array(lvl.numComms);
    /** Per-island containment radius (0 = not an island, i.e. no disc of its own). */
    const cr = new Float64Array(lvl.numComms);
    for (const isl of plan.islands) {
      ax[isl.comm] = isl.anchor[0]; ay[isl.comm] = isl.anchor[1];
      scx[isl.comm] = isl.seedCentroid[0]; scy[isl.comm] = isl.seedCentroid[1];
      cr[isl.comm] = isl.containRadius;
    }
    // Translate every island RIGIDLY from where the seed left it onto its lattice cell. `hostIsland`
    // carries a node whose own group was too small to earn a cell along with the island it already
    // settled nearest to, so it stays with the neighbourhood it visually belongs to (see planIslands).
    const hostIsland = plan.hostIsland;
    anchorX = new Float64Array(n); anchorY = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const host = hostIsland[i];
      X[i][0] = (X[i][0] ?? 0) + (ax[host] - scx[host]);
      X[i][1] = (X[i][1] ?? 0) + (ay[host] - scy[host]);
      anchorX[i] = ax[host]; anchorY[i] = ay[host];
    }
    // The gridded level: gravity toward the fixed anchor at FULL strength, separation off.
    //   - Full strength (not the `communityLevelDecay^gi` an ancestor level normally acts at) because
    //     this level is no longer a weak hint about where a super-cluster would like to be — it IS
    //     the placement. Measured on the reference vault with the decayed value (0.6·0.4² = 0.096):
    //     the finer levels' own gravity (0.6) and separation (0.85) simply overrode the anchors and
    //     the mosaic never formed — settled island centroids showed no lattice at all and 72 of 105
    //     island pairs still overlapped. At full strength the centroids land on their cells.
    //   - Separation off because the lattice already guarantees the lanes, and a community-level
    //     collide on top would push islands straight back off their cells.
    forceLevels = [...levels.slice(0, gi), {
      ...lvl, gravity: o.communityGravity, separation: 0, anchorX: ax, anchorY: ay,
    }];
    islandOf = lvl.comm;
    // CONTAINMENT discs, finest first so the island level (applied last) wins: one nested disc per
    // level BELOW the gridded one, around that community's running centroid at CONTAIN_CHILD_SLACK ×
    // its packing radius, then the island's own disc around its fixed anchor. See the CONTAINMENT block.
    containLevels = [
      ...levels.slice(0, gi).map((lv, li) => ({
        comm: lv.comm, numComms: lv.numComms,
        radius: Float64Array.from(plan.packRadius[li], (r) => r * CONTAIN_CHILD_SLACK),
      })),
      { comm: hostIsland, numComms: lvl.numComms, radius: cr, anchorX: ax, anchorY: ay },
    ];
  }
  // -------------------------------------------------------------------------------------------------

  const nodes: RN[] = ids.map((id, i) => ({
    id,
    x: X[i][0] ?? 0,
    y: X[i][1] ?? 0,
    z: dim === 3 ? (X[i][2] ?? 0) : 0,
  }));

  // Pin pre-existing nodes for an incremental settle (see LayoutOptions.fixedIds): they hold their
  // seeded positions via d3's fx/fy/fz while the new nodes settle around them. Pinned nodes still
  // EXERT forces (so new nodes are repelled/spaced/linked correctly) but never move themselves — so an
  // add provably cannot disturb the established layout, and far fewer ticks are needed to converge.
  if (o.fixedIds && o.fixedIds.length > 0) {
    const fixed = new Set(o.fixedIds);
    for (const nd of nodes) {
      if (!fixed.has(nd.id)) continue;
      nd.fx = nd.x;
      nd.fy = nd.y;
      if (dim === 3) nd.fz = nd.z;
    }
  }

  // One link force over real + tether links. Tethers (virtual) are shorter and stronger so a stray is
  // held inside the cloud against the long-range many-body repulsion; real edges keep their own spacing.
  // Community-anisotropic springs (see the COMMUNITY_* block): intra-community edges pull harder over
  // a shorter rest length, inter-community edges are weak + long, so modularity turns into geometry.
  // Tethers are exempt (they exist to reel orphans in, not to express community structure).
  // `island` is set only in grid mode: false = the edge CROSSES an island boundary (see
  // GRID_INTER_ISLAND_LINK for why those springs are released).
  const links: VL[] = edgePairs.map(({ a, b }) => {
    const l: VL = { source: ids[a], target: ids[b] };
    if (useCommunity) l.intra = comm[a] >= 0 && comm[a] === comm[b];
    if (islandOf) l.island = islandOf[a] >= 0 && islandOf[a] === islandOf[b];
    return l;
  });
  for (const { a, b } of tetherPairs) links.push({ source: ids[a], target: ids[b], virtual: true });
  const linkDistFor = !useCommunity
    ? (_l: VL) => linkDist
    : (l: VL) => linkDist * (l.intra ? o.communityIntraDist : o.communityInterDist);
  const linkStrengthFor = !useCommunity
    ? (_l: VL) => LINK_STRENGTH
    : (l: VL) => LINK_STRENGTH * (l.intra ? o.communityIntraLink : o.communityInterLink);
  const linkForce = forceLink<RN, VL>(links)
    .id((d: RN) => d.id)
    .distance((l: VL) => (l.virtual ? linkDist * o.virtualDistMult : linkDistFor(l)))
    .strength((l: VL) => {
      // Grid mode: the top level's positions are IMPOSED, so nothing may negotiate them. Both the
      // island-crossing real edges and the orphan tethers are released (see GRID_INTER_ISLAND_LINK).
      if (islandOf && (l.virtual || l.island === false)) return LINK_STRENGTH * GRID_INTER_ISLAND_LINK;
      return l.virtual ? o.virtualLinkStrength : linkStrengthFor(l);
    });
  // Flattening to 2D loses a whole dimension of room, so the same forces that spread nicely in 3D
  // collapse into a dense blob in 2D. Compensate in 2D: stronger many-body repulsion pushes communities
  // apart (so clusters stay distinct, not one hairball) and weaker pull-to-center lets them breathe into
  // an even, honeycomb-spaced spread. 3D keeps the gentler defaults.
  const repulsion = dim === 2 ? o.repulsion * MODE_2D_REPULSION_MULT : o.repulsion;
  const centering = dim === 2
    ? o.centering * (anchorX ? GRID_CENTERING_MULT : MODE_2D_CENTERING_MULT)
    : o.centering;
  const sim = forceSimulation<RN>(nodes, dim)
    .alpha(1)
    .force("charge", forceManyBody<RN>().strength(repulsion).theta(MANYBODY_THETA))
    .force("link", linkForce);
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
    sim.force("community", communityForce(nodes, forceLevels, dim, radii));
  }
  // CONTAINMENT (grid mode only) — registered AFTER the community force and BEFORE "collide", for
  // both halves of the same ordering rule: it must see the velocity every placement force already
  // contributed this tick (so an overshoot is corrected in the same tick it was created), and
  // forceCollide must run after it (so a node pushed onto the island boundary can still be spaced
  // off its neighbours instead of being left overlapping until the next tick).
  if (containLevels) sim.force("contain", containmentForce(nodes, containLevels, radii));
  // Centering: normally a spring to the ORIGIN. In grid mode it becomes a spring to the node's own
  // island ANCHOR instead — that is what keeps each island bounded on its cell (the packing-gated
  // anchor gravity above only gathers strays; this linear term is what makes the placement stick, and
  // it can never squeeze past the collide floor because collide is registered after it).
  sim
    .force("collide", forceCollide<RN>(collideRadiusFor).iterations(COLLIDE_ITERATIONS))
    .force("x", (anchorX ? forceX<RN>((_nd: RN, i: number) => anchorX![i]) : forceX<RN>(0)).strength(centering))
    .force("y", (anchorY ? forceY<RN>((_nd: RN, i: number) => anchorY![i]) : forceY<RN>(0)).strength(centering));
  if (dim === 3) {
    sim.force("z", forceZ<RN>(0).strength(o.centering));
    if (o.discBias > 0) sim.force("disc", discFlattenForce(nodes, realDeg, o.discBias));
  }
  sim.stop();
  return { sim, nodes, dim, mainIdx };
}

/** Round out the settled simulation into the id → [x,y,z] integer-coordinate map (z=0 in 2D). */
function extractPositions(nodes: RN[], dim: 2 | 3): Positions {
  const positions: Positions = {};
  for (const nd of nodes) positions[nd.id] = [Math.round(nd.x ?? 0), Math.round(nd.y ?? 0), Math.round(dim === 3 ? (nd.z ?? 0) : 0)];
  return positions;
}

/**
 * Full layout: PivotMDS initial placement (or `initialPositions` warm-start) + a short d3-force-3d
 * refinement (same forces as the renderer). Returns id → [x, y, z] with integer coordinates (z = 0
 * in 2D mode). Synchronous: the whole tick loop runs to completion on the calling thread — use
 * `computeLayoutAsync` on the server hot path so a big graph doesn't stall concurrent requests.
 */
/** DEFAULTS merged with the caller's options, plus the one default that isn't a constant:
 *  `clusterLayout` defaults to `"organic"` in both dimensions (see LayoutOptions) — kept out of
 *  DEFAULTS only so this stays the one place every entry point resolves it through, same as before
 *  the dimension-dependent split existed. */
function withDefaults(options: LayoutOptions): typeof DEFAULTS & LayoutOptions {
  const dimensions = options.dimensions ?? DEFAULTS.dimensions;
  return {
    ...DEFAULTS, ...options, dimensions,
    clusterLayout: options.clusterLayout ?? "organic",
  };
}

export function computeLayout(input: LayoutInput, options: LayoutOptions = {}): Positions {
  const o = withDefaults(options);
  if (input.nodes.length === 0) return {};
  const { sim, nodes, dim } = prepareLayout(input, o);
  for (let i = 0; i < o.refineTicks; i++) sim.tick();
  return extractPositions(nodes, dim);
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
const YIELD_BUDGET_MS = 8;
// Convergence early-exit for an incremental (pinned) settle: once the only moving nodes (the new ones)
// stop moving more than EPSILON units in a tick, further ticks are no-ops, so we stop. Only armed when
// `fixedIds` is set — a full cold/warm settle runs at alpha(1) and keeps drifting (it would never fire),
// so this never changes non-incremental output. MIN guards against quitting before a far-seeded new node
// has begun travelling toward its links.
const INCREMENTAL_EXIT_EPSILON = 0.3;
const INCREMENTAL_EXIT_MIN_TICKS = 8;
const yieldToEventLoop = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));
export async function computeLayoutAsync(input: LayoutInput, options: LayoutOptions = {}): Promise<Positions> {
  const o = withDefaults(options);
  if (input.nodes.length === 0) return {};
  const { sim, nodes, dim } = prepareLayout(input, o);
  const fixed = o.fixedIds && o.fixedIds.length > 0 ? new Set(o.fixedIds) : null;
  // Snapshot of the previous tick's free-node positions, for the convergence check above.
  const px = fixed ? new Float64Array(nodes.length) : null;
  const py = fixed ? new Float64Array(nodes.length) : null;
  const pz = fixed ? new Float64Array(nodes.length) : null;
  const snapshot = () => {
    if (!px || !py || !pz) return;
    for (let j = 0; j < nodes.length; j++) { px[j] = nodes[j].x ?? 0; py[j] = nodes[j].y ?? 0; pz[j] = nodes[j].z ?? 0; }
  };
  snapshot();
  let lastYield = performance.now();
  for (let i = 0; i < o.refineTicks; i++) {
    sim.tick();
    if (fixed && px && py && pz && i >= INCREMENTAL_EXIT_MIN_TICKS) {
      let maxMove2 = 0;
      for (let j = 0; j < nodes.length; j++) {
        if (fixed.has(nodes[j].id)) continue; // pinned: never moves
        const dx = (nodes[j].x ?? 0) - px[j];
        const dy = (nodes[j].y ?? 0) - py[j];
        const dz = dim === 3 ? (nodes[j].z ?? 0) - pz[j] : 0;
        const m = dx * dx + dy * dy + dz * dz;
        if (m > maxMove2) maxMove2 = m;
      }
      if (maxMove2 < INCREMENTAL_EXIT_EPSILON * INCREMENTAL_EXIT_EPSILON) break;
    }
    snapshot();
    if (performance.now() - lastYield >= YIELD_BUDGET_MS) {
      await yieldToEventLoop();
      lastYield = performance.now(); // reset AFTER the await — only our own compute counts
    }
  }
  return extractPositions(nodes, dim);
}
