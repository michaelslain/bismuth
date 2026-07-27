// app/src/graph/organicLayout.ts
//
// TESTING ONLY — client-side ORGANIC layout for the R1/R3 renderer harness (see rendererKind.ts).
// R1/R3 mount the pre-ASCII CanvasGraphRenderer, whose whole point is to look like the graph did
// BEFORE community-aware clustering (core/src/layout-cache.ts CACHE_VERSION v13+) existed at all: a
// force-settled cloud where nothing beyond ordinary link/repulsion physics decides where a node
// lands — no community gravity/separation, no grid-island lattice either (the backend's
// `clusterLayout` DEFAULT flipped grid → organic at v18, but organic still runs the community-aware
// forces; R1/R3 explicitly turn those off too, via `communityForces: false`). So for canvas kinds
// GraphView does NOT draw the backend's node.position/position2d (the shared /graph payload) — it
// asks HERE for a fresh settle instead, computed off the main thread (layoutWorker.ts) with the
// exact layout core the backend precompute uses (core/src/layout.ts), passing `{ communityForces:
// false, clusterLayout: "organic" }` — which layout.ts's own LayoutOptions docs say reproduces the
// pre-community-detection, pre-grid-island physics byte-identically. R2/R4 (AsciiGraphRenderer) are
// untouched — they keep drawing the backend's (now organic-by-default, community-aware) positions
// exactly as shipped.
//
// Results are cached in-memory, keyed by a structural signature of the graph (node ids + edge
// endpoints) — NOT by renderer kind: R1 and R3 both mount CanvasGraphRenderer with an identical
// layout need (R3 only changes the label FONT, never positions), so they always share one cache
// entry per graph shape and toggling between them is instant. A mode switch (2nd/3rd/both/daemon)
// changes the node/edge set, which changes the signature, so it correctly recomputes.
import type { GraphData } from "../../../core/src/graph";
import type { LayoutInput, Positions } from "../../../core/src/layout";
import { hashKey } from "../themeColors";
import LayoutWorkerCtor from "./layoutWorker?worker";
import type { LayoutWorkerRequest, LayoutWorkerResponse } from "./layoutWorker";

export interface OrganicLayout {
  pos3d: Positions;
  pos2d: Record<string, [number, number]>;
}

/** Structural signature of a graph's node set + edge endpoints — this is only ever an in-memory Map
 *  key (not a security boundary or a persisted cache), so a cheap string hash (reuses themeColors.ts's
 *  `hashKey` rather than re-implementing one) is enough; no real digest needed. Mirrors
 *  core/src/layout-cache.ts's `graphSig`, minus the vaultKey — the client only ever has one vault
 *  open at a time, so the node/edge content alone already disambiguates. */
function graphSignature(graph: GraphData): string {
  const ids = graph.nodes.map((n) => n.id).sort().join("\n");
  const edges = graph.edges.map((e) => `${e.from}|${e.to}|${e.kind}`).sort().join("\n");
  return `${graph.nodes.length}:${graph.edges.length}:${hashKey(ids)}:${hashKey(edges)}`;
}

const cache = new Map<string, OrganicLayout>();
const pending = new Map<string, Promise<OrganicLayout>>();

// One worker for the app's lifetime — the layout core (core/src/layout.ts) is stateless, so there's
// nothing per-mount to tear down; every GraphView instance (main pane + sidebar mini-graph) shares it.
let worker: Worker | null = null;
let nextRequestId = 1;
const waiters = new Map<number, { resolve: (v: OrganicLayout) => void; reject: (e: unknown) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new LayoutWorkerCtor();
  worker.onmessage = (ev: MessageEvent<LayoutWorkerResponse>) => {
    const { id, pos3d, pos2d, error } = ev.data;
    const w = waiters.get(id);
    if (!w) return; // stale/duplicate message, or the caller already stopped waiting — nothing to do
    waiters.delete(id);
    if (error || !pos3d || !pos2d) w.reject(new Error(error ?? "organic layout worker returned no positions"));
    else w.resolve({ pos3d, pos2d });
  };
  return worker;
}

function computeInWorker(nodes: LayoutInput["nodes"], edges: LayoutInput["edges"]): Promise<OrganicLayout> {
  const w = ensureWorker();
  const id = nextRequestId++;
  return new Promise<OrganicLayout>((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    const req: LayoutWorkerRequest = { id, nodes, edges };
    w.postMessage(req);
  });
}

/** Cache-only lookup — never computes, never touches the worker. Lets a caller decide synchronously
 *  whether to show a "settling…" state before calling `getOrganicLayout`. */
export function peekOrganicLayout(graph: GraphData): OrganicLayout | null {
  if (graph.nodes.length === 0) return { pos3d: {}, pos2d: {} };
  return cache.get(graphSignature(graph)) ?? null;
}

/** Get (or compute + cache) the organic layout for `graph`. Concurrent calls for the same graph
 *  shape share one in-flight worker round-trip. */
export function getOrganicLayout(graph: GraphData): Promise<OrganicLayout> {
  if (graph.nodes.length === 0) return Promise.resolve({ pos3d: {}, pos2d: {} });
  const sig = graphSignature(graph);
  const cached = cache.get(sig);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(sig);
  if (inflight) return inflight;
  const nodes: LayoutInput["nodes"] = graph.nodes.map((n) => ({ id: n.id, community: n.community, communityPath: n.communityPath }));
  const edges: LayoutInput["edges"] = graph.edges.map((e) => ({ from: e.from, to: e.to }));
  const promise = computeInWorker(nodes, edges)
    .then((result) => { cache.set(sig, result); pending.delete(sig); return result; })
    .catch((err) => { pending.delete(sig); throw err; });
  pending.set(sig, promise);
  return promise;
}

/** Overlay `layout`'s positions onto `graph` WITHOUT mutating it — `props.graph` is shared (R2/R4
 *  and any other reader see the SAME object), so this clones the node array and only replaces
 *  `position`/`position2d` per node. Every other field (id/kind/label/community/daemon/etc.) passes
 *  through unchanged, so hover/click/search/legend — all keyed off those fields, never position —
 *  keep working exactly as before, just against different coordinates. */
export function withOrganicPositions(graph: GraphData, layout: OrganicLayout): GraphData {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const p3 = layout.pos3d[n.id];
      const p2 = layout.pos2d[n.id];
      if (!p3 && !p2) return n;
      return { ...n, ...(p3 ? { position: p3 } : {}), ...(p2 ? { position2d: p2 } : {}) };
    }),
  };
}
