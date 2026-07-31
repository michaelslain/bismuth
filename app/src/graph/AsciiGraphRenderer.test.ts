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
import { CELL_W, LAYER_EDGE, resFromT } from "./asciiGrid";
import { CLUSTER_LABEL_MAX_CHARS, clusterLevelAlphas } from "./labelSelection";
import { DEFAULT_LEVEL_REVEAL_T, EDGE_WEIGHT_BUCKETS, bandsForT, edgeWeightBucketRange } from "./backbone";
import { buildColorSlots } from "./clusterVisual";
import { MAX_MAGNIFICATION, MAX_ZOOM_FRAC } from "./cameraModel";
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

  it("...and those slots resolve to the ACTUAL PAINTED colours — asserted on ctx.fills, on the app's default 2D view", () => {
    // The test above compares two private numeric slot INDICES read out of the same map, so it
    // proves they agree with each other and nothing about what reaches the canvas: swap the slot ->
    // colour resolution wholesale and it stays green. This one reads the paint output. It is also
    // the suite's only paint-COLOUR assertion on the configuration the app actually ships by
    // default — 2D with LOD masses on, which routes through layoutEntityNames/entity rasterization,
    // not the layoutClusterNames path every other Task 9 test exercises.
    const { r } = mountRenderer("2d", lodGraph(), { showLodMasses: true });
    const priv = r as unknown as {
      entityFlat: { level: number; community: number; col: number; row: number }[];
      m: { cols: number; rows: number; cellW: number; cellH: number; padX: number; padY: number };
    };
    const m = priv.m;
    // Glyph runs are painted at (padX + runCol*cellW, padY + row*cellH + cellH/2) — see paint()'s
    // per-row run flusher — so a cell maps back to the run covering it.
    const paintedColorAtCell = (col: number, row: number) => {
      const y = m.padY + row * m.cellH + m.cellH / 2;
      const hit = ctx.fills.find((f) => {
        if (Math.abs(f.y - y) > 0.01 || !/^[.o@ ]+$/.test(f.text)) return false;
        const c0 = Math.round((f.x - m.padX) / m.cellW);
        return col >= c0 && col < c0 + f.text.length;
      });
      return hit?.color;
    };

    // lodGraph's two TOP communities are a 12-member size TIE (blobs 0+1 and blobs 2+3, 6 notes
    // each), so buildColorSlots ranks them by id ascending — 0 -> rank 0, 1 -> rank 1, both inside
    // the palette's first cycle (2 < 5, no hue rotation). Computed through the REAL buildColorSlots
    // against the same fallback ramp the renderer uses under happy-dom, not hand-copied hexes.
    const expected = buildColorSlots(new Map([[0, 12], [1, 12]]), RAMP_FALLBACK);
    expect(expected.get(0)).not.toBe(expected.get(1)); // guard: the check below is vacuous if equal

    // Asserted as a MAPPING (community -> painted hex), not as a set of hexes: the two communities
    // sit at adjacent slots in `commColors`, so an off-by-one in the slot -> colour lookup SWAPS
    // them, and a set comparison — or any assertion that sorts — cannot see a swap. Verified: that
    // exact mutation passes a sorted-set version of this test and fails this one.
    let checked = 0;
    for (const ev of priv.entityFlat.filter((e) => e.level === 0)) {
      const painted = paintedColorAtCell(ev.col, ev.row);
      expect(painted).toBe(expected.get(ev.community));
      checked++;
    }
    expect(checked).toBe(2); // guard: both TOP masses were actually on the field and inspected
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

  it("...and on the LOD MASS name pass too — the path the app's default 2D view actually uses", () => {
    // layoutEntityNames is a SECOND, independent name site (masses, not per-node communities), and
    // it is the one the default 2D view shows. Canvas applies trimDanglingWord at its single name
    // site; trimming only ASCII's non-LOD site left mass names keeping their dangling word.
    const g = lodGraph();
    for (const n of g.nodes as { communityPathLabels?: string[] }[]) {
      if (n.communityPathLabels) n.communityPathLabels[0] = "Ludwig Feuerbach and";
    }
    const { r } = mountRenderer("2d", g, { showLodMasses: true });
    const priv = r as unknown as { labels: { text: string; eyebrow?: boolean }[] };
    const names = priv.labels.filter((l) => l.eyebrow).map((l) => l.text);
    expect(names.length).toBeGreaterThan(0); // guard: no mass names drawn => nothing was tested
    expect(names).toContain("LUDWIG FEUERBACH");
    expect(names.some((t) => t.endsWith("AND"))).toBe(false);
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

/**
 * Task 11 — the 3D camera dolly, DERIVED from the resolution ladder (AsciiGraphRenderer.cameraDolly
 * / cameraModel.dollyForT).
 *
 * The claim under test, in one line: in 3D the magnification is `min(res, maxZsFor(P)^t)`, delivered
 * by a real camera dolly (`zc = z2 + dolly`) over a world held at its FIT scale — which is the SAME
 * projection ASCII always had wherever the resolution ladder stays under the camera ceiling, and a
 * ceiling-clamped one where it does not.
 *
 * Two fixtures, one graph, differing only in host box, because the whole behaviour hinges on which
 * side of `MAX_MAGNIFICATION` the graph's `maxRes` lands (see `assertShallowLadder`/`assertDeepLadder`
 * — every test asserts its own precondition, so a fixture that drifts across that line fails loudly
 * instead of quietly testing the other branch).
 */
describe("Task 11 — the 3D camera dolly is derived from the resolution ladder", () => {
  /** A filled 3D ball of notes. Unlike sampleGraph's ring — whose interior is EMPTY, so a camera that
   *  moves toward the centre sees nothing regardless of whether it works — every direction from the
   *  target here has neighbours, which is what makes "what does the field show at maximum zoom" a
   *  question about the camera rather than about the fixture. Deterministic LCG, no Math.random. */
  function ballGraph(n = 300) {
    const nodes = [];
    const edges = [];
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = Math.cbrt(rnd()) * 300;
      const sp = Math.sqrt(1 - u * u);
      const x = rr * sp * Math.cos(th), y = rr * sp * Math.sin(th), z = rr * u;
      nodes.push({
        id: `n${i}`, label: `note ${i}`, kind: "note" as const,
        position: [x, y, z] as [number, number, number], position2d: [x, y] as [number, number],
        community: i % 5, communityLabel: `Cluster ${i % 5}`,
      });
    }
    for (let i = 1; i < n; i++) edges.push({ from: `n${i - 1}`, to: `n${i}`, kind: "link" as const });
    return { nodes, edges };
  }
  // Same admission-list construction as SAMPLE_GRAPH_COMMUNITY_COLORS above, for the ball's five
  // equal-sized communities (300 nodes, i % 5 → a five-way size tie → ranks 0..4, no hue rotation).
  const BALL_COMMUNITY_COLORS = new Set(
    buildColorSlots(new Map([[0, 60], [1, 60], [2, 60], [3, 60], [4, 60]]), RAMP_FALLBACK).values(),
  );
  const ballNodeRuns = () => ctx.fills.filter((f) => BALL_COMMUNITY_COLORS.has(f.color) && /^[.o@ ]+$/.test(f.text));

  /** The camera state the assertions below read. Cast-only — the public surface stays GraphRenderer. */
  interface CamPriv {
    nodes: {
      p3: [number, number, number]; sx: number; sy: number; depth: number;
      projValid: boolean; onGrid: boolean; node: { id: string };
    }[];
    m: { cols: number; rows: number; cellW: number; cellH: number; padX: number; padY: number };
    pxPerWorld: number; res: number; maxRes: number; P: number;
    rx: number; ry: number; panXQ: number; panYQ: number; target: [number, number, number];
  }
  const camPriv = (r: AsciiGraphRenderer) => r as unknown as CamPriv;

  /**
   * The camera-space depth `z2` a node would have with the world at its FIT scale — i.e. with the
   * resolution factored OUT. Independent of the renderer's own projection loop (it re-derives the
   * yaw/pitch from `rx`/`ry` rather than reading anything the loop wrote), which is what lets the
   * tests below recover the dolly the renderer actually applied: `dolly = nv.depth - fitFrameZ(nv)`.
   */
  function fitFrameZ(p: CamPriv, i: number): number {
    const nv = p.nodes[i];
    const S = p.pxPerWorld;
    const x = (nv.p3[0] - p.target[0]) * S, y = (nv.p3[1] - p.target[1]) * S, z = (nv.p3[2] - p.target[2]) * S;
    const z1 = -x * Math.sin(p.ry) + z * Math.cos(p.ry);
    return y * Math.sin(p.rx) + z1 * Math.cos(p.rx);
  }

  /** Every node's recovered dolly. A dolly is a property of the CAMERA, so these must all agree — the
   *  spread is asserted, not assumed, in the tests that use the mean. */
  const recoveredDollies = (p: CamPriv) => p.nodes.map((nv, i) => nv.depth - fitFrameZ(p, i));

  /**
   * The projection AS IT WAS before the camera became explicit: world scaled by `pxPerWorld * res`,
   * camera pinned at `zc = z2`, clip planes at the literal `persp > 0.05` / `zc < P * 0.985`. Lifted
   * from the pre-Task-11 `projectNodes` and kept here as an INDEPENDENT oracle, because the whole
   * no-regression claim is that wherever the camera ceiling does not bind, the explicit dolly
   * reproduces this term for term — positions AND cull.
   */
  function preDollyProjection(p: CamPriv) {
    const S = p.pxPerWorld * p.res;
    const cyr = Math.cos(p.ry), syr = Math.sin(p.ry), cxr = Math.cos(p.rx), sxr = Math.sin(p.rx);
    const ox = p.m.padX + (p.m.cols / 2) * p.m.cellW + p.panXQ;
    const oy = p.m.padY + (p.m.rows / 2) * p.m.cellH + p.panYQ;
    return p.nodes.map((nv) => {
      const x = (nv.p3[0] - p.target[0]) * S, y = (nv.p3[1] - p.target[1]) * S, z = (nv.p3[2] - p.target[2]) * S;
      const x1 = x * cyr + z * syr, z1 = -x * syr + z * cyr;
      const y2 = y * cxr - z1 * sxr, z2 = y * sxr + z1 * cxr;
      const persp = p.P / Math.max(1, p.P - z2);
      return {
        sx: ox + x1 * persp, sy: oy + y2 * persp,
        projValid: persp > 0.05 && z2 < p.P * 0.985,
      };
    });
  }

  /** The dolly ceiling `cameraModel` imposes at this perspective — Canvas's MAX_ZOOM_FRAC clamp. */
  const ceilingMag = (P: number) => P / Math.max(1, P - MAX_ZOOM_FRAC * P);

  /** Preconditions. A fixture that drifts across the ceiling silently tests the OTHER branch — these
   *  make that a failure with a readable message rather than a vacuous pass. */
  function assertDeepLadder(p: CamPriv) {
    expect(p.maxRes).toBeGreaterThan(ceilingMag(p.P));   // measured 19.7 vs 16.67 — the ceiling binds
  }
  function assertShallowLadder(p: CamPriv) {
    expect(p.maxRes).toBeLessThanOrEqual(ceilingMag(p.P)); // measured 8.0 (the MIN_ZOOM_SPAN floor)
  }

  /** Mount the ball in 3D, optionally in a smaller host box (which is what pushes `maxRes` past the
   *  camera ceiling: maxRes ∝ 1/pxPerWorld ∝ 1/boxPx). Restores BOX like the resize test above. */
  /**
   * `body` runs with the ball mounted; the renderer is destroyed and BOX restored in a `finally`
   * WHATEVER happens. Both matter: a renderer left alive by a failing assertion keeps its rAF loop
   * pumping into this file's SHARED recording context, so one broken test in here silently corrupts
   * the stroke/fill counts of unrelated tests later in the file (observed exactly that, once).
   */
  function withBall(
    box: { width: number; height: number } | null,
    body: (m: { r: AsciiGraphRenderer; viewport: HTMLElement; painted: number[]; p: CamPriv }) => void,
    n = 300,
  ) {
    const restoreBox = { ...BOX };
    if (box) Object.assign(BOX, box);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new AsciiGraphRenderer();
    try {
      const painted: number[] = [];
      r.mount(host, () => {}, () => {});
      r.setPaintCallback((c) => painted.push(c));
      r.setConfig({ ...CONFIG, viewMode: "3d" });
      r.render(ballGraph(n));
      ctx.fills.length = 0; ctx.strokes.length = 0;
      frame();
      settle();
      body({ r, viewport: host.firstElementChild as HTMLElement, painted, p: camPriv(r) });
    } finally {
      r.destroy();
      host.remove();
      Object.assign(BOX, restoreBox);
    }
  }
  /** The zoom-in stop: 10 wheel notches is 100% → 0% (ZOOM_STEP_PCT is 10). */
  function toDeepestStop(viewport: HTMLElement) {
    wheelIn(viewport, 10, { x: BOX.width / 2, y: BOX.height / 2 });
    settle(200);
  }

  it("still paints real note glyphs at MAXIMUM zoom in 3D — a live field at the deepest stop", () => {
    // A guard, and honestly labelled as one: it fires on a BLANK deep end, which is the catastrophic
    // shape, but it is NOT what separates this camera from the naive `zc = z2 + dollyForT(t, P)`
    // stacked on the res-scaled world. That was measured rather than assumed, and the prediction did
    // not hold: the naive double-dolly does not blank a 3D field, it DEGRADES it — 33 nodes on grid
    // against this camera's 43 on the ball below, and 2 against 3 on the 24-note ring, because the
    // half of a cloud that is behind the camera compresses toward the vanishing point instead of
    // disappearing. What actually separates the two is the ~17x over-magnification, and the test that
    // catches it is "caps the approach at the camera ceiling" below (which fails under both the naive
    // form and every partial version of it). Kept because a blank deep end is still the failure worth
    // a named gate, and because a bare paint count is what MERGE-NOTES §6 asked this step to prove.
    withBall({ width: 320, height: 220 }, ({ viewport, painted, p }) => {
      assertDeepLadder(p);
      ctx.fills.length = 0;
      toDeepestStop(viewport);
      expect(p.res).toBeCloseTo(p.maxRes, 6);            // we really are at the 0% stop
      const onGrid = p.nodes.filter((nv) => nv.onGrid).length;
      expect(onGrid).toBeGreaterThan(20);                // measured 43 of 300
      expect(painted.at(-1)!).toBeGreaterThan(20);       // measured 40 node CELLS
      expect(ballNodeRuns().length).toBeGreaterThan(0);  // ...and they are real note glyphs, in a community colour
    });
  });

  it("caps the approach at the camera ceiling on a deep ladder — the ladder alone would stand on the near plane", () => {
    // maxRes 19.7 asks for 19.7x at the deepest stop, which is a dolly of P*(1 - 1/19.7) = 0.949*P —
    // past the 0.94*P Canvas's own wheel clamp stopped at, and heading for the P*0.985 singularity.
    // dollyForT is that clamp: the achieved magnification is MAX_MAGNIFICATION, not maxRes.
    withBall({ width: 320, height: 220 }, ({ viewport, p }) => {
      assertDeepLadder(p);
      toDeepestStop(viewport);
      const dollies = recoveredDollies(p);
      const spread = Math.max(...dollies) - Math.min(...dollies);
      expect(spread).toBeLessThan(1e-6);                 // one camera, not a per-node fudge
      const mag = p.P / (p.P - dollies[0]);
      expect(mag).toBeCloseTo(ceilingMag(p.P), 6);       // 16.667x — Canvas's stop
      expect(mag).toBeCloseTo(MAX_MAGNIFICATION, 6);     // ...which at this P is the asymptotic value
      expect(mag).toBeLessThan(p.maxRes);                // ...strictly short of what the ladder asked for
      expect(dollies[0]).toBeLessThan(p.P * MAX_ZOOM_FRAC + 1e-9);
    });
  });

  it("approaches MONOTONICALLY across the ladder — every stop moves the camera further in, none past the ceiling", () => {
    // The endpoint tests either side of this one pin where the approach STARTS and STOPS; this pins
    // that it is an approach at all rather than a jump. It is also the only thing standing between a
    // correct camera and one that ignores `t` and applies the full ceiling at every stop — which is
    // invisible at the deepest stop (where the full ceiling is the right answer) and invisible on a
    // shallow ladder (where `res` caps it anyway), i.e. invisible to every other test here.
    withBall({ width: 320, height: 220 }, ({ viewport, p }) => {
      assertDeepLadder(p);
      let prevDolly = -Infinity, prevShortfall = -Infinity;
      for (let step = 0; step <= 10; step++) {
        if (step > 0) { wheelIn(viewport, 1, { x: BOX.width / 2, y: BOX.height / 2 }); settle(200); }
        const dolly = recoveredDollies(p)[0];
        expect(dolly).toBeGreaterThan(prevDolly);
        prevDolly = dolly;
        const mag = p.P / (p.P - dolly);
        expect(mag).toBeLessThanOrEqual(ceilingMag(p.P) + 1e-9);   // never past Canvas's stop
        expect(mag).toBeLessThanOrEqual(p.res + 1e-9);             // never more than the ladder asked for
        // On a ladder DEEPER than the ceiling, the shortfall between what the ladder asks for and
        // what a perspective camera can safely give must open GRADUALLY, one stop at a time — a
        // camera that saturates at its stop early and then sits there gives a shortfall that is flat
        // and then jumps, and reads as the approach simply ending partway down the wheel. (This is
        // also the only assertion in the file that separates a `t`-driven ceiling from a constant
        // one: at the deepest stop, and anywhere on a shallow ladder, the two agree exactly.)
        if (step > 0) expect(p.res / mag).toBeGreaterThan(prevShortfall);
        prevShortfall = p.res / mag;
      }
      expect(prevShortfall).toBeGreaterThan(1.1);   // measured 1.18 = maxRes / MAX_MAGNIFICATION
    });
  });

  it("takes the LADDER's magnification, not the ceiling's, wherever the ladder asks for less", () => {
    // The same graph in a full-size box: maxRes falls to the MIN_ZOOM_SPAN floor of 8, well under the
    // 16.667x ceiling, so the camera must deliver exactly 8x at the deepest stop — NOT 16.667x, which
    // would zoom a small graph past its own 0% resolution law for no reason.
    withBall(null, ({ viewport, p }) => {
      assertShallowLadder(p);
      toDeepestStop(viewport);
      const mag = p.P / (p.P - recoveredDollies(p)[0]);
      expect(mag).toBeCloseTo(p.res, 6);
      expect(mag).toBeLessThan(ceilingMag(p.P));
    });
  });

  it("reproduces the pre-camera projection EXACTLY on a shallow ladder — every drawn position and every cull", () => {
    // The no-regression claim, against an independent re-implementation of the projection as it was
    // (see preDollyProjection). Scaling the world by k about the target IS a dolly of P*(1 - 1/k), so
    // where the ceiling does not bind the two must agree to the last few bits — including projValid,
    // which is the half a near plane pinned to P (instead of to the camera's working distance) would
    // silently tighten as the camera comes in.
    //
    // POSITIONS are compared only for nodes the renderer considers drawable. Past the near plane both
    // projections saturate on `Math.max(1, P - zc)`, a clamp that is NOT scale-equivariant, so the two
    // legitimately diverge there — on coordinates no glyph, edge or label ever reads. `projValid`
    // itself is compared over EVERY node, so "drawable" cannot quietly shrink to nothing.
    withBall(null, ({ viewport, p }) => {
      assertShallowLadder(p);
      let comparedTotal = 0;
      for (let step = 0; step <= 10; step++) {
        if (step > 0) { wheelIn(viewport, 1, { x: BOX.width / 2, y: BOX.height / 2 }); settle(200); }
        const want = preDollyProjection(p);
        let maxDelta = 0, cullMismatches = 0, compared = 0;
        for (let i = 0; i < p.nodes.length; i++) {
          if (p.nodes[i].projValid !== want[i].projValid) cullMismatches++;
          if (!want[i].projValid) continue;
          compared++;
          // Off-screen-but-valid nodes carry large coordinates, so compare RELATIVE to their own size.
          const scale = Math.max(1, Math.abs(want[i].sx), Math.abs(want[i].sy));
          maxDelta = Math.max(maxDelta, Math.abs(p.nodes[i].sx - want[i].sx) / scale,
            Math.abs(p.nodes[i].sy - want[i].sy) / scale);
        }
        expect(cullMismatches).toBe(0);
        expect(maxDelta).toBeLessThan(1e-9);
        expect(compared).toBeGreaterThan(150);           // measured 207-300 of 300 across the ladder
        comparedTotal += compared;
      }
      expect(comparedTotal).toBeGreaterThan(2000);
    });
  });

  it("THE LAW through the approach: the camera moves a long way in, the type does not move at all", () => {
    // A dolly moves POSITIONS. The THE LAW tests above pin type size across a wheel zoom in 2D, where
    // there is no camera at all; this pins it across the 3D approach, and pins in the same breath that
    // the camera really did travel (otherwise "the type didn't change" is satisfied by a camera that
    // never moved, which is the state this task started from).
    withBall({ width: 320, height: 220 }, ({ viewport, p }) => {
      expect(recoveredDollies(p)[0]).toBeCloseTo(0, 6);   // fit: no dolly, by construction
      const fontAtFit = ctx.font;
      const spacingAtFit = ctx.letterSpacing;
      const fontsBefore = ctx.fonts.length;
      toDeepestStop(viewport);
      expect(recoveredDollies(p)[0]).toBeGreaterThan(p.P * 0.9); // the camera crossed 90% of the way in
      expect(ctx.font).toBe(fontAtFit);
      expect(ctx.letterSpacing).toBe(spacingAtFit);
      // ...and no DIFFERENT size was ever set mid-glide, only the same one re-asserted.
      expect(new Set(ctx.fonts.slice(fontsBefore))).toEqual(new Set([fontAtFit]));
    });
  });

  it("frameSubset asks for a MAGNIFICATION and gets it in 3D, not merely the matching resolution stop", () => {
    // Canvas's frameSubset set a dolly; ASCII's set a resolution. Unified, the request is a
    // magnification and each mode converts. On a deep ladder the two conversions differ: the
    // resolution stop that NUMERICALLY equals the wanted magnification delivers LESS than it, because
    // the camera ceiling caps `maxRes^t` at `maxZs^t`. Routing through zoomT (cameraModel's exact
    // inverse of dollyForT) is what closes that gap.
    withBall({ width: 320, height: 220 }, ({ r, p }) => {
      assertDeepLadder(p);
      // A SPATIALLY TIGHT subset — the 6 notes nearest n0, on a DENSER ball (700, see the trailing arg) — so the framing request is a real
      // magnification. (A subset sampled across the whole ball has the ball's own radius, i.e. asks
      // to zoom OUT, which would make this test pass on any implementation at all.)
      const anchor = p.nodes[0].p3;
      const subset = [...p.nodes]
        .sort((a, b) => Math.hypot(a.p3[0] - anchor[0], a.p3[1] - anchor[1], a.p3[2] - anchor[2])
          - Math.hypot(b.p3[0] - anchor[0], b.p3[1] - anchor[1], b.p3[2] - anchor[2]))
        .slice(0, 6);
      const pts = subset.map((nv) => nv.p3);
      const c = [0, 1, 2].map((k) => pts.reduce((a, q) => a + q[k], 0) / pts.length);
      let rad = 1e-6;
      for (const q of pts) rad = Math.max(rad, Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]));
      // `whole` mirrors graphFit's boundingRadius (max |p3|) — the same quantity frameSubset divides by.
      const whole = Math.max(...p.nodes.map((nv) => Math.hypot(nv.p3[0], nv.p3[1], nv.p3[2])));
      const wantMag = (whole / rad) * 0.55;
      // Measured 3.36x on this fixture (700 notes, maxRes 26.4) — a real zoom-IN request.
      expect(wantMag).toBeGreaterThan(2);                 // a real zoom-IN request
      expect(wantMag).toBeLessThan(ceilingMag(p.P));      // ...and reachable, so a shortfall is a bug, not a clamp

      r.frameSubset(subset.map((nv) => nv.node.id));
      settle(300);
      const mag = p.P / (p.P - recoveredDollies(p)[0]);
      // The only slack is the resolution glide's own settle epsilon; a systematic shortfall (the
      // resolution-only conversion) is ~20% here, an order of magnitude outside this band.
      expect(mag / wantMag).toBeGreaterThan(0.98);
      expect(mag / wantMag).toBeLessThan(1.02);
    }, 700);
  });

  it("resetView returns the camera to the fit distance — the dolly has no state of its own to strand", () => {
    withBall({ width: 320, height: 220 }, ({ r, viewport, p }) => {
      toDeepestStop(viewport);
      expect(recoveredDollies(p)[0]).toBeGreaterThan(p.P * 0.9);
      r.resetView();
      settle(300);
      expect(recoveredDollies(p)[0]).toBeCloseTo(0, 6);
      expect(p.res).toBeCloseTo(1, 6);
    });
  });
});

describe("respace wiring (Task 10) — node-count-independent resting spacing on the deep-zoom ladder", () => {
  /** Independent (re-implemented, NOT imported from respace.ts) median nearest-neighbour distance
   *  over raw 3-tuples — mirrors respace.test.ts's own `measuredSpacing()`, so a bug shared between
   *  the implementation and a test that imported the same helper can't hide from both. */
  function measuredSpacing3(points: readonly [number, number, number][]): number {
    const nn = points.map((p, i) => {
      let best = Infinity;
      points.forEach((q, j) => {
        if (j === i) return;
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (d < best) best = d;
      });
      return best;
    });
    const s = [...nn].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /** Deterministic jittered square lattice (locally uniform density; the jitter breaks the exact
   *  distance ties a bare lattice would have, so a nearest-neighbour swap can't hide behind a tie)
   *  scaled by `unit`. Two calls whose `unit`s differ by a factor model two vaults whose BACKEND
   *  absolute coordinate scale differs by that same factor — exactly what respace.ts's targetSpacing
   *  exists to normalise away (see respace.ts's own header: "regardless of node count or which layout
   *  algorithm produced the input").
   *
   *  `position` (3D) carries a real per-node Z (a checkerboard stagger + its own jitter, both scaled
   *  by `unit`) that `position2d` (always flat, z omitted) does NOT share — so the 3D cloud's own
   *  median nearest-neighbour distance is genuinely LARGER than the 2D cloud's, not just the same XY
   *  shape with a trailing zero. Without this, `raw3` and `raw2` are numerically identical (z=0 for
   *  every node either way), which makes AsciiGraphRenderer.ts's two independent spacing caches
   *  (`p3SpacingCache`/`p2SpacingCache`) indistinguishable from one shared cache — a copy-paste bug
   *  routing the 2D line through `p3SpacingCache` would silently return the (numerically identical)
   *  right answer. With a real Z, that bug instead hands 2D the 3D cloud's positions verbatim
   *  (col 2 code review, task-10 round 2, finding F2). */
  function jitterGrid(size: number, unit: number): ReturnType<typeof sampleGraph> {
    const nodes: ReturnType<typeof sampleGraph>["nodes"] = [];
    const edges: ReturnType<typeof sampleGraph>["edges"] = [];
    const half = (size - 1) / 2;
    const pseudo = (a: number, b: number) => {
      const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const jx = (pseudo(col, row) - 0.5) * 0.3 * unit;
        const jy = (pseudo(row, col + 1000) - 0.5) * 0.3 * unit;
        const jz = (pseudo(col + 2000, row + 2000) - 0.5) * 0.3 * unit;
        const zStagger = ((row + col) % 2) * 0.5 * unit; // checkerboard — 3D's nearest neighbour is
                                                           // still the same grid-adjacent pair as 2D's
                                                           // (diagonal neighbours stay farther even
                                                           // with this added), just at a genuinely
                                                           // larger 3D distance than the flat 2D one.
        const x = (col - half) * unit + jx;
        const y = (row - half) * unit + jy;
        const z = zStagger + jz;
        nodes.push({
          id: `g${row}_${col}`, label: `note ${row} ${col}`, kind: "note" as const,
          position: [x, y, z] as [number, number, number],
          position2d: [x, y] as [number, number],
          community: 0, communityLabel: "grid",
        });
        if (col > 0) edges.push({ from: `g${row}_${col - 1}`, to: `g${row}_${col}`, kind: "link" as const });
        if (row > 0) edges.push({ from: `g${row - 1}_${col}`, to: `g${row}_${col}`, kind: "link" as const });
      }
    }
    return { nodes, edges };
  }

  /** Median nearest-neighbour separation IN GRID CELLS among the currently on-grid nodes (private
   *  per-frame state — see lodPriv()). "cells" is (col,row) distance, the literal grid coordinate
   *  every glyph/label/hit-test in this renderer already keys off. */
  function medianOnGridCellSpacing(p: LodPriv): { count: number; median: number } {
    const onGrid = p.nodes.filter((nv) => nv.onGrid);
    const nn = onGrid.map((a, i) => {
      let best = Infinity;
      onGrid.forEach((b, j) => { if (i === j) return; const d = Math.hypot(a.col - b.col, a.row - b.row); if (d < best) best = d; });
      return best;
    });
    const s = [...nn].sort((x, y) => x - y);
    const mid = s.length >> 1;
    return { count: onGrid.length, median: s.length ? (s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) : NaN };
  }

  /** Same idea as `measuredSpacing3` but over the XY plane only (`p2` always carries z=0) — a
   *  SEPARATE measurement function (not `measuredSpacing3` fed z-zeroed input) for the same
   *  independent-reimplementation reason. */
  function measuredSpacing2(points: readonly [number, number][]): number {
    const nn = points.map((p, i) => {
      let best = Infinity;
      points.forEach((q, j) => {
        if (j === i) return;
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d < best) best = d;
      });
      return best;
    });
    const s = [...nn].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  it("rescales the resting spacing to the 14.0-world-unit calibration target, regardless of the backend's raw density — independently for BOTH p3 and p2", () => {
    // Pins the ABSOLUTE calibration value, not just "consistent across fixtures" — a wrong constant
    // (e.g. targetSpacing 1 instead of 14) would still make two differently-scaled fixtures agree WITH
    // EACH OTHER (any uniform target cancels a uniform input scale identically — see respace.ts's own
    // header), so a test that only compares two fixtures to each other can't catch a wrong absolute
    // number. This measures the OUTPUT's own median nearest-neighbour distance directly against the
    // literal 14.0 the brief requires (asciiGrid.ts DEEPEST_WORLD_PER_CELL's calibration input),
    // independent of anything imported from respace.ts or AsciiGraphRenderer.ts.
    //
    // Checks p2 as well as p3 (not just p3) for the same reason jitterGrid() now carries a real Z: a
    // bug that routes the 2D line through `p3SpacingCache` (task-10 round 2 finding F2) is invisible
    // to a test that only compares two SAME-BUG-affected fixtures to each other (the bug is applied
    // uniformly to both, so they still agree — see the fixture-agreement test's own doc for why that
    // one structurally can't catch this either). p3's own median NN is 14 BY CONSTRUCTION regardless
    // of the bug (scaleToSpacing always hits its target on whatever it's actually given); what the bug
    // corrupts is p2, which would inherit p3's positions (including its z-driven spread) and so measure
    // BELOW 14 on its own XY-only distance once z is dropped — a real, cheap discriminator.
    const graph = jitterGrid(12, 37); // an arbitrary raw scale far from 14 — a no-op wiring bug shows up loudly
    const { r } = mountRenderer("3d", graph); // build() computes BOTH p3 and p2 regardless of viewMode
    const priv = r as unknown as { nodes: { p3: [number, number, number]; p2: [number, number, number] }[] };
    const spacing3 = measuredSpacing3(priv.nodes.map((nv) => nv.p3));
    const spacing2 = measuredSpacing2(priv.nodes.map((nv) => [nv.p2[0], nv.p2[1]]));
    expect(spacing3).toBeCloseTo(14, 0);
    expect(spacing2).toBeCloseTo(14, 0);
    r.destroy();
  });

  it("two fixtures whose RAW backend density differs ~10x land on the SAME median neighbour cell-separation at the deepest (0%) zoom stop", () => {
    // The task's actual acceptance gate (task-10-brief.md): NOT a screenshot. ASCII's fit divides by
    // the cloud's own extents, so it exactly cancels a uniform scale — a fit-zoom (100%) screenshot is
    // byte-identical whether this task is wired or not. What differs, and what this measures, is the
    // DEEP-ZOOM ladder, anchored to the fixed absolute DEEPEST_WORLD_PER_CELL constant.
    const SIZE = 45;
    const dense = jitterGrid(SIZE, 1.4);
    const sparse = jitterGrid(SIZE, 14); // exactly 10x the dense fixture's raw lattice spacing
    expect(14 / 1.4).toBeCloseTo(10, 6); // sanity: the fixtures really are ~10x apart before any rescale

    const { r: rDense, viewport: vDense } = mountRenderer("2d", dense);
    const { r: rSparse, viewport: vSparse } = mountRenderer("2d", sparse);
    wheelIn(vDense, 20); settle(400);   // saturate at the 0% (deepest) floor
    wheelIn(vSparse, 20); settle(400);

    const camDense = rDense as unknown as { zoomPct: number };
    const camSparse = rSparse as unknown as { zoomPct: number };
    expect(camDense.zoomPct).toBe(0);   // sanity: both actually reached the deepest stop
    expect(camSparse.zoomPct).toBe(0);

    const spacingDense = medianOnGridCellSpacing(lodPriv(rDense));
    const spacingSparse = medianOnGridCellSpacing(lodPriv(rSparse));
    expect(spacingDense.count).toBeGreaterThan(2);   // enough on-grid neighbours for a real median
    expect(spacingSparse.count).toBeGreaterThan(2);

    expect(spacingSparse.median).toBeCloseTo(spacingDense.median, 6);

    rDense.destroy(); rSparse.destroy();
  });

  it("wires the per-signature spacing cache with a real clone, not identity — a later hit is unaffected by mutating an earlier return", () => {
    // The specific footgun respace.ts's own docs call out by name: passing an identity clone for a
    // reference type (Vec3[]) silently reinstates the exact position-corruption hazard the cache
    // exists to prevent (the 2D<->3D morph a future task wires would lerp p2/p3 in place every frame).
    // This exercises the ACTUAL cache instance AsciiGraphRenderer constructs (not a fresh
    // createSpacingCache() call of the test's own), so a wiring bug — e.g.
    // createSpacingCache((v) => v) instead of createSpacingCache(cloneVec3Array) — fails HERE.
    const { r } = mountRenderer("3d", sampleGraph());
    const priv = r as unknown as {
      p3SpacingCache: { getOrCompute(sig: string, compute: () => [number, number, number][]): [number, number, number][] };
    };
    const sig = "respace-wiring-probe";
    const first = priv.p3SpacingCache.getOrCompute(sig, () => [[1, 2, 3]]);
    first[0][0] = -9999; // mutate the CALLER's own copy, as a future per-frame morph would
    const second = priv.p3SpacingCache.getOrCompute(sig, () => { throw new Error("must be a cache hit"); });
    expect(second).toEqual([[1, 2, 3]]); // untouched by the mutation above
    r.destroy();
  });

  it("build() actually ROUTES THROUGH the spacing cache — revisiting a structural signature is a cache hit, not a recompute", () => {
    // The previous test proves the CACHE OBJECT clones correctly in isolation (calling getOrCompute
    // directly with a synthetic signature) — it does NOT prove build() itself ever calls getOrCompute
    // at all. A wiring regression that constructs the caches but calls scaleToSpacing directly
    // (bypassing them entirely) produces the exact same final positions every time, so it passes every
    // other test in this file — the brief's own words: "wire it behind the existing structural
    // signature ... do not call it uncached in a per-frame path" (task-10-brief.md). This counts real
    // scaleToSpacing invocations by wrapping the ACTUAL cache instances' getOrCompute, then revisits a
    // structural signature (A -> B -> A) across three render()s: only the FIRST two should ever reach
    // a genuine compute — the third, revisiting A, must be a hit.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new AsciiGraphRenderer();
    r.mount(host, () => {});
    r.setConfig({ ...CONFIG, viewMode: "3d" });

    const priv = r as unknown as {
      p3SpacingCache: { getOrCompute(sig: string, compute: () => unknown): unknown };
      p2SpacingCache: { getOrCompute(sig: string, compute: () => unknown): unknown };
    };
    let p3Computes = 0, p2Computes = 0;
    const countCompute = (
      cache: { getOrCompute(sig: string, compute: () => unknown): unknown },
      onCompute: () => void,
    ) => {
      const orig = cache.getOrCompute.bind(cache);
      cache.getOrCompute = (sig, compute) => orig(sig, () => { onCompute(); return compute(); });
    };
    countCompute(priv.p3SpacingCache, () => { p3Computes++; });
    countCompute(priv.p2SpacingCache, () => { p2Computes++; });

    const graphA = sampleGraph();
    const graphB = lodGraph(); // a genuinely different structural signature
    r.render(graphA);
    r.render(graphB);
    r.render(graphA); // revisits A's signature — must be a Map lookup, not an O(n²) remeasure
    expect(p3Computes).toBe(2); // A (miss) + B (miss) — NOT a third for revisiting A
    expect(p2Computes).toBe(2);
    r.destroy();
  });

  /** A single horizontal chain (evenly-spaced along X, Y and Z both flat) scaled by `unit`. Every
   *  interior node's nearest neighbour is unambiguous and lies purely along the COLUMN axis, so the
   *  grid Δcol between neighbours at the deepest zoom stop is a clean, directly-computable number —
   *  the exact join between respace.ts's RESPACE_TARGET_SPACING and asciiGrid.ts's
   *  DEEPEST_WORLD_PER_CELL (see the test below). */
  function chainGraph(n: number, unit: number): ReturnType<typeof sampleGraph> {
    const nodes: ReturnType<typeof sampleGraph>["nodes"] = [];
    const edges: ReturnType<typeof sampleGraph>["edges"] = [];
    const half = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const x = (i - half) * unit;
      nodes.push({
        id: `c${i}`, label: `note ${i}`, kind: "note" as const,
        position: [x, 0, 0] as [number, number, number],
        position2d: [x, 0] as [number, number],
        community: 0, communityLabel: "chain",
      });
      if (i > 0) edges.push({ from: `c${i - 1}`, to: `c${i}`, kind: "link" as const });
    }
    return { nodes, edges };
  }

  it("pins the calibration JOIN between RESPACE_TARGET_SPACING and asciiGrid.ts's DEEPEST_WORLD_PER_CELL: median neighbour Δcol at the deepest stop is 35", () => {
    // task-10 round 2, finding F3: the previous two tests each pin ONE end of the calibration link
    // (the fixture-agreement test compares two fixtures only to each other; the absolute-14 test
    // measures p3/p2 WORLD coordinates with no reference to asciiGrid.ts at all) — neither references
    // the deep-zoom ladder itself, so the actual JOIN (RESPACE_TARGET_SPACING=14.0 divided by
    // asciiGrid.ts's DEEPEST_WORLD_PER_CELL=0.4, the whole reason 14.0 was chosen) was untested.
    // Mutating DEEPEST_WORLD_PER_CELL (0.4 -> 0.8, halving deep-zoom detail — the exact regression its
    // own comment warns about) previously left every existing test green.
    //
    // 35 is a LITERAL, independently-hardcoded expectation (14.0 / 0.4 computed by hand, NOT by
    // importing and dividing the live source constants) — deliberately not derived from
    // DEEPEST_WORLD_PER_CELL at test time, because computing "expected" from the very constant a
    // mutation changes would make expected drift together with actual and the test could never fail
    // (the exact self-referential trap this whole test exists to avoid). If either constant
    // intentionally moves, this literal must be updated by hand in lockstep — same discipline
    // asciiGrid.ts:293's own comment already demands of MIN_ZOOM_SPAN and the RING_SCALE test const.
    const CHAIN_N = 100; // long enough that maxRes is derived from the ABSOLUTE target, not floored
                          // at MIN_ZOOM_SPAN (verified empirically — see the maxRes sanity check below)
    const graph = chainGraph(CHAIN_N, 37); // raw unit is arbitrary; respace normalises it away
    const { r, viewport } = mountRenderer("2d", graph);
    // try/finally: this test's whole POINT is to fail under a live mutation (see the mutation-testing
    // note in task-10-report.md). A renderer whose `destroy()` never runs (because an assertion above
    // it threw first) leaves its window-level listeners AND its self-re-arming rAF tick alive for the
    // rest of the file's test run — a real cross-test pollution hazard verified while writing this
    // test (a mutated DEEPEST_WORLD_PER_CELL made an unrelated LATER "vector-edge fidelity" hover test
    // see 4 batched strokes instead of 2, from this test's own never-destroyed renderer still reacting
    // to a later window pointermove and repainting into the shared fake canvas context). Every other
    // `it()` in this file destroys at the very end with no such guarantee — harmless there only because
    // none of them are EXPECTED to fail under a deliberate mutation the way this one specifically is.
    try {
      const cam = r as unknown as { maxRes: number };
      expect(cam.maxRes).toBeGreaterThan(8); // sanity: NOT floored at MIN_ZOOM_SPAN (asciiGrid.ts's floor)

      wheelIn(viewport, 12); settle(300); // saturate at the 0% (deepest) floor
      expect((r as unknown as { zoomPct: number }).zoomPct).toBe(0);

      const p = lodPriv(r);
      const onGridCols = p.nodes.filter((nv) => nv.onGrid).map((nv) => nv.col).sort((a, b) => a - b);
      expect(onGridCols.length).toBeGreaterThan(2); // enough neighbours for a real median
      const deltas = onGridCols.slice(1).map((c, i) => c - onGridCols[i]);
      const sorted = [...deltas].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      const medianDeltaCol = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      expect(medianDeltaCol).toBeCloseTo(35, 0);
    } finally {
      r.destroy();
    }
  });

  it("honours respace.ts's OTHER caller-side contract: daemon/cron/process graphs are recentred but NOT rescaled", () => {
    // respace.ts's header names two caller-side contracts. The self-pin is moot (dead code — see the
    // comment above raw3/raw2's construction in AsciiGraphRenderer.ts). The SECOND one — "don't call
    // scaleToSpacing at all for a graph that arrived pre-laid-out" — was initially skipped without
    // comment (task-10 round 2 review). CanvasGraphRenderer.ts's hasIntentionalLayoutKind() (`:667-668`)
    // skips its OWN rescale for agent/daemon/cron/process graphs: their absolute spacing is chosen by
    // their own layout (a hub-and-spoke daemon tree sized to read at a specific zoom), not the
    // backend's PivotMDS packing scaleToSpacing's 14.0 target was calibrated against. Honoured here by
    // feeding scaleToSpacing a non-positive targetSpacing for those graphs — its own documented
    // "recenter only, scale=1" fallback — rather than skipping the call outright (one call site, one
    // cache, instead of forking a second code path).
    const RAW_UNIT = 5; // deliberately far from RESPACE_TARGET_SPACING (14) — a rescale bug is loud
    const cronGraph = {
      nodes: [
        { id: "d0", label: "daemon", kind: "cron", position: [0, 0, 0], position2d: [0, 0] },
        { id: "d1", label: "cron a", kind: "cron", position: [RAW_UNIT, 0, 0], position2d: [RAW_UNIT, 0] },
        { id: "d2", label: "cron b", kind: "cron", position: [0, RAW_UNIT, 0], position2d: [0, RAW_UNIT] },
        { id: "d3", label: "cron c", kind: "cron", position: [-RAW_UNIT, 0, 0], position2d: [-RAW_UNIT, 0] },
      ],
      edges: [
        { from: "d0", to: "d1", kind: "supervises" },
        { from: "d0", to: "d2", kind: "supervises" },
        { from: "d0", to: "d3", kind: "supervises" },
      ],
    };
    const { r } = mountRenderer("3d", cronGraph as unknown as ReturnType<typeof sampleGraph>);
    try {
      const priv = r as unknown as { nodes: { p3: [number, number, number] }[] };
      const spacing = measuredSpacing3(priv.nodes.map((nv) => nv.p3));
      // NOT rescaled to 14 — stays at (close to) the RAW unit, since these nodes arrived pre-laid-out.
      expect(spacing).toBeCloseTo(RAW_UNIT, 0);
      expect(spacing).not.toBeCloseTo(14, 0);
      // Still RECENTRED, though — the hub (originally at the origin) should sit near the cloud's own
      // centroid-relative origin, same as any other graph (respace's degenerate-target fallback still
      // subtracts the mean, it just skips the scale).
      let cx = 0, cy = 0, cz = 0;
      for (const nv of priv.nodes) { cx += nv.p3[0]; cy += nv.p3[1]; cz += nv.p3[2]; }
      cx /= priv.nodes.length; cy /= priv.nodes.length; cz /= priv.nodes.length;
      expect(cx).toBeCloseTo(0, 6);
      expect(cy).toBeCloseTo(0, 6);
      expect(cz).toBeCloseTo(0, 6);
    } finally {
      r.destroy();
    }
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

  // WAS: "draws aggregate connectors between entities at fit — the leaf edge pass never ran",
  // asserting `layerBuf` held at least one LAYER_EDGE cell. Aggregate connectors are VECTOR strokes
  // now (see the GROUP LINES block in AsciiGraphRenderer.ts) — a character is an order of magnitude
  // more ink than a hairline, and at the default 2D view the reference vault's connectors read as a
  // stair-stepped grey scribble across the field. The connectors themselves are unchanged (same
  // pairs, same log-scaled weights, same anchors), so this asserts the same behaviour through the
  // new medium — and strictly more of it: a cell count could not tell WHICH cells, so it passed
  // for any Bresenham line anywhere, whereas this pins the exact endpoints and the exact count.
  it("draws aggregate connectors between entities at fit — vector strokes anchored on the two masses, no grid characters", () => {
    const { r } = mountRenderer("2d", lodGraph(), { showLodMasses: true });
    const p = lodPriv(r);
    // The leaf passes never ran at fit, so every line on the field is an aggregate connector...
    expect([...p.cellNode].every((v) => v < 0)).toBe(true);
    // ...and lodGraph's two TOP communities are joined by 6 real links, i.e. exactly ONE connector.
    const segs = strokeSegs();
    expect(segs.length).toBe(1);
    // It runs between the two masses' own cell centres — where their ink actually sits — pulled back
    // from both by the shared endpoint clearance, exactly as a member edge is: a group line ends on
    // a mass's `@` core glyph, and running through its interior muddies it. The expectation composes
    // the real `trimSegmentForClearance` (unit-tested separately) rather than re-deriving it.
    const flats = new Set<number>();
    for (const v of p.cellEntity) if (v >= 0) flats.add(v);
    const ents = [...flats].map((f) => p.entityFlat[f]);
    expect(ents.length).toBe(2);
    const key = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
    const cxOf = (e: { col: number }) => p.m.padX + e.col * p.m.cellW + p.m.cellW / 2;
    const cyOf = (e: { row: number }) => p.m.padY + e.row * p.m.cellH + p.m.cellH / 2;
    const [ax, ay, bx, by] = trimSegmentForClearance(
      cxOf(ents[0]), cyOf(ents[0]), cxOf(ents[1]), cyOf(ents[1]), 0.55 * p.m.cellW,
    );
    expect([key(segs[0][0], segs[0][1]), key(segs[0][2], segs[0][3])].sort())
      .toEqual([key(ax, ay), key(bx, by)].sort());
    // ...and the trim really moved both ends: an untrimmed line would land ON the cell centres.
    expect([key(segs[0][0], segs[0][1]), key(segs[0][2], segs[0][3])].sort())
      .not.toEqual([key(cxOf(ents[0]), cyOf(ents[0])), key(cxOf(ents[1]), cyOf(ents[1]))].sort());
    // And NO edge of any kind occupies a cell any more — the edge layer is never written.
    expect([...p.layerBuf].every((v) => v !== LAYER_EDGE)).toBe(true);
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
    // WAS: "Still no real notes this far out" (`cellNode` all < 0). 60% is t ≈ 0.4, which sits
    // inside the mass→glyph crossfade [BACKBONE_START_T, +BACKBONE_FADE_SPAN] = [0.32, 0.46]: the
    // children's own MEMBERS have begun emerging through the dissolving masses, which is exactly
    // what drawEntityMasses' "members emerge through the dissolving parent" always described — it
    // just used to happen at FILE_LABEL_REVEAL_T, because masses owned the field until then.
    expect([...p.cellNode].some((v) => v >= 0)).toBe(true);
    // File NAMES are still far off, though — the crossfade to them starts at 0.75.
    expect(ctx.fills.some((f) => f.text.includes("[[note "))).toBe(false);
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

describe("THE THREE-BAND LADDER — far = masses, mid = glyphs + hub-to-hub backbone, near = glyphs + member edges", () => {
  /**
   * A strictly NESTED 4-level hierarchy: 16 leaf groups of 4 notes, whose paths are the group index
   * shifted (`[g>>3, g>>2, g>>1, g]`), giving 2 / 4 / 8 / 16 communities down the ladder. Four levels
   * specifically, because the level BOUNDARIES are `k · revealT / levelCount`: at 4 levels the
   * level-2/3 boundary sits at 0.5625 under `FILE_LABEL_REVEAL_T` (0.75) but at 0.465 under
   * `computeEdgeLevelWeights`' ported Canvas default (0.62), and the whole gap between them lands
   * inside the mid band's plateau — which is what makes "did the caller pass the right revealT?"
   * observable at all. At 2 levels the same disagreement window (0.31 … 0.375) sits under the mass
   * band, where the backbone is barely drawn.
   *
   * The cross-group links are chosen so the connected-PAIR count differs level to level (1 / 3 / 8 /
   * 11) — a backbone drawn at the wrong level then has a different segment count, which is what the
   * revealT test reads. The test asserts that difference rather than trusting it.
   */
  function fourLevelGraph() {
    const nodes = [];
    const edges = [];
    for (let g = 0; g < 16; g++) {
      const path = [g >> 3, g >> 2, g >> 1, g];
      const labels = [`Lzero ${path[0]}`, `Lone ${path[1]}`, `Ltwo ${path[2]}`, `Lthree ${path[3]}`];
      // Each group is a HUB plus three satellites, and the hubs are deliberately packed into the
      // middle while the satellites sit out on a wide ring. Zoom is RESOLUTION on a fixed ladder, so
      // the mid band always shows about the central third of the graph's bounding box, whatever the
      // fixture's absolute scale — the satellites are what set that box, and putting the hubs inside
      // its middle third is the only way to have more than one hub-to-hub line on screen there to
      // assert against. (Inflating the box with far-off outliers does NOT work: maxResFor derives
      // the ladder from the fit scale, so a bigger box buys proportionally more magnification and
      // the clusters come out SMALLER at the same t, not bigger.)
      const hx = ((g % 4) - 1.5) * 11, hy = (Math.floor(g / 4) - 1.5) * 11;
      for (let k = 0; k < 4; k++) {
        const a = ((g * 3 + k) / 48) * Math.PI * 2;
        const x = k === 0 ? hx : Math.cos(a) * 100;
        const y = k === 0 ? hy : Math.sin(a) * 100;
        nodes.push({
          id: `g${g}n${k}`, label: `note ${g}-${k}`, kind: "note" as const,
          position: [x, y, 0] as [number, number, number], position2d: [x, y] as [number, number],
          community: g, communityLabel: `Leaf ${g}`, communityPath: path, communityPathLabels: labels,
        });
      }
      for (let k = 1; k < 4; k++) edges.push({ from: `g${g}n0`, to: `g${g}n${k}`, kind: "link" as const });
    }
    const cross: [number, number][] = [[0, 1], [0, 2], [0, 4], [0, 8], [1, 3], [2, 6], [4, 12], [5, 13], [3, 11], [7, 15], [9, 10]];
    for (const [a, b] of cross) edges.push({ from: `g${a}n0`, to: `g${b}n1`, kind: "link" as const });
    return { nodes, edges };
  }

  interface BandPriv {
    res: number; goalRes: number; maxRes: number;
    cellNode: Int32Array; cellEntity: Int32Array;
    colors: string[]; edgeBaseAlpha: number;
    levelPairs: { a: { col: number; row: number; onGrid: boolean }; b: { col: number; row: number; onGrid: boolean }; count: number }[][];
    m: { cols: number; rows: number; cellW: number; cellH: number; padX: number; padY: number };
  }

  /** Park the camera at an EXACT resolution progress `t` and repaint once. The band boundaries are
   *  constants in `t`, while a wheel notch is a 10% ZOOM STOP — the two do not line up, so wheeling
   *  to "about the mid band" would make every assertion below depend on where the nearest stop
   *  happens to fall. Sets `res` and `goalRes` together so tick()'s glide has nothing left to do. */
  function parkAtT(r: AsciiGraphRenderer, t: number) {
    const cam = r as unknown as { res: number; goalRes: number; maxRes: number; dirty: boolean };
    cam.res = cam.goalRes = resFromT(t, cam.maxRes);
    cam.dirty = true;
    ctx.fills.length = 0;
    ctx.strokes.length = 0;
    frame(9999);
  }

  /** Segments stroked in the --graph-edge colour: the GROUP LINES (aggregate connectors + backbone)
   *  and the real member edges. Deliberately not `strokeSegs()` — the intra-cluster mesh strokes in
   *  each cluster's own colour, and counting it here would blur exactly the distinction under test. */
  const edgeColorSegs = (priv: BandPriv) =>
    ctx.strokes.filter((s) => s.color === priv.colors[9]).flatMap((s) => s.segs);
  /** The exact segment a group line between two CELLS should produce: the two cell centres, pulled
   *  back by the shared endpoint clearance. Composed from the real, separately-unit-tested
   *  `trimSegmentForClearance` rather than re-deriving the arithmetic. */
  const groupSegKey = (priv: BandPriv, aCol: number, aRow: number, bCol: number, bRow: number) => {
    const cx = (c: number) => priv.m.padX + c * priv.m.cellW + priv.m.cellW / 2;
    const cy = (rw: number) => priv.m.padY + rw * priv.m.cellH + priv.m.cellH / 2;
    const [ax, ay, bx, by] = trimSegmentForClearance(cx(aCol), cy(aRow), cx(bCol), cy(bRow), 0.55 * priv.m.cellW);
    return [`${ax.toFixed(2)},${ay.toFixed(2)}`, `${bx.toFixed(2)},${by.toFixed(2)}`].sort().join(" -> ");
  };
  /** The hub-to-hub segments level `L`'s backbone SHOULD have drawn this frame: one per connected
   *  community pair whose two hubs are both on the grid. */
  const expectedBackbone = (priv: BandPriv, L: number) => priv.levelPairs[L]
    .filter((p) => p.a.onGrid && p.b.onGrid)
    .map((p) => groupSegKey(priv, p.a.col, p.a.row, p.b.col, p.b.row))
    .sort();
  /** ...and the ones it actually did. Edge-colour strokes only — the intra-cluster mesh strokes in
   *  each cluster's own colour, and folding it in here would blur the distinction under test. */
  const drawnBackbone = (priv: BandPriv) => edgeColorSegs(priv)
    .map((s) => [`${s[0].toFixed(2)},${s[1].toFixed(2)}`, `${s[2].toFixed(2)},${s[3].toFixed(2)}`].sort().join(" -> "))
    .sort();

  // t = 0.48 sits inside the mid band's PLATEAU (bandsForT → {mass: 0, backbone: 1, member: 0}),
  // and inside the revealT disagreement window described on the fixture above.
  const MID_T = 0.48;

  it("REQUIRED — the mid band rasterizes individual GLYPHS, with no masses left on the field", () => {
    const { r } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    // At fit the far band owns everything: masses, no glyphs. (Establishes that the fixture really
    // does take the LOD path, so the mid-band assertion below is a CHANGE, not the status quo.)
    expect([...priv.cellEntity].some((v) => v >= 0)).toBe(true);
    expect([...priv.cellNode].every((v) => v < 0)).toBe(true);

    parkAtT(r, MID_T);
    // A GLYPH count, not a paint count: `cellNode` is written only by rasterize()'s leaf node pass,
    // one entry per individual note actually on the grid. Masses paint `. o @` too — an ink or fill
    // count would be satisfied by the far band and prove nothing.
    const glyphCells = [...priv.cellNode].filter((v) => v >= 0).length;
    expect(glyphCells).toBeGreaterThan(0);
    // ...and the masses really are gone, which is the other half of "this is the mid band".
    expect([...priv.cellEntity].every((v) => v < 0)).toBe(true);
    r.destroy();
  });

  it("the mid band draws the hub-to-hub BACKBONE instead of the member hairball", () => {
    const { r } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    parkAtT(r, MID_T);

    // Level 2 owns the field at this t (asserted independently in the revealT test below): its
    // connected community pairs, one line each, hub to hub — minus the ones the both-hubs-on-grid
    // cull drops (a group line to an off-frame hub is a line to nowhere; see queueBackbone).
    expect(priv.levelPairs[2].length).toBe(8);
    const visible = expectedBackbone(priv, 2);
    expect(visible.length).toBe(8);                     // every hub is on the grid at this stop
    // Every line runs between two HUBS — not between arbitrary members, and not the filtered
    // member-crossing edges the first attempt at this drew (see buildLevelEdges' doc comment).
    expect(drawnBackbone(priv)).toEqual(visible);
    // The graph has 48 intra-group spokes + 11 cross links = 59 real edges. If the member pass had
    // leaked into this band there would be an order of magnitude more lines here than this — that
    // hairball is precisely what the backbone stands in for.
    expect(edgeColorSegs(priv).length).toBeLessThan(20);
    r.destroy();
  });

  it("a group line whose hub has left the grid is not drawn — a line to nowhere, unlike a member edge", () => {
    // The member-edge pass deliberately keeps an edge with ONE endpoint off-frame (the "edges vanish
    // at deep zoom" fix): the relationship is still readable from the part that crosses the field.
    // A GROUP line is different — it summarizes a whole community that isn't there — and the finest
    // hierarchy levels have hundreds of them, so keeping them fans long lines off every edge of the
    // field. Measured on the reference vault at 50%: ~620 such lines, which is the field-crossing
    // noise the mid band exists to remove.
    const { r, viewport } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    parkAtT(r, MID_T);
    const before = drawnBackbone(priv);
    expect(before.length).toBe(8);

    // Pan far enough that some hubs leave the grid, but not so far that they all do.
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 400, clientY: 300 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 420, clientY: 300 })); // prime past DRAG_THRESHOLD
    frame(10016);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 720, clientY: 300 }));
    ctx.strokes.length = 0;  // only the POST-pan frame's strokes; the recording ctx accumulates
    frame(10032);
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 720, clientY: 300 }));

    const offGrid = priv.levelPairs[2].filter((p) => !p.a.onGrid || !p.b.onGrid);
    expect(offGrid.length).toBeGreaterThan(0);          // the pan really did push hubs off...
    expect(offGrid.length).toBeLessThan(8);             // ...but not all of them
    // Exactly the surviving pairs, and nothing else.
    expect(drawnBackbone(priv)).toEqual(expectedBackbone(priv, 2));
    expect(drawnBackbone(priv).length).toBe(8 - offGrid.length);
    r.destroy();
  });

  it("the NEAR band gives the field back to the real member edges, and the backbone stands down", () => {
    const { r } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    parkAtT(r, 0.99);
    // 59 real edges, every one of them stroked (the budget is 6000 — nothing is thinned here).
    expect(edgeColorSegs(priv).length).toBe(59);
    r.destroy();
  });

  it("the backbone rewires to the finer grouping on the SAME frame node colour and cluster names do — computeEdgeLevelWeights must be passed FILE_LABEL_REVEAL_T, not its ported default", () => {
    const { r } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    parkAtT(r, MID_T);

    // Which level the COLOUR + NAME ladder says owns the field here, from the very function the
    // renderer's colour block and label pass call — not a hardcoded number.
    const alphas = clusterLevelAlphas(MID_T, 4);
    const colourLevel = alphas.indexOf(Math.max(...alphas));
    // The ported Canvas default puts a DIFFERENT level in charge at this t. Without this, the test
    // would pass for either constant and prove nothing — it is what makes MID_T a discriminating
    // sample rather than an arbitrary one.
    const ported = clusterLevelAlphas(MID_T, 4, DEFAULT_LEVEL_REVEAL_T);
    const portedLevel = ported.indexOf(Math.max(...ported));
    expect(portedLevel).not.toBe(colourLevel);
    // ...and the two levels' visible pair sets genuinely differ, so one can be told from the other.
    expect(expectedBackbone(priv, colourLevel).length).toBeGreaterThan(0);
    expect(expectedBackbone(priv, portedLevel)).not.toEqual(expectedBackbone(priv, colourLevel));

    // The backbone drew the COLOUR ladder's level, on this frame — compared as the exact SET of
    // hub-to-hub segments, not a count, so two levels that happened to share a count could not pass
    // for each other.
    expect(drawnBackbone(priv)).toEqual(expectedBackbone(priv, colourLevel));
    expect(drawnBackbone(priv)).not.toEqual(expectedBackbone(priv, portedLevel));
    r.destroy();
  });

  it("the INTRA-CLUSTER MESH strokes each cluster's own colour at INTRA_EDGE_ALPHA, one batch per colour", () => {
    const { r } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    parkAtT(r, MID_T);

    const mesh = ctx.strokes.filter((s) => s.color !== priv.colors[9] && s.segs.length > 0);
    expect(mesh.length).toBeGreaterThan(1);              // batched BY COLOUR, not one bucket for all
    // Exactly one batch per distinct colour — the batching claim, which "some strokes exist" misses.
    expect(new Set(mesh.map((s) => s.color)).size).toBe(mesh.length);
    for (const s of mesh) expect(s.alpha).toBeCloseTo(0.22 * priv.edgeBaseAlpha, 6);
    // Every mesh line is INTRA-community at the level being shown: its endpoints share a colour, and
    // that colour is the batch's own. (A mesh that also drew cross-group edges would be the between-
    // group story told twice, which the group lines above already own.)
    // 49 = the 16 leaf groups' 3 spokes each (48), PLUS exactly one of the 11 cross-group links:
    // g0–g1, the only one whose endpoints fall in the same community AT LEVEL 2 (`g >> 1`, so
    // groups 0 and 1 are both community 0 there). That single edge is what makes the count pin the
    // mesh's LEVEL-sensitivity rather than just its existence — keyed off the leaf level it would be
    // 48, and off no level at all (every edge) it would be 59.
    const meshSegs = mesh.flatMap((s) => s.segs);
    expect(meshSegs.length).toBe(49);
    r.destroy();
  });

  it("mass NAMES keep tracking the field through the mid band, where their masses no longer draw", () => {
    // The cluster-name ladder and the mass band are no longer the same ladder: names ride
    // `clusterLevelAlphas × clusterLabelAlpha` and run until the file-name reveal at 0.75, while the
    // masses themselves are gone by 0.46. `layoutEntityNames` anchors on the ENTITY's projected
    // position, so a level still being NAMED has to still be PROJECTED even though nothing about it
    // is drawn — otherwise the name is placed from a screen position frames or seconds old and sits
    // frozen while the field pans under it.
    const { r, viewport } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv & {
      labels: { text: string; col: number; eyebrow?: boolean }[];
      nodes: { node: { id: string }; col: number }[];
    };
    // Centre on ONE level-2 community first: the mid band's magnification (~2.7x on this fixture's
    // ladder) shows about a third of the graph, and this fixture's level-2 centroids all sit outside
    // that window from the fit camera — with no entity on the grid there is no name to track.
    r.frameSubset(["g4n0", "g5n0"]);
    settle(300);
    parkAtT(r, MID_T);
    const name = () => priv.labels.find((l) => l.eyebrow && l.text.startsWith("LTWO "))!;
    const ref = () => priv.nodes.find((n) => n.node.id === "g5n0")!.col;
    expect(name()).toBeDefined();           // a level-2 name really is on the field at this stop...
    expect([...priv.cellEntity].every((v) => v < 0)).toBe(true); // ...with no mass under it
    const label0 = name().col, node0 = ref();

    // One continuous pan (prime past DRAG_THRESHOLD, then move) — the whole-cell part of which every
    // projection in the frame shares, so the name and the note glyphs must shift by the same amount.
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 400, clientY: 300 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 420, clientY: 300 }));
    frame(10016);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 470, clientY: 300 }));
    frame(10032);
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 470, clientY: 300 }));

    expect(ref() - node0).toBeGreaterThan(0);              // the field really moved
    expect(name().col - label0).toBe(ref() - node0);       // ...and the name moved exactly with it
    r.destroy();
  });

  it("a FORCED file label still draws in the mid band — the file-name pass is gated on glyphs, not on member edges", () => {
    // `layoutLabels`' early return exists because a far-band frame has no note glyphs for a label to
    // point at. Key it off the member-edge alpha instead and the whole file-label pass — including
    // the forced active/hovered/search labels, which draw at alpha 1 regardless of the crossfade —
    // disappears across the entire mid band, where the glyphs it names are plainly on screen.
    const { r } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    r.setActiveFile("g5n0");
    parkAtT(r, MID_T);
    // The unforced crossfade has not started here (fileLabelAlpha(0.48) === 0), so this label is on
    // the field only because it is forced — which is exactly the path the gate would have killed.
    expect(ctx.fills.some((f) => f.text === "[[note 5-0]]")).toBe(true);
    expect(ctx.fills.filter((f) => f.text.startsWith("[[note ")).length).toBe(1);
    r.destroy();
  });

  /** `n` notes with no community at all (so the band ladder degenerates to "member edges own every
   *  stop") and `m` deterministically-chosen edges between them — the dense-graph thinning fixture. */
  function denseEdgeGraph(n: number, m: number) {
    const nodes = [];
    const edges = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      nodes.push({
        id: `n${i}`, label: `note ${i}`, kind: "note" as const,
        position: [Math.cos(a) * 400, Math.sin(a) * 400, 0] as [number, number, number],
        position2d: [Math.cos(a) * 400, Math.sin(a) * 400] as [number, number],
      });
    }
    // A fixed stride walk, so the edge SET is identical between the 2D and 3D mounts below (the
    // per-edge keep rank is a hash of the endpoint ids — the comparison is only meaningful if both
    // renderers are ranking the same edges).
    for (let e = 0; e < m; e++) edges.push({ from: `n${e % n}`, to: `n${(e * 7 + 1 + Math.floor(e / n)) % n}`, kind: "link" as const });
    return { nodes, edges };
  }

  it("adopts the 6000-edge budget: a 4000-edge vault draws every edge, where the old 2600 budget thinned it to ~65%", () => {
    const { r } = mountRenderer("2d", denseEdgeGraph(600, 4000));
    // 4000 < EDGE_BUDGET_2D (6000) → keepFrac is 1 and nothing is thinned. Under the old pair
    // (2600 / 0.12) keepFrac would be max(0.12, 2600/4000) = 0.65, i.e. ~1400 edges silently gone.
    const drawn = r.computeStats().edgesClassified;
    expect(drawn).toBe(4000);
    r.destroy();
  });

  it("...and thins 3D LESS than 2D past the budget — one shared floor could not express that", () => {
    const g = denseEdgeGraph(600, 30000);
    const a = mountRenderer("2d", g);
    const in2d = a.r.computeStats().edgesClassified;
    a.r.destroy();
    const b = mountRenderer("3d", g);
    const in3d = b.r.computeStats().edgesClassified;
    b.r.destroy();
    // 3D's depth-band falloff already thins the far half of the cloud optically, so dropping the
    // same fraction structurally on top of it reads as holes — hence the higher floor.
    // 30000 edges puts 2D on its BUDGET (6000/30000 = 0.2, above EDGE_FLOOR_2D = 0.06) and 3D on its
    // FLOOR (0.45), a 2.25x split. Deliberately not a size where the two land close together: the
    // keep rank is a 1000-bucket hash, so a small gap would be swamped by its ~2% sampling bias, and
    // the test would be asserting noise. Windows are ±8% relative, comfortably wider than that bias
    // and far narrower than the gap between the two constants.
    expect(in2d / 30000).toBeGreaterThan(0.2 * 0.92);
    expect(in2d / 30000).toBeLessThan(0.2 * 1.08);
    expect(in3d / 30000).toBeGreaterThan(0.45 * 0.92);
    expect(in3d / 30000).toBeLessThan(0.45 * 1.08);
    // Restore ONE shared floor (either value) and this inequality is the assertion that goes red:
    // both dimensions would then thin the same graph identically.
    expect(in3d).toBeGreaterThan(in2d * 2);
  });

  it("the intra-cluster MESH fades in WITH the glyphs — it does not pop on at full strength over near-solid masses", () => {
    // `intraOn` only asks whether the leaf pass ran at all, and its threshold (LOD_ALPHA_EPS) is
    // crossed at t ≈ 0.330 — where massAlpha is still 0.985. Stroked at a flat INTRA_EDGE_ALPHA from
    // that instant, the mesh is a full-strength colour-tinted web over near-solid territory masses
    // with no visible glyphs anywhere: a cobweb across the field, exactly the noise the far band
    // exists NOT to have, persisting the whole way across [0.33, 0.46].
    const { r } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    const meshAlpha = () => {
      const m = ctx.strokes.filter((st) => st.color !== priv.colors[9] && st.segs.length > 0);
      return m.length ? m[0].alpha : 0;
    };
    // EARLY_T is deep in the far side of the mass→glyph crossfade — the masses still own ~88% of the
    // field there, which is the whole point of the sample. Asserted, not assumed.
    const EARLY_T = 0.35;
    expect(bandsForT(EARLY_T, 4).massAlpha).toBeGreaterThan(0.8);

    parkAtT(r, EARLY_T);
    const early = meshAlpha();
    parkAtT(r, MID_T);
    const plateau = meshAlpha();

    // Both exact, against `bandsForT` — the band authority — not against anything the renderer says.
    expect(plateau).toBeCloseTo(0.22 * priv.edgeBaseAlpha, 6);
    expect(early).toBeCloseTo(0.22 * priv.edgeBaseAlpha * (1 - bandsForT(EARLY_T, 4).massAlpha), 6);
    // The killer: with no band term these are the SAME number. The mesh is still drawn (it is fading
    // in, not gated off), just far too faint to read as a web over the masses.
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(plateau * 0.25);
    r.destroy();
  });

  it("computeStats separates edges CLASSIFIED from edges STROKED — in the mid band they are nowhere near each other", () => {
    // The classification loop runs before anything reaches strokeEdges(), and the member tier then
    // returns early on `base <= 0.004`. Reporting one number for both is how a QA hook ends up
    // claiming ~4566 lines on a frame that drew ~18.
    const { r } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    parkAtT(r, MID_T);
    const stats = r.computeStats();
    // All 59 real edges survive the budget rank (59 << 6000) and every 2D node is projValid.
    expect(stats.edgesClassified).toBe(59);
    // ...but not one of them is stroked here: 8 backbone lines + the 49 intra-community mesh lines.
    expect(stats.edgesStroked).toBe(8 + 49);
    expect(edgeColorSegs(priv).length).toBe(8);
    // And in the NEAR band the member tier is back, so the two converge on the same order.
    parkAtT(r, 0.99);
    const deep = r.computeStats();
    expect(deep.edgesClassified).toBe(59);
    expect(deep.edgesStroked).toBeGreaterThan(59);   // members + mesh, both drawn
    r.destroy();
  });

  it("group-line and mesh WIDTHS ride the resolution stop, and the mesh honours its ceiling", () => {
    // `lineWidthScale()` is 1 at fit by construction and rises to EDGE_W_MAX / EDGE_W_GAIN at the
    // deepest stop; every ported width constant multiplies it, which is how Canvas's relative
    // weights survive a renderer whose zoom is RESOLUTION and has no magnification scalar at all.
    const { r } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    const meshWidth = () => ctx.strokes.filter((st) => st.color !== priv.colors[9] && st.segs.length > 0)[0]?.width;
    const scaleAt = (t: number) => (EDGE_W_GAIN + (EDGE_W_MAX - EDGE_W_GAIN) * t) / EDGE_W_GAIN;

    parkAtT(r, MID_T);
    expect(meshWidth()).toBeCloseTo(0.3 * scaleAt(MID_T), 6);   // 0.3 = CanvasGraphRenderer.ts:1298
    const midMesh = meshWidth();
    // Deeper: strictly thicker, and then pinned at the 1.1 ceiling rather than running away.
    parkAtT(r, 0.99);
    expect(meshWidth()).toBeGreaterThan(midMesh);
    expect(meshWidth()).toBe(1.1);
    expect(0.3 * scaleAt(0.99)).toBeGreaterThan(1.1);            // the clamp really is what is binding

    // Backbone buckets: `(0.35 + 0.55·wb) × scale`, clamped to [0.25, 2.4], one batch per bucket that
    // actually has a pair in it. Which buckets those are is derived from the real (unit-tested)
    // `edgeWeightBucketRange` against the level's own counts, not assumed.
    parkAtT(r, MID_T);
    const groupWidths = ctx.strokes
      .filter((st) => st.color === priv.colors[9] && st.segs.length > 0)
      .map((st) => st.width).sort((x, y) => x - y);
    const visiblePairs = priv.levelPairs[2].filter((p) => p.a.onGrid && p.b.onGrid);
    const maxCount = priv.levelPairs[2][0].count;
    const wantWidths: number[] = [];
    for (let wb = 0; wb < EDGE_WEIGHT_BUCKETS; wb++) {
      const { lo, hi } = edgeWeightBucketRange(wb, maxCount);
      if (!visiblePairs.some((p) => p.count >= lo && p.count < hi)) continue;
      wantWidths.push(Math.max(0.25, Math.min(2.4, (0.35 + wb * 0.55) * scaleAt(MID_T))));
    }
    expect(wantWidths.length).toBeGreaterThan(1);                // more than one bucket drew
    expect(groupWidths.length).toBe(wantWidths.length);
    groupWidths.forEach((w, i) => expect(w).toBeCloseTo(wantWidths.sort((x, y) => x - y)[i], 6));
    r.destroy();
  });

  /** Three fat communities at fit, wired so ONE connector is heavy (`aggEdgeWeight` ≥
   *  AGG_EDGE_DOUBLE_W) and one is light — the two-tier width the doubled Bresenham trace became. */
  function heavyAndLightConnectorGraph() {
    const nodes = [];
    const edges = [];
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        nodes.push({
          id: `c${c}n${k}`, label: `note ${c}-${k}`, kind: "note" as const,
          position: [(c - 1) * 90 + Math.cos(a) * 12, Math.sin(a) * 12, 0] as [number, number, number],
          position2d: [(c - 1) * 90 + Math.cos(a) * 12, Math.sin(a) * 12] as [number, number],
          community: c, communityLabel: `Group ${c}`,
        });
      }
    }
    // 20 links c0–c1 (the level's maximum, so w = 1), 1 link c1–c2 (w = log1p(1)/log1p(20) ≈ 0.23).
    for (let k = 0; k < 20; k++) edges.push({ from: `c0n${k % 8}`, to: `c1n${(k * 3) % 8}`, kind: "link" as const });
    edges.push({ from: `c1n0`, to: `c2n0`, kind: "link" as const });
    return { nodes, edges };
  }

  it("the heaviest aggregate connector strokes at DOUBLE width — the vector form of the old parallel trace", () => {
    const { r } = mountRenderer("2d", heavyAndLightConnectorGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    // At fit, `lineWidthScale()` is exactly 1, so the widths are the raw constants.
    const batches = ctx.strokes.filter((st) => st.color === priv.colors[9] && st.segs.length > 0);
    expect(batches.length).toBe(2);                              // one heavy connector, one light
    const widths = batches.map((b) => b.width).sort((x, y) => x - y);
    expect(widths).toEqual([0.35, 0.7]);                         // GROUP_W_BASE, and its double
    // The doubling follows the WEIGHT, not the draw order: the wide line is the heavier connector,
    // so it also carries the higher alpha off `AGG_EDGE_ALPHA_MIN`'s ramp.
    const heavy = batches.find((b) => b.width === 0.7)!;
    const light = batches.find((b) => b.width === 0.35)!;
    expect(heavy.alpha).toBeGreaterThan(light.alpha);
    // w = 1 → the ramp's full value. Within one batching step: group-line ALPHAS are deliberately
    // quantized to GROUP_ALPHA_STEPS so a continuous per-connector ramp stays a handful of strokes.
    expect(Math.abs(heavy.alpha - priv.edgeBaseAlpha)).toBeLessThanOrEqual(1 / 24);
    expect(light.alpha).toBeCloseTo(priv.edgeBaseAlpha * (0.35 + 0.65 * (Math.log1p(1) / Math.log1p(20))), 1);
    r.destroy();
  });

  it("the far band is unchanged: masses own the field at fit, and no glyph or member edge is drawn", () => {
    const { r } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv;
    expect([...priv.cellEntity].some((v) => v >= 0)).toBe(true);
    expect([...priv.cellNode].every((v) => v < 0)).toBe(true);
    // The only lines at fit are the level-0 aggregate connectors — one per connected pair of the
    // coarsest level's communities, which for this fixture is exactly one.
    expect(edgeColorSegs(priv).length).toBe(1);
    // ...and no mesh, because there are no glyph clouds to give substance to yet.
    expect(ctx.strokes.filter((s) => s.color !== priv.colors[9] && s.segs.length > 0)).toEqual([]);
    r.destroy();
  });

  it("an aggregate connector to a mass that is no longer on the field is dropped, not left trailing off the edge", () => {
    // Same rule as the backbone's, and the same reason: a connector to a mass with no ink on the
    // grid can only read as a stray diagonal leaving the frame. This is the FAR band, i.e. the app's
    // default 2D view once it is panned at all.
    const { r, viewport } = mountRenderer("2d", fourLevelGraph(), { showLodMasses: true });
    const priv = r as unknown as BandPriv & { entityFlat: { level: number; onGrid: boolean }[] };
    expect(edgeColorSegs(priv).length).toBe(1);
    expect(priv.entityFlat.filter((e) => e.level === 0).every((e) => e.onGrid)).toBe(true);

    // Pan DOWNWARD until one of the two coarsest masses has left the field entirely. Vertically,
    // because this fixture's two level-0 centroids are separated almost purely in y — a horizontal
    // pan takes them off together and there is nothing left to compare against.
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 400, clientY: 300 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 320 }));
    frame(10016);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 520 }));
    ctx.strokes.length = 0;
    frame(10032);
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, clientY: 520 }));

    const level0 = priv.entityFlat.filter((e) => e.level === 0);
    expect(level0.some((e) => !e.onGrid)).toBe(true);   // one really did leave...
    expect(level0.some((e) => e.onGrid)).toBe(true);    // ...and one really is still there
    expect(edgeColorSegs(priv).length).toBe(0);         // ...so the connector between them is gone
    r.destroy();
  });
});

describe("LOD mass names — the CONDITIONAL edge clamp (the parked-label defect on the DEFAULT 2D path)", () => {
  /**
   * Two fat, spatially separated communities. Sizes are chosen deliberately: `massRadii(200, …)`
   * gives `rowR = 3` and `colR = round(3 × CELL_H/CELL_W) = 9`, so `projectEntities`' `onGrid` test
   * (`col >= -drawnColR && col < cols + drawnColR`) admits a mass whose CENTRE is up to NINE columns
   * off the grid. That nine-column band is the entire bug surface: it is where an unconditional
   * clamp parks the name at the edge column while the field keeps sliding under it. A small fixture
   * (`lodGraph`'s 6-note blobs → `colR = 2`) leaves a two-column band, too narrow to sample.
   */
  function fatClusterGraph(mirrored = false) {
    const nodes = [];
    const edges = [];
    const NAMES = ["Region A", "Region B"];
    for (let c = 0; c < 2; c++) {
      for (let k = 0; k < 200; k++) {
        const x = ((c === 0 ? -300 : 300) + (k % 20) * 4) * (mirrored ? -1 : 1);
        const y = Math.floor(k / 20) * 4;
        nodes.push({
          id: `c${c}n${k}`, label: `note ${c}-${k}`, kind: "note" as const,
          position: [x, y, 0] as [number, number, number], position2d: [x, y] as [number, number],
          community: c, communityLabel: NAMES[c],
        });
      }
      // A hub-and-spoke wiring so the community has real degree structure (and so the aggregate
      // connector between the two has something to summarize).
      for (let k = 1; k < 200; k++) edges.push({ from: `c${c}n0`, to: `c${c}n${k}`, kind: "link" as const });
    }
    for (let k = 0; k < 5; k++) edges.push({ from: `c0n${k}`, to: `c1n${k}`, kind: "link" as const });
    return { nodes, edges };
  }

  interface NamePriv {
    entityFlat: { level: number; community: number; col: number; row: number; drawnColR: number }[];
    labels: { text: string; col: number; widthCells: number; eyebrow?: boolean }[];
    m: { cols: number };
  }

  /**
   * One continuous 2D pan gesture in FINE steps (the same technique the hub-anchored path's boundary
   * tests use, and for the same reason: `onPointerMove` only starts panning past DRAG_THRESHOLD, and
   * the field edge is the ONLY place the placement rule can be discontinuous, so a coarse gesture
   * steps clean over it without ever sampling there). Samples the named mass's anchor column and its
   * label's column every frame.
   */
  function massPanSweep(dxPerStep: number, steps: number, community: number, text: string) {
    const { r, viewport } = mountRenderer("2d", fatClusterGraph(dxPerStep < 0), { showLodMasses: true });
    const priv = r as unknown as NamePriv;
    let px = 400, t = 100;
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: px, clientY: 300 }));
    px += 20 * Math.sign(dxPerStep); // prime past DRAG_THRESHOLD
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: px, clientY: 300 }));
    frame((t += 16));

    const samples: { anchorCol: number; labelCol: number | null; w: number | null }[] = [];
    for (let i = 0; i <= steps; i++) {
      if (i > 0) {
        px += dxPerStep;
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: px, clientY: 300 }));
        frame((t += 16));
      }
      const ev = priv.entityFlat.find((e) => e.community === community)!;
      const label = priv.labels.find((l) => l.eyebrow && l.text === text);
      samples.push({ anchorCol: ev.col, labelCol: label ? label.col : null, w: label ? label.widthCells : null });
    }
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: px, clientY: 300 }));
    const cols = priv.m.cols;
    const drawnColR = priv.entityFlat.find((e) => e.community === community)!.drawnColR;
    r.destroy();
    return { samples, cols, drawnColR };
  }

  function assertMassNameClampIsConditional(dxPerStep: number, steps: number, community: number, text: string) {
    const { samples, cols, drawnColR } = massPanSweep(dxPerStep, steps, community, text);

    // SANITY FIRST — every invariant below is vacuous if the sweep never reached the band. The
    // fixture is sized so `drawnColR` is wide enough for the band to be sampled at all; assert the
    // size the reasoning depends on rather than trusting massRadii not to be retuned underneath it.
    expect(drawnColR).toBeGreaterThanOrEqual(6);
    expect(samples.some((s) => s.anchorCol >= 0 && s.anchorCol < cols)).toBe(true);   // anchor was on-grid...
    expect(samples.some((s) => s.anchorCol < 0 || s.anchorCol >= cols)).toBe(true);   // ...and later was not
    expect(samples.filter((s) => s.labelCol != null).length).toBeGreaterThan(5);
    const offGridDrawn = samples.filter((s) => s.labelCol != null && (s.anchorCol < 0 || s.anchorCol >= cols));
    expect(offGridDrawn.length).toBeGreaterThan(0); // the far side of the boundary really was sampled

    // (A) OFF-GRID ANCHORS ARE NOT CLAMPED. Past the edge the name keeps its raw centred column and
    // clips — exactly `anchorCol - floor(w/2)`, no nudging. This is the assertion the unconditional
    // clamp fails: it pins the name to 0 (or cols - w) and holds it there while the anchor slides on.
    for (const s of offGridDrawn) {
      expect(`at anchor ${s.anchorCol}: label ${s.labelCol}`)
        .toBe(`at anchor ${s.anchorCol}: label ${s.anchorCol - Math.floor(s.w! / 2)}`);
    }

    // (B) ON-GRID ANCHORS ARE STILL CLAMPED — the clamp's legitimate job, which (A) must not have
    // deleted. Every drawn name whose anchor is on the grid lies fully inside it.
    const onGridDrawn = samples.filter((s) => s.labelCol != null && s.anchorCol >= 0 && s.anchorCol < cols);
    expect(onGridDrawn.length).toBeGreaterThan(5);
    for (const s of onGridDrawn) {
      expect(s.labelCol!).toBeGreaterThanOrEqual(0);
      expect(s.labelCol! + s.w!).toBeLessThanOrEqual(cols);
    }

    // (C) CONTINUITY. Frame to frame the name may not move further than its anchor did, except for
    // the clamp switching on or off — at most `ceil(w/2)`. The no-teleport bound.
    let worst = { v: 0, at: "" };
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (a.labelCol == null || b.labelCol == null) continue;
      const excess = Math.abs((b.labelCol - a.labelCol) - (b.anchorCol - a.anchorCol)) - Math.ceil(b.w! / 2);
      if (excess > worst.v) worst = { v: excess, at: `frame ${i}: label ${a.labelCol}->${b.labelCol}, anchor ${a.anchorCol}->${b.anchorCol}` };
    }
    expect(`step ${worst.v} ${worst.at}`).toBe("step 0 ");
  }

  it("BOUNDARY CONTINUITY (right edge) — a mass name is never parked at the edge column while its mass keeps panning", () => {
    assertMassNameClampIsConditional(2, 90, 1, "REGION B");
  });

  it("BOUNDARY CONTINUITY (left edge) — same, in the other direction (the left clamp is a separate branch)", () => {
    // MIRRORED fixture, exactly as the hub-anchored pair does it: negating x makes community 1 the
    // one that leads off the LEFT edge, so the `col < 0` branch is the one under test.
    assertMassNameClampIsConditional(-2, 90, 1, "REGION B");
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
    // The child level now owns the field — the coarsest level has fully crossfaded away...
    expect(entityLevelsOnGrid(p)).toEqual(new Set([1]));
    // ...and the click landed ONE level in, not at the leaves. WAS asserted as `cellNode` all < 0,
    // which stopped meaning "not the leaves" once the mass→glyph crossfade moved to [0.32, 0.46]:
    // individual glyphs legitimately emerge through a dissolving mass at this stop. What still
    // separates "one level in" from "straight to the leaves" is the LABEL ladder — file names do
    // not begin crossfading in until FILE_LABEL_REVEAL_T (0.75), well past this boundary.
    expect(ctx.fills.some((f) => f.text.includes("[[note "))).toBe(false);
    expect(ctx.fills.some((f) => f.text.startsWith("BLOB "))).toBe(true);
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
    // of those — QA measured 2 surviving edges at 0%. Edges are vector strokes now, gated on `projValid`
    // alone (exactly the pre-redesign renderer's `onScreen`) — the canvas's own paint-time clip
    // handles the off-field portion, so n0's own local edges should still be numerous.
    r.frameSubset(["n0"]);
    wheelIn(viewport, 30);
    settle(300);
    const stats = r.computeStats();
    expect(stats.zoomPct).toBe(0);
    expect(stats.notesOnScreen).toBeGreaterThanOrEqual(1); // at least the hub itself is on the field
    expect(stats.edgesClassified).toBeGreaterThan(5);
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
      edgeBaseAlpha: number; memberEdgeAlpha: number;
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
    const base = priv.edgeBaseAlpha * priv.memberEdgeAlpha;
    expect(dimStroke.alpha).toBeCloseTo(Math.min(1, base * EDGE_DIM_ALPHA), 5);
    // ...and specifically NOT the node constant (0.28, a past bug reused it — 5.6x too strong).
    expect(dimStroke.alpha).toBeLessThan(base * DIM_ALPHA);

    // The accent (hovered-incident) pass strokes at `base`, not the bare memberEdgeAlpha — they're
    // equal only while edgeBaseAlpha is 1. happy-dom resolves no CSS vars, so this renderer's
    // edgeBaseAlpha is computed off the FALLBACK token table (not 1 — see deriveEdgeBaseAlpha),
    // which is exactly what makes this assertion meaningful: the old bug read alpha===the band alpha
    // (here, exactly 1).
    expect(priv.edgeBaseAlpha).toBeLessThan(1);
    expect(accentStroke.alpha).toBeCloseTo(Math.min(1, base), 5);
    expect(accentStroke.alpha).not.toBeCloseTo(priv.memberEdgeAlpha, 3);
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

