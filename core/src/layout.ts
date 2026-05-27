// Graph layout computation shared by the backend (precompute on graph change) and the app's
// layout Web Worker. Two stages:
//   1. PivotMDS (Brandes & Pich) — a fast, deterministic GLOBAL placement from graph-theoretic
//      distances to a handful of pivot nodes. Gets the overall shape right in O(k·(V+E)).
//   2. A short d3-force-3d REFINEMENT using the same forces/constants as the renderer, to polish
//      local spacing. Starting from PivotMDS means it converges in a fraction of the iterations a
//      random start needs — that's the whole point, since the force solve is the expensive part.
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
  nodes: { id: string }[];
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
   * scrambling — and it converges faster than a cold PivotMDS start. Missing ids fall back to random.
   */
  initialPositions?: Positions;
}

export type Positions = Record<string, [number, number, number]>;

// Force constants mirrored from the renderer (WebGLRenderer.ts) so a precomputed layout matches
// what the live renderer would settle to — otherwise the renderer's warm-skip would re-settle them.
const DEFAULTS = { dimensions: 3 as 2 | 3, numPivots: 100, refineTicks: 150, repulsion: -10, linkDistance: 5, centering: 0.13 };
const LINK_STRENGTH = 0.18;
const COLLIDE_RATIO = 0.9;
const COLLIDE_ITERATIONS = 3;
const MANYBODY_THETA = 1.5;
const MODE_2D_SPACING = 1.8;
const PIVOT_TARGET_RADIUS = 100; // PivotMDS output is scaled to this RMS radius; force refine sets the final scale

/** Deterministic LCG so layouts are reproducible (stable disk cache, testable). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
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

/**
 * Full layout: PivotMDS initial placement + a short d3-force-3d refinement (same forces as the
 * renderer). Returns id → [x, y, z] with integer coordinates (z = 0 in 2D mode).
 */
export function computeLayout(input: LayoutInput, options: LayoutOptions = {}): Positions {
  const o = { ...DEFAULTS, ...options };
  const dim = o.dimensions;
  const ids = input.nodes.map((n) => n.id);
  const n = ids.length;
  const positions: Positions = {};
  if (n === 0) return positions;

  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const adj: number[][] = Array.from({ length: n }, () => []);
  const links: RL[] = [];
  for (const e of input.edges) {
    const a = index.get(e.from), b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    adj[a].push(b); adj[b].push(a);
    links.push({ source: e.from, target: e.to });
  }

  const seed = options.initialPositions;
  const X = seed
    ? ids.map((id) => {
        const p = seed[id];
        return p ? [p[0], p[1], dim === 3 ? p[2] : 0] : [(Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160, dim === 3 ? (Math.random() - 0.5) * 160 : 0];
      })
    : pivotMDS(adj, n, dim, o.numPivots);
  const nodes: RN[] = ids.map((id, i) => ({
    id,
    x: X[i][0] ?? 0,
    y: X[i][1] ?? 0,
    z: dim === 3 ? (X[i][2] ?? 0) : 0,
  }));

  const linkDist = o.linkDistance * (dim === 2 ? MODE_2D_SPACING : 1);
  const sim = forceSimulation<RN>(nodes, dim)
    .alpha(1)
    .force("charge", forceManyBody<RN>().strength(o.repulsion).theta(MANYBODY_THETA))
    .force("link", forceLink<RN, RL>(links).id((d: RN) => d.id).distance(linkDist).strength(LINK_STRENGTH))
    .force("collide", forceCollide<RN>(linkDist * COLLIDE_RATIO).iterations(COLLIDE_ITERATIONS))
    .force("x", forceX<RN>(0).strength(o.centering))
    .force("y", forceY<RN>(0).strength(o.centering));
  if (dim === 3) sim.force("z", forceZ<RN>(0).strength(o.centering));
  sim.stop();
  for (let i = 0; i < o.refineTicks; i++) sim.tick();

  for (const nd of nodes) positions[nd.id] = [Math.round(nd.x ?? 0), Math.round(nd.y ?? 0), Math.round(dim === 3 ? (nd.z ?? 0) : 0)];
  return positions;
}
