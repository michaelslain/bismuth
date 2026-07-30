// app/src/graph/CanvasGraphRenderer.test.ts
//
// Headless CHARACTERIZATION cover for the legacy Canvas2D graph renderer, written just before the
// ASCII/Canvas merge (see MERGE-NOTES.md) so the merge's riskiest commit — deleting
// CanvasGraphRenderer.ts — doesn't silently drop the Canvas-only feature column: clearAroundSelf,
// the intra-cluster mesh, size-ranked cluster colours, hub-anchored cluster names, inViewport label
// culling, scaleToSpacing, and the 2D<->3D morph. These tests assert what the code does TODAY, not
// what it should do — a behaviour change during the merge should make one of these red, for the
// right reason. (Workflow lanes are deliberately NOT covered here: buildAgentGraph was the only
// producer of GraphNode.workflow and that whole path is already scheduled for deletion.)
//
// Harness ported from AsciiGraphRenderer.test.ts: happy-dom has no canvas, so a RECORDING 2D
// context stands in, capturing every draw call this renderer makes — batched arc()+fill()/stroke()
// node dots, batched moveTo/lineTo path strokes (edges, the intra-cluster mesh, group-level lines),
// and per-glyph fillText labels — instead of touching a real canvas. A manual rAF frame()/settle()
// driver steps the render loop deterministically: no wall-clock, no real timers, no Math.random.
//
// TEST ISOLATION (see blocks/milkdownSerialize.test.ts / AsciiGraphRenderer.test.ts for the full
// reasoning): Bun loads every `bun test app/src` module into ONE process, and several app modules
// resolve DOM-dependent singletons lazily off `globalThis.window`. So the DOM globals are installed
// in beforeAll (NOT at module top level) and exactly what we added is deleted in afterAll.
import { GlobalWindow } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CanvasGraphRenderer, type GraphConfig } from "./CanvasGraphRenderer";
import type { GraphData, GraphEdge, GraphNode } from "../../../core/src/graph";
import { intToHex } from "../themeColors";

const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "HTMLDivElement",
  "HTMLCanvasElement", "Text", "Event", "CustomEvent", "MouseEvent", "PointerEvent", "WheelEvent",
  "KeyboardEvent", "getComputedStyle", "DOMRect",
];
const installed: string[] = [];
const saved: Record<string, unknown> = {};
/** [object, key, originalValue] triples put back in afterAll. */
const restore: [Record<string, unknown>, string, unknown][] = [];

const BOX = { width: 800, height: 600 };

type PathOp =
  | { t: "moveTo"; x: number; y: number }
  | { t: "lineTo"; x: number; y: number }
  | { t: "arc"; x: number; y: number; r: number }
  | { t: "roundRect"; x: number; y: number; w: number; h: number; r: number }
  | { t: "rect"; x: number; y: number; w: number; h: number };

/** One `fill()`/`stroke()` call: the path ops traced since the last `beginPath()`, plus the style
 *  state at the moment the paint call fired (mirrors AsciiGraphRenderer.test.ts's `strokes`, widened
 *  to also cover `fill()` since this renderer draws its node dots as arc()+fill(), not glyphs). */
interface DrawEvent {
  kind: "fill" | "stroke";
  ops: PathOp[];
  color: string;
  alpha: number;
  lineWidth: number;
}
interface TextEvent { text: string; x: number; y: number; color: string; alpha: number; font: string; }

interface FakeCtx {
  draws: DrawEvent[];
  texts: TextEvent[];
  fonts: string[];
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  textAlign: string;
  textBaseline: string;
  lineCap: string;
  roundRect(x: number, y: number, w: number, h: number, r: number): void;
  setTransform(...a: number[]): void;
  clearRect(...a: number[]): void;
  save(): void;
  restore(): void;
  setLineDash(seg: number[]): void;
  fillText(t: string, x: number, y: number): void;
  measureText(s: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, ...rest: number[]): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
}

/** A 2D context that records what was drawn instead of touching a real canvas. Node dots are
 *  `beginPath(); arc(); fill()/stroke()`; edges/the intra-cluster mesh/group lines are
 *  `beginPath(); moveTo/lineTo…; stroke()` (batched — one DrawEvent per bucket, mirroring how the
 *  renderer itself batches a whole edge set into one path); labels are per-glyph `fillText`. */
function makeCtx(): FakeCtx {
  let font = "500 11px monospace";
  let pendingOps: PathOp[] = [];
  const ctx = {
    draws: [] as DrawEvent[],
    texts: [] as TextEvent[],
    fonts: [] as string[],
    get font() { return font; },
    set font(v: string) { font = v; ctx.fonts.push(v); },
    fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1,
    textAlign: "", textBaseline: "", lineCap: "",
    roundRect(x: number, y: number, w: number, h: number, r: number) { pendingOps.push({ t: "roundRect", x, y, w, h, r }); },
    setTransform() {}, clearRect() {}, save() {}, restore() {}, setLineDash() {},
    fillText(t: string, x: number, y: number) { ctx.texts.push({ text: t, x, y, color: ctx.fillStyle, alpha: ctx.globalAlpha, font }); },
    measureText(s: string) { return { width: s.length * 6 }; },
    beginPath() { pendingOps = []; },
    moveTo(x: number, y: number) { pendingOps.push({ t: "moveTo", x, y }); },
    lineTo(x: number, y: number) { pendingOps.push({ t: "lineTo", x, y }); },
    arc(x: number, y: number, r: number) { pendingOps.push({ t: "arc", x, y, r }); },
    rect(x: number, y: number, w: number, h: number) { pendingOps.push({ t: "rect", x, y, w, h }); },
    fill() { ctx.draws.push({ kind: "fill", ops: pendingOps, color: ctx.fillStyle, alpha: ctx.globalAlpha, lineWidth: ctx.lineWidth }); },
    stroke() { ctx.draws.push({ kind: "stroke", ops: pendingOps, color: ctx.strokeStyle, alpha: ctx.globalAlpha, lineWidth: ctx.lineWidth }); },
  };
  return ctx as unknown as FakeCtx;
}

let ctx: FakeCtx;
let rafQueue: FrameRequestCallback[] = [];

beforeAll(() => {
  const win = new GlobalWindow();
  for (const key of DOM_GLOBALS) {
    if (!(key in globalThis) && key in win) {
      (globalThis as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
      installed.push(key);
    }
  }
  if (!("window" in globalThis)) { (globalThis as Record<string, unknown>).window = win; installed.push("window"); }

  ctx = makeCtx();
  // happy-dom shares its Element/HTMLCanvasElement prototypes across GlobalWindow instances in one
  // process, so these two patches MUST be restored in afterAll — leaving an 800x600 box on every
  // element breaks other suites that rely on real 0x0 measurements (editor/tableWidget.test.ts).
  const canvasProto = (globalThis as unknown as { HTMLCanvasElement: { prototype: Record<string, unknown> } }).HTMLCanvasElement.prototype;
  restore.push([canvasProto, "getContext", canvasProto.getContext]);
  canvasProto.getContext = () => ctx;
  const elProto = Element.prototype as unknown as Record<string, unknown>;
  restore.push([elProto, "getBoundingClientRect", elProto.getBoundingClientRect]);
  elProto.getBoundingClientRect = function () {
    return { x: 0, y: 0, left: 0, top: 0, right: BOX.width, bottom: BOX.height, ...BOX, toJSON: () => ({}) } as DOMRect;
  };
  for (const key of ["ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"]) {
    saved[key] = (globalThis as Record<string, unknown>)[key];
  }
  (globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  // A MANUAL frame pump — the tests step the loop themselves so nothing is timing-dependent.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterAll(() => {
  for (const [obj, key, value] of restore) obj[key] = value;
  for (const key of Object.keys(saved)) (globalThis as Record<string, unknown>)[key] = saved[key];
  for (const key of installed) delete (globalThis as Record<string, unknown>)[key];
});

function frame(t = 16) {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(t);
}
/** Advance many frames (small, restarting timestamps) so a GLIDE (goalZoom/goalTarget/goalPan — all
 *  frame-count based, not clock based) settles. Do NOT use this once a 2D<->3D MORPH is in flight —
 *  morph timing IS clock-based (see the morph describe block below), and this helper's timestamps
 *  would run that clock backwards. */
function settle(n = 120) { for (let i = 0; i < n; i++) frame(16 * (i + 2)); }

const CONFIG: GraphConfig = {
  spin: false, spinSpeed: 0, palette: [], repulsion: 0, linkDistance: 5, centering: 0, nodeSize: 6,
  viewMode: "3d", showGraphLabels: true, graphLabelHubCount: 6, nodeSizeMinMult: 0.4,
  nodeSizeDegreeGain: 0.45, nodeSizeMaxMult: 6, edgeColor: 0, edgeOpacity: 0.3, backgroundColor: 0,
  labelTextColor: "#fff", labelBgColor: "#000", selfColor: 0xffffff,
};

interface Mounted {
  r: CanvasGraphRenderer;
  viewport: HTMLElement;
  clicks: string[];
  hovers: (string | null)[];
}

/** Mounts a fresh renderer, renders `graph`, then lets any startup 2D<->3D morph (triggered when
 *  `cfgOverrides.viewMode` differs from the class's own "3d" default) fully resolve before handing
 *  back a CLEAN paint — every test after this point starts from a settled camera (rx/ry/zoom/pan at
 *  rest), regardless of which viewMode it asked for. */
function mountRenderer(graph: GraphData, cfgOverrides: Partial<GraphConfig> = {}): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r = new CanvasGraphRenderer();
  const clicks: string[] = [];
  const hovers: (string | null)[] = [];
  r.mount(host, (id) => clicks.push(id), (n) => hovers.push(n?.id ?? null));
  r.setConfig({ ...CONFIG, ...cfgOverrides });
  r.render(graph);
  ctx.draws.length = 0; ctx.texts.length = 0;
  settle(60); // resolves a startup morph, if the viewMode override triggered one; a no-op otherwise
  ctx.draws.length = 0; ctx.texts.length = 0;
  r.setSearchMatches(new Set()); // harmless no-op mutation — forces one more, CLEAN repaint to inspect
  frame(9999);
  return { r, viewport: host.firstElementChild as HTMLElement, clicks, hovers };
}

/** Every (moveTo,lineTo) pair in one DrawEvent's ops — this renderer always issues them as adjacent
 *  pairs (one moveTo+lineTo per edge, batched into one beginPath/stroke per bucket), so consecutive
 *  pairing recovers exactly the segments that were stroked. Mirrors AsciiGraphRenderer.test.ts's
 *  `strokeSegs`. */
function segsOf(d: DrawEvent): [number, number, number, number][] {
  const segs: [number, number, number, number][] = [];
  for (let i = 0; i < d.ops.length - 1; i++) {
    const a = d.ops[i], b = d.ops[i + 1];
    if (a.t === "moveTo" && b.t === "lineTo") segs.push([a.x, a.y, b.x, b.y]);
  }
  return segs;
}
/** Loose float-safe "same screen point" check — a drawn segment's endpoint and a live nv.sx/nv.sy
 *  accumulate independent floating-point rounding through unrelated code paths. */
function samePoint(x1: number, y1: number, x2: number, y2: number): boolean {
  return Math.hypot(x1 - x2, y1 - y2) < 0.5;
}
// A real wheel event always carries the cursor position, but onWheel (below) never reads
// clientX/clientY — this renderer's zoom is NOT cursor-anchored (unlike AsciiGraphRenderer's), it
// just dollies the camera toward whatever `target` already is. The coordinates are set anyway for
// realism; they're inert.
const wheelIn = (viewport: HTMLElement, times = 10) => {
  for (let i = 0; i < times; i++) {
    const e = new WheelEvent("wheel", { deltaY: -120, cancelable: true });
    Object.defineProperty(e, "clientX", { value: BOX.width / 2 });
    Object.defineProperty(e, "clientY", { value: BOX.height / 2 });
    viewport.dispatchEvent(e);
  }
};

/** Standard RGB->hue (degrees), independent of the renderer's own (unexported) rgbToHsl — used only
 *  to check that buildColorSlots preserves each palette slot's HUE. Cycle 0 (see buildColorSlots)
 *  doesn't rotate hue at all; only saturation/lightness are boosted for graph-node fills
 *  (NODE_SAT_BOOST), so the hue alone is a robust, implementation-independent fingerprint of "which
 *  palette slot did this community land on". */
function hueOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 0xff) / 255, g = ((n >> 8) & 0xff) / 255, b = (n & 0xff) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// ---------------------------------------------------------------------------------------------

describe("clearAroundSelf — the self hub's clear zone", () => {
  function selfClearGraph(): GraphData {
    const nodes: GraphNode[] = [
      { id: "you", label: "You", kind: "self", position: [0, 0, 0], position2d: [0, 0] },
      // Two counterweights placed so their average is exactly the true origin — keeping the
      // non-self CENTROID (what scaleToSpacing recentres around, see build()) pinned at [0,0], so
      // "near"'s tiny raw offset from the origin survives as a tiny offset from "you" after
      // centring + uniform scaling, rather than being swamped by an off-centre mean of the
      // non-self node set.
      { id: "far1", label: "Far 1", kind: "note", position: [400, 400, 0], position2d: [400, 400] },
      { id: "far2", label: "Far 2", kind: "note", position: [-403, -400, 0], position2d: [-403, -400] },
      // Sits just 3 world units off "you" — well inside the clear zone before any nudge.
      { id: "near", label: "Near Note", kind: "note", position: [3, 0, 0], position2d: [3, 0] },
    ];
    const edges: GraphEdge[] = [
      { from: "you", to: "far1", kind: "link" },
      { from: "you", to: "far2", kind: "link" },
      { from: "you", to: "near", kind: "link" },
    ];
    return { nodes, edges };
  }

  it("nudges a node out of the hub's clear zone, and mutates sx/sy so edges and labels follow the nudge", () => {
    const { r } = mountRenderer(selfClearGraph(), { viewMode: "2d" });
    const priv = r as unknown as {
      nodes: { node: { id: string }; sx: number; sy: number; p2: [number, number, number]; pscale: number }[];
      fitPx: number; scale2: number;
      nodeDiameter(nv: unknown): number;
    };
    const byId = new Map(priv.nodes.map((n) => [n.node.id, n]));
    const self = byId.get("you")!, near = byId.get("near")!;

    // The RAW (pre-nudge) screen distance, reconstructed from the stable p2/scale2 fields — valid
    // because zoom/pan/target/rx/ry are all still their build()-reset rest values at fit (no
    // wheel/drag ran in this test), so sx = cx + p2.x * scale2 (see the morph describe block below
    // for the same reduction, derived in full there).
    const rawDist = Math.hypot(near.p2[0] * priv.scale2, near.p2[1] * priv.scale2);

    const rSelf = priv.nodeDiameter(self) / 2, rNear = priv.nodeDiameter(near) / 2;
    // SELF_CLEAR_FRAC = 0.05 (CanvasGraphRenderer.ts) — world-space clearance as a fraction of the
    // fitted graph radius, projected through the hub's own perspective scale (== 1 here: zoom 0).
    const projectedClear = 0.05 * priv.fitPx * self.pscale;
    const minDist = rSelf + rNear + projectedClear;

    // It WAS inside the zone before the push...
    expect(rawDist).toBeLessThan(minDist);
    // ...and clearAroundSelf pushed it out to EXACTLY the zone's edge (f = minDist / d — see source).
    const pushedDist = Math.hypot(near.sx - self.sx, near.sy - self.sy);
    expect(pushedDist).toBeCloseTo(minDist, 1);

    // Edges read the MUTATED sx/sy, not the pre-nudge position: this fixture has no communities, so
    // the you<->near edge draws at full member-edge weight every frame (see computeEdgeLevelWeights'
    // n<=1 branch) — it should stretch out to the NUDGED point, not collapse to a near-zero-length
    // line sitting on "you".
    const followsNudge = ctx.draws
      .filter((d) => d.kind === "stroke")
      .some((d) => segsOf(d).some((s) =>
        (samePoint(s[0], s[1], self.sx, self.sy) && samePoint(s[2], s[3], near.sx, near.sy)) ||
        (samePoint(s[0], s[1], near.sx, near.sy) && samePoint(s[2], s[3], self.sx, self.sy))));
    expect(followsNudge).toBe(true);

    // Labels read it too: force "near"'s label on (bypasses the fade/budget gate, not inViewport —
    // see the inViewport describe block) and confirm the drawn glyph's x is the NUDGED sx exactly
    // (drawLabels calls fillText(text, nv.sx, …) directly).
    r.setActiveFile("near");
    ctx.texts.length = 0; ctx.draws.length = 0;
    frame();
    const label = ctx.texts.find((t) => t.text === "Near Note");
    expect(label).toBeDefined();
    expect(label!.x).toBeCloseTo(near.sx, 3);
    r.destroy();
  });
});

// ---------------------------------------------------------------------------------------------

describe("the intra-cluster mesh", () => {
  function twoClusterGraph(): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const A = ["a0", "a1", "a2", "a3", "a4"];
    const B = ["b0", "b1", "b2", "b3"];
    A.forEach((id, i) => {
      const a = (i / A.length) * Math.PI * 2;
      const pos: [number, number] = [-200 + Math.cos(a) * 20, Math.sin(a) * 20];
      nodes.push({ id, label: id, kind: "note", position: [pos[0], pos[1], 0], position2d: pos, community: 0, communityLabel: "Cluster A" });
    });
    B.forEach((id, i) => {
      const a = (i / B.length) * Math.PI * 2;
      const pos: [number, number] = [200 + Math.cos(a) * 20, Math.sin(a) * 20];
      nodes.push({ id, label: id, kind: "note", position: [pos[0], pos[1], 0], position2d: pos, community: 1, communityLabel: "Cluster B" });
    });
    for (let i = 0; i < A.length; i++) edges.push({ from: A[i], to: A[(i + 1) % A.length], kind: "link" });
    for (let i = 0; i < B.length; i++) edges.push({ from: B[i], to: B[(i + 1) % B.length], kind: "link" });
    edges.push({ from: "a0", to: "b0", kind: "link" }); // the ONE cross-cluster edge
    return { nodes, edges };
  }

  it("strokes each community's own internal edges in the community's colour, at every zoom — but never a cross-cluster edge", () => {
    const { r } = mountRenderer(twoClusterGraph(), { viewMode: "2d" });
    const colorA = r.getCommunityCentroids().get(0)!.color;
    const colorB = r.getCommunityCentroids().get(1)!.color;
    expect(colorA).not.toBe(colorB);

    const nodes = (r as unknown as { nodes: { node: { id: string }; sx: number; sy: number }[] }).nodes;
    const byId = new Map(nodes.map((n) => [n.node.id, n]));
    // INTRA_EDGE_ALPHA = 0.22 (CanvasGraphRenderer.ts) is a distinctive alpha not shared by the
    // ordinary member-edge pass (CONFIG.edgeOpacity=0.3) or the group-level line pass, so filtering
    // on it isolates exactly the intra-cluster mesh's own draw calls.
    const meshDraws = ctx.draws.filter((d) => d.kind === "stroke" && Math.abs(d.alpha - 0.22) < 0.005);
    expect(meshDraws.length).toBeGreaterThan(0);
    const meshSegs = meshDraws.flatMap(segsOf);

    const hasSeg = (idA: string, idB: string) => {
      const a = byId.get(idA)!, b = byId.get(idB)!;
      return meshSegs.some((s) =>
        (samePoint(s[0], s[1], a.sx, a.sy) && samePoint(s[2], s[3], b.sx, b.sy)) ||
        (samePoint(s[0], s[1], b.sx, b.sy) && samePoint(s[2], s[3], a.sx, a.sy)));
    };
    // A's and B's own internal ring edges are drawn as part of the mesh...
    expect(hasSeg("a0", "a1")).toBe(true);
    expect(hasSeg("b0", "b1")).toBe(true);
    // ...but the one edge that crosses between the two communities is NOT — it belongs to the
    // group-level/member-edge passes instead (see buildLevelEdges + the plain strokeEdges call).
    expect(hasSeg("a0", "b0")).toBe(false);

    // Each community's mesh strokes in ITS OWN colour — the same size-ranked slot getCommunityCentroids reports.
    const colorOfSeg = (idA: string, idB: string) => {
      const a = byId.get(idA)!, b = byId.get(idB)!;
      return meshDraws.find((d) => segsOf(d).some((s) =>
        (samePoint(s[0], s[1], a.sx, a.sy) && samePoint(s[2], s[3], b.sx, b.sy)) ||
        (samePoint(s[0], s[1], b.sx, b.sy) && samePoint(s[2], s[3], a.sx, a.sy))))?.color;
    };
    expect(colorOfSeg("a0", "a1")).toBe(colorA);
    expect(colorOfSeg("b0", "b1")).toBe(colorB);
    r.destroy();
  });
});

// ---------------------------------------------------------------------------------------------

describe("size-ranked cluster colours", () => {
  function sizedCommunityGraph(): GraphData {
    const nodes: GraphNode[] = [];
    // Community ids are deliberately NOT monotonic with size (id 50 is the LARGEST at 10 members,
    // id 1 is the MIDDLE at 6, id 99 is the SMALLEST at 3) — neither ascending- nor descending-id
    // order matches the size order, so a hash- or id-based scheme (the old paletteColor()) could
    // not coincidentally reproduce a size-rank result here; only genuine ranking by member count can.
    const spec: [number, number][] = [[50, 10], [1, 6], [99, 3]];
    for (const [cid, count] of spec) {
      for (let k = 0; k < count; k++) {
        nodes.push({
          id: `c${cid}n${k}`, label: `c${cid}n${k}`, kind: "note",
          position: [cid, k, 0], position2d: [cid, k], community: cid, communityLabel: `Community ${cid}`,
        });
      }
    }
    return { nodes, edges: [] };
  }

  it("buildColorSlots assigns palette slots by community member-COUNT rank, not by hashing the community id", () => {
    const { r } = mountRenderer(sizedCommunityGraph());
    const centroids = r.getCommunityCentroids();
    const colorOf = (cid: number) => centroids.get(cid)!.color;

    // DEFAULT_PALETTE (CanvasGraphRenderer.ts): [0]=0xf0509b, [1]=0x9b53e8, [2]=0x3f6bf0.
    expect(hueDist(hueOf(colorOf(50)), hueOf(intToHex(0xf0509b)))).toBeLessThan(2); // 10 members -> rank 0
    expect(hueDist(hueOf(colorOf(1)), hueOf(intToHex(0x9b53e8)))).toBeLessThan(2);  // 6 members -> rank 1
    expect(hueDist(hueOf(colorOf(99)), hueOf(intToHex(0x3f6bf0)))).toBeLessThan(2); // 3 members -> rank 2

    const distinct = new Set([colorOf(1), colorOf(50), colorOf(99)]);
    expect(distinct.size).toBe(3); // no hash collisions — every community reads as its own colour
    r.destroy();
  });
});

// ---------------------------------------------------------------------------------------------

describe("hub-anchored cluster names", () => {
  function hubAnchoredGraph(): GraphData {
    const nodes: GraphNode[] = [
      { id: "hub", label: "Hub Note", kind: "note", position: [0, 0, 0], position2d: [0, 0], community: 0, communityLabel: "Test Cluster" },
    ];
    const edges: GraphEdge[] = [];
    // Five leaves clustered tightly FAR from the hub — so the community's members' on-screen
    // CENTROID sits nowhere near the hub, but the hub (degree 5, vs each leaf's 1) is what the
    // name should anchor on instead (see drawClusterNames's own comment on why: a real vault's
    // 400-node community centroid "routinely lands in empty space").
    for (let i = 0; i < 5; i++) {
      const id = `leaf${i}`;
      const pos: [number, number] = [500 + i * 4, 500 + i * 3];
      nodes.push({ id, label: `Leaf ${i}`, kind: "note", position: [pos[0], pos[1], 0], position2d: pos, community: 0, communityLabel: "Test Cluster" });
      edges.push({ from: "hub", to: id, kind: "link" });
    }
    return { nodes, edges };
  }

  it("anchors the name on the community's highest-degree member, not the members' screen centroid", () => {
    const { r } = mountRenderer(hubAnchoredGraph(), { viewMode: "2d" });
    const nodes = (r as unknown as { nodes: { node: { id: string }; sx: number; sy: number }[] }).nodes;
    const hub = nodes.find((n) => n.node.id === "hub")!;
    const leaves = nodes.filter((n) => n.node.id.startsWith("leaf"));
    const group = [hub, ...leaves];
    const naiveCentroid = {
      x: group.reduce((s, n) => s + n.sx, 0) / group.length,
      y: group.reduce((s, n) => s + n.sy, 0) / group.length,
    };

    // The cluster-name pass draws its label CHARACTER BY CHARACTER (fillTracked) in a distinct,
    // bold, size-ramped font (CLUSTER_LABEL_MIN_PX..MAX_PX = 9-13px) — unlike ordinary file labels
    // (FONT_NODE, fixed "500 11px…") or the self label (FONT_SELF, fixed "700 14px…") — so
    // filtering by that font isolates exactly the cluster-name glyphs.
    const glyphs = ctx.texts.filter((t) => /^700 (9|1[0-3])(\.\d)?px/.test(t.font));
    expect(glyphs.map((g) => g.text).join("")).toBe("TEST CLUSTER");
    const xs = glyphs.map((g) => g.x);
    const labelCenter = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: glyphs[0].y };

    // Anchored on the hub's own x (fillTracked centres the string on `x = e.hub.sx`)...
    expect(Math.abs(labelCenter.x - hub.sx)).toBeLessThan(15);
    // ...lifted straight up off it (CLUSTER_LABEL_LIFT_PX=10 .. + up to CLUSTER_LABEL_MAX_LIFT_PX=46)...
    expect(hub.sy - labelCenter.y).toBeGreaterThanOrEqual(10);
    expect(hub.sy - labelCenter.y).toBeLessThanOrEqual(10 + 46 + 1);
    // ...and nowhere near the group's naive (all-members) centroid — what a centroid-anchored
    // scheme (the one AsciiGraphRenderer's layoutClusterNames still uses) would have placed it at.
    const distFromCentroid = Math.hypot(labelCenter.x - naiveCentroid.x, labelCenter.y - naiveCentroid.y);
    expect(distFromCentroid).toBeGreaterThan(100);
    r.destroy();
  });
});

// ---------------------------------------------------------------------------------------------

describe("inViewport culling", () => {
  function ringGraph(n = 24): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const pos: [number, number] = [Math.cos(a) * 300, Math.sin(a) * 300];
      nodes.push({ id: `n${i}`, label: `note ${i}`, kind: "note", position: [pos[0], pos[1], 0], position2d: pos });
    }
    for (let i = 1; i < n; i++) edges.push({ from: "n0", to: `n${i}`, kind: "link" });
    return { nodes, edges };
  }

  it("restricts label candidates to the actual on-screen box (+ margin), not merely in front of the camera", () => {
    const { r, viewport } = mountRenderer(ringGraph(), { viewMode: "2d" });
    const priv = r as unknown as { inViewport(nv: { onScreen: boolean; sx: number; sy: number }): boolean; W: number; H: number };
    const { W, H } = priv;
    // VIEWPORT_LABEL_MARGIN_PX = 40 (CanvasGraphRenderer.ts) — a node just off the edge still
    // counts (its label would still poke into frame); further out, or behind the camera, doesn't.
    expect(priv.inViewport({ onScreen: true, sx: W / 2, sy: H / 2 })).toBe(true);   // dead centre
    expect(priv.inViewport({ onScreen: true, sx: -39, sy: H / 2 })).toBe(true);     // just inside the margin
    expect(priv.inViewport({ onScreen: true, sx: -41, sy: H / 2 })).toBe(false);    // just outside it
    expect(priv.inViewport({ onScreen: true, sx: W + 39, sy: H / 2 })).toBe(true);
    expect(priv.inViewport({ onScreen: true, sx: W + 41, sy: H / 2 })).toBe(false);
    expect(priv.inViewport({ onScreen: true, sx: W / 2, sy: -41 })).toBe(false);
    expect(priv.inViewport({ onScreen: false, sx: W / 2, sy: H / 2 })).toBe(false); // onScreen gates first, regardless of position

    // Observable consequence: frame in tightly on one node so the rest of the ring falls off-frame,
    // then force a FAR node's label on. Active-file status bypasses the fade/budget gate in
    // drawLabels — but NOT this filter: `ordered` (the label candidate list) is built from
    // inViewport nodes BEFORE forced status is even consulted (see drawLabels' own comment on
    // this). So a forced label for an off-frame node stays silent.
    r.frameSubset(["n0"]);
    wheelIn(viewport, 20);
    settle(200);
    r.setSearchMatches(new Set(["n12"])); // opposite side of the ring from n0 — forced, but off-frame
    ctx.texts.length = 0; ctx.draws.length = 0;
    frame();
    expect(ctx.texts.some((t) => t.text === "note 12")).toBe(false);
    // n0 itself, dead centre of the framed view, still gets its forced (active-file) label.
    r.setActiveFile("n0");
    ctx.texts.length = 0; ctx.draws.length = 0;
    frame();
    expect(ctx.texts.some((t) => t.text === "note 0")).toBe(true);
    r.destroy();
  });
});

// ---------------------------------------------------------------------------------------------

describe("scaleToSpacing", () => {
  function spacingGraph(): GraphData {
    return {
      nodes: [
        { id: "you", label: "You", kind: "self", position: [0, 0, 0], position2d: [0, 0] },
        { id: "n1", label: "N1", kind: "note", position: [100, 0, 0], position2d: [100, 0] },
        { id: "n2", label: "N2", kind: "note", position: [-50, 50, 0], position2d: [-50, 50] },
        { id: "n3", label: "N3", kind: "note", position: [-50, -50, 0], position2d: [-50, -50] },
      ],
      edges: [
        { from: "you", to: "n1", kind: "link" },
        { from: "you", to: "n2", kind: "link" },
        { from: "you", to: "n3", kind: "link" },
      ],
    };
  }

  it("rescales the backend layout to a node-count-independent spacing, and pins the self hub at the origin", () => {
    const { r } = mountRenderer(spacingGraph());
    const nodes = (r as unknown as { nodes: { node: { id: string }; p3: [number, number, number]; p2: [number, number, number] }[] }).nodes;
    const byId = new Map(nodes.map((n) => [n.node.id, n]));
    const self = byId.get("you")!;
    // "you" is pinned at the cloud's centre in BOTH views, regardless of its raw backend position.
    expect(self.p3).toEqual([0, 0, 0]);
    expect(self.p2).toEqual([0, 0, 0]);

    // n=4 total nodes -> smallBoost = min(8, max(1, 400/4)) = 8 (BACKEND_SMALL_BOOST). The
    // fixture's non-self centroid is exactly the origin by construction (n1+n2+n3 average to
    // [0,0,0]), so scaleToSpacing's own re-centring is a no-op here and the expected numbers
    // reduce to exactly raw * scale (with the Y-flip build() already applies before scaling).
    //
    // 3D scale = LINK_SPREAD(6) / smallBoost(8) = 0.75.
    const n1v3 = byId.get("n1")!.p3, n2v3 = byId.get("n2")!.p3, n3v3 = byId.get("n3")!.p3;
    expect(n1v3[0]).toBeCloseTo(75, 3); expect(n1v3[1]).toBeCloseTo(0, 3);
    expect(n2v3[0]).toBeCloseTo(-37.5, 3); expect(n2v3[1]).toBeCloseTo(-37.5, 3);
    expect(n3v3[0]).toBeCloseTo(-37.5, 3); expect(n3v3[1]).toBeCloseTo(37.5, 3);

    // 2D scale = (LINK_SPREAD * RENDERER_2D_SPACING) / (smallBoost * BACKEND_2D_SPACING)
    //          = (6 * 1.4) / (8 * 1.8) = 0.58333...
    const n1v2 = byId.get("n1")!.p2, n2v2 = byId.get("n2")!.p2, n3v2 = byId.get("n3")!.p2;
    expect(n1v2[0]).toBeCloseTo(58.333, 2); expect(n1v2[1]).toBeCloseTo(0, 2);
    expect(n2v2[0]).toBeCloseTo(-29.167, 2); expect(n2v2[1]).toBeCloseTo(-29.167, 2);
    expect(n3v2[0]).toBeCloseTo(-29.167, 2); expect(n3v2[1]).toBeCloseTo(29.167, 2);
    r.destroy();
  });
});

// ---------------------------------------------------------------------------------------------

describe("the 2D<->3D morph", () => {
  it("interpolates node screen positions over MODE_MORPH_MS, and lands exactly on the flat 2D projection", () => {
    const graph: GraphData = {
      nodes: [
        { id: "n0", label: "N0", kind: "note", position: [100, 50, 80], position2d: [300, -150] },
        { id: "n1", label: "N1", kind: "note", position: [-120, 30, -60], position2d: [-250, 200] },
        { id: "n2", label: "N2", kind: "note", position: [10, -140, 40], position2d: [50, 300] },
      ],
      edges: [{ from: "n0", to: "n1", kind: "link" }, { from: "n1", to: "n2", kind: "link" }],
    };
    // Default CONFIG.viewMode is "3d", matching the class's own DEFAULT_CONFIG, so mounting here
    // does NOT itself trigger a morph — a clean, settled 3D start.
    const { r } = mountRenderer(graph);
    const priv = r as unknown as {
      nodes: { node: { id: string }; sx: number; sy: number; p2: [number, number, number] }[];
      morph: number; morphAnim: unknown; rx: number; ry: number; nowMs: number;
      cx: number; scale2: number;
    };
    const n0 = () => priv.nodes.find((n) => n.node.id === "n0")!;
    expect(priv.morph).toBe(0); // settled 3D
    const sx3D = n0().sx;

    const t0 = priv.nowMs;
    r.setConfig({ ...CONFIG, viewMode: "2d" }); // triggers startModeMorph("2d"): 0 -> 1 over 500ms
    expect(priv.morphAnim).not.toBeNull();

    frame(t0 + 250); // exactly the animation's midpoint
    expect(priv.morph).toBeCloseTo(0.5, 5); // easeInOutCubic(0.5) == 0.5 (symmetric)
    const sxMid = n0().sx;
    expect(sxMid).not.toBeCloseTo(sx3D, 1); // a genuine in-between frame, not a snap to either end

    // Run it to completion (well past 500ms) on a MONOTONIC clock continuing from t0 — the shared
    // settle() helper restarts its own small absolute timestamps, which would run this animation's
    // (clock-based, unlike the glides) morph backwards.
    for (let i = 1; i <= 40; i++) frame(t0 + 250 + i * 16);
    expect(priv.morph).toBe(1);       // lands EXACTLY on 1 (tick() snaps it, doesn't just approach it)
    expect(priv.morphAnim).toBeNull();
    expect(priv.rx).toBe(0); expect(priv.ry).toBe(0); // the orbit unwinds fully at the 2D end
    expect(sxMid).not.toBeCloseTo(n0().sx, 1); // ...and the midpoint is distinct from the settled end too

    // At m=1 the camera is flat (rx=ry=0) and otherwise untouched (zoom/target/pan are all still
    // their build()-reset zero values — nothing wheeled/dragged/framed in this test), so screen x
    // reduces to a plain projection of p2: sx = cx + panX + p2.x*worldScale*(P/(P-zoom))
    // == cx + p2.x*scale2 (zoom=pan=0, target=0, worldScale settles to scale2 exactly at morph=1).
    const nv = n0();
    const expectedSx = priv.cx + nv.p2[0] * priv.scale2;
    expect(nv.sx).toBeCloseTo(expectedSx, 3);
    r.destroy();
  });
});
