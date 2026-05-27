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
import type { GraphData } from "./graph";

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

/**
 * Return a copy of the graph with precomputed `position` (3D) and `position2d` (flat) on every node.
 * Uses the in-memory or disk cache when the graph signature is unchanged; otherwise computes both
 * layouts (~3-5s for a few thousand nodes) and caches them. `vaultKey` namespaces the cache per vault.
 */
export function attachLayout(graph: GraphData, vaultKey: string): GraphData {
  if (graph.nodes.length === 0) return graph;
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

  return {
    edges: graph.edges,
    nodes: graph.nodes.map((n) => {
      const p3 = layout.pos3d[n.id];
      const p2 = layout.pos2d[n.id];
      if (!p3 && !p2) return n;
      return { ...n, ...(p3 ? { position: p3 } : {}), ...(p2 ? { position2d: [p2[0], p2[1]] as [number, number] } : {}) };
    }),
  };
}
