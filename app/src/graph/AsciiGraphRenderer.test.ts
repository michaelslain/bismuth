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
import { CELL_W } from "./asciiGrid";

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

// The fixture's world coordinates are scaled up 12x from the "natural" ring geometry below (still
// only 24 notes on a small ring) so the graph's bounding radius is big enough, relative to the fixed
// absolute DEEPEST_WORLD_PER_CELL target (asciiGrid.ts), to actually have zoom range to test against
// — fit() normalizes screen layout to a fraction of the box regardless of world scale (see
// AsciiGraphRenderer's zoom law), so this changes NOTHING about on-screen geometry at 100%, only how
// much further there is to zoom toward 0%. Chosen so maxRes lands on a clean, comfortably-settling
// value in both 2D and 3D (see AsciiGraphRenderer.ts fit()/asciiGrid.ts maxResFor).
const RING_SCALE = 12;

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

function mountRenderer(viewMode: "2d" | "3d" = "3d"): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r = new AsciiGraphRenderer();
  const clicks: string[] = [];
  const hovers: (string | null)[] = [];
  const zooms: number[] = [];
  r.mount(host, (id) => clicks.push(id), (n) => hovers.push(n?.id ?? null));
  r.setZoomCallback((p) => zooms.push(p));
  r.setConfig({ ...CONFIG, viewMode });
  r.render(sampleGraph());
  ctx.fills.length = 0;
  frame();
  return { r, viewport: host.firstElementChild as HTMLElement, clicks, hovers, zooms };
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
const wheelIn = (viewport: HTMLElement, times = 10) => {
  for (let i = 0; i < times; i++) viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, cancelable: true }));
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

  it("hover always names the hovered node, even at fit (100% zoom, where non-forced file names are withheld)", () => {
    const { r, hovers } = mountRenderer("2d");
    const run = nodeRuns().find((f) => /[.o@]/.test(f.text));
    expect(run).toBeDefined();
    const p = { x: run!.x + run!.text.search(/[.o@]/) * CELL_W + 1, y: run!.y };
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: p.x, clientY: p.y }));
    expect(hovers.filter(Boolean).length).toBeGreaterThan(0); // sanity: something actually got hovered
    frame();
    expect(ctx.fills.some((f) => f.text.includes("[[note "))).toBe(true); // forced past the reveal gate
    r.destroy();
  });
});

describe("N-level semantic labels — the zoom ladder walks communityPath, coarsest to finest", () => {
  /** Two top-level super-clusters (TOP 0/TOP 1), each split into two finer sub-clusters (SUB
   *  0..3) — a 2-level hierarchy, communityPath/communityPathLabels coarsest-first per graph.ts. */
  function twoLevelGraph() {
    const nodes = [];
    const edges = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const top = i < 12 ? 0 : 1;
      const sub = top * 2 + (i % 2);
      nodes.push({
        id: `n${i}`, label: `note ${i}`, kind: "note" as const,
        position: [Math.cos(a) * 80 * RING_SCALE, Math.sin(a) * 80 * RING_SCALE, ((i % 5) - 2) * 30 * RING_SCALE] as [number, number, number],
        position2d: [Math.cos(a) * 80 * RING_SCALE, Math.sin(a) * 80 * RING_SCALE] as [number, number],
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
    wheelIn(viewport, 2); // two notches = two 10% steps: 100% -> 80%, well inside the finer half of the ladder
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

describe("interaction", () => {
  /** Screen px of a node glyph the renderer actually drew (identified by its cluster colour). */
  function nodeHit(): { x: number; y: number } {
    const run = nodeRuns().find((f) => /[.o@]/.test(f.text));
    expect(run).toBeDefined();
    return { x: run!.x + run!.text.search(/[.o@]/) * CELL_W + 1, y: run!.y };
  }

  it("hovers the node under the cursor, and a click opens it", () => {
    const { r, viewport, clicks, hovers } = mountRenderer("2d");
    const p = nodeHit();
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: p.x, clientY: p.y }));
    expect(hovers.filter(Boolean).length).toBeGreaterThan(0);

    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: p.x, clientY: p.y }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: p.x, clientY: p.y }));
    expect(clicks.length).toBe(1);
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
    const before = allText();
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 400, clientY: 300 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 300, clientY: 250 }));
    ctx.fills.length = 0;
    frame(32);
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 300, clientY: 250 }));
    expect(allText()).not.toBe(before);
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
