// app/src/graph/EmbeddedGraph.test.ts
//
// Smoke cover for the ` ```graph ` note block's renderer wiring. The block had NO test at all until
// it was migrated off CanvasGraphRenderer, and the one expectation its code stated in a comment
// ("always-on labels for every node") had never been true.
//
// WHAT THIS DRIVES, AND WHY IT ISN'T A COMPONENT MOUNT. `EmbeddedGraph` is a Solid component and
// Solid components cannot be rendered under `bun test` in this repo: bun resolves `solid-js/web` to
// its SERVER build, so `render()` throws "Client-only API called on the server side" and the JSX
// compiles against `solid-js/jsx-runtime`'s server entry. (That is why there is not one `.test.tsx`
// in the tree.) So the block's two renderer-facing units are exported — `layoutGraphData` and
// `embeddedGraphConfig` — and this file feeds their real output to a real AsciiGraphRenderer in the
// same order `onMount` does. Everything between those two units and the renderer is a `setConfig` /
// `render` pair; what could actually break in the migration is on this side of the seam.
//
// TASK 26 — THIS FILE NEVER ACTUALLY RAN. It originally imported those two exports straight from
// EmbeddedGraph.tsx. That's a DIFFERENT problem than the one described above: even though neither
// export contains a line of JSX, `bun test` still has to pick a JSX transform for the whole .tsx
// file that HOSTS them, and Solid's `jsx:"preserve"` + `jsxImportSource:"solid-js"` isn't an
// executable mode Bun supports — it silently fell back to the classic React runtime and errored
// importing `react/jsx-dev-runtime`, which isn't installed. `bun test app/src/graph` reported this
// as "1 fail / 1 error" — easy to read past in a summary line — and it had that shape from the
// commit that added it (confirmed by checking out 6890c3e and running it there: same failure, zero
// passes). The fix is the import below: `layoutGraphData`/`embeddedGraphConfig` now live in
// embeddedGraphRender.ts, a plain .ts file with no JSX anywhere in it, so no JSX transform is ever
// invoked to load it.
//
// TEST ISOLATION (see AsciiGraphRenderer.test.ts for the full reasoning): Bun loads every
// `bun test app/src` module into ONE process, so the DOM globals go in beforeAll (not at module
// top level) and the two patched prototypes are restored in afterAll.
import { GlobalWindow } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AsciiGraphRenderer } from "./AsciiGraphRenderer";
import { embeddedGraphConfig, layoutGraphData } from "./embeddedGraphRender";
import type { GraphConfig, GraphRenderer } from "./graphRenderer";
import { parseGraphBlock } from "../../../core/src/graphBlock";
import { DEFAULTS } from "../settings";
import { THEMES } from "../themes";
import type { DensityField } from "./densityField";

const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "HTMLDivElement",
  "HTMLCanvasElement", "Text", "Event", "CustomEvent", "MouseEvent", "PointerEvent", "WheelEvent",
  "KeyboardEvent", "getComputedStyle", "DOMRect",
];
const installed: string[] = [];
const saved: Record<string, unknown> = {};
const restore: [Record<string, unknown>, string, unknown][] = [];

// A note-width box, roughly what a `.graph-block-canvas` (height: 320px) gets in a pane.
const BOX = { width: 640, height: 320 };

interface FakeCtx {
  fills: { text: string; x: number; y: number }[];
  /** Ground haloes stroked under the names (see `strokeText` below) — kept out of `fills`. */
  haloes: { text: string; x: number; y: number }[];
  strokes: number;
  font: string;
  letterSpacing: string;
  fillStyle: string;
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
    // The label pass draws a ground HALO under every name (`strokeText`) instead of the opaque plate
    // it used to fill — see AsciiGraphRenderer's label loop. A real 2D context always has this; this
    // stub is the only reason it needs saying. Recorded, not swallowed, so a halo can never be
    // mistaken for a field glyph by `fills`.
    strokeText(t: string, x: number, y: number) { ctx.haloes.push({ text: t, x, y }); },
    haloes: [] as { text: string; x: number; y: number }[],
    lineJoin: "miter", lineCap: "butt",
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

/** A five-box flowchart — the shape a hand-authored block actually is. */
const SOURCE = `capture
triage
write
review: Review it
publish
capture -> triage
triage -> write
write -> review
review -> publish
review -> write
`;

interface Mounted {
  r: GraphRenderer;
  host: HTMLElement;
  viewport: HTMLElement;
  painted: number[];
  blooms: DensityField[];
  clicks: string[];
}

/** Mirrors EmbeddedGraph's onMount + its config createEffect, in that order. */
function mountBlock(source = SOURCE, dim: "2d" | "3d" = "2d", cfgOverride?: Partial<GraphConfig>): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const { spec } = parseGraphBlock(source);
  const data = layoutGraphData(spec);
  const r: GraphRenderer = new AsciiGraphRenderer();
  const painted: number[] = [];
  const blooms: DensityField[] = [];
  const clicks: string[] = [];
  r.mount(host, (id) => clicks.push(id));
  r.setPaintCallback((n) => painted.push(n));
  r.setBloomCallback?.((f) => blooms.push(f));
  r.render(data);
  r.setConfig({ ...embeddedGraphConfig(DEFAULTS.graph, THEMES.ink, dim), ...cfgOverride });
  ctx.fills.length = 0;
  ctx.strokes = 0;
  painted.length = 0;
  blooms.length = 0;
  frame();
  return { r, host, viewport: host.firstElementChild as HTMLElement, painted, blooms, clicks };
}

const nodeIds = (source = SOURCE) => parseGraphBlock(source).spec.nodes.map((n) => n.id);

describe("EmbeddedGraph — the ```graph block on the unified renderer", () => {
  it("paints the whole diagram: one glyph cell per node, plus its edges", () => {
    const { r, painted, viewport } = mountBlock();
    expect(viewport).toBeTruthy();
    // The paint callback counts LAYER_NODE cells — so this is "every box in the fence is on the
    // field", not merely "something was drawn".
    expect(painted.at(-1)).toBe(nodeIds().length);
    expect(ctx.strokes).toBeGreaterThan(0); // the 5 edges are stroked beneath the glyphs
    r.destroy();
  });

  it("names every box at the zoom a block OPENS at", () => {
    // This is the regression the old `graphLabelHubCount: 9999` never prevented: the file-label
    // ladder is zero at fit, and a block always opens at fit.
    const { r } = mountBlock();
    for (const id of nodeIds()) {
      const label = id === "review" ? "[[Review it]]" : `[[${id}]]`;
      expect(ctx.fills.some((f) => f.text === label)).toBe(true);
    }
    r.destroy();
  });

  it("...and would name none of them without the opt-in (but flat graphs always label)", () => {
    // The control. Without this pair the test above passes against a renderer that names everything
    // unconditionally, which would be a knowledge-graph regression rather than a block fix.
    // NOTE: flat graphs (no clustering, levelCount === 0) always label nodes regardless of labelEveryNode,
    // because they have no cluster names to fall back on at low zoom. This flowchart is flat, so labels appear.
    const { r } = mountBlock(SOURCE, "2d", { labelEveryNode: false });
    // Flat graph always labels, even with labelEveryNode: false
    expect(ctx.fills.some((f) => f.text.startsWith("[["))).toBe(true);
    r.destroy();
  });

  it("carries the labels into the block's 3D toggle too", () => {
    const { r, painted } = mountBlock(SOURCE, "3d");
    expect(painted.at(-1)).toBe(nodeIds().length);
    expect(ctx.fills.some((f) => f.text === "[[capture]]")).toBe(true);
    r.destroy();
  });

  it("shows no cluster machinery — a hand-authored block has no communities", () => {
    const { r } = mountBlock();
    // No community data at all: nothing to aggregate into masses, nothing to name a region.
    expect(r.getCommunityCentroids().size).toBe(0);
    // Cluster names are drawn in eyebrow register (upper-cased). Every glyph the field draws is
    // from the degree ramp or a `[[…]]` file label — no `CLUSTER 0`, no territory name.
    const stray = ctx.fills.filter((f) => !f.text.startsWith("[[") && /[A-Z]/.test(f.text));
    expect(stray).toEqual([]);
    r.destroy();
  });

  it("still emits a live atmosphere with no communities to emit from", () => {
    // Task 17 rebuilt the bloom to emit from MASSES in the far band and from glyphs elsewhere. A
    // community-less graph has no masses at any stop, so it exercises only the glyph branch — the
    // path that must not come back empty (an all-zero field is a black atmosphere).
    const { r, blooms } = mountBlock();
    const field = blooms.at(-1)!;
    expect(field).toBeTruthy();
    let peak = 0;
    for (const v of field) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, v); }
    expect(peak).toBeGreaterThan(0);
    const stats = (r as unknown as { computeStats(): { bloomPoints: number; bloomWeight: number } }).computeStats();
    // Measured on the INPUT: buildBloom normalises its peak to 1, so a check on the field alone
    // cannot tell a healthy atmosphere from one built out of nothing.
    expect(stats.bloomPoints).toBe(nodeIds().length);
    expect(stats.bloomWeight).toBeGreaterThan(0);
    r.destroy();
  });

  it("routes a click on a box back as that box's id", () => {
    // The block's SELECT/CONNECT/ERASE tools are all built on onNodeClick, so the hit test landing
    // on the right node is the whole edit surface.
    const { r, clicks, viewport } = mountBlock();
    const p = r as unknown as {
      nodes: { col: number; row: number; onGrid: boolean; node: { id: string } }[];
      m: { padX: number; padY: number; cellW: number; cellH: number };
    };
    const target = p.nodes.find((n) => n.onGrid)!;
    const x = p.m.padX + target.col * p.m.cellW + p.m.cellW / 2;
    const y = p.m.padY + target.row * p.m.cellH + p.m.cellH / 2;
    viewport.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: x, clientY: y, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { button: 0, clientX: x, clientY: y, bubbles: true }));
    expect(clicks).toEqual([target.node.id]);
    r.destroy();
  });

  it("survives an empty fence instead of blanking or throwing", () => {
    const { r, painted } = mountBlock("");
    expect(painted.at(-1) ?? 0).toBe(0);
    r.destroy();
  });
});
