// app/src/graph/labelSelection.ts
// Pure helper for the LabelLayer: which nodes get a permanent label regardless of camera state.
// Combines top-degree hubs with the currently-open file.
// Pure (no DOM, no Three.js) so it can be unit-tested directly.

import { drawnNodeRadius } from "./collide";

type NodeLike = { id: string; kind: string };
type EdgeEndpoint = string | { id: string };
type EdgeLike = { source: EdgeEndpoint; target: EdgeEndpoint };

function endpointId(e: EdgeEndpoint): string {
  return typeof e === "object" ? e.id : (e as string);
}

/**
 * Return the union of: top-`hubCount` nodes by edge degree and `activeFile` (if present and in the
 * node list). Ties in degree are broken by id (lexicographically ascending) so the choice is
 * deterministic across renders.
 *
 * Degree is computed as undirected degree (total connections, in or out — counts both source and target).
 */
export function computeAlwaysOnSet(
  nodes: NodeLike[],
  edges: EdgeLike[],
  activeFile: string | null,
  hubCount: number,
): Set<string> {
  const result = new Set<string>();
  if (nodes.length === 0) return result;
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Active file, if it actually exists in the graph.
  if (activeFile && nodeIds.has(activeFile)) result.add(activeFile);

  // Top-N by undirected degree.
  if (hubCount > 0) {
    const deg = new Map<string, number>();
    for (const n of nodes) deg.set(n.id, 0);
    for (const e of edges) {
      const s = endpointId(e.source);
      const t = endpointId(e.target);
      if (deg.has(s)) deg.set(s, (deg.get(s) ?? 0) + 1);
      if (deg.has(t)) deg.set(t, (deg.get(t) ?? 0) + 1);
    }
    const ranked = nodes
      .map((n) => ({ id: n.id, d: deg.get(n.id) ?? 0 }))
      .sort((a, b) => (b.d - a.d) || a.id.localeCompare(b.id));
    for (let i = 0; i < Math.min(hubCount, ranked.length); i++) {
      result.add(ranked[i].id);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 2D rendered-size label gating (no permanent hubs, no radius-from-center).
//
// Label visibility in 2D is driven by a node's *on-screen* size — its
// importance (degree multiplier) times zoom (smaller worldPerPixel = zoomed in)
// — plus an on-screen density cap so labels never pile up. Position relative to
// the viewport center never decides anything.
// ---------------------------------------------------------------------------

/**
 * On-screen radius in CSS px of a node drawn with degree multiplier `scale`.
 * Mirrors collide.ts: the node's world radius (`drawnNodeRadius`) divided by the
 * world-units-per-pixel of the current camera projection gives its pixel radius.
 * Larger `scale` (higher degree) and smaller `worldPerPixel` (zoomed in) both
 * yield a larger rendered radius.
 */
export function renderedPixelRadius(
  nodeSize: number,
  scale: number,
  fovDeg: number,
  worldPerPixel: number,
): number {
  return drawnNodeRadius(nodeSize, scale, fovDeg) / worldPerPixel;
}

export interface LabelCandidate {
  id: string;
  px: number; // projected screen position (CSS px)
  py: number;
  w: number; // label box size (CSS px)
  h: number;
  renderedPx: number; // node's on-screen radius (importance×zoom signal)
  forced: boolean; // hover / search-match / active file → bypass the size gate
}

export interface LabelSelectOpts {
  thresholdPx: number; // min renderedPx to be a candidate (default ~6)
  gridCell: number; // screen grid cell size in px (default 64)
  perCell: number; // max labels per cell (default 1)
}

/**
 * Pure label selection: forced labels always pass; others must clear
 * `thresholdPx`; then a screen-space grid keeps the worthiest (largest
 * renderedPx) `perCell` per cell and rejects overlaps. Returns the accepted id
 * set. No DOM, no Three.js.
 *
 * Ordering: forced candidates first, then by `renderedPx` descending, ties
 * broken by id. Forced labels also occupy their grid cell (so they declutter
 * neighbours) but are never themselves rejected by the cap.
 */
export function selectVisibleLabels(
  cands: LabelCandidate[],
  opts: LabelSelectOpts,
): Set<string> {
  const accepted = new Set<string>();
  const cellCounts = new Map<string, number>();

  const ordered = [...cands].sort((a, b) => {
    if (a.forced !== b.forced) return a.forced ? -1 : 1;
    if (b.renderedPx !== a.renderedPx) return b.renderedPx - a.renderedPx;
    return a.id.localeCompare(b.id);
  });

  for (const c of ordered) {
    const key =
      Math.floor(c.px / opts.gridCell) + ":" + Math.floor(c.py / opts.gridCell);
    const count = cellCounts.get(key) ?? 0;

    const passes = c.forced || (c.renderedPx >= opts.thresholdPx && count < opts.perCell);
    if (!passes) continue;

    accepted.add(c.id);
    cellCounts.set(key, count + 1);
  }

  return accepted;
}

// ---------------------------------------------------------------------------
// Zoom-driven label MODE: below a reveal point the field names CLUSTERS, not files — file names
// crossfade in (and their per-frame budget ramps up) only as the camera keeps zooming in. All of
// this is keyed off the same continuous "t" AsciiGraphRenderer already computes for its 0–100%
// resolution readout (see asciiGrid.ts `resolutionT`): 0 = fully zoomed out (res = 1, the whole
// graph fit to the grid), 1 = max resolution. Pure so the curve shape can be tuned + pinned here
// without touching the renderer or a canvas.
// ---------------------------------------------------------------------------

/** t below which NO file label is drawn (forced ones — hover/active/search — are the only
 *  exception; see AsciiGraphRenderer's `forced()`). Cluster names own the field down here — and
 *  since the LOD renderer (lod.ts) keys its GEOMETRY off the same boundary, so do the aggregate
 *  cluster ENTITIES: real notes and real edges only rasterize past this point, i.e. on the deep
 *  stops of the zoom ladder. Raised from 0.3 for the LOD redesign: the aggregate view owns the
 *  majority of the ladder (100%..40%), leaves crossfade in across ~30% and own ~20%..0%. */
export const FILE_LABEL_REVEAL_T = 0.6;
/** Width (in the same t units) of the cluster-name → file-name crossfade that starts at
 *  `FILE_LABEL_REVEAL_T`. */
export const FILE_LABEL_FADE_SPAN = 0.22;
/** t at which the file-label BUDGET (as opposed to the crossfade alpha above) reaches "every
 *  on-grid candidate". Deliberately later than the crossfade finishes — the crossfade is about
 *  visibility, the budget is about density, and "full naming only near max resolution" means the
 *  budget keeps climbing well after files have fully faded in. */
export const FILE_LABEL_FULL_T = 0.94;
/** Shape of the budget ramp: `u ** power`, power > 1 → slow-then-fast. Right after the reveal
 *  point only the highest-ranked (hub) candidates clear a budget of 1–2; the ramp only opens up
 *  approaching `FILE_LABEL_FULL_T`. */
export const FILE_LABEL_BUDGET_POWER = 2.6;

/**
 * How many non-forced file labels the field may draw at zoom fraction `t`, out of
 * `totalCandidates` on-grid nodes. Zero at/below `revealT`. Grows as `((t - revealT) /
 * (fullT - revealT)) ** power` beyond that — small for a while after the reveal point (letting
 * only genuine hubs, which are ranked first by the caller, name themselves early) and only
 * approaching `totalCandidates` near `fullT`.
 */
export function fileLabelBudget(
  t: number,
  totalCandidates: number,
  revealT: number = FILE_LABEL_REVEAL_T,
  fullT: number = FILE_LABEL_FULL_T,
  power: number = FILE_LABEL_BUDGET_POWER,
): number {
  if (totalCandidates <= 0 || t <= revealT) return 0;
  const span = Math.max(1e-6, fullT - revealT);
  const u = Math.max(0, Math.min(1, (t - revealT) / span));
  return Math.round(Math.pow(u, power) * totalCandidates);
}

/** Smoothstep crossfade: 0 at/below `revealT`, 1 at `revealT + fadeSpan` and beyond. Drives file
 *  labels' fade-IN alpha; `clusterLabelAlpha` is its complement. */
export function fileLabelAlpha(
  t: number,
  revealT: number = FILE_LABEL_REVEAL_T,
  fadeSpan: number = FILE_LABEL_FADE_SPAN,
): number {
  if (t <= revealT) return 0;
  const u = Math.max(0, Math.min(1, (t - revealT) / Math.max(1e-6, fadeSpan)));
  return u * u * (3 - 2 * u);
}

/** The complementary cluster-name alpha: clusters own the field at/below `revealT` and fade fully
 *  out once file labels have crossfaded in. */
export function clusterLabelAlpha(
  t: number,
  revealT: number = FILE_LABEL_REVEAL_T,
  fadeSpan: number = FILE_LABEL_FADE_SPAN,
): number {
  return 1 - fileLabelAlpha(t, revealT, fadeSpan);
}

// ---------------------------------------------------------------------------
// N-LEVEL cluster-name ladder: below `FILE_LABEL_REVEAL_T` (owned entirely by cluster names, see
// above) a graph with a `communityPath` deeper than one level doesn't just show ONE cluster
// tier — it walks the hierarchy coarsest → finest as the camera zooms in, one crossfade per level
// boundary, landing on the finest level exactly at `revealT` (where the two-state file-vs-cluster
// crossfade above takes over unchanged). A 1-level graph (the pre-hierarchy default, or any graph
// under the community detector's finest-only threshold) collapses to exactly the original
// single-tier behaviour: `clusterLevelAlphas(t, 1)` is `[1]` for every t below `revealT`.
// ---------------------------------------------------------------------------

/** Fraction of each level's segment spent crossfading INTO the next level (smoothstep, ending
 *  exactly at the segment's own boundary) — the rest of the segment shows that level at full
 *  strength. Mirrors `FILE_LABEL_FADE_SPAN`'s role for the outer file crossfade, sized per-segment
 *  instead of being a fixed t-width so it still fits comfortably at 4 levels. */
const LEVEL_FADE_FRAC = 0.45;

/**
 * The `levelCount + 1` t-boundaries splitting `[0, revealT)` into `levelCount` even segments, one
 * per hierarchy level (coarsest → finest). `boundaries[i]` is where level `i` starts owning the
 * field; `boundaries[levelCount] === revealT`, where the outer file crossfade takes over.
 */
export function levelBoundaries(levelCount: number, revealT: number = FILE_LABEL_REVEAL_T): number[] {
  const n = Math.max(1, levelCount);
  const seg = revealT / n;
  return Array.from({ length: n + 1 }, (_, i) => i * seg);
}

function smoothstep01(u: number): number {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
}

/** Rises smoothly from 0 to 1 as `t` crosses `at`, over a span of `fadeSpan` ending exactly at `at`. */
function riseTo1(t: number, at: number, fadeSpan: number): number {
  if (t >= at) return 1;
  const span = Math.max(1e-6, fadeSpan);
  if (t <= at - span) return 0;
  return smoothstep01((t - (at - span)) / span);
}

/**
 * Per-level alpha (coarsest → finest), one entry per level, for the N-level cluster-name ladder at
 * zoom progress `t`. A true partition of unity below `revealT` (the entries always sum to 1 — a
 * crossfade between adjacent levels, never independent fades), landing on `[0,…,0,1]` (only the
 * finest level "current") at/after `revealT`, where `clusterLabelAlpha`/`fileLabelAlpha` own the
 * rest of the fade into file names. Implemented as telescoping "have we entered level i yet"
 * indicators (`entered(0)=1`, `entered(levelCount)=0`, each boundary in between its own smoothstep)
 * so `alpha[i] = entered(i) - entered(i+1)` — the same shape as `fileLabelAlpha`/`clusterLabelAlpha`,
 * generalized to `levelCount - 1` internal boundaries instead of one.
 */
export function clusterLevelAlphas(
  t: number,
  levelCount: number,
  revealT: number = FILE_LABEL_REVEAL_T,
): number[] {
  const n = Math.max(1, levelCount);
  if (t >= revealT) return Array.from({ length: n }, (_, i) => (i === n - 1 ? 1 : 0));
  const bounds = levelBoundaries(n, revealT);
  const entered = (i: number): number => {
    if (i <= 0) return 1;
    if (i >= n) return 0;
    const segStart = bounds[i - 1], segEnd = bounds[i];
    const fadeSpan = (segEnd - segStart) * LEVEL_FADE_FRAC;
    return riseTo1(t, segEnd, fadeSpan);
  };
  return Array.from({ length: n }, (_, i) => entered(i) - entered(i + 1));
}

/** Eyebrow-register text for a cluster name: upper-cased, matching the design system's
 *  `.asc-eyebrow` treatment (`--ls-eyebrow` tracking is applied by the canvas caller via
 *  `ctx.letterSpacing`, not baked into the string). */
export function clusterLabelText(name: string): string {
  return name.toUpperCase();
}
