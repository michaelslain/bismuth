/**
 * Self-contained, deterministic HIERARCHICAL community detection ("clusters in clusters in
 * clusters"). No external dependencies, no RNG, no wall-clock — the same graph always produces the
 * same answer, which the layout cache (layout-cache.ts) and the stable node colouring both rely on.
 *
 * ## Why Louvain and not label propagation
 *
 * This module used to be synchronous label propagation (LPA). LPA is fine for ONE flat level but it
 * cannot produce a hierarchy: its only "coarsening" move is to run itself on the contracted graph,
 * and because it optimises nothing it immediately collapses. Measured on the reference 2248-node
 * vault, LPA gave 196 communities with a single 652-node blob (29% of the whole graph) at the
 * finest level, and one contraction step fused 652+390+… into a single 1796-node super-community —
 * i.e. level 1 was "everything", which is not a grouping. Modularity (Louvain) has an explicit
 * penalty term against exactly that, so it coarsens gracefully: on the same vault it produces
 * 206 → 47 → 11 non-trivial groups, three levels that each read as a different grouping.
 *
 * The finest level is also better as a FLAT result: Louvain's largest finest community on that
 * vault is 149 nodes (vs LPA's 652), so `community` (colour/group key) is more informative than
 * before, and `detectCommunities` — the flat API every existing consumer uses — is simply the
 * finest level of the hierarchy.
 *
 * ## How many levels
 *
 * `communityLevelsFor(nodeCount)` — see its doc comment. Summary: 1 level below ~360 nodes, 2 to
 * ~1620, 3 to ~7290, 4 beyond, derived from a target per-level group-count RATIO rather than
 * hardcoded thresholds.
 *
 * ## Determinism
 *
 *   - Nodes are processed in sorted (lexicographic) id order at every level.
 *   - The modularity local-move visits nodes in that order; ties go to the smallest community id.
 *   - Resolution search is a fixed-step geometric bisection (no adaptive termination on timing).
 *   - Communities are renumbered densely `0..k-1` in order of first appearance, per level.
 *   - Each community's exemplar is picked by `pickExemplar` (see its doc comment) from the community's
 *     highest-degree members, measured on the ORIGINAL graph. Isolated nodes (no edges) form their own
 *     singleton community at every level, labelled by themselves.
 */

export interface CommunityAssignment {
  community: number;
  label: string;
}

export interface HierarchicalCommunityAssignment extends CommunityAssignment {
  /** Community id per level, COARSEST → FINEST. Always non-empty; the last element is exactly
   *  `community`. Ids are densely renumbered PER LEVEL, so a path element only means anything
   *  paired with its level index (path[0]=3 and path[1]=3 are unrelated groups). */
  path: number[];
  /** Exemplar label per level, COARSEST → FINEST; same length as `path`, last element === `label`. */
  labels: string[];
}

// --- Exemplar (cluster NAME) selection -----------------------------------------------------------
// A cluster's exemplar is what the graph DRAWS as the cluster's name, and the field is a monospace
// ASCII grid — so the name has to be SHORT above all else. Picking "the single highest-degree
// member" (what this used to do) reliably produced a full note-title SENTENCE:
// "PLAYER - MORE RESPONSIVE WALKING PHYSICS + ANIMATIONS" was a real label on the reference vault,
// and a field of those overlaps into unreadable soup no matter how the renderer places them.
//
// So: build a pool of the community's genuine HUBS — members whose degree is at least
// `EXEMPLAR_DEGREE_FRAC` of the community's maximum, capped at `EXEMPLAR_POOL` of them — then inside
// that pool prefer the SHORTEST name, with one override: a TAG member wins over a note outright.
// A tag ("#school", "#books") is already the vault's own one-word summary of a group of notes, which
// is exactly what a cluster name wants to be, and on the reference vault 75% of all edges are
// incident to a tag node, so most communities have one in their top-degree pool.
// The degree FRACTION (not just "the top 8") is what keeps a short-titled LEAF from naming the
// cluster: in a star of one hub + three leaves, only the hub clears the threshold, so "HUB" wins even
// though "L1" is shorter.
const EXEMPLAR_POOL = 8;
const EXEMPLAR_DEGREE_FRAC = 0.5;
// Mirrors app/src/graph/labelSelection.ts CLUSTER_LABEL_MAX_CHARS — the field's hard per-label cap.
// core has no dependency on app (the reverse is true), so this is a plain duplicated constant, not
// an import; keep the two in sync if the cap ever moves. Preferring a hub-pool candidate that
// already FITS this cap outright means the renderer almost never has to cut the exemplar's own
// name — see the block below and clusterLabelText's word-boundary trim for the rare case where
// nothing in the pool fits.
const EXEMPLAR_FIT_CHARS = 20;

/** One candidate member for `pickExemplar`. `kind` is the graph node kind ("tag" gets the override
 *  above); anything else, or absent, is treated as a plain note. */
export interface ExemplarCandidate {
  id: string;
  label: string;
  kind?: string;
  degree: number;
}

/**
 * The community's display name source, per the rule in the block above:
 *   1. keep the members whose degree is >= `degreeFrac` × the community's max degree, ranked by degree
 *      DESC (ties → shorter label, then id ASC), at most `poolSize` of them — the hub pool;
 *   2. if any of those is a `kind: "tag"`, consider only the tags;
 *   3. among the survivors, prefer whichever ones already FIT the field's hard cap
 *      (`EXEMPLAR_FIT_CHARS`) outright, then pick the SHORTEST label among THOSE (ties → higher
 *      degree, then id ASC); only when NOTHING in the field fits does the shortest-overall label
 *      win instead, and the renderer's `clusterLabelText` then trims it at a WORD boundary (no
 *      ellipsis — see labelSelection.ts).
 * Deterministic and total: returns `undefined` only for an empty candidate list. Exported for
 * community.test.ts — the ranking rule is the whole readability contract, so it is pinned directly.
 */
export function pickExemplar(
  members: ExemplarCandidate[],
  poolSize = EXEMPLAR_POOL,
  degreeFrac = EXEMPLAR_DEGREE_FRAC,
): ExemplarCandidate | undefined {
  if (members.length === 0) return undefined;
  const byDegree = [...members].sort(
    (a, b) => b.degree - a.degree || a.label.length - b.label.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const cut = byDegree[0].degree * degreeFrac;
  // `|| [byDegree[0]]` can't be needed — byDegree[0] always clears its own fraction — but slicing
  // first keeps the cap honest when many members tie at the top degree.
  const pool = byDegree.filter((m) => m.degree >= cut).slice(0, Math.max(1, poolSize));
  const tags = pool.filter((m) => m.kind === "tag");
  const field = tags.length > 0 ? tags : pool;
  const shortest = (candidates: ExemplarCandidate[]): ExemplarCandidate =>
    candidates.reduce((best, m) =>
      m.label.length < best.label.length ||
      (m.label.length === best.label.length && (m.degree > best.degree || (m.degree === best.degree && m.id < best.id)))
        ? m
        : best,
    );
  const fitting = field.filter((m) => m.label.length <= EXEMPLAR_FIT_CHARS);
  return shortest(fitting.length > 0 ? fitting : field);
}
// -------------------------------------------------------------------------------------------------

// --- Level count ---------------------------------------------------------------------------------
// The finest level aims for communities of ~MEAN_FINEST_SIZE nodes, so a graph of N nodes wants
// about N/MEAN_FINEST_SIZE groups at the bottom. Going UP, each level should hold about
// LEVEL_RATIO of the level below it — below ~3x two adjacent levels read as the same grouping
// (you cannot see that anything merged), above ~6x a level is skipped (a super-cluster with 20
// children is not a summary of anything). 4.5 sits in the middle of that band, and it is also what
// the real vault produces naturally: 206 → 47 → 11 is 4.4x per step.
// The ladder stops once the coarsest level would hold fewer than MIN_TOP_GROUPS groups: a top level
// of 3-4 blobs carries no information you could not get by looking at the graph.
// Net effect (the "the more nodes the more hierarchical clusters" the feature is for):
//   N < 360   → 1 level    (finest level already has <= ~36 groups: the whole thing is scannable)
//   N < 1620  → 2 levels
//   N < 7290  → 3 levels   (the reference 2248-node vault lands here)
//   N >= 7290 → 4 levels   (capped: past 4, coarse levels stop being distinguishable in a viewport)
const MEAN_FINEST_SIZE = 10;
const LEVEL_RATIO = 4.5;
const MIN_TOP_GROUPS = 8;
const MAX_LEVELS = 4;

/**
 * Number of hierarchy levels for a graph of `nodeCount` nodes.
 *
 *   levels = clamp(1, 4, 1 + floor( log_4.5( (nodeCount / 10) / 8 ) ))
 *
 * i.e. start from the finest level's target group count (nodeCount/10), and add one level for every
 * further factor of 4.5 you can climb before dropping under 8 groups. See the constants above for
 * why those three numbers. Breakpoints: 360 / 1620 / 7290 nodes.
 */
export function communityLevelsFor(nodeCount: number): number {
  if (!Number.isFinite(nodeCount) || nodeCount <= 0) return 1;
  const finestGroups = nodeCount / MEAN_FINEST_SIZE;
  if (finestGroups <= MIN_TOP_GROUPS) return 1;
  // +1e-9: the breakpoints are exact powers of LEVEL_RATIO, and floating-point log lands a hair
  // under at exactly 360 / 1620 / 7290 nodes without it.
  const extra = Math.floor(Math.log(finestGroups / MIN_TOP_GROUPS) / Math.log(LEVEL_RATIO) + 1e-9);
  return Math.min(MAX_LEVELS, 1 + extra);
}
// -------------------------------------------------------------------------------------------------

// --- Weighted modularity local-move (the Louvain inner loop) --------------------------------------
// Standard Louvain phase 1 with a resolution parameter γ: repeatedly move each node into the
// neighbouring community that maximises the modularity gain
//     ΔQ ∝ w(i → C) - γ · k_i · Σ_tot(C) / 2m
// where w(i→C) is i's edge weight into C, k_i its weighted degree, Σ_tot(C) the community's total
// degree and 2m the graph's total degree. γ > 1 → more, smaller communities; γ < 1 → fewer, bigger.
// That knob is what lets us hit a TARGET group count per level (see moveToTarget) instead of taking
// whatever the natural dendrogram happens to give — the natural dendrogram of a real vault is only
// ~2 useful levels deep, and its step sizes are wildly uneven.
const MAX_MOVE_PASSES = 20;

/** Weighted undirected graph in adjacency form. Self-loops are folded straight into `k`/`m2` (they
 *  contribute to a node's degree but are never a "move target"), which is how a contracted level
 *  carries the edge weight that is INTERNAL to each super-node. `mass` is how many ORIGINAL nodes
 *  each (super-)node stands for — the quantity the balance cap below is expressed in. */
interface WGraph {
  n: number;
  adj: Int32Array[];
  aw: Float64Array[];
  /** Weighted degree per node (self-loops counted twice, as modularity requires). */
  k: Float64Array;
  /** 2m — total weighted degree over the whole graph. */
  m2: number;
  mass: Float64Array;
}

function buildWGraph(n: number, edges: { a: number; b: number; w: number }[], mass?: Float64Array): WGraph {
  const deg = new Int32Array(n);
  for (const e of edges) if (e.a !== e.b) { deg[e.a]++; deg[e.b]++; }
  const adj = Array.from({ length: n }, (_, i) => new Int32Array(deg[i]));
  const aw = Array.from({ length: n }, (_, i) => new Float64Array(deg[i]));
  const fill = new Int32Array(n);
  const k = new Float64Array(n);
  let m2 = 0;
  for (const e of edges) {
    if (e.a === e.b) { k[e.a] += 2 * e.w; m2 += 2 * e.w; continue; }
    adj[e.a][fill[e.a]] = e.b; aw[e.a][fill[e.a]++] = e.w;
    adj[e.b][fill[e.b]] = e.a; aw[e.b][fill[e.b]++] = e.w;
    k[e.a] += e.w; k[e.b] += e.w; m2 += 2 * e.w;
  }
  return { n, adj, aw, k, m2, mass: mass ?? new Float64Array(n).fill(1) };
}

/**
 * One Louvain local-moving phase at resolution `gamma`. Returns a DENSE community index per node
 * (renumbered 0..k-1 in ascending node order). Degree-0 nodes always keep their own community.
 *
 * `maxMass` (Infinity = off) is a BALANCE CAP: a node may not move into a community whose combined
 * mass would exceed it. Modularity alone is not enough at the coarse levels — asked for ~10 top
 * groups on the reference vault it happily returns one 1257-node super-community (56% of the graph)
 * plus a tail, which is not a grouping, it is "everything and some leftovers". The cap is a purely
 * local, deterministic constraint (it never reorders anything, it only removes candidates), and it
 * is what turns "10 groups" into 10 groups you can actually tell apart. It cannot split a node that
 * is already over the cap, so it degrades gracefully rather than failing.
 */
function localMove(g: WGraph, gamma: number, maxMass = Infinity): Int32Array {
  const { n, adj, aw, k, m2, mass } = g;
  const comm = new Int32Array(n);
  for (let i = 0; i < n; i++) comm[i] = i;
  if (m2 > 0) {
    const tot = Float64Array.from(k);
    const cmass = Float64Array.from(mass);
    // Scratch tally of i's edge weight into each candidate community; `stamp` avoids clearing it.
    const wTo = new Float64Array(n);
    const stamp = new Int32Array(n).fill(-1);
    const cand: number[] = [];
    for (let pass = 0; pass < MAX_MOVE_PASSES; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const nbr = adj[i];
        if (nbr.length === 0) continue; // isolated: stays in its own community forever
        const ci = comm[i];
        tot[ci] -= k[i]; // remove i from its community before scoring (including its own)
        cmass[ci] -= mass[i];
        cand.length = 0;
        // The current community is always a candidate (with weight 0 if i has no edge back to it),
        // so "don't move" competes fairly and a tie leaves the node where it is.
        stamp[ci] = i; wTo[ci] = 0; cand.push(ci);
        const w = aw[i];
        for (let e = 0; e < nbr.length; e++) {
          const c = comm[nbr[e]];
          if (stamp[c] !== i) { stamp[c] = i; wTo[c] = 0; cand.push(c); }
          wTo[c] += w[e];
        }
        // Best gain; ties → smallest community id (candidates are scanned in ascending id order).
        cand.sort((x, y) => x - y);
        let best = ci;
        let bestGain = wTo[ci] - (gamma * tot[ci] * k[i]) / m2;
        for (const c of cand) {
          if (c === ci) continue;
          if (cmass[c] + mass[i] > maxMass) continue; // balance cap
          const gain = wTo[c] - (gamma * tot[c] * k[i]) / m2;
          if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
        }
        tot[best] += k[i];
        cmass[best] += mass[i];
        if (best !== ci) { comm[i] = best; moved = true; }
      }
      if (!moved) break;
    }
  }
  return densify(comm);
}

/** Renumber an Int32Array of raw ids to a dense 0..k-1 in order of first appearance. */
function densify(raw: Int32Array): Int32Array {
  const dense = new Map<number, number>();
  const out = new Int32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    let d = dense.get(raw[i]);
    if (d === undefined) { d = dense.size; dense.set(raw[i], d); }
    out[i] = d;
  }
  return out;
}

/** Total number of communities in a dense partition (including singletons). */
const groupCount = (part: Int32Array): number => {
  let max = -1;
  for (let i = 0; i < part.length; i++) if (part[i] > max) max = part[i];
  return max + 1;
};

/** Number of communities that contain at least one node WITH EDGES. This — not `groupCount` — is
 *  what the resolution search targets: a real vault has a long tail of edgeless notes (145 of 2248
 *  on the reference vault) that are singletons at every level no matter what γ does, so targeting
 *  the raw count is unreachable by construction and drives the search to γ_min, collapsing the
 *  connected part into one blob. Ask about the part of the graph that can actually be grouped. */
function connectedGroupCount(part: Int32Array, g: WGraph): number {
  const seen = new Set<number>();
  for (let i = 0; i < part.length; i++) if (g.adj[i].length > 0) seen.add(part[i]);
  return seen.size;
}

// Geometric bisection bounds + step count for the resolution search. Group count is monotone
// non-decreasing in γ, so plain bisection converges; 18 geometric steps narrow [0.01, 100] by 2^18,
// far finer than the granularity at which the integer group count can change. Fixed step count (no
// early convergence heuristics beyond an exact hit) keeps it deterministic and bounds the cost at
// 18 local-moves per level.
const GAMMA_MIN = 0.01;
const GAMMA_MAX = 100;
const BISECT_STEPS = 18;
// Balance cap, as a FRACTION of the connected graph a single community may occupy:
//     cap = totalMass · max(MAX_GROUP_FRACTION, MASS_CAP_SLACK / target)
// The cap must be a guard against runaway, NOT a quota. A per-target quota (2.5x the mean size) was
// tried first and is wrong: at the finest level the mean is ~10 nodes, so the cap binds on EVERY
// community and the partition degenerates into equal-sized bricks (measured: every group exactly 24
// nodes at the finest level, 108 at the mid level — the cap, not the graph, was choosing the
// clusters). The fraction floor makes the cap irrelevant except where modularity actually runs away:
// on the reference vault the finest level's biggest natural community is 7% of the graph (never
// capped) while the coarsest level's is 56% (capped to 25%, which is what breaks up the "everything"
// blob). MASS_CAP_SLACK only takes over below ~10 target groups, where 2.5x the mean is the tighter
// and more meaningful of the two.
const MAX_GROUP_FRACTION = 0.25;
const MASS_CAP_SLACK = 2.5;

/** Partition `g` into as close to `target` communities as the modularity landscape allows, by
 *  bisecting the resolution γ under a balance cap. Deterministic (fixed step count, geometric
 *  bisection, no timing). Ties in closeness prefer the FINER (larger count) partition, so a level
 *  never accidentally reads as coarser than the one above it. */
function moveToTarget(g: WGraph, target: number): Int32Array {
  let totalMass = 0;
  for (let i = 0; i < g.n; i++) if (g.adj[i].length > 0) totalMass += g.mass[i];
  const maxMass = target > 0 && totalMass > 0
    ? totalMass * Math.max(MAX_GROUP_FRACTION, MASS_CAP_SLACK / target)
    : Infinity;
  let lo = GAMMA_MIN, hi = GAMMA_MAX;
  let best: Int32Array | null = null;
  let bestErr = Infinity, bestCount = -1;
  for (let step = 0; step < BISECT_STEPS; step++) {
    const gamma = Math.sqrt(lo * hi);
    const part = localMove(g, gamma, maxMass);
    const count = connectedGroupCount(part, g);
    const err = Math.abs(count - target);
    if (err < bestErr || (err === bestErr && count > bestCount)) {
      best = part; bestErr = err; bestCount = count;
    }
    if (count === target) break;
    if (count > target) hi = gamma; else lo = gamma;
  }
  return best ?? densify(new Int32Array(g.n));
}
// -------------------------------------------------------------------------------------------------

/** Flat community detection — the FINEST level of `detectCommunityHierarchy`. Kept as its own
 *  export because most consumers only ever want the one colour/group key per node.
 *  `levels: 1` is an optimisation, not a different answer: the finest partition is computed from the
 *  raw graph at the finest target, which does not depend on how many coarser levels sit above it
 *  (the coarse levels are built from the finest, never the other way round). Asserted in
 *  community.test.ts, which compares this against the full hierarchy's finest level. */
export function detectCommunities(
  nodes: { id: string; label: string; kind?: string }[],
  edges: { from: string; to: string }[],
): Map<string, CommunityAssignment> {
  const out = new Map<string, CommunityAssignment>();
  for (const [id, a] of detectCommunityHierarchy(nodes, edges, { levels: 1 })) {
    out.set(id, { community: a.community, label: a.label });
  }
  return out;
}

/**
 * Hierarchical community detection. Every node gets a `path` of community ids (coarsest → finest)
 * plus the exemplar `labels` for each of those levels; `community`/`label` mirror the finest level
 * so the flat contract is unchanged.
 *
 * The number of levels comes from `communityLevelsFor(nodes.length)` unless `opts.levels` overrides
 * it (tests / tuning harnesses). Levels are built BOTTOM-UP and are strictly NESTED by construction
 * — each coarser level is a partition of the contracted graph of the level below it, so two nodes
 * that share a finest community always share every coarser one.
 */
export function detectCommunityHierarchy(
  nodes: { id: string; label: string; kind?: string }[],
  edges: { from: string; to: string }[],
  opts: { levels?: number } = {},
): Map<string, HierarchicalCommunityAssignment> {
  const result = new Map<string, HierarchicalCommunityAssignment>();
  if (nodes.length === 0) return result;

  const labelById = new Map<string, string>();
  const kindById = new Map<string, string>();
  for (const n of nodes) {
    labelById.set(n.id, n.label);
    if (n.kind) kindById.set(n.id, n.kind);
  }

  // Process in sorted id order for determinism (also the order dense ids are assigned in).
  const sortedIds = nodes.map((n) => n.id).sort();
  const n = sortedIds.length;
  const indexOf = new Map<string, number>();
  sortedIds.forEach((id, i) => indexOf.set(id, i));

  // Undirected adjacency, DEDUPED (a repeated edge between the same pair counts once) — same
  // structural reading of the edge set the previous implementation used, and the same one
  // `degree` (for exemplar picking) is measured on.
  const pairs = new Map<number, number>(); // (min*n + max) → weight, always 1 after dedupe
  const degree = new Int32Array(n);
  for (const e of edges) {
    if (e.from === e.to) continue;
    const a = indexOf.get(e.from), b = indexOf.get(e.to);
    if (a === undefined || b === undefined) continue; // endpoint not in the node set
    const key = a < b ? a * n + b : b * n + a;
    if (pairs.has(key)) continue;
    pairs.set(key, 1);
    degree[a]++; degree[b]++;
  }
  const baseEdges = [...pairs.keys()].map((key) => ({ a: Math.floor(key / n), b: key % n, w: 1 }));

  const levels = Math.max(1, Math.floor(opts.levels ?? communityLevelsFor(n)));

  // Target group count per level, COARSEST → FINEST. The finest aims for ~MEAN_FINEST_SIZE nodes per
  // community over the CONNECTED nodes (isolated nodes are singletons at every level no matter what,
  // so counting them would inflate every target on a vault full of orphan notes); each step up
  // divides by LEVEL_RATIO.
  let connected = 0;
  for (let i = 0; i < n; i++) if (degree[i] > 0) connected++;
  const finestTarget = Math.max(1, Math.min(connected || 1, Math.ceil((connected || n) / MEAN_FINEST_SIZE)));
  const targets: number[] = [];
  for (let i = 0; i < levels; i++) {
    const stepsUp = levels - 1 - i;
    targets.push(Math.max(1, Math.round(finestTarget / Math.pow(LEVEL_RATIO, stepsUp))));
  }

  // --- Build the levels bottom-up -----------------------------------------------------------------
  // partitions[l] maps ORIGINAL node index → community id at level l, with l=0 the finest here
  // (reversed to coarsest-first when writing out the path below).
  const partitions: Int32Array[] = [];
  const finest = moveToTarget(buildWGraph(n, baseEdges), targets[levels - 1]);
  partitions.push(finest);

  let current = finest;
  let currentN = groupCount(finest);
  for (let up = 1; up < levels; up++) {
    if (currentN < 2) { partitions.push(current); continue; } // nothing left to merge
    // Contract the ORIGINAL edge set through the level below: super-node = a community of that
    // level, super-edge weight = the summed weight of the underlying edges. Edges internal to a
    // super-node become self-loops, which the modularity term needs to see. Always contracting from
    // `baseEdges` (rather than from the previous contraction) keeps this a single code path; it is
    // O(|E|) per level with at most MAX_LEVELS-1 levels, so the cost is irrelevant.
    const w = new Map<number, number>();
    for (const e of baseEdges) {
      const a = current[e.a], b = current[e.b];
      const key = a <= b ? a * currentN + b : b * currentN + a;
      w.set(key, (w.get(key) ?? 0) + e.w);
    }
    const superEdges = [...w.entries()].map(([key, ww]) => ({ a: Math.floor(key / currentN), b: key % currentN, w: ww }));
    // A super-node's mass is how many ORIGINAL nodes it stands for, so the balance cap keeps meaning
    // "no super-community may hold more than 2.5x its fair share of the VAULT" at every level.
    const superMass = new Float64Array(currentN);
    for (let i = 0; i < n; i++) superMass[current[i]] += 1;
    const coarse = moveToTarget(buildWGraph(currentN, superEdges, superMass), targets[levels - 1 - up]);
    // Lift the super-partition back onto the original nodes — this is what makes the levels NESTED.
    const lifted = new Int32Array(n);
    for (let i = 0; i < n; i++) lifted[i] = coarse[current[i]];
    partitions.push(lifted);
    current = lifted;
    currentN = groupCount(coarse);
  }
  // -------------------------------------------------------------------------------------------------

  // Per level: renumber densely in sorted-id first-appearance order (so ids read left-to-right in the
  // same order nodes are processed), then name each community via `pickExemplar` — top-degree pool,
  // tag members preferred, shortest label wins (see the "Exemplar (cluster NAME) selection" block:
  // the name is drawn on a monospace ASCII grid, so SHORT beats "biggest hub").
  const perLevelId: Int32Array[] = [];
  const perLevelLabel: string[][] = [];
  for (const part of partitions) {
    const dense = new Map<number, number>();
    const ids = new Int32Array(n);
    const members: ExemplarCandidate[][] = [];
    for (let i = 0; i < n; i++) {
      const raw = part[i];
      let d = dense.get(raw);
      if (d === undefined) { d = dense.size; dense.set(raw, d); members.push([]); }
      ids[i] = d;
      const id = sortedIds[i];
      members[d].push({ id, label: labelById.get(id) ?? id, kind: kindById.get(id), degree: degree[i] });
    }
    perLevelId.push(ids);
    perLevelLabel.push(members.map((ms, d) => pickExemplar(ms)?.label ?? `cluster ${d}`));
  }

  // partitions/perLevel* are FINEST-first; the emitted path is COARSEST-first.
  for (let i = 0; i < n; i++) {
    const path: number[] = [];
    const labels: string[] = [];
    for (let l = perLevelId.length - 1; l >= 0; l--) {
      path.push(perLevelId[l][i]);
      labels.push(perLevelLabel[l][perLevelId[l][i]]);
    }
    result.set(sortedIds[i], {
      community: path[path.length - 1],
      label: labels[labels.length - 1],
      path,
      labels,
    });
  }
  return result;
}
