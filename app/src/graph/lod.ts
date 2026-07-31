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
// MERGE-NOTES.md §5.4 and backbone.ts's wiring recipe.
//
// Everything here is DOM-free and unit-tested (lod.test.ts); AsciiGraphRenderer owns the buffers,
// projection and the rAF loop, and calls into this for structure (once per graph build) and the
// per-frame alpha mix (once per frame — a ≤4-entry array, not a hot loop).

import { clusterLevelAlphas } from "./labelSelection";
import { bandsForT } from "./backbone";

/** One aggregate entity: a community at one hierarchy level, positioned at its members' 2D world
 *  centroid. Built once per graph build — per-frame screen state lives on the renderer's view. */
export interface LodCluster {
  level: number;
  community: number;
  count: number;
  /** Members' centroid in the SAME 2D world space the renderer projects (its `p2`). */
  wx: number;
  wy: number;
  memberIds: string[];
}

/** One aggregate edge: every real link between two communities' member sets, summarized.
 *  `a`/`b` index into the level's `clusters` array; `w` is the 0..1 log-scaled visual weight. */
export interface LodAggEdge {
  a: number;
  b: number;
  count: number;
  w: number;
}

export interface LodLevel {
  clusters: LodCluster[];
  edges: LodAggEdge[];
  maxEdgeCount: number;
}

export interface LodNodeInput {
  id: string;
  /** Hierarchy path coarsest → finest (AsciiGraphRenderer's `nodePath` fallback rules). */
  path?: number[];
  x: number;
  y: number;
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
export const LOD_MIN_CLUSTER = 4;

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
): LodLevel[] {
  let levelCount = 0;
  for (const n of nodes) if (n.path && n.path.length > levelCount) levelCount = n.path.length;
  if (levelCount === 0) return [];

  const pathById = new Map<string, number[]>();
  for (const n of nodes) if (n.path && n.path.length) pathById.set(n.id, n.path);

  const out: LodLevel[] = [];
  for (let L = 0; L < levelCount; L++) {
    const groups = new Map<number, { sx: number; sy: number; ids: string[] }>();
    for (const n of nodes) {
      const c = n.path?.[L];
      if (c == null) continue;
      let g = groups.get(c);
      if (!g) { g = { sx: 0, sy: 0, ids: [] }; groups.set(c, g); }
      g.sx += n.x; g.sy += n.y; g.ids.push(n.id);
    }
    const clusters: LodCluster[] = [...groups.entries()]
      .filter(([, g]) => g.ids.length >= minCluster)
      .map(([community, g]) => ({
        level: L, community, count: g.ids.length,
        wx: g.sx / g.ids.length, wy: g.sy / g.ids.length,
        memberIds: g.ids,
      }))
      .sort((a, b) => b.count - a.count || a.community - b.community);
    const indexByCommunity = new Map<number, number>();
    clusters.forEach((c, i) => indexByCommunity.set(c.community, i));

    // Aggregate edges: one entry per unordered community pair, counting every real inter-cluster
    // link. Intra-cluster links are the entity's own mass, not a connector.
    const pair = new Map<number, { a: number; b: number; count: number }>();
    for (const e of edges) {
      const ca = pathById.get(e.from)?.[L];
      const cb = pathById.get(e.to)?.[L];
      if (ca == null || cb == null || ca === cb) continue;
      const ia = indexByCommunity.get(ca);
      const ib = indexByCommunity.get(cb);
      if (ia === undefined || ib === undefined) continue; // an endpoint's community is under minCluster
      const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
      const key = lo * clusters.length + hi;
      let p = pair.get(key);
      if (!p) { p = { a: lo, b: hi, count: 0 }; pair.set(key, p); }
      p.count++;
    }
    let maxEdgeCount = 1;
    for (const p of pair.values()) if (p.count > maxEdgeCount) maxEdgeCount = p.count;
    const aggEdges: LodAggEdge[] = [...pair.values()]
      .map((p) => ({ a: p.a, b: p.b, count: p.count, w: aggEdgeWeight(p.count, maxEdgeCount) }))
      .sort((x, y) => y.count - x.count || x.a - y.a || x.b - y.b);
    out.push({ clusters, edges: aggEdges, maxEdgeCount });
  }
  return out;
}

/** Log-scaled 0..1 visual weight for an aggregate edge carrying `count` real links, against the
 *  level's heaviest connector. A single link still reads (w > 0); the heaviest reads full. */
export function aggEdgeWeight(count: number, maxCount: number): number {
  if (count <= 0) return 0;
  if (maxCount <= 1) return 1;
  return Math.log1p(count) / Math.log1p(maxCount);
}

/** Aggregate edges at/above this weight draw DOUBLED (a second parallel trace) — char-density
 *  thickness, never a wider glyph. */
export const AGG_EDGE_DOUBLE_W = 0.66;
/** Aggregate edge alpha ramp: alpha = base × (MIN + (1−MIN)·w) — the lightest connector is still
 *  legible, the heaviest is full-strength. */
export const AGG_EDGE_ALPHA_MIN = 0.35;

// --- Entity mass form ---------------------------------------------------------------------------
// A compact elliptical ASCII mass on the grid: "@" core, "o" body, "." fringe — the SAME degree
// ramp vocabulary the notes use, so an entity reads as "a heavier kind of node", not a new alphabet.
// Its size encodes member count with ~sqrt scaling (area ∝ count-ish without huge clusters
// swallowing the field). The ellipse is expressed in CELLS: rows are ~2.9× taller than columns are
// wide (CELL_H/CELL_W), so a visually round mass needs its column radius stretched by that ratio.

/** Row-radius scale: rowR = max(1, round(K·√count)). Tuned so the reference vault's coarsest level
 *  (19 clusters, ~40–300 members) yields 2–4-row masses on a full-pane grid. */
export const MASS_ROW_K = 0.22;

export function massRadii(count: number, cellW: number, cellH: number): { rowR: number; colR: number } {
  const rowR = Math.max(1, Math.round(MASS_ROW_K * Math.sqrt(Math.max(1, count))));
  const colR = Math.max(2, Math.round(rowR * (cellH / Math.max(1e-6, cellW))));
  return { rowR, colR };
}

/** Squared-normalized-radius thresholds for the mass ramp ("@" core / "o" body / "." fringe). */
export const MASS_CORE_D2 = 0.3;
export const MASS_BODY_D2 = 0.72;
const CODE_AT = 64, CODE_O = 111, CODE_DOT = 46;

/** Char CODE for a mass cell at squared normalized radius `d2` (0 centre → 1 rim). Codes, not
 *  strings — this runs inside the raster loop. */
export function massCellCode(d2: number): number {
  return d2 < MASS_CORE_D2 ? CODE_AT : d2 < MASS_BODY_D2 ? CODE_O : CODE_DOT;
}

/** Per-cell alpha for the mass at squared normalized radius `d2`: solid core, soft fringe. */
export function massCellAlpha(d2: number): number {
  return d2 < MASS_CORE_D2 ? 1 : d2 < MASS_BODY_D2 ? 0.85 : 0.55;
}

// --- Per-frame level mix ------------------------------------------------------------------------

export interface LodMix {
  /** Draw alpha per hierarchy level (coarsest → finest): `clusterLevelAlphas × massAlpha`. At most
   *  two adjacent levels are nonzero mid-crossfade; all go to 0 as the mass band hands over. */
  levelAlphas: number[];
  /** How much of the field the territory MASSES own (`bandsForT`'s far band). The per-level split
   *  above is this number distributed over the levels. */
  massAlpha: number;
  /** The leaf/glyph RASTER gate — `1 - massAlpha`, i.e. `backboneAlpha + memberAlpha`. Individual
   *  note glyphs rasterize across BOTH the mid and the near band, not only the near one: the mid
   *  band is "individual glyphs joined by a hub-to-hub backbone". This is NOT the member-edge
   *  alpha; see `memberAlpha`. */
  glyphAlpha: number;
  /** How much of the field the hub-to-hub BACKBONE owns (`bandsForT`'s mid band) — the multiplier
   *  on `backbone.ts`'s `computeEdgeLevelWeights` per-level group-line weights. */
  backboneAlpha: number;
  /** How much of the field the REAL, individual member edges own (`bandsForT`'s near band). The
   *  renderer's `strokeEdges()` member passes take THIS, never `glyphAlpha` — in the mid band the
   *  two are numerically different (glyphs ≈ 1, member edges ≈ 0), and collapsing them onto one
   *  field draws the hairball the backbone exists to replace. See backbone.ts's wiring recipe. */
  memberAlpha: number;
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
 * band. `bandsForT` is the single owner of that handover now (MERGE-NOTES.md §5.4); this function
 * only distributes the mass band's share over the hierarchy levels, which is unchanged.
 */
export function lodMix(t: number, levelCount: number): LodMix {
  const bands = bandsForT(t, levelCount);
  const levelAlphas = clusterLevelAlphas(t, levelCount);
  for (let i = 0; i < levelAlphas.length; i++) levelAlphas[i] *= bands.massAlpha;
  return {
    levelAlphas,
    massAlpha: bands.massAlpha,
    glyphAlpha: 1 - bands.massAlpha,
    backboneAlpha: bands.backboneAlpha,
    memberAlpha: bands.memberAlpha,
  };
}

/** Below this alpha a level (or the leaf pass) is skipped entirely — the raster work never runs. */
export const LOD_ALPHA_EPS = 0.02;
