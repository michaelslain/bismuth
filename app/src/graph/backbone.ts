// app/src/graph/backbone.ts
//
// GROUP-LEVEL EDGES — "the lines between the groups at this zoom" — ported from
// CanvasGraphRenderer.ts:859-924, 1247-1270 (`crossLevel`/`buildLevelEdges`/`levelPairs`/
// `levelHubs`/`computeEdgeLevelWeights`, `MAX_LEVEL_PAIRS` 700), plus the THREE-BAND HANDOVER
// (`bandsForT`) that decides how much of the field each of Ascii's LOD masses and this backbone
// gets to own at a given zoom. See MERGE-NOTES.md §5.4 for the conflict this resolves: Ascii's
// masses and Canvas's backbone each assumed they owned the WHOLE zoom range on their own. They
// don't anymore — they hand over, in bands.
//
// Pure (no DOM, no canvas, no ctx) so it is unit-testable directly, matching lod.ts/labelSelection.ts.

import { clusterLevelAlphas, fileLabelAlpha } from "./labelSelection";

// ---------------------------------------------------------------------------------------------
// The per-level hub-to-hub backbone (ported).
// ---------------------------------------------------------------------------------------------

/** Minimal per-node input: a hierarchy path (coarsest → finest; `null` = no community at all —
 *  the "you" hub, daemon nodes) and its undirected degree (drives which member becomes each
 *  community's hub). Decoupled from `GraphNode`/`NodeView` on purpose, same as `lod.ts`'s
 *  `LodNodeInput` — this module never needs screen state to compute the backbone structure. */
export interface PathNode {
  id: string;
  path: number[] | null;
  deg: number;
}

/** A real edge, referencing node ids (not `NodeView`s — this module is pure). */
export interface PathEdge {
  a: string;
  b: string;
}

/** See `EdgeView.crossLevel` in the source. Returns the SHALLOWEST hierarchy level at which
 *  `pathA`/`pathB` fall in different communities — i.e. the coarsest zoom at which an edge
 *  between them is a connection BETWEEN the things being shown, rather than a wire buried inside
 *  one of them. An edge touching a node with no community at all (`null` path) belongs to level 0
 *  — those nodes are never inside a cluster, so their connections are structural and read at
 *  every zoom. Because hierarchy levels are strictly NESTED, endpoints that differ at level L
 *  also differ at every deeper level, so this single number fully determines visibility: the edge
 *  belongs to every level from `crossLevelOf(...)` down. */
export function crossLevelOf(pathA: number[] | null, pathB: number[] | null): number {
  if (!pathA || !pathB) return 0;
  const len = Math.min(pathA.length, pathB.length);
  for (let L = 0; L < len; L++) if (pathA[L] !== pathB[L]) return L;
  return len; // identical the whole way down — an intra-finest-community edge
}

/** Cap on group-level lines built per hierarchy level, heaviest first. Measured on the reference
 *  vault's 5-level hierarchy, the connected-pair count per level is 22 / 75 / 232 / 578 / 1221 —
 *  so this only ever truncates the two DEEPEST levels, which are the ones you are already zoomed
 *  into (most of their lines are off-frame) and which are handing over to the real member edges
 *  anyway. The coarse levels, where the whole field is in view and clutter actually matters, are
 *  far below the cap and never truncated. Ported verbatim from `CanvasGraphRenderer.ts`. */
export const MAX_LEVEL_PAIRS = 700;

/** One community's hub at a hierarchy level: its highest-degree member (ties broken by id, lowest
 *  wins, for determinism). */
export interface LevelHub {
  id: string;
  deg: number;
}

/** One connected pair of communities at a hierarchy level, hub to hub, with the number of real
 *  edges summarized behind the line. */
export interface LevelPair {
  a: LevelHub;
  b: LevelHub;
  count: number;
}

/**
 * Build the GROUP-LEVEL edge sets — the "lines between the groups at this zoom" — for every
 * hierarchy level `0..levelCount-1`.
 *
 * For each level, every real edge whose endpoints fall in DIFFERENT communities at that level
 * contributes to one group-to-group line, drawn hub-to-hub with the number of real edges behind
 * it as its weight. Edges buried inside a single community at that level contribute nothing — at
 * that zoom they are wires inside a thing, not connections between things.
 *
 * This replaced a first attempt that instead FILTERED the member-level edges (drawing the real
 * node-to-node edges that happened to cross a boundary). That is not the same picture: it still
 * draws hundreds of lines fanning into the middle of blobs, so it reads as "some edges are
 * missing" rather than as a graph OF the clusters — which is why the intended behaviour looked
 * absent.
 *
 * Static: hubs are highest-degree members and communities don't move, so this is build-time work,
 * not per-frame. Cost is O(levelCount × edges).
 *
 * Ported from `CanvasGraphRenderer.ts`'s `buildLevelEdges` (lines 859-924).
 */
export function buildLevelEdges(
  nodes: PathNode[],
  edges: PathEdge[],
  levelCount: number,
  maxPairs: number = MAX_LEVEL_PAIRS,
): { levelHubs: Map<number, LevelHub>[]; levelPairs: LevelPair[][] } {
  const byId = new Map<string, PathNode>();
  for (const n of nodes) byId.set(n.id, n);

  // Each edge's crossLevel is a structural property of its endpoints, not of L — compute it once
  // rather than once per level.
  const withCrossLevel = edges.map((e) => {
    const na = byId.get(e.a), nb = byId.get(e.b);
    return { na, nb, crossLevel: na && nb ? crossLevelOf(na.path, nb.path) : 0 };
  });

  const levelHubs: Map<number, LevelHub>[] = [];
  const levelPairs: LevelPair[][] = [];

  for (let L = 0; L < levelCount; L++) {
    // Hubs first — the anchors both the lines and (elsewhere) the cluster names use.
    const hubs = new Map<number, LevelHub>();
    for (const n of nodes) {
      if (!n.path) continue;
      const cid = n.path[Math.min(L, n.path.length - 1)];
      const cur = hubs.get(cid);
      if (!cur || n.deg > cur.deg || (n.deg === cur.deg && n.id < cur.id)) {
        hubs.set(cid, { id: n.id, deg: n.deg });
      }
    }
    levelHubs.push(hubs);

    // Then the group-to-group pairs, deduped by (lower, higher) community id.
    const pairs = new Map<string, { a: LevelHub; b: LevelHub; count: number }>();
    for (const { na, nb, crossLevel } of withCrossLevel) {
      if (crossLevel > L) continue; // buried inside one community at this level
      if (!na?.path || !nb?.path) continue;
      const ca = na.path[Math.min(L, na.path.length - 1)];
      const cb = nb.path[Math.min(L, nb.path.length - 1)];
      if (ca === cb) continue;
      const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
      const key = `${lo}\0${hi}`;
      const found = pairs.get(key);
      if (found) { found.count++; continue; }
      const ha = hubs.get(lo), hb = hubs.get(hi);
      if (ha && hb) pairs.set(key, { a: ha, b: hb, count: 1 });
    }
    // Heaviest first, capped: the finest levels have hundreds of groups and so potentially
    // thousands of pairs, which would put the hairball straight back. The heaviest pairs are the
    // real structure; a 1-edge link between two 5-node groups is noise at that zoom.
    const list = [...pairs.values()].sort((x, y) => y.count - x.count);
    levelPairs.push(list.slice(0, maxPairs));
  }

  return { levelHubs, levelPairs };
}

/** Ported from `CanvasGraphRenderer.ts`'s `CANVAS_REVEAL_T` — the boundary its (pre-merge)
 *  two-state ladder used: group lines owned `[0, revealT)`, real member edges owned
 *  `[revealT, 1]`. Kept as `computeEdgeLevelWeights`'s own default so the ported function is
 *  independently faithful to its source. `bandsForT` below is the NEW three-band outer gate that
 *  supersedes this once wired (a later task) — see its doc comment. */
export const DEFAULT_LEVEL_REVEAL_T = 0.62;

/**
 * Per-level weight for each hierarchy level's group-edge set (index `0..levelCount-1`), plus the
 * weight of the real member-level edges (index `levelCount`).
 *
 * Straight off the same `clusterLevelAlphas` partition of unity the node colour and the cluster
 * names use, so all three cross their boundaries on the same frame: level L's group lines are
 * visible exactly when level L is the grouping being shown, crossfading into level L+1's. The
 * real node-to-node edges ride `fileLabelAlpha` — they arrive with the file names, when
 * individual notes are what is on screen.
 *
 * Ported from `CanvasGraphRenderer.ts`'s `computeEdgeLevelWeights` (lines 898-925).
 */
export function computeEdgeLevelWeights(
  t: number,
  levelCount: number,
  revealT: number = DEFAULT_LEVEL_REVEAL_T,
): number[] {
  const n = levelCount;
  if (n <= 1) {
    // No hierarchy to read (a small or community-less graph) — behave exactly as the graph always
    // did: real edges at full strength, no group lines.
    return [0, 1];
  }
  const w = new Array<number>(n + 1).fill(0);
  const levelAlphas = clusterLevelAlphas(t, n, revealT);
  for (let L = 0; L < n; L++) w[L] = levelAlphas[L];
  w[n] = fileLabelAlpha(t, revealT);
  // The finest level's group lines and the real edges would otherwise both be up at full zoom
  // (clusterLevelAlphas pins [0,…,0,1] past the reveal point), double-drawing the same structure.
  // Hand the finest level over as the real edges fade in.
  w[n - 1] *= 1 - w[n];
  return w;
}

/** Number of weight buckets a level's group-pairs are sorted into for batched-stroke rendering —
 *  heavier group links read heavier, but bucketed so a level's lines stay a handful of batched
 *  draws rather than one per pair. Ported from `CanvasGraphRenderer.ts:1256-1258` (`WB`). */
export const EDGE_WEIGHT_BUCKETS = 3;

/** The `[lo, hi)` count range for weight bucket `bucket` (0 = lightest) out of `buckets`, against
 *  a level's heaviest pair (`maxCount`). The final bucket's `hi` is nudged up by 1 so the single
 *  heaviest pair (`count === maxCount`) still falls inside it — `count >= hi` would otherwise
 *  exclude it. Ported from `CanvasGraphRenderer.ts:1257-1258`. */
export function edgeWeightBucketRange(
  bucket: number,
  maxCount: number,
  buckets: number = EDGE_WEIGHT_BUCKETS,
): { lo: number; hi: number } {
  const lo = maxCount * (bucket / buckets);
  const hi = maxCount * ((bucket + 1) / buckets) + (bucket === buckets - 1 ? 1 : 0);
  return { lo, hi };
}

// ---------------------------------------------------------------------------------------------
// The three-band handover (new — MERGE-NOTES.md §5.4).
//
// Ascii's LOD masses (lod.ts) and Canvas's hub-to-hub backbone (above) are two implementations
// of "the coarse view" that each assumed they owned the whole zoom range below the file-label
// reveal point. The spec wants BOTH, in bands:
//
//   far  (t low)  — territory masses + cluster names, aggregate connectors (lod.ts's masses own this)
//   mid  (t mid)  — individual glyphs, hub-to-hub backbone (this file's buildLevelEdges owns this)
//   near (t high) — individual glyphs, real member edges (the plain edge list owns this)
//
// `bandsForT` is the OUTER gate deciding how much of the field each band gets at a given `t` — it
// says nothing about which hierarchy LEVEL within the mass or backbone band is active; that is
// still `clusterLevelAlphas`'s job (lod.ts's `lodMix`, and `computeEdgeLevelWeights` above),
// unchanged. A caller wiring this in multiplies: e.g. a level's backbone lines draw at
// `computeEdgeLevelWeights(...)[L] × bandsForT(t, levelCount).backboneAlpha`.
// ---------------------------------------------------------------------------------------------

export interface Bands {
  /** How much of the field is territory masses (lod.ts) right now, 0..1. */
  massAlpha: number;
  /** How much of the field is the hub-to-hub backbone (this file) right now, 0..1. */
  backboneAlpha: number;
  /** How much of the field is real, individual member edges right now, 0..1. */
  memberAlpha: number;
}

/** `t` at which the mass→backbone handover CENTRES (the crossfade spans
 *  `[BACKBONE_START_T, BACKBONE_START_T + BACKBONE_FADE_SPAN]`). Chosen, not measured — see
 *  MERGE-NOTES.md §5.4: this is a design choice a later task may retune against a real vault.
 *  Reasoning: the far band should own a genuine first third of the ladder (masses are the whole
 *  point of the coarse view, they shouldn't feel rushed), so the handover starts just past t=1/3. */
export const BACKBONE_START_T = 0.32;
/** Width of the mass→backbone crossfade. Kept narrower than a full third so there is a real
 *  plateau afterward where the mid band owns the field outright (see `MEMBER_START_T`), rather
 *  than the mid band being nothing but two crossfades back to back. */
export const BACKBONE_FADE_SPAN = 0.14;
/** `t` at which the backbone→member handover centres. Symmetric placement to `BACKBONE_START_T`
 *  around the ladder's midpoint (0.32 and 0.68 sit equally far from 0.5) so the mid band's plateau
 *  (`[0.46, 0.68)`) is centred in the ladder's own middle third, not lopsided toward one side. */
export const MEMBER_START_T = 0.68;
/** Width of the backbone→member crossfade. Same width as `BACKBONE_FADE_SPAN` for a symmetric
 *  ladder — no principled reason for the two crossfades to differ in speed. */
export const MEMBER_FADE_SPAN = 0.14;

/**
 * The three-band alpha mix at zoom progress `t` (0 = fit, 1 = deepest — the same progress
 * `lodMix`/`clusterLevelAlphas` already use) for a graph with `levelCount` hierarchy levels.
 * `massAlpha + backboneAlpha + memberAlpha === 1` at every `t`, by construction (a genuine
 * partition of unity, not three independently-tuned curves that happen to be checked afterward)
 * — see the derivation below.
 *
 * `levelCount <= 0` means the graph has NO community hierarchy at all (`buildLodIndex` needs
 * `levelCount >= 1` to produce even a single LOD level — see `lod.ts`; `VaultIntro`'s and
 * `EmbeddedGraph`'s graphs are exactly this case, per MERGE-NOTES.md §3). With nothing to
 * aggregate into a mass and no communities to connect hub-to-hub, real member edges are the only
 * story at every zoom — exactly the pre-merge behaviour for a community-less graph, and the same
 * degenerate call `computeEdgeLevelWeights` makes for its own `n <= 1` case.
 *
 * Built from TWO independent crossfades (reusing `fileLabelAlpha`'s exact smoothstep shape rather
 * than re-deriving one) instead of a single `clusterLevelAlphas(t, 3, …)` call: the two handovers
 * are semantically different knobs (masses are a whole product surface; backbone is a thinner
 * one) and a later task should be able to retune, say, `MEMBER_START_T` without perturbing where
 * masses hand off to backbone. `clusterLevelAlphas` divides its range into perfectly even
 * segments, which would couple the two handovers together.
 *
 *   enteredBackbone(t) = fileLabelAlpha(t, BACKBONE_START_T, BACKBONE_FADE_SPAN)   // 0 → 1
 *   enteredMember(t)   = fileLabelAlpha(t, MEMBER_START_T,   MEMBER_FADE_SPAN)     // 0 → 1
 *   massAlpha      = 1 − enteredBackbone
 *   backboneAlpha  =     enteredBackbone − enteredMember
 *   memberAlpha    =                       enteredMember
 *
 * which telescopes to exactly 1 for any t, the same telescoping shape `clusterLevelAlphas` uses
 * internally for its own N-level partition (`entered(i) − entered(i+1)`), just with N=3 stages
 * whose boundaries are independently named instead of evenly spaced.
 */
export function bandsForT(t: number, levelCount: number): Bands {
  if (levelCount <= 0) return { massAlpha: 0, backboneAlpha: 0, memberAlpha: 1 };
  const enteredBackbone = fileLabelAlpha(t, BACKBONE_START_T, BACKBONE_FADE_SPAN);
  const enteredMember = fileLabelAlpha(t, MEMBER_START_T, MEMBER_FADE_SPAN);
  return {
    massAlpha: 1 - enteredBackbone,
    backboneAlpha: enteredBackbone - enteredMember,
    memberAlpha: enteredMember,
  };
}
