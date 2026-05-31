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
