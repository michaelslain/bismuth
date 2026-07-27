// app/src/graph/rendererKind.test.ts
//
// TESTING ONLY module (see rendererKind.ts) — this just proves the kind -> renderer-instance
// factory maps all four harness combinations to the right CLASS. Construction alone (no mount())
// needs no DOM: both renderers' field initializers are plain values/Maps, nothing touches
// document/window until mount() is called.
import { describe, expect, it } from "bun:test";
import { AsciiGraphRenderer } from "./AsciiGraphRenderer";
import { CanvasGraphRenderer } from "./CanvasGraphRenderer";
import { isCanvasKind, isRendererKind, makeRenderer, RENDERER_KIND_OPTIONS, type RendererKind } from "./rendererKind";

describe("makeRenderer", () => {
  it("R1 canvas -> CanvasGraphRenderer, unmodified", () => {
    expect(makeRenderer("canvas")).toBeInstanceOf(CanvasGraphRenderer);
  });

  it("R2 ascii -> AsciiGraphRenderer, unmodified (the default)", () => {
    expect(makeRenderer("ascii")).toBeInstanceOf(AsciiGraphRenderer);
  });

  it("R3 canvas-ascii -> CanvasGraphRenderer (the ASCII mono-stack override is a config flag, not a class change)", () => {
    expect(makeRenderer("canvas-ascii")).toBeInstanceOf(CanvasGraphRenderer);
  });

  it("R4 ascii-canvas -> AsciiGraphRenderer (the LOD-disable override is a config flag, not a class change)", () => {
    expect(makeRenderer("ascii-canvas")).toBeInstanceOf(AsciiGraphRenderer);
  });

  it("always constructs a FRESH instance, never returns a shared singleton", () => {
    expect(makeRenderer("ascii")).not.toBe(makeRenderer("ascii"));
  });
});

describe("isCanvasKind", () => {
  it("is true for the two CanvasGraphRenderer combinations (R1, R3)", () => {
    expect(isCanvasKind("canvas")).toBe(true);
    expect(isCanvasKind("canvas-ascii")).toBe(true);
  });

  it("is false for the two AsciiGraphRenderer combinations (R2, R4)", () => {
    expect(isCanvasKind("ascii")).toBe(false);
    expect(isCanvasKind("ascii-canvas")).toBe(false);
  });
});

describe("isRendererKind", () => {
  it("accepts all four combinations", () => {
    const kinds: RendererKind[] = ["canvas", "ascii", "canvas-ascii", "ascii-canvas"];
    for (const k of kinds) expect(isRendererKind(k)).toBe(true);
  });

  it("rejects anything else (a stale/foreign localStorage value falls back to the ascii default)", () => {
    expect(isRendererKind("webgl")).toBe(false);
    expect(isRendererKind(undefined)).toBe(false);
    expect(isRendererKind(null)).toBe(false);
    expect(isRendererKind(42)).toBe(false);
  });
});

describe("RENDERER_KIND_OPTIONS", () => {
  it("has exactly one toolbar option per kind, R1 through R4 in order", () => {
    expect(RENDERER_KIND_OPTIONS.map((o) => o.label)).toEqual(["R1", "R2", "R3", "R4"]);
    expect(RENDERER_KIND_OPTIONS.map((o) => o.id)).toEqual(["canvas", "ascii", "canvas-ascii", "ascii-canvas"]);
  });

  it("every option carries a non-empty title tooltip", () => {
    for (const o of RENDERER_KIND_OPTIONS) expect(o.title.length).toBeGreaterThan(0);
  });
});
