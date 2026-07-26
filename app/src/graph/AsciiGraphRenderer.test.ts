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

/** A ring of notes around one high-degree hub, in three communities. */
function sampleGraph() {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    nodes.push({
      id: `n${i}`, label: `note ${i}`, kind: "note" as const,
      position: [Math.cos(a) * 80, Math.sin(a) * 80, ((i % 5) - 2) * 30] as [number, number, number],
      position2d: [Math.cos(a) * 80, Math.sin(a) * 80] as [number, number],
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
const RAMP_COLORS = new Set(["#f0509b", "#9b53e8", "#3f6bf0", "#27c7d9", "#43d49a"]);
const nodeRuns = () => ctx.fills.filter((f) => RAMP_COLORS.has(f.color));
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

  it("names nodes on the grid — labels are cells, not a DOM overlay", () => {
    const { r } = mountRenderer("2d");
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

  it("reads 0% at fit and climbs as the wheel turns", () => {
    const { r, viewport, zooms } = mountRenderer("2d");
    expect(zooms.at(-1)).toBe(0);
    wheelIn(viewport, 10);
    settle();
    expect(zooms.at(-1)!).toBeGreaterThan(0);
    r.destroy();
  });

  it("resetView glides back to fit", () => {
    const { r, viewport, zooms } = mountRenderer("2d");
    wheelIn(viewport, 10);
    settle();
    r.resetView();
    settle(200);
    expect(zooms.at(-1)).toBe(0);
    r.destroy();
  });

  it("frameSubset raises the resolution instead of scaling anything", () => {
    const { r, zooms } = mountRenderer("2d");
    const fontBefore = ctx.font;
    r.frameSubset(["n0", "n1", "n2"]);
    settle(200);
    expect(zooms.at(-1)!).toBeGreaterThan(0);
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
