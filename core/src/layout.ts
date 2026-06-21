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
const DEFAULTS = { dimensions: 3 as 2 | 3, numPivots: 50, refineTicks: 150, repulsion: -10, linkDistance: 5, centering: 0.13, virtualLinkStrength: 1.2, virtualAnchors: 4, virtualDistMult: 0.8 };
const LINK_STRENGTH = 0.18;
// 2D-only force tuning (see prepareLayout): the flat layout has one less dimension of room, so without
// help it collapses into a hairball. Push communities apart (repulsion ×), let them breathe (centering
// ×), and enforce a slightly bigger honeycomb gap (collide ×). 3D keeps the gentler defaults.
const MODE_2D_REPULSION_MULT = 3;
const MODE_2D_CENTERING_MULT = 0.5;
const MODE_2D_COLLIDE_MULT = 1.2;
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
 *  component into the main mass (stronger + shorter than a real link; see prepareLayout's reel-in). */
type VL = RL & { virtual?: boolean };

/** All layout setup short of running the tick loop: build the adjacency, seed coordinates
 *  (PivotMDS or `initialPositions`), and construct the stopped d3-force simulation. Shared by the
 *  sync `computeLayout` and the async, event-loop-yielding `computeLayoutAsync`. */
function prepareLayout(input: LayoutInput, o: typeof DEFAULTS & LayoutOptions): { sim: ReturnType<typeof forceSimulation<RN>>; nodes: RN[]; dim: 2 | 3; mainIdx: number[] } {
  const dim = o.dimensions;
  const RANDOM_COORD_RADIUS = 160;
  const ids = input.nodes.map((nd) => nd.id);
  const n = ids.length;

  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const adj: number[][] = Array.from({ length: n }, () => []);
  const links: VL[] = [];
  for (const e of input.edges) {
    const a = index.get(e.from), b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    adj[a].push(b); adj[b].push(a);
    links.push({ source: e.from, target: e.to });
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
          links.push({ source: ids[i], target: ids[anchor], virtual: true });
        }
      }
    }
  }
  // -------------------------------------------------------------------------------------------------

  const seed = o.initialPositions;
  const X = seed
    ? ids.map((id) => {
        const p = seed[id];
        if (p) {
          return [p[0], p[1], dim === 3 ? p[2] : 0];
        } else {
          // Missing id (e.g. a newly-added node): pick a deterministic position seeded from a hash
          // of the id, so the warm-start layout stays reproducible instead of using Math.random().
          const rand = lcg(fnv1a(id));
          return [
            (rand() - 0.5) * RANDOM_COORD_RADIUS,
            (rand() - 0.5) * RANDOM_COORD_RADIUS,
            dim === 3 ? (rand() - 0.5) * RANDOM_COORD_RADIUS : 0
          ];
        }
      })
    : pivotMDS(adj, n, dim, o.numPivots);
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

  // Per-node collide radius: leaves keep the uniform spacing floor; hubs get their actual drawn
  // radius (degree-scaled) so big nodes repel as the circles they're drawn as, not as points. `i`
  // indexes `nodes`, the same order as `adj` and the sim's node array. Degree uses realDeg (real edges
  // only) so layout-only tether links above don't inflate an orphan's drawn-size collision radius.
  const collideMult = dim === 2 ? MODE_2D_COLLIDE_MULT : 1;
  const collideRadiusFor = (_n: RN, i: number) =>
    collideMult * Math.max(collideFloor, drawnNodeRadius(degreeScale(realDeg[i])) * COLLIDE_SIZE_PADDING);
  // One link force over real + tether links. Tethers (virtual) are shorter and stronger so a stray is
  // held inside the cloud against the long-range many-body repulsion; real edges keep their own spacing.
  const linkForce = forceLink<RN, VL>(links)
    .id((d: RN) => d.id)
    .distance((l: VL) => (l.virtual ? linkDist * o.virtualDistMult : linkDist))
    .strength((l: VL) => (l.virtual ? o.virtualLinkStrength : LINK_STRENGTH));
  // Flattening to 2D loses a whole dimension of room, so the same forces that spread nicely in 3D
  // collapse into a dense blob in 2D. Compensate in 2D: stronger many-body repulsion pushes communities
  // apart (so clusters stay distinct, not one hairball) and weaker pull-to-center lets them breathe into
  // an even, honeycomb-spaced spread. 3D keeps the gentler defaults.
  const repulsion = dim === 2 ? o.repulsion * MODE_2D_REPULSION_MULT : o.repulsion;
  const centering = dim === 2 ? o.centering * MODE_2D_CENTERING_MULT : o.centering;
  const sim = forceSimulation<RN>(nodes, dim)
    .alpha(1)
    .force("charge", forceManyBody<RN>().strength(repulsion).theta(MANYBODY_THETA))
    .force("link", linkForce)
    .force("collide", forceCollide<RN>(collideRadiusFor).iterations(COLLIDE_ITERATIONS))
    .force("x", forceX<RN>(0).strength(centering))
    .force("y", forceY<RN>(0).strength(centering));
  if (dim === 3) sim.force("z", forceZ<RN>(0).strength(o.centering));
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
export function computeLayout(input: LayoutInput, options: LayoutOptions = {}): Positions {
  const o = { ...DEFAULTS, ...options };
  if (input.nodes.length === 0) return {};
  const { sim, nodes, dim } = prepareLayout(input, o);
  for (let i = 0; i < o.refineTicks; i++) sim.tick();
  return extractPositions(nodes, dim);
}

/**
 * Identical result to `computeLayout`, but yields to the event loop every `YIELD_EVERY` force ticks
 * so a multi-thousand-node settle doesn't monopolize Bun's single thread and block other requests
 * (/tree, /file, /settings) for seconds. d3-force ticks are deterministic regardless of when we
 * yield between them, so the output matches the sync path exactly.
 */
const YIELD_EVERY = 16;
// Convergence early-exit for an incremental (pinned) settle: once the only moving nodes (the new ones)
// stop moving more than EPSILON units in a tick, further ticks are no-ops, so we stop. Only armed when
// `fixedIds` is set — a full cold/warm settle runs at alpha(1) and keeps drifting (it would never fire),
// so this never changes non-incremental output. MIN guards against quitting before a far-seeded new node
// has begun travelling toward its links.
const INCREMENTAL_EXIT_EPSILON = 0.3;
const INCREMENTAL_EXIT_MIN_TICKS = 8;
const yieldToEventLoop = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));
export async function computeLayoutAsync(input: LayoutInput, options: LayoutOptions = {}): Promise<Positions> {
  const o = { ...DEFAULTS, ...options };
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
    if (i > 0 && i % YIELD_EVERY === 0) await yieldToEventLoop();
  }
  return extractPositions(nodes, dim);
}
