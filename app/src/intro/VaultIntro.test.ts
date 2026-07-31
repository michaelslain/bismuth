// app/src/intro/VaultIntro.test.ts
//
// Smoke cover for the first-run intro's graph. This is the FIRST screen a new user ever sees, it
// had no test of any kind, and until the renderer merge it had never executed a line of the ASCII
// renderer — so the failure mode this guards against is "the intro shows a blank rectangle and
// nobody finds out for months".
//
// WHAT THIS DRIVES, AND WHY IT ISN'T A COMPONENT MOUNT. `VaultIntro` is a Solid component and Solid
// components cannot be rendered under `bun test` in this repo: bun resolves `solid-js/web` to its
// SERVER build, so `render()` throws "Client-only API called on the server side". (That is why
// there is not one `.test.tsx` in the tree.) So the two things `IntroGraph` actually owns are
// exported — `applyGraphConfig` and the two baked clouds — and this file replays `IntroGraph`'s
// own onMount sequence against a real AsciiGraphRenderer, in order:
//     mount → setBloomCallback → render → applyGraphConfig → setFitMargin → setFrameOffsetY → setVisible
// Get that order or those arguments wrong and the intro is blank; everything else in the component
// is slide chrome.
//
// TEST ISOLATION (see graph/AsciiGraphRenderer.test.ts for the full reasoning): Bun loads every
// `bun test app/src` module into ONE process, so the DOM globals go in beforeAll (not at module top
// level) and the two patched prototypes are restored in afterAll.
import { GlobalWindow } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AsciiGraphRenderer } from "../graph/AsciiGraphRenderer";
import type { GraphRenderer } from "../graph/graphRenderer";
import type { DensityField } from "../graph/densityField";
import { applyGraphConfig, BIG_GRAPH, SMALL_GRAPH } from "./VaultIntro";
import { THEME_NAMES, type ThemeName } from "../themes";
import { NODE_GLYPHS } from "../graph/asciiGrid";
import type { GraphData } from "../../../core/src/graph";

const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "HTMLDivElement",
  "HTMLCanvasElement", "Text", "Event", "CustomEvent", "MouseEvent", "PointerEvent", "WheelEvent",
  "KeyboardEvent", "getComputedStyle", "DOMRect",
];
const installed: string[] = [];
const saved: Record<string, unknown> = {};
const restore: [Record<string, unknown>, string, unknown][] = [];

// The intro's graph layers are full-bleed (`.vi-graph3d { inset: 0 }`), so this is a window.
const BOX = { width: 1440, height: 900 };

interface FakeCtx {
  fills: { text: string; x: number; y: number }[];
  strokes: number;
  font: string;
  letterSpacing: string;
}
function makeCtx(): FakeCtx {
  let font = "11.5px monospace";
  const ctx = {
    fills: [] as { text: string; x: number; y: number }[],
    strokes: 0,
    get font() { return font; },
    set font(v: string) { font = v; },
    letterSpacing: "0px",
    fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, textBaseline: "", textAlign: "",
    setTransform() {}, clearRect() {}, fillRect() {},
    fillText(t: string, x: number, y: number) { ctx.fills.push({ text: t, x, y }); },
    measureText(s: string) {
      const px = parseFloat((font.match(/^([\d.]+)px/) ?? ["", "11.5"])[1]);
      const ls = parseFloat(ctx.letterSpacing) || 0;
      return { width: s.length * (px * 0.6 + ls) };
    },
    beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { ctx.strokes++; },
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

/** The renderer's own per-frame QA snapshot (AsciiGraphStats). `notesOnScreen` is a NODE count,
 *  unlike the paint callback's cell count. */
const statsOf = (r: GraphRenderer) =>
  (r as unknown as { computeStats(): {
    notesOnScreen: number; bloomPoints: number; bloomWeight: number; bloomSdx: number; bloomSdy: number;
  } }).computeStats();

interface Mounted {
  r: GraphRenderer;
  viewport: HTMLElement;
  painted: number[];
  blooms: DensityField[];
}

/** IntroGraph's onMount, verbatim, against a real renderer. */
function mountIntroGraph(
  graph: GraphData, theme: ThemeName = "ink",
  opts: { offsetY?: number; fitMargin?: number; active?: boolean } = {},
): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r: GraphRenderer = new AsciiGraphRenderer();
  const painted: number[] = [];
  const blooms: DensityField[] = [];
  r.mount(host, () => {});
  r.setPaintCallback((n) => painted.push(n));
  r.setBloomCallback?.((f) => blooms.push(f));
  r.render(graph);
  applyGraphConfig(r, theme);
  if (opts.fitMargin) r.setFitMargin(opts.fitMargin);
  r.setFrameOffsetY(opts.offsetY ?? 0);
  r.setVisible(opts.active ?? true);
  ctx.fills.length = 0;
  ctx.strokes = 0;
  painted.length = 0;
  blooms.length = 0;
  frame();
  return { r, viewport: host.firstElementChild as HTMLElement, painted, blooms };
}

describe("VaultIntro — the first-run cloud on the unified renderer", () => {
  it("the two clouds are the fixtures the slides describe", () => {
    // Not decoration: 54 vs 1874 straddles the renderer's 350-node idle-spin cut-off, which is the
    // difference between the theme slide's turning cloud and the "three brains" one holding still.
    expect(SMALL_GRAPH.nodes.length).toBe(55); // 54 + the "you" hub
    expect(BIG_GRAPH.nodes.length).toBe(1875);
    // Positions are BAKED (no force settle, no auto-fit race) — every node must carry one.
    expect(SMALL_GRAPH.nodes.every((n) => n.position && n.position2d)).toBe(true);
  });

  it("paints the theme slide's small cloud", () => {
    const { r, painted } = mountIntroGraph(SMALL_GRAPH);
    // Every node of a 55-node cloud is on the field. `notesOnScreen` counts NODES; the paint
    // callback counts CELLS, and two nodes can land on one cell (this fixture has one such pair),
    // so the two numbers are close but not equal — asserted separately rather than conflated.
    expect(statsOf(r).notesOnScreen).toBe(SMALL_GRAPH.nodes.length);
    expect(painted.at(-1)).toBeGreaterThan(0);
    expect(ctx.strokes).toBeGreaterThan(0); // the link edges too
    r.destroy();
  });

  it("paints the three-brains slide's whole-vault cloud, framed by its own margin + offset", () => {
    const { r, painted } = mountIntroGraph(BIG_GRAPH, "ink", { offsetY: 0.12, fitMargin: 1.55 });
    // 1874 nodes into a 228x50 grid: many share a cell, so the painted count is a large fraction of
    // the field rather than the node count. The number that matters is that it is NOT near-zero —
    // a mis-framed cloud (bad fit margin, offset applied twice) empties the grid.
    expect(painted.at(-1)).toBeGreaterThan(1000);
    r.destroy();
  });

  it("frames the big cloud INSIDE the window — the margin is what keeps it off the edges", () => {
    const extent = (m: Mounted) => {
      const p = m.r as unknown as { nodes: { sx: number; sy: number }[] };
      let minY = Infinity, maxY = -Infinity;
      for (const nv of p.nodes) { minY = Math.min(minY, nv.sy); maxY = Math.max(maxY, nv.sy); }
      return maxY - minY;
    };
    const plain = mountIntroGraph(BIG_GRAPH, "ink", { offsetY: 0.12 });
    const framed = mountIntroGraph(BIG_GRAPH, "ink", { offsetY: 0.12, fitMargin: 1.55 });
    expect(extent(framed)).toBeLessThan(extent(plain)); // 1.55 really is a zoom-out
    expect(extent(framed)).toBeGreaterThan(BOX.height * 0.3); // ...and not a collapse to a dot
    plain.r.destroy(); framed.r.destroy();
  });

  it("shows NO names and no cluster machinery — the intro's nodes are deliberately anonymous", () => {
    // `showGraphLabels: false`. The cloud does carry a community per node (it is what gives the
    // palette slide five colours to show off), so "no communities" is NOT what keeps cluster names
    // off the field — the label gate is. Worth pinning: drop that gate and the first thing a new
    // user sees is a screen captioned CLUSTER 0 … CLUSTER 4.
    expect(SMALL_GRAPH.nodes.some((n) => n.community != null)).toBe(true);
    const { r } = mountIntroGraph(SMALL_GRAPH);
    expect(ctx.fills.length).toBeGreaterThan(0);
    // Every fill is a run of degree-ramp glyphs — no letters of any kind.
    const ramp = new Set<string>([...NODE_GLYPHS, " "]);
    const words = ctx.fills.filter((f) => [...f.text].some((c) => !ramp.has(c)));
    expect(words).toEqual([]);
    r.destroy();
  });

  it("keeps the page background showing through (transparent: true)", () => {
    // The two layers cross-fade; an opaque --graph-bg ground would pulse the whole page background
    // on every slide change.
    const { r, viewport } = mountIntroGraph(SMALL_GRAPH);
    expect(viewport.style.background).toBe("transparent");
    r.destroy();
  });

  it("emits a live atmosphere — the intro's bloom is its only glow", () => {
    // 3D has no mass band at any stop, so this is Task 17's glyph branch alone. An all-zero field
    // is a black screen behind the copy, which is what the intro's whole visual is.
    const { r, blooms } = mountIntroGraph(SMALL_GRAPH);
    const field = blooms.at(-1)!;
    expect(field).toBeTruthy();
    let peak = 0;
    for (const v of field) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, v); }
    expect(peak).toBeGreaterThan(0);
    const stats = statsOf(r);
    expect(stats.bloomPoints).toBe(SMALL_GRAPH.nodes.length);
    expect(stats.bloomWeight).toBeGreaterThan(0);
    // ...spread over the field rather than collapsed into one cell (a spike normalises to a dot).
    expect(stats.bloomSdx).toBeGreaterThan(0.05);
    expect(stats.bloomSdy).toBeGreaterThan(0.05);
    r.destroy();
  });

  it("re-themes live without blanking — every theme in the picker", () => {
    // The theme card click path: applyGraphConfig again on the SAME live renderer. setConfig
    // re-reads tokens, re-measures and re-fits, and a bug there empties the field silently.
    const { r, painted } = mountIntroGraph(SMALL_GRAPH);
    for (const name of THEME_NAMES) {
      applyGraphConfig(r, name);
      frame(1000);
      expect(statsOf(r).notesOnScreen).toBe(SMALL_GRAPH.nodes.length);
      expect(painted.at(-1)).toBeGreaterThan(0);
      // The framing knob must survive a re-config — setConfig calls fit() itself.
      expect((r as unknown as { fitMargin: number }).fitMargin).toBe(1);
    }
    r.destroy();
  });

  it("holds its framing across a re-theme", () => {
    const { r } = mountIntroGraph(BIG_GRAPH, "ink", { offsetY: 0.12, fitMargin: 1.55 });
    const p = r as unknown as { nodes: { sy: number }[]; fitMargin: number; frameOffsetY: number };
    const before = p.nodes.map((n) => n.sy);
    applyGraphConfig(r, "cathode");
    frame(1000);
    expect(p.fitMargin).toBe(1.55);
    expect(p.frameOffsetY).toBe(0.12);
    for (let i = 0; i < p.nodes.length; i++) expect(p.nodes[i].sy).toBeCloseTo(before[i], 6);
    r.destroy();
  });

  it("the inactive layer is paused, and resumes when its slide arrives", () => {
    // Both IntroGraphs mount at once; only the active one may run a rAF loop.
    const { r, painted } = mountIntroGraph(SMALL_GRAPH, "ink", { active: false });
    painted.length = 0;
    frame(1000); frame(2000);
    expect(painted).toEqual([]);
    r.setVisible(true);
    frame(3000);
    expect(painted.at(-1)).toBeGreaterThan(0);
    expect(statsOf(r).notesOnScreen).toBe(SMALL_GRAPH.nodes.length);
    r.destroy();
  });
});
