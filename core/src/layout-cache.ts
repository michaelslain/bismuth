// Backend layout precompute + cache. Computes BOTH a 3D and a flat 2D layout for the graph
// (PivotMDS + force refine, see layout.ts) and attaches `position` / `position2d` to every node, so
// the browser renders both modes instantly and morphs smoothly between them — never running the
// expensive force settle on its main thread. The 2D layout is seeded from the flattened 3D one so
// the two stay aligned (a 2D↔3D morph flattens in place instead of scrambling).
//
// Caching is two-tier: an in-memory map (survives within a server run) and a JSON file in the OS
// temp dir, keyed by a graph signature. IMPORTANT: the cache is written to os.tmpdir(), NOT inside
// the vault/memory dirs — writing there would trip the fs watcher and trigger an infinite
// invalidate → rebuild → recompute → rewrite loop.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { computeLayout, type Positions } from "./layout";
import { subgraphByKinds, type GraphData, type NodeKind, type ViewLayout } from "./graph";

interface Layout { pos3d: Positions; pos2d: Positions }

const CACHE_DIR = join(tmpdir(), "oa-layout");
const CACHE_VERSION = "v3"; // bump when the layout format/algorithm changes to invalidate old files (v3: per-node collide radius)
const REFINE_TICKS = 120; // PivotMDS-seeded, so this polishes well without a full ~300-tick settle
const memCache = new Map<string, Layout>();

/** Stable signature of the graph's structure (node set + edge count) — changes when the graph does. */
function graphSig(graph: GraphData, vaultKey: string): string {
  const ids = graph.nodes.map((n) => n.id).sort().join("\n");
  const h = createHash("sha1").update(vaultKey).update(" ").update(ids).update(`|${graph.edges.length}`).digest("hex");
  return `${CACHE_VERSION}-${h.slice(0, 16)}`;
}

function readDisk(sig: string): Layout | null {
  try {
    return JSON.parse(readFileSync(join(CACHE_DIR, `${sig}.json`), "utf8")) as Layout;
  } catch {
    return null;
  }
}

function writeDisk(sig: string, layout: Layout): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, `${sig}.json`), JSON.stringify(layout));
  } catch {
    // temp dir unavailable — in-memory cache still applies for this run
  }
}

// Node kinds belonging to each brain VIEW, mirrored by the frontend's mode filter (App.tsx). "both"
// is the full graph (no subset). Each sub-view is laid out on its OWN node set so cross-brain-linked
// nodes aren't stranded far from their cluster when the other brain is hidden.
const SECOND_KINDS = new Set<NodeKind>(["self", "note", "tag"]);
const THIRD_KINDS = new Set<NodeKind>(["self", "memory"]);

/** Compute (or fetch from cache) the 3D + flat-2D layout for one graph. ~3-5s for a few thousand nodes. */
function layoutFor(graph: GraphData, vaultKey: string): Layout {
  const sig = graphSig(graph, vaultKey);
  let layout = memCache.get(sig) ?? readDisk(sig);
  if (!layout) {
    const input = { nodes: graph.nodes, edges: graph.edges.map((e) => ({ from: e.from, to: e.to })) };
    const pos3d = computeLayout(input, { dimensions: 3, refineTicks: REFINE_TICKS });
    // Seed 2D from the flattened 3D layout → aligned (morph flattens in place) and faster to converge.
    const pos2d = computeLayout(input, { dimensions: 2, refineTicks: REFINE_TICKS, initialPositions: pos3d });
    layout = { pos3d, pos2d };
    writeDisk(sig, layout);
  }
  memCache.set(sig, layout);
  return layout;
}

/** A Layout (full [x,y,z] in both maps) → wire ViewLayout (pos2d trimmed to [x,y]). */
function toViewLayout(layout: Layout): ViewLayout {
  const pos2d: ViewLayout["pos2d"] = {};
  for (const id in layout.pos2d) pos2d[id] = [layout.pos2d[id][0], layout.pos2d[id][1]];
  return { pos3d: layout.pos3d, pos2d };
}

/**
 * Return a copy of the graph with precomputed `position` (3D) and `position2d` (flat) on every node
 * for the full ("both") view, plus self-contained `views.second` / `views.third` layouts for the
 * brain subsets. Uses the in-memory or disk cache (keyed by graph signature) per layout. `vaultKey`
 * namespaces the cache per vault.
 */
export function attachLayout(graph: GraphData, vaultKey: string): GraphData {
  if (graph.nodes.length === 0) return graph;
  const layout = layoutFor(graph, vaultKey); // full graph → "both" view (unchanged)
  const second = layoutFor(subgraphByKinds(graph, SECOND_KINDS), vaultKey);
  const third = layoutFor(subgraphByKinds(graph, THIRD_KINDS), vaultKey);

  return {
    edges: graph.edges,
    views: { second: toViewLayout(second), third: toViewLayout(third) },
    nodes: graph.nodes.map((n) => {
      const p3 = layout.pos3d[n.id];
      const p2 = layout.pos2d[n.id];
      if (!p3 && !p2) return n;
      return { ...n, ...(p3 ? { position: p3 } : {}), ...(p2 ? { position2d: [p2[0], p2[1]] as [number, number] } : {}) };
    }),
  };
}
