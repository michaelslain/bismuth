// Backend layout precompute + cache. Computes BOTH a 3D and a flat 2D layout for the graph
// (PivotMDS + force refine, see layout.ts) and attaches `position` / `position2d` to every node, so
// the browser renders both modes instantly and morphs smoothly between them — never running the
// expensive force settle on its main thread. The 2D layout is seeded from the flattened 3D one so
// the two stay aligned (a 2D↔3D morph flattens in place instead of scrambling).
//
// Caching is two-tier: an in-memory map (survives within a server run) and a JSON file on disk, keyed
// by a graph signature. IMPORTANT: the disk cache lives under a DURABLE app dir (~/.bismuth/layout-cache),
// NOT inside the vault/memory dirs — writing there would trip the fs watcher and trigger an infinite
// invalidate → rebuild → recompute → rewrite loop. It used to live in os.tmpdir(), but macOS purges
// /tmp periodically (and it's empty on every fresh process), so a meaningful fraction of cold boots
// recomputed the whole (multi-second) layout from scratch; a durable dir makes a normal close/reopen a
// reliable cache hit. Override with BISMUTH_LAYOUT_CACHE_DIR (used by tests to isolate/redirect the cache).
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { computeLayoutAsync, type Positions } from "./layout";
import { subgraphByKinds, type GraphData, type ViewLayout, SECOND_BRAIN_KINDS as SECOND_KINDS, THIRD_BRAIN_KINDS as THIRD_KINDS } from "./graph";

interface Layout { pos3d: Positions; pos2d: Positions }

/** Drop the trailing z from a Positions triple — pos2d entries are [x,y,z] with z=0. */
const to2d = (p: number[]): [number, number] => [p[0], p[1]];

const CACHE_DIR = process.env.BISMUTH_LAYOUT_CACHE_DIR || join(homedir(), ".bismuth", "layout-cache");
// v9: incremental "add-only" rebuilds pin pre-existing nodes (layout.ts fixedIds) so only new nodes
//     settle — different output than the old whole-graph warm re-settle for newly-added structures.
// v8: reel disconnected components into the main mass via virtual tether links (layout.ts) — orphan
//     notes (no in-view links) no longer fling out to an empty direction; changes any >1-component graph.
// v7: stronger small-graph linkDist boost (400/n, cap 8) — much airier small graphs.
// v6: small-graph linkDist boost added (sqrt(500/n) factor in layout.ts) changes layout output.
// v5: collide iterations 3→6 + padding 1.25→1.55 (anti-overlap).
const CACHE_VERSION = "v9";
const REFINE_TICKS = 120; // PivotMDS-seeded, so this polishes well without a full ~300-tick settle
// Incremental (pinned add-only) rebuild: only the new nodes move, so far fewer ticks converge (the
// early-exit in computeLayoutAsync usually stops sooner). Cap the number of added nodes that take this
// path — a large batch import is better re-optimized globally by a full cold-quality warm rebuild.
const REFINE_TICKS_INCREMENTAL = 60;
const INCREMENTAL_MAX_ADD = 25;
const INCREMENTAL_MAX_FRAC = 0.1;
const memCache = new Map<string, Layout>();

// --- Per-graph-object memoization -------------------------------------------------------------
// graphSig() sorts every node id (O(n log n)) + every edge string (O(m log m)); subgraphByKinds()
// walks the whole node/edge list (O(n+m)). Both are pure functions of a GraphData's structure, and
// nothing downstream ever mutates a GraphData's nodes/edges in place (subgraphByKinds only reads
// `n.kind`/`e.from`/`e.to`; computeLayoutAsync's prepareLayout only reads `.id`/`.from`/`.to` off the
// nodes/edges it's given — see layout.ts). So for a given graph OBJECT, its signature and its 2nd/3rd
// brain subgraphs are safe to compute once and reuse for every later call that happens to receive the
// exact same reference — notably attachLayout's peek (below) followed by a computeViewLayouts call
// over the identical cached graph (e.g. GET /graph/views, or the background view-layout warm-up in
// server.ts, both of which operate on the same object graphCache.get() keeps returning until the next
// rebuild). WeakMap so entries vanish on their own once a graph is superseded by the next rebuild.
const sigCache = new WeakMap<GraphData, { vaultKey: string; sig: string }>();
function memoSig(graph: GraphData, vaultKey: string): string {
  const cached = sigCache.get(graph);
  if (cached && cached.vaultKey === vaultKey) return cached.sig;
  const sig = graphSig(graph, vaultKey);
  sigCache.set(graph, { vaultKey, sig });
  return sig;
}

const brainSubgraphCache = new WeakMap<GraphData, { second: GraphData; third: GraphData }>();
/** The 2nd-brain (note+tag) and 3rd-brain (memory) subgraphs of `graph`, built once per graph object
 *  and reused by every later caller that passes the same reference. `subgraphByKinds` is pure and
 *  order-preserving, so a cached subgraph is structurally identical to a freshly-built one. */
function brainSubgraphs(graph: GraphData): { second: GraphData; third: GraphData } {
  let subgraphs = brainSubgraphCache.get(graph);
  if (!subgraphs) {
    subgraphs = { second: subgraphByKinds(graph, SECOND_KINDS), third: subgraphByKinds(graph, THIRD_KINDS) };
    brainSubgraphCache.set(graph, subgraphs);
  }
  return subgraphs;
}
// -----------------------------------------------------------------------------------------------

// Last full-graph layout per vault, kept so a structural edit warm-starts the next build from where
// the graph already was instead of a cold PivotMDS, and (for a pure add) lets us pin the unchanged
// nodes and settle only the new ones. Persisted to disk (see read/writeSeed) so the warm-start
// survives a process restart — without it, the first structural edit after relaunch paid a cold
// PivotMDS. Only the FULL graph is seeded here (not subgraph/view layouts), keyed by vaultKey.
const lastFullLayout = new Map<string, Layout>();

/** Stable signature of the graph's structure (node set + edge endpoints) — changes when the graph does.
 *  Edges are hashed by their sorted `from|to|kind` keys, not just their count, so retargeting a wikilink
 *  between two existing notes ([[A]] → [[B]]: same node set, same edge count) still busts the cache. */
export function graphSig(graph: GraphData, vaultKey: string): string {
  const ids = graph.nodes.map((n) => n.id).sort().join("\n");
  const edges = graph.edges.map((e) => `${e.from}|${e.to}|${e.kind}`).sort().join("\n");
  const h = createHash("sha1").update(vaultKey).update(" ").update(ids).update(" ").update(edges).digest("hex");
  return `${CACHE_VERSION}-${h.slice(0, 16)}`;
}

function readDisk(sig: string): Layout | null {
  try {
    return JSON.parse(readFileSync(join(CACHE_DIR, `${sig}.json`), "utf8")) as Layout;
  } catch {
    return null;
  }
}

async function writeDisk(sig: string, layout: Layout): Promise<void> {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    // Async write (Bun.write) instead of writeFileSync: the layout JSON can be
    // multi-MB for a large vault, and a sync write here blocks Bun's single thread
    // on the /graph path — stalling concurrent /file reads. JSON.stringify is still
    // sync, but the blocking syscall is the bigger offender; the await also lets the
    // event loop service other requests while the bytes flush.
    await Bun.write(join(CACHE_DIR, `${sig}.json`), JSON.stringify(layout));
  } catch {
    // cache dir unavailable — in-memory cache still applies for this run
  }
}

/** Disk path for a vault's persisted warm-start seed (the last full layout), keyed by vaultKey so
 *  the warm-start survives a restart. Versioned with CACHE_VERSION so a layout-algorithm change
 *  ignores stale seeds. */
function seedPath(vaultKey: string): string {
  const h = createHash("sha1").update(vaultKey).digest("hex").slice(0, 16);
  return join(CACHE_DIR, `seed-${CACHE_VERSION}-${h}.json`);
}

function readSeed(vaultKey: string): Layout | null {
  try {
    return JSON.parse(readFileSync(seedPath(vaultKey), "utf8")) as Layout;
  } catch {
    return null;
  }
}

async function writeSeed(vaultKey: string, layout: Layout): Promise<void> {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    await Bun.write(seedPath(vaultKey), JSON.stringify(layout));
  } catch {
    // cache dir unavailable — in-memory lastFullLayout still seeds this run
  }
}

/** If the new graph is the seed's node set plus a SMALL number of additions (and nothing removed),
 *  return the ids to pin so only the new nodes settle. Returns null for deletions, pure edge-only
 *  changes (same node set), an absent/empty seed, or a large batch — those take the normal warm/cold
 *  path (a delete/retarget or big import is better re-settled globally). */
function incrementalPlan(seed: Layout, graph: GraphData): { fixed: string[] } | null {
  const seedIds = Object.keys(seed.pos3d);
  if (seedIds.length === 0) return null;
  const seedSet = new Set(seedIds);
  const newSet = new Set(graph.nodes.map((n) => n.id));
  for (const id of seedSet) if (!newSet.has(id)) return null; // a node was removed → not a pure add
  const fixed: string[] = [];
  let added = 0;
  for (const id of newSet) {
    if (seedSet.has(id)) fixed.push(id);
    else added++;
  }
  if (added === 0) return null; // same node set (e.g. a wikilink retarget) → no add to fast-path
  const cap = Math.max(INCREMENTAL_MAX_ADD, Math.floor(newSet.size * INCREMENTAL_MAX_FRAC));
  if (added > cap) return null; // large batch → full warm rebuild re-optimizes globally
  return { fixed };
}

/** 2D warm-start seed for an incremental rebuild: pinned (existing) nodes hold their PRIOR 2D position
 *  (so 2D stays as stable as 3D), while new nodes start from their freshly-settled 3D position flattened
 *  (so the 2D layout stays aligned with 3D and the morph flattens in place). */
function incremental2dSeed(seed: Layout, pos3d: Positions, fixed: Set<string>): Positions {
  const out: Positions = {};
  for (const id of fixed) {
    const p2 = seed.pos2d[id];
    const p3 = seed.pos3d[id];
    out[id] = p2 ? [p2[0], p2[1], 0] : p3 ? [p3[0], p3[1], 0] : [0, 0, 0];
  }
  for (const id in pos3d) {
    if (fixed.has(id)) continue;
    const p = pos3d[id];
    out[id] = [p[0], p[1], 0];
  }
  return out;
}


/** Compute (or fetch from cache) the 3D + flat-2D layout for one graph. ~3-5s for a few thousand nodes
 *  on a cold build; far less when `seed` warm-starts it. Uses the event-loop-yielding layout so a big
 *  settle doesn't block concurrent requests. `seed` (the prior full layout) skips PivotMDS on a miss;
 *  for a pure add it also pins the unchanged nodes so only the new ones settle (cheap + no scramble). */
async function layoutFor(graph: GraphData, vaultKey: string, seed?: Layout): Promise<Layout> {
  const sig = memoSig(graph, vaultKey);
  let layout = memCache.get(sig) ?? readDisk(sig);
  if (!layout) {
    const input = { nodes: graph.nodes, edges: graph.edges.map((e) => ({ from: e.from, to: e.to })) };
    const plan = seed ? incrementalPlan(seed, graph) : null;
    if (seed && plan) {
      // Incremental add-only rebuild: pin every pre-existing node where it already is and let only the
      // new node(s) settle in among them. Existing nodes provably don't move (no scramble), and with
      // the convergence early-exit this converges in a handful of ticks.
      const fixed = new Set(plan.fixed);
      const pos3d = await computeLayoutAsync(input, { dimensions: 3, refineTicks: REFINE_TICKS_INCREMENTAL, initialPositions: seed.pos3d, fixedIds: plan.fixed });
      const seed2d = incremental2dSeed(seed, pos3d, fixed);
      const pos2d = await computeLayoutAsync(input, { dimensions: 2, refineTicks: REFINE_TICKS_INCREMENTAL, initialPositions: seed2d, fixedIds: plan.fixed });
      layout = { pos3d, pos2d };
    } else {
      // Warm-start 3D from the prior layout when given; otherwise cold PivotMDS. Either way the 2D layout
      // is seeded from the flattened 3D one → aligned (morph flattens in place) and faster to converge.
      const pos3d = await computeLayoutAsync(input, { dimensions: 3, refineTicks: REFINE_TICKS, initialPositions: seed?.pos3d });
      const pos2d = await computeLayoutAsync(input, { dimensions: 2, refineTicks: REFINE_TICKS, initialPositions: pos3d });
      layout = { pos3d, pos2d };
    }
    await writeDisk(sig, layout);
  }
  memCache.set(sig, layout);
  return layout;
}

/**
 * Cached layout for a graph (in-memory or on-disk) WITHOUT computing it. Returns null when
 * absent. An empty graph has the trivial empty layout, so callers treat it as "cached"
 * (e.g. the 3rd-brain subgraph when there is no memory dir) instead of scheduling work.
 */
export function peekLayout(graph: GraphData, vaultKey: string): Layout | null {
  if (graph.nodes.length === 0) return { pos3d: {}, pos2d: {} };
  const sig = memoSig(graph, vaultKey);
  const hit = memCache.get(sig) ?? readDisk(sig);
  if (hit) memCache.set(sig, hit);
  return hit ?? null;
}

/**
 * Compute (and cache) BOTH brain-view layouts for a graph. Called on demand by the
 * /graph/views endpoint when the user switches to 2nd/3rd-brain mode — attachLayout omits
 * them from the cold /graph so first paint only pays for the full-graph layout.
 */
export async function computeViewLayouts(graph: GraphData, vaultKey: string): Promise<{ second: ViewLayout; third: ViewLayout }> {
  const { second: secondGraph, third: thirdGraph } = brainSubgraphs(graph);
  const second = await layoutFor(secondGraph, vaultKey);
  const third = await layoutFor(thirdGraph, vaultKey);
  return { second: toViewLayout(second), third: toViewLayout(third) };
}

function toViewLayout(layout: Layout): ViewLayout {
  // Copy pos2d to drop the trailing z=0 that Positions always carries (it's a [x,y,z] triple even for 2D).
  const pos2d: ViewLayout["pos2d"] = {};
  for (const id in layout.pos2d) {
    pos2d[id] = to2d(layout.pos2d[id]);
  }
  return { pos3d: layout.pos3d, pos2d };
}

export async function attachLayout(graph: GraphData, vaultKey: string): Promise<GraphData> {
  if (graph.nodes.length === 0) return graph;
  // Warm-start the full-graph layout from the previous one for this vault (skips cold PivotMDS on a
  // structural edit; pins unchanged nodes on a pure add), then remember the result as the seed for the
  // next rebuild. The seed falls back to the on-disk copy so the warm-start survives a process restart.
  const seed = lastFullLayout.get(vaultKey) ?? readSeed(vaultKey) ?? undefined;
  const layout = await layoutFor(graph, vaultKey, seed);
  lastFullLayout.set(vaultKey, layout);
  void writeSeed(vaultKey, layout);
  // Brain-view layouts (2nd = note+tag, 3rd = memory) are only used in 2nd/3rd-brain
  // mode. Attach them only when ALREADY cached (a cheap peek) so the cold first /graph
  // pays for just the full-graph layout. When absent they're computed on demand via
  // GET /graph/views; the frontend falls back to full-graph positions until then.
  const { second: secondGraph, third: thirdGraph } = brainSubgraphs(graph);
  const second = peekLayout(secondGraph, vaultKey);
  const third = peekLayout(thirdGraph, vaultKey);
  const views = second && third
    ? { second: toViewLayout(second), third: toViewLayout(third) }
    : undefined;

  return {
    edges: graph.edges,
    views,
    nodes: graph.nodes.map((n) => {
      const p3 = layout.pos3d[n.id];
      const p2 = layout.pos2d[n.id];
      if (!p3 && !p2) return n;
      const updates: Partial<typeof n> = {};
      if (p3) updates.position = p3;
      if (p2) updates.position2d = to2d(p2);
      return { ...n, ...updates };
    }),
  };
}
