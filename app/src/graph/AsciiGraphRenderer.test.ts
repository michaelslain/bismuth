// app/src/graph/AsciiGraphRenderer.test.ts
//
// Headless integration cover for the ASCII field. happy-dom has no canvas, so the test installs a
// RECORDING 2D context: every fillText / font assignment is captured and asserted against. That is
// enough to prove the pipeline end to end — a graph rasterizes into edge and node GLYPHS on the
// grid, the hit test finds a node under the cursor, a drag orbits instead of opening a note, and
// above all zooming changes the RESOLUTION and never the type size.
//
// TEST ISOLATION (see blocks/milkdownSerialize.test.ts for the full reasoning): Bun loads every
// `bun test app/src` module into ONE process, and several app modules resolve DOM-dependent
// singletons lazily off `globalThis.window`. So the DOM globals are installed in beforeAll (NOT at
// module top level) and exactly what we added is deleted in afterAll.
import { GlobalWindow } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  AsciiGraphRenderer, DIM_ALPHA, EDGE_DIM_ALPHA, EDGE_W_GAIN, EDGE_W_MAX,
  deriveEdgeBaseAlpha, safeDepthBand, trimSegmentForClearance,
} from "./AsciiGraphRenderer";
import { CELL_W, LAYER_EDGE } from "./asciiGrid";
import { CLUSTER_LABEL_MAX_CHARS } from "./labelSelection";
import { buildColorSlots } from "./clusterVisual";
import { THEMES } from "../../../core/src/theme/tokens";

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

interface FakeCtx {
  fills: { text: string; x: number; y: number; color: string }[];
  /** Every batched `stroke()` call the vector-edge pass (strokeEdges()) issued this paint — one
   *  entry per `pass()` bucket, each carrying every `moveTo/lineTo` segment traced between its
   *  `beginPath()` and its `stroke()`. */
  strokes: { color: string; width: number; alpha: number; segs: [number, number, number, number][] }[];
  fonts: string[];
  font: string;
  letterSpacing: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  textBaseline: string;
  textAlign: string;
  setTransform(): void;
  clearRect(): void;
  fillRect(): void;
  fillText(t: string, x: number, y: number): void;
  measureText(s: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

/** A 2D context that records what was drawn. Its advance ratio (0.6em) deliberately does NOT equal
 *  the design's 6.3px cell, so applyFont()'s letterSpacing correction is genuinely exercised. */
function makeCtx(): FakeCtx {
  let font = "11.5px monospace";
  let pendingPoint: [number, number] | null = null;
  let pendingSegs: [number, number, number, number][] = [];
  const ctx = {
    fills: [] as { text: string; x: number; y: number; color: string }[],
    strokes: [] as { color: string; width: number; alpha: number; segs: [number, number, number, number][] }[],
    fonts: [] as string[],
    get font() { return font; },
    set font(v: string) { font = v; ctx.fonts.push(v); },
    letterSpacing: "0px",
    fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, textBaseline: "", textAlign: "",
    setTransform() {},
    clearRect() {},
    fillRect() {},
    fillText(t: string, x: number, y: number) { ctx.fills.push({ text: t, x, y, color: ctx.fillStyle }); },
    measureText(s: string) {
      const px = parseFloat((font.match(/^([\d.]+)px/) ?? ["", "11.5"])[1]);
      const ls = parseFloat(ctx.letterSpacing) || 0;
      return { width: s.length * (px * 0.6 + ls) };
    },
    beginPath() { pendingPoint = null; pendingSegs = []; },
    moveTo(x: number, y: number) { pendingPoint = [x, y]; },
    lineTo(x: number, y: number) {
      if (pendingPoint) pendingSegs.push([pendingPoint[0], pendingPoint[1], x, y]);
      pendingPoint = [x, y];
    },
    stroke() {
      ctx.strokes.push({ color: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha, segs: pendingSegs });
      pendingSegs = [];
    },
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
  // process, so these two patches MUST be restored in afterAll — leaving a 800x600 box on every
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
/** Advance many frames so a camera glide (resolution / target) settles. */
function settle(n = 120) { for (let i = 0; i < n; i++) frame(16 * (i + 2)); }

// The fixture's world coordinates are scaled up from the "natural" ring geometry below (still only 24
// notes on a small ring) so the graph's bounding radius is big enough, relative to the fixed absolute
// DEEPEST_WORLD_PER_CELL target (asciiGrid.ts), to actually have zoom range to test against — fit()
// normalizes screen layout to a fraction of the box regardless of world scale (see AsciiGraphRenderer's
// zoom law), so this changes NOTHING about on-screen geometry at 100%, only how much further there is to
// zoom toward 0%. Chosen so maxRes lands on a clean, comfortably-settling value in both 2D and 3D (see
// AsciiGraphRenderer.ts fit()/asciiGrid.ts maxResFor).
// 1.5, was 3, was 12: maxRes is proportional to RING_SCALE / DEEPEST_WORLD_PER_CELL, and that constant
// went 3.125 → 0.8 → 0.4 (a deeper absolute 0% each time). Left at 12 the fixture's ladder got ~4x
// deeper, so the level-boundary stops these tests step to magnified 4 blobs of 6 notes past the whole
// field and every entity went off-grid. Rescaling by the same factor keeps the ladder — and therefore
// what each stop MEANS for this fixture — exactly where it was: measured at 800x600, RING_SCALE 1.5
// with W 0.4 reproduces RING_SCALE 3 with W 0.8 exactly (2D maxRes 8.00 — the MIN_ZOOM_SPAN floor —
// and 3D maxRes 9.77). Retune this whenever that constant moves.
const RING_SCALE = 1.5;

/** A ring of notes around one high-degree hub, in three communities. */
function sampleGraph() {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    nodes.push({
      id: `n${i}`, label: `note ${i}`, kind: "note" as const,
      position: [Math.cos(a) * 80 * RING_SCALE, Math.sin(a) * 80 * RING_SCALE, ((i % 5) - 2) * 30 * RING_SCALE] as [number, number, number],
      position2d: [Math.cos(a) * 80 * RING_SCALE, Math.sin(a) * 80 * RING_SCALE] as [number, number],
      community: i % 3,
      communityLabel: `Cluster ${i % 3}`,
    });
  }
  for (let i = 1; i < 24; i++) edges.push({ from: "n0", to: `n${i}`, kind: "link" as const });
  for (let i = 1; i < 23; i++) edges.push({ from: `n${i}`, to: `n${i + 1}`, kind: "link" as const });
  return { nodes, edges };
}

const CONFIG = {
  spin: false, spinSpeed: 0, palette: [], repulsion: 0, linkDistance: 5, centering: 0, nodeSize: 6,
  viewMode: "3d" as const, showGraphLabels: true, graphLabelHubCount: 6, nodeSizeMinMult: 0.4,
  nodeSizeDegreeGain: 0.45, nodeSizeMaxMult: 6, edgeColor: 0, edgeOpacity: 0.3, backgroundColor: 0,
  labelTextColor: "#fff", labelBgColor: "#000", selfColor: 0xffffff,
};

interface Mounted {
  r: AsciiGraphRenderer;
  viewport: HTMLElement;
  clicks: string[];
  hovers: (string | null)[];
  zooms: number[];
}

function mountRenderer(
  viewMode: "2d" | "3d" = "3d",
  graph: ReturnType<typeof sampleGraph> = sampleGraph(),
  cfgOverrides: Partial<typeof CONFIG & { showLodMasses: boolean }> = {},
): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r = new AsciiGraphRenderer();
  const clicks: string[] = [];
  const hovers: (string | null)[] = [];
  const zooms: number[] = [];
  r.mount(host, (id) => clicks.push(id), (n) => hovers.push(n?.id ?? null));
  r.setZoomCallback((p) => zooms.push(p));
  r.setConfig({ ...CONFIG, viewMode, ...cfgOverrides });
  r.render(graph);
  ctx.fills.length = 0;
  ctx.strokes.length = 0;
  frame();
  return { r, viewport: host.firstElementChild as HTMLElement, clicks, hovers, zooms };
}

/** The private per-frame LOD state the integration tests assert against (cell buffers + entity
 *  views). Cast-only — the public surface stays exactly GraphRenderer. */
interface LodPriv {
  cellEntity: Int32Array;
  cellNode: Int32Array;
  layerBuf: Uint8Array;
  entityFlat: { level: number; community: number; count: number; col: number; row: number }[];
  nodes: { col: number; row: number; onGrid: boolean; node: { id: string } }[];
  m: { cols: number; rows: number; cellW: number; cellH: number; padX: number; padY: number };
  pxPerWorld: number; res: number; panX: number; panY: number; target: [number, number, number];
}
const lodPriv = (r: AsciiGraphRenderer) => r as unknown as LodPriv;
/** Distinct entity levels currently rasterized (via the hit-test buffer). */
function entityLevelsOnGrid(p: LodPriv): Set<number> {
  const out = new Set<number>();
  for (const v of p.cellEntity) if (v >= 0) out.add(p.entityFlat[v].level);
  return out;
}
const cellPx = (p: LodPriv, i: number) => ({
  x: p.m.padX + (i % p.m.cols) * p.m.cellW + 1,
  y: p.m.padY + Math.floor(i / p.m.cols) * p.m.cellH + 1,
});

/**
 * The LOD fixture: four spatially TIGHT 6-note blobs in a 2-level hierarchy — TOP 0 (blobs 0+1)
 * on the left, TOP 1 (blobs 2+3) on the right — with a KNOWN aggregate-link structure: 6 links
 * cross the two top halves (3 b0–b2 + 3 b1–b3), 2 link blob 0 to blob 1. Unlike sampleGraph's
 * interleaved ring, members are co-located with their cluster, so centroids, expansion and
 * click-to-frame all behave like a real vault's geometry.
 */
function lodGraph() {
  const nodes = [];
  const edges = [];
  // Two top clusters (left/right), each of two blobs (up/down). The VERTICAL offset is bounded by
  // what the field can still show at the level-1 boundary stop, which is the stop these tests step
  // to: fit maps the graph's WIDE axis to the field, so at the boundary's resolution the visible
  // world half-height is ~122 units — a ±120 offset (the original) left both children within a third
  // of a row of the edge, so which of them counted as "on the grid" came down to rounding. ±80 keeps
  // ~5 rows of margin. Bounded by the ladder, so re-check it if FILE_LABEL_REVEAL_T moves again.
  const CENTERS = [[-350, -80], [-350, 80], [350, -80], [350, 80]];
  for (let b = 0; b < 4; b++) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const x = (CENTERS[b][0] + Math.cos(a) * 8) * RING_SCALE;
      const y = (CENTERS[b][1] + Math.sin(a) * 8) * RING_SCALE;
      const top = b < 2 ? 0 : 1;
      nodes.push({
        id: `b${b}k${k}`, label: `note ${b}${k}`, kind: "note" as const,
        position: [x, y, 0] as [number, number, number],
        position2d: [x, y] as [number, number],
        community: b, communityLabel: `Blob ${b}`,
        communityPath: [top, b], communityPathLabels: [`Top ${top}`, `Blob ${b}`],
      });
    }
  }
  for (let b = 0; b < 4; b++) for (let k = 1; k < 6; k++) edges.push({ from: `b${b}k0`, to: `b${b}k${k}`, kind: "link" as const });
  for (let k = 0; k < 3; k++) edges.push({ from: `b0k${k}`, to: `b2k${k}`, kind: "link" as const });
  for (let k = 0; k < 3; k++) edges.push({ from: `b1k${k}`, to: `b3k${k}`, kind: "link" as const });
  edges.push({ from: "b0k0", to: "b1k0", kind: "link" as const }, { from: "b0k1", to: "b1k1", kind: "link" as const });
  return { nodes, edges };
}

const allText = () => ctx.fills.map((f) => f.text).join("");
/** Every line segment the vector-edge pass (strokeEdges()) actually stroked this paint, flattened
 *  across all batched `stroke()` calls. */
const strokeSegs = () => ctx.strokes.flatMap((s) => s.segs);
// The fallback --graph-0..4 tokens (COLOR_FALLBACK's first 5 entries in AsciiGraphRenderer.ts) —
// happy-dom resolves no CSS vars, so this is the exact palette rebuildCommunityColors() passes to
// buildColorSlots() in every test in this file. Declared before nodeRuns() (below), which depends on it.
const RAMP_FALLBACK = ["#f0509b", "#9b53e8", "#3f6bf0", "#27c7d9", "#43d49a"];
// happy-dom resolves no CSS vars, so the renderer falls back to its literal token table. Community
// colours are no longer one of a fixed 5-entry ramp (buildColorSlots ranks-and-boosts against the
// --graph-0..4 tokens, so the actual hex a community lands on is a saturation/lightness-boosted, and
// possibly hue-rotated, DERIVATIVE of those tokens — see clusterVisual.ts) — so "is this a node run"
// is a WHITELIST, computed via the real buildColorSlots (not hand-copied, and not a blacklist).
//
// The reason is ADMISSION, not exclusion: a blacklist of the five fixed roles (self/muted/faint/
// accent/edge) admits ANY other stray colour — e.g. a regression that mis-painted an accent or self
// glyph — as if it were a real community node run, which is the direction that lets a broken
// renderer pass. It does NOT also under-admit: an earlier version of this comment claimed the
// blacklist "accidentally excludes #3f6bf0, which is both --accent's fallback and --graph-2's",
// hiding legitimate glyphs. That is false, and measuring it is one line: buildColorSlots
// saturation/lightness-boosts every token before emitting it, so --graph-2's #3f6bf0 comes out as
// #5078f1, and this fixture's three community colours (#f261a5, #a45cf2, #5078f1) have ZERO overlap
// with the five fixed UI colours. No glyph was ever being hidden. sampleGraph() gives its three
// communities (ids 0/1/2) an exact 8-member size TIE, so buildColorSlots ranks them by id ascending
// — ids 0/1/2 -> ranks 0/1/2, all within the palette's first cycle (3 < 5, no hue rotation yet) — a
// small, closed, exactly-computable set.
const SAMPLE_GRAPH_COMMUNITY_COLORS = new Set(
  buildColorSlots(new Map([[0, 8], [1, 8], [2, 8]]), RAMP_FALLBACK).values(),
);
const nodeRuns = () => ctx.fills.filter((f) => SAMPLE_GRAPH_COMMUNITY_COLORS.has(f.color) && /^[.o@ ]+$/.test(f.text));
// A real wheel event always carries the cursor position — default to the field's centre (2D zoom
// is cursor-ANCHORED now). happy-dom's WheelEvent constructor DROPS MouseEvent init fields
// (clientX comes out undefined), so the coordinates are pinned on afterwards.
const wheelIn = (viewport: HTMLElement, times = 10, at = { x: BOX.width / 2, y: BOX.height / 2 }) => {
  for (let i = 0; i < times; i++) {
    const e = new WheelEvent("wheel", { deltaY: -120, cancelable: true });
    Object.defineProperty(e, "clientX", { value: at.x });
    Object.defineProperty(e, "clientY", { value: at.y });
    viewport.dispatchEvent(e);
  }
};

describe("AsciiGraphRenderer — the field rasterizes into characters", () => {
  it("strokes edges as vector lines and draws the node degree ramp as glyphs", () => {
    const { r } = mountRenderer("3d");
    expect(ctx.fills.length).toBeGreaterThan(0);
    // Edges are real Canvas2D strokes now, not grid characters — a regression lock that the deleted
    // character-edge path doesn't come back: no fillText run is purely edge glyphs ("- | / \ +").
    expect(ctx.fills.some((f) => /^[-|/\\+]+$/.test(f.text))).toBe(false);
    const segs = strokeSegs();
    expect(segs.length).toBeGreaterThan(0);
    for (const s of ctx.strokes) {
      expect(s.width).toBeGreaterThanOrEqual(0.08);
      expect(s.width).toBeLessThanOrEqual(1.6);
    }
    // At fit (t == 0, the shallowest resolution stop) the width law (EDGE_W_GAIN + (EDGE_W_MAX -
    // EDGE_W_GAIN) * resolutionT(res, maxRes)) lands exactly on EDGE_W_GAIN, its unclamped floor —
    // see AsciiGraphRenderer.ts's strokeEdges() and the "edge width follows the resolution stop, not
    // raw res" describe block below for the deepest-stop end of this same law.
    expect(ctx.strokes[0]?.width).toBeCloseTo(EDGE_W_GAIN, 5);
    const glyphs = nodeRuns().map((f) => f.text).join("");
    expect(glyphs.includes("@")).toBe(true);           // the 24-spoke hub
    expect(/[.o]/.test(glyphs)).toBe(true);            // leaves / linked notes
    expect(/[^.o@ ]/.test(glyphs)).toBe(false);        // the node layer draws ONLY the degree ramp
    r.destroy();
  });

  it("reports the node count it painted (the boot splash correlates these)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new AsciiGraphRenderer();
    const painted: number[] = [];
    r.mount(host, () => {});
    r.setPaintCallback((n) => painted.push(n));
    r.setConfig({ ...CONFIG });
    r.render(sampleGraph());
    frame();
    expect(painted.at(-1)).toBeGreaterThan(0);
    r.destroy();
  });

  it("emits a per-frame density field for the phosphor bloom (buildBloom always normalises its peak cell to exactly 1)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new AsciiGraphRenderer();
    const fields: Float32Array[] = [];
    r.mount(host, () => {});
    r.setBloomCallback((f) => fields.push(f));
    r.setConfig({ ...CONFIG });
    r.render(sampleGraph());
    frame();
    expect(fields.length).toBeGreaterThan(0);
    expect(Math.max(...fields.at(-1)!)).toBe(1);
    r.destroy();
  });

  it("detaches its bloom callback on destroy — a torn-down renderer must not hold a stale sink", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new AsciiGraphRenderer();
    r.mount(host, () => {});
    r.setBloomCallback(() => {});
    expect((r as unknown as { onBloom?: unknown }).onBloom).toBeDefined();
    r.destroy();
    expect((r as unknown as { onBloom?: unknown }).onBloom).toBeUndefined();
  });

  it("rasterizes the flat layout in 2D too", () => {
    const { r } = mountRenderer("2d");
    expect(allText().length).toBeGreaterThan(0);
    r.destroy();
  });

  it("names nodes on the grid — labels are cells, not a DOM overlay (once zoomed past the cluster-name reveal point)", () => {
    // At fit (100% zoom) the field names CLUSTERS, not files — see the "cluster names own the field
    // at fit" describe block below. frameSubset + a wheel push to saturation deterministically
    // reaches max resolution (0%) centred on n0, regardless of the fixture's ring geometry.
    const { r, viewport } = mountRenderer("2d");
    r.frameSubset(["n0"]);
    wheelIn(viewport, 30);
    settle(200);
    expect(ctx.fills.some((f) => f.text.includes("[[note "))).toBe(true);
    r.destroy();
  });

  it("writes a tag label exactly once (vault.ts already puts the # on the label)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new AsciiGraphRenderer();
    r.mount(host, () => {});
    r.setConfig({ ...CONFIG, viewMode: "2d" });
    // Positions scaled by RING_SCALE for the same reason as sampleGraph() above — a big enough
    // bounding radius to have real zoom range under the fixed-absolute 0% target.
    r.render({
      nodes: [
        { id: "note", label: "note", kind: "note", position: [0, 0, 0], position2d: [0, 0] },
        {
          id: "tag:research", label: "#research", kind: "tag",
          position: [60 * RING_SCALE, 0, 0], position2d: [60 * RING_SCALE, 0],
        },
      ],
      edges: [{ from: "note", to: "tag:research", kind: "tag" }],
    });
    const viewport = host.firstElementChild as HTMLElement;
    ctx.fills.length = 0;
  ctx.strokes.length = 0;
    frame();
    // Past the cluster-name reveal point — these two nodes carry no community, so file names are
    // the only kind on offer once zoomed. frameSubset on the tag ITSELF (not the midpoint of the
    // pair) keeps it dead-centre — and therefore on-grid — even once the wheel saturates resolution.
    r.frameSubset(["tag:research"]);
    wheelIn(viewport, 30);
    settle(200);
    expect(ctx.fills.some((f) => f.text === "#research")).toBe(true);
    expect(ctx.fills.some((f) => f.text.includes("##"))).toBe(false);
    r.destroy();
  });

  /** Card: the field rendered NOTHING while the HUD read "8 nodes · 10 edges". The knowledge graph
   *  is one floating element App sizes from a rAF, so mount() AND the first render() both run
   *  against a 0×0 host; measure() correctly refuses to fit a degenerate box, and the ONLY thing
   *  that used to re-measure was a ResizeObserver notification. Miss that one delivery and the
   *  field stayed pinned to its 1×1 bootstrap grid forever — every node off-grid, every cell empty.
   *  The loop now reconciles the box itself. (The harness's ResizeObserver is a no-op, so this test
   *  reproduces exactly the "no RO delivery ever arrives" case.) */
  it("picks the host box up from the render loop when no ResizeObserver notification arrives", () => {
    const restoreBox = { ...BOX };
    BOX.width = 0; BOX.height = 0;
    try {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const r = new AsciiGraphRenderer();
      const painted: number[] = [];
      r.mount(host, () => {});
      r.setPaintCallback((n) => painted.push(n));
      r.setConfig({ ...CONFIG, viewMode: "2d" });
      r.render(sampleGraph());
      ctx.fills.length = 0;
  ctx.strokes.length = 0;
      frame();
      expect(nodeRuns()).toEqual([]);          // nothing measurable yet — blank, as designed

      BOX.width = 800; BOX.height = 600;       // App places + sizes the floater; no RO callback fires
      frame(32);
      expect(nodeRuns().length).toBeGreaterThan(0);
      expect(painted.at(-1)).toBeGreaterThan(0);
      r.destroy();
    } finally {
      Object.assign(BOX, restoreBox);
    }
  });
});

describe("semantic zoom — cluster names own the field zoomed out, file names crossfade in on zoom-in", () => {
  it("shows cluster names and NO file names at fit (100% zoom)", () => {
    const { r } = mountRenderer("2d");
    // sampleGraph() gives every node communityLabel `Cluster ${0|1|2}`; the eyebrow register
    // upper-cases it.
    expect(ctx.fills.some((f) => f.text.includes("CLUSTER 0"))).toBe(true);
    expect(ctx.fills.some((f) => f.text.includes("[[note "))).toBe(false);
    r.destroy();
  });

  it("crossfades to file names as the field zooms in", () => {
    const { r, viewport } = mountRenderer("2d");
    r.frameSubset(["n0"]);
    wheelIn(viewport, 30);
    settle(200);
    expect(ctx.fills.some((f) => f.text.includes("[[note "))).toBe(true);
    r.destroy();
  });

  it("hover at fit reports the CLUSTER entity when LOD masses are opted into; a hovered NOTE is force-named once leaves are on the field", () => {
    // LOD masses are OFF by default (see the "LEVEL OF DETAIL" describe block further down) — this
    // test opts in (showLodMasses) to cover the retained aggregate-entity hover path. At fit with
    // masses on, the 2D field is AGGREGATE ENTITIES — there is no note glyph to hover; hovering a
    // mass surfaces the cluster, and the forced file-name behaviour still lives at the deep stops.
    const { r, hovers } = mountRenderer("2d", undefined, { showLodMasses: true });
    const priv = r as unknown as {
      cellEntity: Int32Array;
      m: { cols: number; rows: number; cellW: number; cellH: number; padX: number; padY: number };
      nodes: { col: number; row: number; onGrid: boolean; node: { id: string } }[];
    };
    const i = priv.cellEntity.findIndex((v) => v >= 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const m = priv.m;
    window.dispatchEvent(new PointerEvent("pointermove", {
      clientX: m.padX + (i % m.cols) * m.cellW + 1, clientY: m.padY + Math.floor(i / m.cols) * m.cellH + 1,
    }));
    expect(String(hovers.at(-1))).toContain("cluster:");

    // Deep: frame a note (t → 1, leaves fully on the field), hover it → forced label.
    r.frameSubset(["n0"]);
    settle(200);
    const nv = priv.nodes.find((n) => n.onGrid);
    expect(nv).toBeDefined();
    ctx.fills.length = 0;
  ctx.strokes.length = 0;
    window.dispatchEvent(new PointerEvent("pointermove", {
      clientX: m.padX + nv!.col * m.cellW + 1, clientY: m.padY + nv!.row * m.cellH + m.cellH / 2,
    }));
    frame();
    expect(hovers.filter(Boolean).length).toBeGreaterThan(1);
    expect(ctx.fills.some((f) => f.text.includes("[[note "))).toBe(true); // forced past the reveal gate
    r.destroy();
  });
});

describe("N-level semantic labels — the zoom ladder walks communityPath, coarsest to finest", () => {
  /** Two top-level super-clusters (TOP 0/TOP 1), each split into two finer sub-clusters (SUB
   *  0..3) — a 2-level hierarchy, communityPath/communityPathLabels coarsest-first per graph.ts.
   *  A FLATTENED ring (y radius 30 against x radius 80), for the same reason as lodGraph's CENTERS:
   *  the two top halves are the upper/lower arcs, so their centroids sit at 0.62 of the y radius, and
   *  at the sub-level boundary stop the field only shows the middle ~0.7 of the y extent. On the
   *  circular ring this put every cluster centroid off the grid at that stop and no name could draw. */
  function twoLevelGraph() {
    const nodes = [];
    const edges = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const top = i < 12 ? 0 : 1;
      const sub = top * 2 + (i % 2);
      nodes.push({
        id: `n${i}`, label: `note ${i}`, kind: "note" as const,
        position: [Math.cos(a) * 80 * RING_SCALE, Math.sin(a) * 30 * RING_SCALE, ((i % 5) - 2) * 30 * RING_SCALE] as [number, number, number],
        position2d: [Math.cos(a) * 80 * RING_SCALE, Math.sin(a) * 30 * RING_SCALE] as [number, number],
        community: sub,
        communityLabel: `Sub ${sub}`,
        communityPath: [top, sub],
        communityPathLabels: [`Top ${top}`, `Sub ${sub}`],
      });
    }
    for (let i = 1; i < 24; i++) edges.push({ from: "n0", to: `n${i}`, kind: "link" as const });
    return { nodes, edges };
  }

  function mountTwoLevel(): Mounted {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new AsciiGraphRenderer();
    const zooms: number[] = [];
    r.mount(host, () => {});
    r.setZoomCallback((p) => zooms.push(p));
    r.setConfig({ ...CONFIG, viewMode: "2d" });
    r.render(twoLevelGraph());
    ctx.fills.length = 0;
  ctx.strokes.length = 0;
    frame();
    return { r, viewport: host.firstElementChild as HTMLElement, clicks: [], hovers: [], zooms };
  }

  it("shows only the COARSEST level's names at fit (100%)", () => {
    const { r } = mountTwoLevel();
    expect(ctx.fills.some((f) => f.text === "TOP 0" || f.text === "TOP 1")).toBe(true);
    expect(ctx.fills.some((f) => f.text.startsWith("SUB "))).toBe(false);
    r.destroy();
  });

  it("steps down to the sub-level's names on zooming in, before file names appear", () => {
    const { r, viewport } = mountTwoLevel();
    // Anchor the wheel zoom ON a real node (n0), not the screen centre: this fixture is a pure RING
    // with every member at roughly the same radius and NOTHING near the origin (unlike lodGraph's
    // co-located blobs), so a centre-anchored zoom shrinks the visible window away from every
    // member simultaneously — with masses off (the default) that leaves layoutClusterNames zero
    // onGrid members for ANY community, so it draws nothing. Anchoring on n0 instead recentres the
    // camera toward its neighbourhood as the ladder steps in, keeping its own sub-cluster (and, on
    // this fixture, every sub-cluster) genuinely on the field to name — the leaf pass now always
    // runs, so real nodes' screen positions are available right after mount.
    const n0 = (r as unknown as { nodes: { node: { id: string }; sx: number; sy: number }[] })
      .nodes.find((n) => n.node.id === "n0")!;
    // Four notches = 100% -> 60%, i.e. t = 0.4 — past the 2-level boundary of the LOD ladder
    // (levelBoundaries splits [0, FILE_LABEL_REVEAL_T=0.75) evenly, so it sits at 0.375), where the
    // SUB level owns the field outright and the TOP level has fully crossfaded away.
    wheelIn(viewport, 4, { x: n0.sx, y: n0.sy });
    settle(200);
    // The settle() glide paints every intermediate frame too (including ones still mid-crossfade
    // from TOP to SUB), so only the FINAL settled frame answers "what does 80% look like" — force
    // one more repaint at the now-converged camera via a harmless no-op mutation.
    ctx.fills.length = 0;
  ctx.strokes.length = 0;
    r.setSearchMatches(new Set());
    frame();
    expect(ctx.fills.some((f) => f.text.startsWith("SUB "))).toBe(true);
    expect(ctx.fills.some((f) => f.text === "TOP 0" || f.text === "TOP 1")).toBe(false);
    expect(ctx.fills.some((f) => f.text.includes("[[note "))).toBe(false); // still well before the file reveal
    r.destroy();
  });

  it("eventually crossfades all the way to file names, same as the single-level case", () => {
    const { r, viewport } = mountTwoLevel();
    r.frameSubset(["n0"]);
    wheelIn(viewport, 30);
    settle(200);
    expect(ctx.fills.some((f) => f.text.includes("[[note "))).toBe(true);
    r.destroy();
  });
});

describe("Task 9 — clusterVisual wiring: community colours are RANK-based, cluster names are HUB-anchored", () => {
  /** `sizeById[c]` notes tagged `community: c` (finest-level only, no hierarchy) — no edges needed,
   *  getCommunityCentroids() only reads community membership + colour. */
  function communitySizeGraph(sizeById: number[]) {
    const nodes: unknown[] = [];
    let i = 0;
    for (let c = 0; c < sizeById.length; c++) {
      for (let k = 0; k < sizeById[c]; k++) {
        nodes.push({
          id: `n${i}`, label: `note ${i}`, kind: "note" as const,
          position: [i * 5, 0, 0] as [number, number, number], position2d: [i * 5, 0] as [number, number],
          community: c, communityLabel: `Cluster ${c}`,
        });
        i++;
      }
    }
    return { nodes: nodes as never, edges: [] };
  }

  it("the LARGEST community always resolves to the same colour, regardless of which id happens to be biggest (rank, not hash)", () => {
    // id 2 is the biggest (10 members) here...
    const a = mountRenderer("3d", communitySizeGraph([2, 3, 10]));
    const colorABiggest = a.r.getCommunityCentroids().get(2)!.color;
    a.r.destroy();

    // ...id 0 is the biggest (10 members) here — same size DISTRIBUTION, different id<->size mapping.
    const b = mountRenderer("3d", communitySizeGraph([10, 3, 2]));
    const colorBBiggest = b.r.getCommunityCentroids().get(0)!.color;
    b.r.destroy();

    // A hash of the community id would almost certainly give these two a DIFFERENT colour (id 2 vs
    // id 0 hash differently); rank-by-size gives the biggest community the same palette slot no
    // matter which id it happens to carry.
    expect(colorABiggest).toBe(colorBBiggest);

    // ...and the three communities within ONE graph are still visually distinct from each other —
    // ranking isn't collapsing everything onto one colour either.
    const c = mountRenderer("3d", communitySizeGraph([2, 3, 10]));
    const colors = new Set([...c.r.getCommunityCentroids().values()].map((cl) => cl.color));
    expect(colors.size).toBe(3);
    c.r.destroy();
  });

  // --- the `pathOf` level clamp, `path[Math.min(L, path.length - 1)]` -------------------------
  // Three independent per-level tables apply it (exemplar NAMES, the COLOUR tally, and the HUB
  // race) and all three must agree, or a shallow node belongs to different communities depending on
  // which table you ask. There is one test per table below; the names one is further down. Round 1
  // of this task deleted the colour one, and deleting either production clamp then passed the whole
  // suite — coverage a fix round dropped on the way past.

  it("a node with only a finest-level community (no communityPath) still counts toward a DEEPER level's COLOUR tally — the pathOf level clamp", () => {
    // Two-level hierarchy: top is uniformly 0, sub varies 0/1/2. Sub sizes 2/4/3 — sub 0 is the
    // STRICT smallest among the three deep-only sizes. One extra SHALLOW node (community: 0, no
    // communityPath at all) should count toward sub 0's tally too (clamped to its own deepest known
    // community), tying it with sub 2 at 3 — and buildColorSlots' tie-break (lowest id) then ranks
    // sub 0 ABOVE sub 2. Drop the clamp and sub 0 stays strictly smallest, changing its rank (and
    // therefore its colour) entirely.
    const nodes: unknown[] = [];
    let i = 0;
    const subSizes = [2, 4, 3];
    for (let sub = 0; sub < subSizes.length; sub++) {
      for (let k = 0; k < subSizes[sub]; k++) {
        nodes.push({
          id: `d${sub}_${k}`, label: `deep ${sub} ${k}`, kind: "note" as const,
          position: [i * 5, sub * 50, 0] as [number, number, number], position2d: [i * 5, sub * 50] as [number, number],
          community: sub, communityLabel: `Sub ${sub}`,
          communityPath: [0, sub], communityPathLabels: ["Top 0", `Sub ${sub}`],
        });
        i++;
      }
    }
    nodes.push({
      id: "shallow", label: "shallow", kind: "note" as const,
      position: [i * 5, -50, 0] as [number, number, number], position2d: [i * 5, -50] as [number, number],
      community: 0, communityLabel: "Sub 0",
    });
    const { r } = mountRenderer("3d", { nodes: nodes as never, edges: [] });

    // Independently reconstruct what the CORRECTLY-clamped per-level tally should be (sub 0 = 2 deep
    // + 1 clamped shallow = 3) and feed it through the real buildColorSlots — the same palette the
    // renderer falls back to under happy-dom (no CSS vars resolved).
    const expected = buildColorSlots(new Map([[0, 3], [1, 4], [2, 3]]), RAMP_FALLBACK);
    expect(r.getCommunityCentroids().get(0)!.color).toBe(expected.get(0));
    r.destroy();
  });

  it("...and toward that deeper level's HUB race too — the same clamp, in clusterHubByLevel", () => {
    // The colour test above cannot see this one: the tally and the hub race clamp INDEPENDENTLY, so
    // deleting the clamp here leaves every colour correct while the name silently anchors on the
    // wrong node. Fixture: deep community 5 has two degree-1 members; a SHALLOW node ("big",
    // community 5, no communityPath) has degree 3. Clamped, "big" joins community 5 at level 1 and
    // wins the hub race outright on degree. Unclamped, its `path[1]` is undefined, it falls out of
    // level 1 entirely, and the hub becomes "d5a" (degree tie, lowest id).
    const mk = (id: string, x: number, path?: number[]) => ({
      id, label: id, kind: "note" as const,
      position: [x, 0, 0] as [number, number, number], position2d: [x, 0] as [number, number],
      community: path ? path[1] : 5, communityLabel: path ? `C${path[1]}` : "C5",
      ...(path ? { communityPath: path, communityPathLabels: ["Top", `C${path[1]}`] } : {}),
    });
    const nodes = [
      mk("d5a", 0, [0, 5]), mk("d5b", 20, [0, 5]),
      mk("f0", 40, [0, 6]), mk("f1", 60, [0, 6]), mk("f2", 80, [0, 6]),
      mk("big", 100), // shallow: community 5, NO communityPath
    ];
    const edges = [
      { from: "d5a", to: "d5b", kind: "link" as const },       // d5a, d5b -> degree 1 each
      { from: "big", to: "f0", kind: "link" as const },
      { from: "big", to: "f1", kind: "link" as const },
      { from: "big", to: "f2", kind: "link" as const },        // big -> degree 3
    ];
    const { r } = mountRenderer("3d", { nodes: nodes as never, edges });
    const priv = r as unknown as { clusterHubByLevel: Map<number, string>[]; levelCount: number };
    expect(priv.levelCount).toBe(2); // sanity: there IS a deeper level than "big"'s own path
    expect(priv.clusterHubByLevel[1]?.get(5)).toBe("big");
    r.destroy();
  });

  /** Shared by the two hub-anchor tests below: one high-degree hub far to the RIGHT, four
   *  low-degree leaves spread across the LEFT half, all in one community. The OLD centroid-of-all-
   *  members anchor lands far to the LEFT (dragged there by the 4-vs-1 leaf majority); the hub
   *  anchor must land at the hub's own (far-RIGHT) position instead.
   *
   *  The leaves are SPREAD (-300, -220, -140, -60), not stacked within 3 world units of each other:
   *  co-located leaves enter and leave the viewport as a single block, so a fixture built that way
   *  can never show what happens while a community is PARTIALLY visible — every member-set-dependent
   *  quantity (the `clusterAgg` membership, and `clusterExtent`'s lift, which is fed visible-only
   *  members by contract) stays constant right up until the whole community vanishes at once. The
   *  leftmost leaf stays at -300 so the graph's bounding box — and therefore fit() and every column
   *  the hub-anchor test below measures — is unchanged by the spread. */
  function hubAndLeavesGraph() {
    const nodes = [
      {
        id: "hub", label: "Hub", kind: "note" as const,
        position: [300, 0, 0] as [number, number, number], position2d: [300, 0] as [number, number],
        community: 0, communityLabel: "Group",
      },
      ...[0, 1, 2, 3].map((k) => ({
        id: `leaf${k}`, label: `leaf${k}`, kind: "note" as const,
        position: [-300 + k * 80, k % 2 === 0 ? -10 : 10, 0] as [number, number, number],
        position2d: [-300 + k * 80, k % 2 === 0 ? -10 : 10] as [number, number],
        community: 0, communityLabel: "Group",
      })),
    ];
    const edges = [0, 1, 2, 3].map((k) => ({ from: "hub", to: `leaf${k}`, kind: "link" as const }));
    return { nodes, edges };
  }

  it("anchors a cluster name on the community's HUB (highest-degree member), not the member centroid", () => {
    const { r } = mountRenderer("2d", hubAndLeavesGraph());
    const priv = r as unknown as {
      nodes: { node: { id: string }; col: number; row: number }[];
      labels: { text: string; col: number; row: number; eyebrow?: boolean }[];
    };
    const hub = priv.nodes.find((n) => n.node.id === "hub")!;
    // The OLD formula: the plain average grid column over EVERY on-grid member of the community
    // (hub included) — what layoutClusterNames used to anchor on.
    const oldCentroidCol = priv.nodes.reduce((s, n) => s + n.col, 0) / priv.nodes.length;
    const label = priv.labels.find((l) => l.eyebrow);
    expect(label).toBeDefined();
    expect(Math.abs(label!.col - hub.col)).toBeLessThanOrEqual(4);
    expect(Math.abs(label!.col - oldCentroidCol)).toBeGreaterThan(10);
    r.destroy();
  });

  /**
   * Sweeps a 2D pan in FINE steps and samples (hub column, cluster-label column) every frame.
   *
   * One continuous gesture, not a series of down/move/up drags: `onPointerMove` only starts panning
   * once the pointer has travelled DRAG_THRESHOLD (5px) from where it went down, so a fresh gesture
   * per 3px step would pan by exactly nothing. Prime past the threshold once, then every subsequent
   * move pans by its own dx. (The test this replaced used one-shot `drag(500)`/`drag(200)` gestures,
   * which is why it stepped clean over the field edge without ever sampling a frame near it — the
   * boundary is the only place the placement rule can be discontinuous, and it never looked there.)
   */
  function panSweep(dxPerStep: number, steps: number, graph = hubAndLeavesGraph()) {
    const { r, viewport } = mountRenderer("2d", graph);
    const priv = r as unknown as {
      nodes: { node: { id: string }; col: number }[];
      labels: { col: number; widthCells: number; eyebrow?: boolean }[];
      m: { cols: number };
    };
    let px = 400, t = 100;
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: px, clientY: 300 }));
    px += 20 * Math.sign(dxPerStep); // prime past DRAG_THRESHOLD
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: px, clientY: 300 }));
    frame((t += 16));

    const samples: { hubCol: number; labelCol: number | null; wCells: number | null }[] = [];
    for (let i = 0; i <= steps; i++) {
      if (i > 0) {
        px += dxPerStep;
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: px, clientY: 300 }));
        frame((t += 16));
      }
      const label = priv.labels.find((l) => l.eyebrow);
      samples.push({
        hubCol: priv.nodes.find((n) => n.node.id === "hub")!.col,
        labelCol: label ? label.col : null,
        wCells: label ? label.widthCells : null,
      });
    }
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: px, clientY: 300 }));
    const cols = priv.m.cols;
    r.destroy();
    return { samples, cols };
  }

  /** Asserts the two placement invariants over a fine pan sweep that genuinely crosses one field
   *  edge. Shared by the left- and right-edge cases below so neither can drift from the other.
   *
   *  Both invariants are evaluated across the WHOLE sweep and asserted on the worst case, rather
   *  than asserted inside the loop: an in-loop `expect` aborts at the first violation, which for
   *  this failure mode is a marginal one-column overshoot several frames BEFORE the actual teleport
   *  — so the diagnostic would name the symptom's foothills instead of the 99-column cliff. */
  function assertEdgeCrossingIsContinuous(dxPerStep: number, steps: number, graph?: ReturnType<typeof hubAndLeavesGraph>) {
    const { samples, cols } = panSweep(dxPerStep, steps, graph);

    // Sanity FIRST — every assertion below is vacuous if the sweep never reached the edge, or if the
    // name was never drawn at all. A boundary test that never visits the boundary passes against
    // anything, and a sweep whose community goes fully off-screen before its hub does silently stops
    // testing the placement rule at all (which is why the left-edge case needs a MIRRORED fixture:
    // with the hub on the right, panning left takes every leaf off the field before the hub, so the
    // name is already gone for want of members by the time the edge matters).
    expect(samples.some((s) => s.hubCol >= 0 && s.hubCol < cols)).toBe(true); // anchor was on-grid...
    expect(samples.some((s) => s.hubCol < 0 || s.hubCol >= cols)).toBe(true); // ...and later was not
    expect(samples.filter((s) => s.labelCol != null).length).toBeGreaterThan(5);
    // The name must still be on the field on a frame where the hub is ALREADY off it, or neither
    // invariant below ever gets to look at the far side of the boundary.
    expect(samples.some((s) => s.labelCol != null && (s.hubCol < 0 || s.hubCol >= cols))).toBe(true);

    // (A) ANCHOR TRACKING. The name is centred on its hub's cell (`col0 - floor(w/2)`), so the gap
    // between the two is `floor(w/2)` — plus, inside the clamp's band, at most another
    // `ceil(w/2) - 1` of legitimate nudge to keep an on-screen name inside the grid. `w` is
    // therefore the exact ceiling, and it is what makes a FREEZE fail: an edge-parked label keeps an
    // absolute column while its anchor slides on, so this gap grows without bound. It is also what
    // makes a WRONG ANCHOR fail: the visible-member centroid sits ~117 columns from the hub in this
    // fixture, by construction — that separation is the entire premise of hub-anchoring.
    //
    // (B) CONTINUITY. Frame to frame, the name may not move any further than its anchor did — except
    // for the clamp switching on or off, which contributes at most its own maximum displacement,
    // `ceil(w/2)`. This is the no-teleport bound: switching between two anchors that are far apart by
    // construction blew it by ~99 columns of a 124-column field in ONE frame.
    let worstGap = { v: 0, at: "" }, worstStep = { v: 0, at: "" };
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (b.labelCol == null || b.wCells == null) continue;
      const w = b.wCells;
      const gap = Math.abs(b.labelCol - b.hubCol) - w;
      if (gap > worstGap.v) worstGap = { v: gap, at: `frame ${i}: labelCol ${b.labelCol} vs hubCol ${b.hubCol}, w=${w}` };
      if (a.labelCol == null) continue; // name was absent last frame — no delta to compare
      const excess = Math.abs((b.labelCol - a.labelCol) - (b.hubCol - a.hubCol)) - Math.ceil(w / 2);
      if (excess > worstStep.v) worstStep = { v: excess, at: `frame ${i}: labelCol ${a.labelCol}->${b.labelCol} while hubCol ${a.hubCol}->${b.hubCol}, w=${w}` };
    }
    // `v` is the amount by which the bound was EXCEEDED, so 0 means "within bound" and the message
    // carries the offending frame.
    expect(`gap ${worstGap.v} ${worstGap.at}`).toBe("gap 0 ");
    expect(`step ${worstStep.v} ${worstStep.at}`).toBe("step 0 ");
  }

  it("BOUNDARY CONTINUITY (right edge) — the name never teleports and never freezes as its hub pans across the field edge", () => {
    assertEdgeCrossingIsContinuous(3, 40);
  });

  it("BOUNDARY CONTINUITY (left edge) — same, in the other direction (the left clamp is a separate branch)", () => {
    // MIRRORED fixture — see the sanity block in the helper for why the right-edge one cannot test
    // this direction: x is negated so the hub leads the community off the LEFT edge, leaving its
    // leaves on the field behind it, which is the arrangement that makes an off-grid anchor
    // observable at all.
    const g = hubAndLeavesGraph();
    for (const n of g.nodes) { n.position[0] *= -1; n.position2d[0] *= -1; }
    assertEdgeCrossingIsContinuous(-3, 40, g);
  });

  it("ACCEPTED COST — a community whose hub has left the field loses its name entirely rather than parking it at the edge", () => {
    // This is a REGRESSION against the pre-task centroid anchor, and it is deliberate: it is the
    // price of having exactly one anchor rule. See layoutClusterNames' doc for why a quiet omission
    // beats the alternatives (a frozen label captioning whatever drifts under it, or a ~99-column
    // one-frame teleport when switching to a second, screen-derived anchor). Asserted explicitly so
    // the trade-off is recorded in the suite rather than only in a commit message — and so that
    // anyone who later restores a fallback has to come here and delete this on purpose.
    // Swept LEFTWARD: at fit the hub already sits at column ~122 of 124, so a rightward sweep leaves
    // only about three on-grid frames to sample — too few to tell "drawn while on-grid" from noise.
    // Going the other way it crosses the whole field first, then exits past column 0.
    const { samples, cols } = panSweep(-3, 300);
    const wellOff = samples.filter((s) => s.hubCol <= -4);
    expect(wellOff.length).toBeGreaterThan(3); // the sweep really did leave the hub far off-grid
    expect(wellOff.every((s) => s.labelCol == null)).toBe(true);
    // ...and while the hub WAS on the grid, the name was drawn — the omission is scoped to the hub
    // being gone, not a blanket "cluster names stopped working".
    const onGridDrawn = samples.filter((s) => s.hubCol >= 0 && s.hubCol < cols && s.labelCol != null);
    expect(onGridDrawn.length).toBeGreaterThan(50);
  });

  it("the pathOf level clamp is applied consistently in the exemplar-NAME table too, not just the colour tally and hub race — a shallow-only community still gets its real name at a deeper level, not the 'cluster N' placeholder", () => {
    // Two ordinary 2-level nodes establish levelCount=2. A THIRD, SHALLOW node (community only, no
    // communityPath) carries community id 99 — a community with NO deep member at all, so its name
    // can only ever reach level 1 via the SAME clamp (`path[Math.min(L, path.length-1)]`) the colour
    // tally and hub race already use. Drop the clamp here specifically and level 1 never learns
    // community 99's name at all, even though the colour/hub tables (independently clamped) still
    // happily rank and anchor it — an inconsistency invisible to any test that only checks colour.
    const nodes = [
      {
        id: "d0", label: "d0", kind: "note" as const, position: [0, 0, 0] as [number, number, number], position2d: [0, 0] as [number, number],
        community: 0, communityLabel: "Sub Zero", communityPath: [0, 0], communityPathLabels: ["Top", "Sub Zero"],
      },
      {
        id: "d1", label: "d1", kind: "note" as const, position: [10, 0, 0] as [number, number, number], position2d: [10, 0] as [number, number],
        community: 1, communityLabel: "Sub One", communityPath: [0, 1], communityPathLabels: ["Top", "Sub One"],
      },
      {
        id: "shallow", label: "shallow", kind: "note" as const, position: [20, 0, 0] as [number, number, number], position2d: [20, 0] as [number, number],
        community: 99, communityLabel: "Shallow Only",
      },
    ];
    const { r } = mountRenderer("3d", { nodes, edges: [] });
    const priv = r as unknown as { communityNamesByLevel: Map<number, string>[] };
    expect(priv.communityNamesByLevel[1]?.get(99)).toBe("Shallow Only");
    r.destroy();
  });
});

describe("Task 9 — LOD entity masses share the node glyphs' colour (the invariant colorLevelsFor's doc claims)", () => {
  it("an entity mass's colour slot is the EXACT SAME per-level community slot its member nodes would show at that level", () => {
    // lodGraph() (see its own describe block above): a 2-level hierarchy, TOP 0 = blobs 0+1, TOP 1 =
    // blobs 2+3. At fit with LOD masses on, only the coarsest (TOP) entities are on the field.
    const { r } = mountRenderer("2d", lodGraph(), { showLodMasses: true });
    const priv = r as unknown as {
      entityFlat: { level: number; community: number; color: number }[];
      nodes: { node: { id: string }; colorByLevel: number[] }[];
    };
    const topEntity0 = priv.entityFlat.find((e) => e.level === 0 && e.community === 0);
    const topEntity1 = priv.entityFlat.find((e) => e.level === 0 && e.community === 1);
    expect(topEntity0).toBeDefined();
    expect(topEntity1).toBeDefined();
    const memberOf0 = priv.nodes.find((n) => n.node.id === "b0k0")!; // blob 0 -> TOP community 0
    const memberOf1 = priv.nodes.find((n) => n.node.id === "b2k0")!; // blob 2 -> TOP community 1
    // Level 0 (TOP) is the COARSEST of this fixture's 2 levels, i.e. colorByLevel[0].
    expect(memberOf0.colorByLevel[0]).toBe(topEntity0!.color);
    expect(memberOf1.colorByLevel[0]).toBe(topEntity1!.color);
    // ...and the two top-level communities are still coloured DIFFERENTLY from each other.
    expect(topEntity0!.color).not.toBe(topEntity1!.color);
    r.destroy();
  });
});

describe("Task 9 — trimDanglingWord wired into the live cluster-name pass", () => {
  it("a cluster name ending on a dangling word (\"AND\") loses it, on the field, not just in the pure helper", () => {
    // The exemplar name is short enough that clusterLabelText's char-cap truncation never fires —
    // this exercises trimDanglingWord as wired into layoutClusterNames itself, not the pure function
    // in isolation (already covered in clusterVisual.test.ts).
    const nodes = [
      {
        id: "n0", label: "n0", kind: "note" as const,
        position: [0, 0, 0] as [number, number, number], position2d: [0, 0] as [number, number],
        community: 0, communityLabel: "Ludwig Feuerbach and",
      },
      {
        id: "n1", label: "n1", kind: "note" as const,
        position: [40, 0, 0] as [number, number, number], position2d: [40, 0] as [number, number],
        community: 0, communityLabel: "Ludwig Feuerbach and",
      },
    ];
    const { r } = mountRenderer("2d", { nodes, edges: [] });
    const priv = r as unknown as { labels: { text: string; eyebrow?: boolean }[] };
    const label = priv.labels.find((l) => l.eyebrow);
    expect(label).toBeDefined();
    expect(label!.text).toBe("LUDWIG FEUERBACH");
    expect(label!.text.endsWith("AND")).toBe(false);
    r.destroy();
  });
});

describe("cluster label occupancy — no two eyebrow labels ever overlap (the 'soup' regression)", () => {
  /** Many small clusters packed TIGHTLY along one horizontal band — dense enough that greedy
   *  placement genuinely contends for cells. A wide margin between clusters would never exercise
   *  the bug: reservation and real DRAWN width only diverge once labels actually compete for the
   *  same row. Names are long enough to land past `CLUSTER_LABEL_MAX_CHARS`, so clusterLabelText's
   *  truncation is exercised too. */
  function denseClusterGraph() {
    const nodes = [];
    const edges = [];
    const N = 10;
    for (let b = 0; b < N; b++) {
      const cx = (b - (N - 1) / 2) * 40 * RING_SCALE;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const x = cx + Math.cos(a) * 4 * RING_SCALE;
        const y = Math.sin(a) * 4 * RING_SCALE;
        nodes.push({
          id: `b${b}k${k}`, label: `note ${b}${k}`, kind: "note" as const,
          position: [x, y, 0] as [number, number, number],
          position2d: [x, y] as [number, number],
          community: b,
          communityLabel: `Cluster Number ${b} About Something Long`,
        });
      }
    }
    for (let b = 0; b < N; b++) for (let k = 1; k < 4; k++) edges.push({ from: `b${b}k0`, to: `b${b}k${k}`, kind: "link" as const });
    return { nodes, edges };
  }

  it("keeps every drawn cluster label's DRAWN span disjoint from every other on the same row", () => {
    const { r } = mountRenderer("2d", denseClusterGraph());
    const priv = r as unknown as {
      labels: { text: string; col: number; row: number; widthCells: number; eyebrow?: boolean }[];
    };
    const eyebrows = priv.labels.filter((l) => l.eyebrow);
    expect(eyebrows.length).toBeGreaterThan(1); // the fixture must actually produce contention
    const byRow = new Map<number, typeof eyebrows>();
    for (const l of eyebrows) {
      const arr = byRow.get(l.row) ?? [];
      arr.push(l);
      byRow.set(l.row, arr);
    }
    let sameRowPairs = 0;
    for (const arr of byRow.values()) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          sameRowPairs++;
          const a = arr[i], b = arr[j];
          const overlaps = a.col <= b.col + b.widthCells && b.col <= a.col + a.widthCells;
          expect(overlaps).toBe(false);
        }
      }
    }
    expect(sameRowPairs).toBeGreaterThan(0); // the assertion above must actually have run at least once
    r.destroy();
  });

  it("computeStats() reports zero label overlaps and a capped max label length on the same dense fixture", () => {
    const { r } = mountRenderer("2d", denseClusterGraph());
    const stats = r.computeStats();
    expect(stats.labelsDrawn).toBeGreaterThan(1);
    expect(stats.labelOverlaps).toBe(0);
    expect(stats.maxLabelChars).toBeLessThanOrEqual(CLUSTER_LABEL_MAX_CHARS);
    // LOD masses are OFF by default — the leaf pass always runs (see "renders every individual node
    // as a glyph, even at fit" below), so real notes ARE on screen at fit and no aggregate entity is
    // drawn at all.
    expect(stats.notesOnScreen).toBeGreaterThan(0);
    expect(stats.entitiesDrawn).toBe(0);
    r.destroy();
  });

  it("computeStats() shows aggregate entities instead of real notes at fit when LOD masses are opted into", () => {
    const { r } = mountRenderer("2d", denseClusterGraph(), { showLodMasses: true });
    const stats = r.computeStats();
    expect(stats.notesOnScreen).toBe(0);
    expect(stats.entitiesDrawn).toBeGreaterThan(0);
    r.destroy();
  });
});

describe("THE LAW — zoom is resolution, never scale", () => {
  it("keeps the type size byte-identical across a wheel zoom", () => {
    const { r, viewport } = mountRenderer("2d");
    const fontBefore = ctx.font;
    ctx.fonts.length = 0;
    wheelIn(viewport, 12);
    settle();
    expect(ctx.font).toBe(fontBefore);
    expect(ctx.fonts.every((f) => f === fontBefore)).toBe(true);
    r.destroy();
  });

  it("re-rasterizes the field at the finer grid (more glyphs, same cell)", () => {
    const { r, viewport } = mountRenderer("2d");
    const before = allText();
    wheelIn(viewport, 12);
    settle();
    ctx.fills.length = 0;
  ctx.strokes.length = 0;
    frame(9999);
    expect(allText()).not.toBe(before);
    r.destroy();
  });

  it("pins the character advance to the design's cell width via letterSpacing", () => {
    const { r } = mountRenderer("2d");
    expect(parseFloat(ctx.letterSpacing)).toBeCloseTo(CELL_W - 11.5 * 0.6, 3);
    r.destroy();
  });

  it("reads 100% at fit and drops toward 0% as the wheel zooms in (10% steps)", () => {
    const { r, viewport, zooms } = mountRenderer("2d");
    expect(zooms.at(-1)).toBe(100);
    wheelIn(viewport, 1); // exactly one notch = one ZOOM_STEP_PCT step
    settle();
    expect(zooms.at(-1)).toBe(90);
    wheelIn(viewport, 9); // saturate at the 0% (deepest) floor
    settle();
    expect(zooms.at(-1)).toBe(0);
    r.destroy();
  });

  /**
   * REGRESSION (the stepped-zoom ladder collapsing to a single point).
   *
   * `RING_SCALE` above exists precisely to give the fixture enough bounding radius to have zoom
   * range — which means every other test in this file dodges the case that actually shipped broken:
   * a graph whose OWN fit resolution already meets the fixed absolute 0% target
   * (`DEEPEST_WORLD_PER_CELL`). That is not exotic — it is any compact graph, and it is the real
   * 2251-note vault the moment the field is ~2200px wide (a maximized window on a large display).
   *
   * There, `maxResFor`'s floor pinned `maxRes` to exactly 1, and BOTH directions of the percent
   * mapping degenerate at `maxRes <= 1`: `resFromPercent` returns 1 for every step and
   * `resolutionPercent` returns 100 for every res. So a wheel notch moved `zoomPct` to 90 while
   * `goalRes` stayed at the fit resolution — the field never re-rasterized, the HUD stayed pinned
   * at "100%", and every further notch did nothing. The whole 11-stop ladder collapsed onto one
   * stop. This test drives the REAL wheel path (one 120px notch) on a natural-scale graph and pins
   * the three things that were wrong: the ladder has range, the field still draws, and the HUD
   * reports the step the user actually selected.
   */
  it("keeps a live ladder on a graph whose own fit already meets the absolute 0% target", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new AsciiGraphRenderer();
    const zooms: number[] = [];
    r.mount(host, () => {});
    r.setZoomCallback((p) => zooms.push(p));
    r.setConfig({ ...CONFIG, viewMode: "2d" });
    // sampleGraph() WITHOUT the RING_SCALE blow-up: an ordinary compact ring, whose fit scale is
    // already finer than DEEPEST_WORLD_PER_CELL in an 800x600 field.
    r.render({
      nodes: sampleGraph().nodes.map((n) => ({
        ...n,
        position: n.position.map((v) => v / RING_SCALE) as [number, number, number],
        position2d: n.position2d.map((v) => v / RING_SCALE) as [number, number],
      })),
      edges: sampleGraph().edges,
    });
    const viewport = host.firstElementChild as HTMLElement;
    ctx.fills.length = 0;
  ctx.strokes.length = 0;
    frame();
    expect(zooms.at(-1)).toBe(100); // sanity: we start at fit

    // The camera internals are private; this is the one place the test needs to see the ladder
    // itself rather than only its symptoms.
    const cam = r as unknown as { res: number; goalRes: number; maxRes: number };
    const fitRes = cam.res;

    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, cancelable: true })); // ONE notch
    expect(Number.isFinite(cam.goalRes)).toBe(true);
    expect(cam.goalRes).toBeGreaterThan(fitRes); // the step must actually move the resolution

    settle();
    expect(cam.res).toBe(cam.goalRes);                 // the glide LANDS on the step, exactly
    expect(zooms.at(-1)).toBe(90);                     // ...so the HUD reads the step the user picked
    expect(nodeRuns().length).toBeGreaterThan(0);      // ...and the field is still on the grid
    r.destroy();
  });

  it("resetView glides back to 100% (fit)", () => {
    const { r, viewport, zooms } = mountRenderer("2d");
    wheelIn(viewport, 10);
    settle();
    r.resetView();
    settle(200);
    expect(zooms.at(-1)).toBe(100);
    r.destroy();
  });

  it("frameSubset raises the resolution (drops the percent toward 0%) instead of scaling anything", () => {
    const { r, zooms } = mountRenderer("2d");
    const fontBefore = ctx.font;
    r.frameSubset(["n0", "n1", "n2"]);
    settle(200);
    expect(zooms.at(-1)!).toBeLessThan(100);
    expect(ctx.font).toBe(fontBefore);
    r.destroy();
  });
});

describe("LEVEL OF DETAIL (opt-in, GraphConfig.showLodMasses) — coarse stops rasterize aggregate entities, deep stops the real graph", () => {
  it("renders every individual node as a glyph even at fit — LOD masses are OFF by default", () => {
    const { r } = mountRenderer("2d", lodGraph());
    const p = lodPriv(r);
    // No aggregate entity anywhere on the field...
    expect([...p.cellEntity].every((v) => v < 0)).toBe(true);
    // ...every real note IS on the field instead (the leaf pass always runs).
    expect([...p.cellNode].some((v) => v >= 0)).toBe(true);
    expect(r.computeStats().notesOnScreen).toBe(24); // all 4 blobs × 6 notes
    r.destroy();
  });

  it("renders ONE named entity per coarsest community at fit — and no individual notes at all", () => {
    const { r } = mountRenderer("2d", lodGraph(), { showLodMasses: true });
    const p = lodPriv(r);
    // No leaf raster work ran: no note occupies any cell.
    expect([...p.cellNode].every((v) => v < 0)).toBe(true);
    // Exactly the two TOP communities, one entity each, left and right of centre, at their
    // members' centroids.
    const flats = new Set<number>();
    for (const v of p.cellEntity) if (v >= 0) flats.add(v);
    const ents = [...flats].map((f) => p.entityFlat[f]);
    expect(ents.length).toBe(2);
    expect(new Set(ents.map((e) => e.level))).toEqual(new Set([0]));
    expect(ents.map((e) => e.count).sort()).toEqual([12, 12]);
    const left = ents.find((e) => e.community === 0)!;
    const right = ents.find((e) => e.community === 1)!;
    expect(left.col).toBeLessThan(p.m.cols / 2);
    expect(right.col).toBeGreaterThan(p.m.cols / 2);
    // The auto names ride along in eyebrow register.
    expect(ctx.fills.some((f) => f.text === "TOP 0")).toBe(true);
    expect(ctx.fills.some((f) => f.text === "TOP 1")).toBe(true);
    r.destroy();
  });

  it("draws aggregate connectors between entities at fit — the leaf edge pass never ran", () => {
    const { r } = mountRenderer("2d", lodGraph(), { showLodMasses: true });
    const p = lodPriv(r);
    // Any LAYER_EDGE cell at fit is an aggregate connector (the leaf passes are skipped wholesale).
    let edgeCells = 0;
    for (const v of p.layerBuf) if (v === LAYER_EDGE) edgeCells++;
    expect(edgeCells).toBeGreaterThan(0);
    r.destroy();
  });

  it("stepping in over an entity expands it into its CHILDREN near the parent's position", () => {
    const { r, viewport } = mountRenderer("2d", lodGraph(), { showLodMasses: true });
    const p = lodPriv(r);
    expect(entityLevelsOnGrid(p)).toEqual(new Set([0]));
    // Wheel ANCHORED on the left top-level mass (community 0 = blobs 0+1).
    const leftFlat = p.entityFlat.findIndex((e) => e.level === 0 && e.community === 0);
    const i = p.cellEntity.findIndex((v) => v === leftFlat);
    expect(i).toBeGreaterThanOrEqual(0);
    const at = cellPx(p, i);
    wheelIn(viewport, 4, at); // 100% -> 60% = t 0.4: past the 2-level boundary (0.375) — level 1 owns it
    settle(200);
    expect(entityLevelsOnGrid(p)).toEqual(new Set([1]));
    // The children on the field are the anchored parent's OWN blobs (0 and 1) — expansion happens
    // in place; the other half of the graph has left the anchored view.
    const comms = new Set<number>();
    for (const v of p.cellEntity) if (v >= 0) comms.add(p.entityFlat[v].community);
    expect(comms.size).toBeGreaterThan(0);
    expect([...comms].every((c) => c === 0 || c === 1)).toBe(true);
    // Still no real notes this far out.
    expect([...p.cellNode].every((v) => v < 0)).toBe(true);
    r.destroy();
  });

  it("only the real graph rasterizes at the deep stops — entities are gone, real notes and edges draw", () => {
    const { r, viewport } = mountRenderer("2d", lodGraph(), { showLodMasses: true });
    const p = lodPriv(r);
    // Phase 1: into the left top cluster (level 1 active).
    const leftFlat = p.entityFlat.findIndex((e) => e.level === 0 && e.community === 0);
    const at0 = cellPx(p, p.cellEntity.findIndex((v) => v === leftFlat));
    wheelIn(viewport, 3, at0);
    settle(200);
    // Phase 2: follow ONE child mass down to 0% (the anchor keeps it under the cursor).
    const childIdx = p.cellEntity.findIndex((v) => v >= 0);
    expect(childIdx).toBeGreaterThanOrEqual(0);
    wheelIn(viewport, 7, cellPx(p, childIdx));
    settle(300);
    expect([...p.cellEntity].every((v) => v < 0)).toBe(true); // entities fully dissolved
    expect([...p.cellNode].some((v) => v >= 0)).toBe(true);   // real notes on the field
    r.destroy();
  });

  it("keeps the world point under the cursor fixed through zoom steps (within a cell)", () => {
    const { r, viewport } = mountRenderer("2d", lodGraph(), { showLodMasses: true });
    const p = lodPriv(r);
    const m = p.m;
    // A deliberately off-centre cursor point: over the left mass.
    const at = cellPx(p, p.cellEntity.findIndex((v) => v >= 0));
    const screenOf = (wx: number, wy: number) => {
      const s = p.pxPerWorld * p.res;
      return {
        x: m.padX + (m.cols / 2) * m.cellW + p.panX + (wx - p.target[0]) * s,
        y: m.padY + (m.rows / 2) * m.cellH + p.panY + (wy - p.target[1]) * s,
      };
    };
    // The world point under the cursor, from the settled fit camera.
    const s0 = p.pxPerWorld * p.res;
    const wx = p.target[0] + (at.x - (m.padX + (m.cols / 2) * m.cellW + p.panX)) / s0;
    const wy = p.target[1] + (at.y - (m.padY + (m.rows / 2) * m.cellH + p.panY)) / s0;

    wheelIn(viewport, 1, at);
    settle(300);
    const p1 = screenOf(wx, wy);
    expect(Math.abs(p1.x - at.x)).toBeLessThanOrEqual(m.cellW);
    expect(Math.abs(p1.y - at.y)).toBeLessThanOrEqual(m.cellH);

    wheelIn(viewport, 1, at); // consecutive steps must compose without drift
    settle(300);
    const p2 = screenOf(wx, wy);
    expect(Math.abs(p2.x - at.x)).toBeLessThanOrEqual(m.cellW);
    expect(Math.abs(p2.y - at.y)).toBeLessThanOrEqual(m.cellH);
    r.destroy();
  });

  it("3D keeps its full-detail path untouched — no entities, ever (even with showLodMasses on)", () => {
    const { r, viewport } = mountRenderer("3d", lodGraph(), { showLodMasses: true });
    const p = lodPriv(r);
    expect([...p.cellEntity].every((v) => v < 0)).toBe(true);
    expect([...p.cellNode].some((v) => v >= 0)).toBe(true);
    wheelIn(viewport, 1); // one step in — the 3D camera still rasterizes the REAL graph
    settle(200);
    expect([...p.cellEntity].every((v) => v < 0)).toBe(true);
    expect([...p.cellNode].some((v) => v >= 0)).toBe(true);
    r.destroy();
  });
});

describe("interaction", () => {
  /** Screen px of a node glyph the renderer actually drew (identified by its cluster colour). */
  function nodeHit(): { x: number; y: number } {
    const run = nodeRuns().find((f) => /[.o@]/.test(f.text));
    expect(run).toBeDefined();
    return { x: run!.x + run!.text.search(/[.o@]/) * CELL_W + 1, y: run!.y };
  }

  it("hovers the node under the cursor, and a click opens it (at a deep stop, where notes are on the field)", () => {
    const { r, viewport, clicks, hovers } = mountRenderer("2d");
    // At fit the 2D field shows aggregate entities (LOD) — frame a note first so real note glyphs
    // are on the grid to hit.
    r.frameSubset(["n0"]);
    settle(200);
    // The settled loop is idle (dirty=false) — force one repaint so nodeHit() reads a fresh frame.
    ctx.fills.length = 0;
  ctx.strokes.length = 0;
    r.setSearchMatches(new Set());
    frame(9999);
    const p = nodeHit();
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: p.x, clientY: p.y }));
    expect(hovers.filter(Boolean).length).toBeGreaterThan(0);

    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: p.x, clientY: p.y }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: p.x, clientY: p.y }));
    expect(clicks.length).toBe(1);
    r.destroy();
  });

  it("clicking an AGGREGATE ENTITY at fit expands it (zooms toward its members) instead of opening a note", () => {
    const { r, viewport, clicks, zooms } = mountRenderer("2d", lodGraph(), { showLodMasses: true });
    const p = lodPriv(r);
    const i = p.cellEntity.findIndex((v) => v >= 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const { x, y } = cellPx(p, i);
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: x, clientY: y }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y }));
    settle(200);
    expect(clicks).toEqual([]);                 // a cluster is not a note
    expect(zooms.at(-1)!).toBeLessThan(100);    // the field zoomed toward the cluster's members
    r.destroy();
  });

  it("clicking a COARSEST entity centres on it and expands exactly ONE level in — children on-grid, not the leaves yet", () => {
    const { r, viewport, clicks } = mountRenderer("2d", lodGraph(), { showLodMasses: true });
    const p = lodPriv(r);
    // At fit only the coarsest (TOP) level is on-grid — see the LOD describe block above.
    expect(entityLevelsOnGrid(p)).toEqual(new Set([0]));
    const i = p.cellEntity.findIndex((v) => v >= 0);
    const { x, y } = cellPx(p, i);
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: x, clientY: y }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y }));
    settle(300);
    expect(clicks).toEqual([]);
    // The child level now owns the field — the coarsest level has fully crossfaded away, and real
    // notes are NOT on the field yet (one click expands one level, not straight to the leaves).
    expect(entityLevelsOnGrid(p)).toEqual(new Set([1]));
    expect([...p.cellNode].every((v) => v < 0)).toBe(true);
    r.destroy();
  });

  it("orbiting in 3D re-rasterizes the field, and a drag never opens a note", () => {
    const { r, viewport, clicks } = mountRenderer("3d");
    const before = allText();
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 400, clientY: 300 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 500, clientY: 340 }));
    ctx.fills.length = 0;
  ctx.strokes.length = 0;
    frame(32);
    const after = allText();
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 500, clientY: 340 }));
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toBe(before);
    expect(clicks).toEqual([]);
    r.destroy();
  });

  it("panning in 2D moves the field", () => {
    const { r, viewport, clicks } = mountRenderer("2d");
    // At fit the 2D field is a handful of entity masses whose TEXT is identical wherever they sit —
    // a pan shows up in the fills' positions, so snapshot text AND coordinates.
    const snap = () => ctx.fills.map((f) => `${f.text}@${f.x.toFixed(1)},${f.y.toFixed(1)}`).join("|");
    const before = snap();
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 400, clientY: 300 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 300, clientY: 250 }));
    ctx.fills.length = 0;
  ctx.strokes.length = 0;
    frame(32);
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 300, clientY: 250 }));
    expect(snap()).not.toBe(before);
    expect(clicks).toEqual([]);
    r.destroy();
  });

  it("an empty-space click drops a persistent cluster highlight", () => {
    const { r, viewport } = mountRenderer("2d");
    let cleared = false;
    r.onHighlightCleared = () => { cleared = true; };
    r.highlightNodes(["n0", "n1"]);
    frame();
    // The very top-left corner of the field is padding — no node can be there.
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 1, clientY: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 1, clientY: 1 }));
    expect(cleared).toBe(true);
    r.destroy();
  });
});

describe("UI data accessors", () => {
  it("exposes clusters with a colour + member ids, and the nodes the search list needs", () => {
    const { r } = mountRenderer("3d");
    const clusters = r.getCommunityCentroids();
    expect(clusters.size).toBe(3);
    for (const c of clusters.values()) {
      expect(c.count).toBeGreaterThan(1);
      expect(c.ids.length).toBe(c.count);
      expect(c.color).toBeTruthy();
    }
    expect(r.getNodesForUI().length).toBe(24);
    r.destroy();
  });

  it("survives an empty graph — nothing is painted at all, no nodes, no clusters", () => {
    // POSITIVE CONTROL first. The assertion below is a "nothing was drawn" one, and those are
    // exactly the assertions that rot into always-true: this proves the instrument reads non-zero
    // on a graph that DOES have nodes, in this same harness, immediately before it is used to claim
    // zero. (It replaces `expect(nodeRuns()).toEqual([])`, which could not fail — nodeRuns() filters
    // on a whitelist of the SAMPLE graph's community colours, and a graph with no communities paints
    // nothing that could ever match, so the assertion was true by construction rather than by
    // behaviour.)
    const control = mountRenderer("2d");
    expect(ctx.fills.length).toBeGreaterThan(0);
    control.r.destroy();

    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new AsciiGraphRenderer();
    const painted: number[] = [];
    r.mount(host, () => {});
    r.setPaintCallback((n) => painted.push(n));
    r.setConfig({ ...CONFIG });
    r.render({ nodes: [], edges: [] });
    ctx.fills.length = 0;
    ctx.strokes.length = 0;
    frame();
    expect(painted.at(-1)).toBe(0);
    // An empty graph paints NOTHING — measured: no glyph runs, no labels, and no noise texture
    // either (hence the renamed title; the old one said "noise field only", which the paint output
    // does not bear out). Asserted on the raw fill list so ANY regression that paints anything at
    // all trips it, whatever colour or glyph it comes out as.
    expect(ctx.fills).toEqual([]);
    expect(r.getCommunityCentroids().size).toBe(0);
    r.destroy();
  });
});

describe("edge clipping — an edge with an off-field endpoint still strokes (a vector line needs no grid clip)", () => {
  it("keeps n0's local edges numerous at maximum zoom, even though most neighbours project off the tiny visible field", () => {
    const { r, viewport } = mountRenderer("2d");
    // frameSubset on n0 ALONE zooms to the maximum resolution centred exactly on it (a 1-point
    // subset has ~zero radius, so the frame ratio saturates at maxRes) — the same deterministic
    // "reach 0%" pattern other tests in this file use. n0 is the 24-spoke hub; every one of its 23
    // neighbours has a real edge to it, and at this resolution almost all of them project well off
    // the field. The OLD rule ("skip an edge unless BOTH endpoints are on-grid") dropped every one
    // of those — QA measured edgesDrawn:2 at 0%. Edges are vector strokes now, gated on `projValid`
    // alone (exactly the pre-redesign renderer's `onScreen`) — the canvas's own paint-time clip
    // handles the off-field portion, so n0's own local edges should still be numerous.
    r.frameSubset(["n0"]);
    wheelIn(viewport, 30);
    settle(300);
    const stats = r.computeStats();
    expect(stats.zoomPct).toBe(0);
    expect(stats.notesOnScreen).toBeGreaterThanOrEqual(1); // at least the hub itself is on the field
    expect(stats.edgesDrawn).toBeGreaterThan(5);
    expect(strokeSegs().length).toBeGreaterThan(5);
    r.destroy();
  });
});

describe("pan anchoring — the raster is WORLD-anchored, not screen-anchored (the pan-jitter fix)", () => {
  it("keeps the field's discrete char raster byte-identical across several different sub-cell pans", () => {
    const { r, viewport } = mountRenderer("2d");
    const priv = r as unknown as { charBuf: Uint16Array };

    // Engage dragging (crosses DRAG_THRESHOLD) with one bigger move, then snapshot.
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 400, clientY: 300 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 410, clientY: 300 }));
    frame(32);
    const snapshot = Array.from(priv.charBuf);

    // Several FOLLOW-UP sub-cell moves (well under one cell — CELL_W ~6.3px / CELL_H 18px), all
    // landing in the SAME whole-cell pan bucket as the snapshot above. Under the old screen-anchored
    // grid every one of these re-phased the world->cell rounding and reshaped every Bresenham line on
    // the field — "dragging makes lines wiggle". Quantizing pan to whole cells means the RASTER must
    // not change at all here; only a paint-time canvas translate (not exercised by this fake 2D
    // context) would move.
    let x = 410, y = 300;
    for (const [dx, dy] of [[1, 0], [1, 1], [-1, -1], [-1, 1]] as const) {
      x += dx; y += dy;
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y }));
      frame(32);
      expect(Array.from(priv.charBuf)).toEqual(snapshot);
    }
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y }));
    r.destroy();
  });

  it("shifts the raster by an exact whole cell when panned by one cell width — same shape, translated", () => {
    const { r, viewport } = mountRenderer("2d");
    const priv = r as unknown as { charBuf: Uint16Array; m: { cols: number; rows: number } };
    const { cols } = priv.m;

    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 400, clientY: 300 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 410, clientY: 300 })); // engage
    frame(32);
    const before = Array.from(priv.charBuf);

    // One more whole CELL_W of horizontal pan (rounds to +1 column), no vertical change.
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 410 + Math.round(CELL_W), clientY: 300 }));
    frame(32);
    const after = Array.from(priv.charBuf);

    // Every non-empty cell should have moved exactly one column right (dropping whatever scrolled
    // off the left edge, and leaving the new rightmost column however it lands) — the same discrete
    // SHAPE, not a reshaped line.
    let matched = 0, checked = 0;
    for (let r2 = 0; r2 < priv.m.rows; r2++) {
      for (let c = 0; c < cols - 1; c++) {
        const i = r2 * cols + c;
        if (!before[i]) continue;
        checked++;
        if (after[i + 1] === before[i]) matched++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(matched).toBe(checked);
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 410, clientY: 300 }));
    r.destroy();
  });
});

// ---- vector-edge fidelity (the batched-stroke edge pass ported from CanvasGraphRenderer) --------
// These cover the adversarial-review fixes to strokeEdges()/its bucket classification: the pure
// helpers get direct unit tests (no DOM needed); the DOM-dependent ones reuse mountRenderer() above.

describe("vector-edge fidelity — deriveEdgeBaseAlpha (a flat EDGE_BASE_ALPHA=1 was wrong on light themes)", () => {
  // The SAME background strokeEdges() actually composites onto — readTokens() prefers --graph-bg
  // (ColorTokens.graphBg) over --bg when present, exactly like this helper.
  const alphaFor = (name: keyof typeof THEMES) => {
    const t = THEMES[name];
    return deriveEdgeBaseAlpha(t.neutral, t.graphBg ?? t.background, t.graphEdge ?? t.neutral);
  };

  it("keeps ~full strength on the two DARK ascii themes (ink, cathode) — --graph-edge already composites close to the original's neutral-at-opacity weight", () => {
    expect(alphaFor("ink")).toBeCloseTo(0.92, 2);
    expect(alphaFor("cathode")).toBe(1); // raw ratio computes slightly ABOVE 1 (~1.06) — clamped
  });

  it("attenuates the two LIGHT ascii themes (paper, riso) — the original dampened light-theme lines far more (a colour mix toward background + a lower opacity) than a flat alpha of 1 would", () => {
    const paper = alphaFor("paper"), riso = alphaFor("riso");
    expect(paper).toBeCloseTo(0.47, 2);
    expect(riso).toBeCloseTo(0.34, 2);
    // Both meaningfully below the dark themes' ~1 — this gap is exactly the bug finding #3 fixes.
    expect(paper).toBeLessThan(0.6);
    expect(riso).toBeLessThan(0.6);
  });

  it("classifies light/dark from the resolved background's OWN luminance, not a theme-name lookup — a hypothetical future light theme gets the same dampening with no code change", () => {
    const hypotheticalLightTheme = deriveEdgeBaseAlpha("#665544", "#f0ede6", "#c8c0b0");
    expect(hypotheticalLightTheme).toBeGreaterThan(0);
    expect(hypotheticalLightTheme).toBeLessThan(1);
  });

  it("clamps to [0,1] and never NaNs, even on unparsuable or fully degenerate input", () => {
    expect(deriveEdgeBaseAlpha("not-a-color", "#000000", "#3C4048")).toBe(1); // unparsable → fallback
    const degenerate = deriveEdgeBaseAlpha("#000000", "#000000", "#000000"); // neutral==bg==edge
    expect(Number.isFinite(degenerate)).toBe(true);
    expect(degenerate).toBeGreaterThanOrEqual(0);
    expect(degenerate).toBeLessThanOrEqual(1);
  });
});

describe("vector-edge fidelity — trimSegmentForClearance (a line ran straight through its endpoint glyph)", () => {
  it("pulls a horizontal segment's endpoints back by the clearance, keeping its direction", () => {
    expect(trimSegmentForClearance(0, 0, 100, 0, 10)).toEqual([10, 0, 90, 0]);
  });

  it("pulls a diagonal segment back along its OWN unit vector, not axis-aligned (3-4-5 triangle, len 50)", () => {
    const [ax, ay, bx, by] = trimSegmentForClearance(0, 0, 30, 40, 5);
    expect(ax).toBeCloseTo(3, 5);  // 5 * (30/50)
    expect(ay).toBeCloseTo(4, 5);  // 5 * (40/50)
    expect(bx).toBeCloseTo(27, 5);
    expect(by).toBeCloseTo(36, 5);
  });

  it("leaves a segment no more than twice the clearance apart UNTRIMMED, rather than inverting its direction", () => {
    expect(trimSegmentForClearance(0, 0, 10, 0, 6)).toEqual([0, 0, 10, 0]);   // len 10 < 2*6
    expect(trimSegmentForClearance(0, 0, 12, 0, 6)).toEqual([0, 0, 12, 0]);   // len 12 == 2*6, the boundary
  });

  it("handles a zero-length (coincident-node) segment without dividing by zero into NaN", () => {
    const result = trimSegmentForClearance(5, 5, 5, 5, 3);
    expect(result).toEqual([5, 5, 5, 5]);
    expect(result.every(Number.isFinite)).toBe(true);
  });
});

describe("vector-edge fidelity — safeDepthBand (a NaN band index threw inside the rAF tick and froze the field)", () => {
  it("clamps a normal 0..1 midpoint into the band range", () => {
    expect(safeDepthBand(0, 6)).toBe(0);
    expect(safeDepthBand(0.999, 6)).toBe(5);
    expect(safeDepthBand(0.5, 6)).toBe(3);
  });

  it("falls back to band 0 for a non-finite midpoint instead of indexing an array with NaN", () => {
    expect(safeDepthBand(NaN, 6)).toBe(0);
    expect(safeDepthBand(Infinity, 6)).toBe(0);
    expect(safeDepthBand(-Infinity, 6)).toBe(0);
  });

  it("clamps an out-of-[0,1] but finite midpoint too", () => {
    expect(safeDepthBand(-1, 6)).toBe(0);
    expect(safeDepthBand(5, 6)).toBe(5);
  });
});

describe("vector-edge fidelity — hover dims by strict incidence, at the EDGE constant (not the node's, and not focusSet()'s neighbour-expanded set)", () => {
  it("dims every edge not directly incident to the hovered hub — including 2nd-degree ring edges between two of its own neighbours — at EDGE_DIM_ALPHA, and strokes the hovered-incident tier at `base`", () => {
    const { r } = mountRenderer("2d");
    const priv = r as unknown as {
      m: { cols: number; rows: number; cellW: number; cellH: number; padX: number; padY: number };
      nodes: { col: number; row: number; node: { id: string } }[];
      edgeBaseAlpha: number; leafAlpha: number;
    };
    const hub = priv.nodes.find((n) => n.node.id === "n0")!;
    const x = priv.m.padX + hub.col * priv.m.cellW + 1;
    const y = priv.m.padY + hub.row * priv.m.cellH + priv.m.cellH / 2;
    ctx.strokes.length = 0;
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y }));
    frame();

    // n0 is the 24-spoke hub — sampleGraph()'s ring edges (n1-n2 .. n22-n23) have NEITHER endpoint
    // equal to the hovered id, but BOTH endpoints ARE n0's neighbours (n0 links to every note):
    // exactly the case `focusSet()`'s neighbour-expanded set used to spare from dimming. With no
    // persistent highlight in play, hover now produces exactly two batched strokes — dim, then
    // accent (edgeMain/the depth bands are unreachable while hovering; see rasterize()'s edge loop).
    expect(ctx.strokes.length).toBe(2);
    const [dimStroke, accentStroke] = ctx.strokes;
    expect(dimStroke.segs.length).toBeGreaterThan(0); // the ring edges actually landed in the dim bucket
    const base = priv.edgeBaseAlpha * priv.leafAlpha;
    expect(dimStroke.alpha).toBeCloseTo(Math.min(1, base * EDGE_DIM_ALPHA), 5);
    // ...and specifically NOT the node constant (0.28, a past bug reused it — 5.6x too strong).
    expect(dimStroke.alpha).toBeLessThan(base * DIM_ALPHA);

    // The accent (hovered-incident) pass strokes at `base`, not the bare leafAlpha they're equal
    // only while edgeBaseAlpha is 1. happy-dom resolves no CSS vars, so this renderer's edgeBaseAlpha
    // is computed off the FALLBACK token table (not 1 — see deriveEdgeBaseAlpha), which is exactly
    // what makes this assertion meaningful: the old bug read alpha===leafAlpha (here, exactly 1).
    expect(priv.edgeBaseAlpha).toBeLessThan(1);
    expect(accentStroke.alpha).toBeCloseTo(Math.min(1, base), 5);
    expect(accentStroke.alpha).not.toBeCloseTo(priv.leafAlpha, 3);
    expect(accentStroke.alpha).toBeGreaterThan(dimStroke.alpha);
    r.destroy();
  });
});

describe("vector-edge fidelity — edge width follows the resolution STOP, not raw `res`", () => {
  it("reaches EDGE_W_MAX only at the deepest zoom stop, not almost immediately", () => {
    const { r, viewport } = mountRenderer("2d");
    r.frameSubset(["n0"]);
    wheelIn(viewport, 30); // saturate toward the deepest (0%) stop
    settle(300);
    ctx.strokes.length = 0;
    r.setSearchMatches(new Set()); // harmless dirty-forcing mutation (same pattern used elsewhere)
    frame(9999);
    expect(ctx.strokes[0]?.width).toBeCloseTo(EDGE_W_MAX, 1);
    r.destroy();
  });
});

