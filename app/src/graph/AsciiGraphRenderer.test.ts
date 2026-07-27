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
import { AsciiGraphRenderer } from "./AsciiGraphRenderer";
import { CELL_W, LAYER_EDGE } from "./asciiGrid";
import { CLUSTER_LABEL_MAX_CHARS } from "./labelSelection";

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
  fonts: string[];
  font: string;
  letterSpacing: string;
  fillStyle: string;
  globalAlpha: number;
  textBaseline: string;
  textAlign: string;
  setTransform(): void;
  clearRect(): void;
  fillRect(): void;
  fillText(t: string, x: number, y: number): void;
  measureText(s: string): { width: number };
}

/** A 2D context that records what was drawn. Its advance ratio (0.6em) deliberately does NOT equal
 *  the design's 6.3px cell, so applyFont()'s letterSpacing correction is genuinely exercised. */
function makeCtx(): FakeCtx {
  let font = "11.5px monospace";
  const ctx = {
    fills: [] as { text: string; x: number; y: number; color: string }[],
    fonts: [] as string[],
    get font() { return font; },
    set font(v: string) { font = v; ctx.fonts.push(v); },
    letterSpacing: "0px",
    fillStyle: "", globalAlpha: 1, textBaseline: "", textAlign: "",
    setTransform() {},
    clearRect() {},
    fillRect() {},
    fillText(t: string, x: number, y: number) { ctx.fills.push({ text: t, x, y, color: ctx.fillStyle }); },
    measureText(s: string) {
      const px = parseFloat((font.match(/^([\d.]+)px/) ?? ["", "11.5"])[1]);
      const ls = parseFloat(ctx.letterSpacing) || 0;
      return { width: s.length * (px * 0.6 + ls) };
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
  cfgOverrides: Partial<typeof CONFIG & { showLodMasses: boolean; clusterColorsOff: boolean }> = {},
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
// happy-dom resolves no CSS vars, so the renderer falls back to its literal token table — which
// makes the fill colour a reliable way to tell a NODE run (the --graph-0..4 ramp) apart from the
// noise texture and the edges, whose glyph vocabularies overlap ("." "o" "@" are noise chars too).
// Cluster-name LABELS are drawn in this same ramp (by design — "the cluster's ramp color"), so the
// glyph-only regex below is what actually separates a node run from a cluster-name fill sharing
// its color.
const RAMP_COLORS = new Set(["#f0509b", "#9b53e8", "#3f6bf0", "#27c7d9", "#43d49a"]);
const nodeRuns = () => ctx.fills.filter((f) => RAMP_COLORS.has(f.color) && /^[.o@ ]+$/.test(f.text));
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
  it("draws edge runs and the node degree ramp", () => {
    const { r } = mountRenderer("3d");
    const text = allText();
    expect(ctx.fills.length).toBeGreaterThan(0);
    expect(/[-|/\\+]/.test(text)).toBe(true);          // "- | / \" with "+" junctions
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

  it("survives an empty graph — noise field only, no nodes, no clusters", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new AsciiGraphRenderer();
    const painted: number[] = [];
    r.mount(host, () => {});
    r.setPaintCallback((n) => painted.push(n));
    r.setConfig({ ...CONFIG });
    r.render({ nodes: [], edges: [] });
    ctx.fills.length = 0;
    frame();
    expect(painted.at(-1)).toBe(0);
    expect(nodeRuns()).toEqual([]);
    expect(r.getCommunityCentroids().size).toBe(0);
    r.destroy();
  });
});

describe("edge clipping — an edge with an off-field endpoint still draws (the 'edges vanish at deep zoom' fix)", () => {
  it("keeps n0's local edges numerous at maximum zoom, even though most neighbours project off the tiny visible field", () => {
    const { r, viewport } = mountRenderer("2d");
    // frameSubset on n0 ALONE zooms to the maximum resolution centred exactly on it (a 1-point
    // subset has ~zero radius, so the frame ratio saturates at maxRes) — the same deterministic
    // "reach 0%" pattern other tests in this file use. n0 is the 24-spoke hub; every one of its 23
    // neighbours has a real edge to it, and at this resolution almost all of them project well off
    // the field. The OLD rule ("skip an edge unless BOTH endpoints are on-grid") dropped every one
    // of those — QA measured edgesDrawn:2 at 0%. The fix clips each edge to its on-screen portion
    // instead, so n0's own local edges should still be numerous.
    r.frameSubset(["n0"]);
    wheelIn(viewport, 30);
    settle(300);
    const stats = r.computeStats();
    expect(stats.zoomPct).toBe(0);
    expect(stats.notesOnScreen).toBeGreaterThanOrEqual(1); // at least the hub itself is on the field
    expect(stats.edgesDrawn).toBeGreaterThan(5);
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

