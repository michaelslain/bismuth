// app/src/graph/layoutWorker.ts
//
// TESTING ONLY — background thread for the R1/R3 renderer harness's client-side ORGANIC layout
// (see organicLayout.ts, the only caller, and rendererKind.ts for what R1/R3 are). Runs
// core/src/layout.ts's `computeLayout` — the SAME pure layout core the backend precompute uses
// (core/src/layout-cache.ts) — off the main thread, so a multi-thousand-node force settle (~5-10s
// on 2k nodes) never freezes the app while it converges.
//
// Deliberately the SYNCHRONOUS `computeLayout`, not `computeLayoutAsync`: the async variant yields
// to the event loop via `setImmediate` so a big settle doesn't block *Bun's* single request-handling
// thread — a browser Worker has no such neighbour to protect (nothing else runs on it), and
// `setImmediate` isn't even a browser global, so the async variant would throw ReferenceError here.
// Blocking THIS thread for the whole settle is the entire point of having a worker — see
// EmbeddedGraph.tsx's `` ```graph `` block preview, the other client-side caller of this same core
// module, which already uses the sync `computeLayout` (on the main thread, but its graphs are tiny).
//
// Built via Vite's `?worker` import — see organicLayout.ts:
//   import LayoutWorkerCtor from "./layoutWorker?worker";
//   const worker = new LayoutWorkerCtor();
import { computeLayout, type LayoutInput, type Positions } from "../../../core/src/layout";

export interface LayoutWorkerRequest {
  id: number;
  nodes: LayoutInput["nodes"];
  edges: LayoutInput["edges"];
}
export interface LayoutWorkerResponse {
  id: number;
  pos3d?: Positions;
  /** [x,y] pairs — the trailing z=0 already dropped (mirrors layout-cache.ts's `to2d`). */
  pos2d?: Record<string, [number, number]>;
  error?: string;
}

// `self` inside a worker module is really a DedicatedWorkerGlobalScope, but the app's tsconfig only
// pulls in the "DOM" lib (not "webworker" — mixing the two libs' ambient globals conflicts, since
// both declare a global `self`/`postMessage` with different shapes). DOM's `Worker` interface (the
// MAIN-thread handle used to talk to a worker) happens to declare the exact onmessage/postMessage
// shape a worker sees looking at itself, so casting through it is a compile-time-only shim — the
// runtime object underneath is unchanged.
const ctx = self as unknown as Worker;

ctx.onmessage = (ev: MessageEvent<LayoutWorkerRequest>) => {
  const { id, nodes, edges } = ev.data;
  try {
    const input: LayoutInput = { nodes, edges };
    // Mirrors layout-cache.ts's layoutFor: 3D first (cold PivotMDS seed), then 2D seeded from the
    // flattened 3D result so a 2D<->3D morph aligns instead of scrambling. `communityForces:false` +
    // `clusterLayout:"organic"` reproduce the pre-grid-island, community-unaware physics BYTE-
    // IDENTICALLY (see layout.ts's own LayoutOptions docs) — the true pre-redesign look R1/R3 exist
    // to show off.
    const pos3d = computeLayout(input, { dimensions: 3, communityForces: false, clusterLayout: "organic" });
    const pos2dRaw = computeLayout(input, { dimensions: 2, communityForces: false, clusterLayout: "organic", initialPositions: pos3d });
    const pos2d: Record<string, [number, number]> = {};
    for (const nid in pos2dRaw) pos2d[nid] = [pos2dRaw[nid][0], pos2dRaw[nid][1]];
    const res: LayoutWorkerResponse = { id, pos3d, pos2d };
    ctx.postMessage(res);
  } catch (e) {
    const res: LayoutWorkerResponse = { id, error: e instanceof Error ? e.message : String(e) };
    ctx.postMessage(res);
  }
};
