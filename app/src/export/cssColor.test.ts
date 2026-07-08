// app/src/export/cssColor.test.ts
import { test, expect, describe } from "bun:test";
import { isRasterUnsafeColor, colorSrgbToRgb, normalizeCssColor, sanitizeDocColorsForRaster } from "./cssColor";
import { Window } from "happy-dom";

describe("isRasterUnsafeColor", () => {
  test("flags every modern color function html2canvas chokes on", () => {
    expect(isRasterUnsafeColor("color(srgb 0.1 0.2 0.3)")).toBe(true);
    expect(isRasterUnsafeColor("color-mix(in srgb, #fff 42%, transparent)")).toBe(true);
    expect(isRasterUnsafeColor("oklch(0.7 0.1 200)")).toBe(true);
    expect(isRasterUnsafeColor("oklab(0.5 0.05 -0.02)")).toBe(true);
    expect(isRasterUnsafeColor("lab(52% 40 59)")).toBe(true);
    expect(isRasterUnsafeColor("lch(52% 72 50)")).toBe(true);
    expect(isRasterUnsafeColor("light-dark(#fff, #000)")).toBe(true);
  });

  test("passes classic colors through", () => {
    expect(isRasterUnsafeColor("#0D0E16")).toBe(false);
    expect(isRasterUnsafeColor("rgb(13, 14, 22)")).toBe(false);
    expect(isRasterUnsafeColor("rgba(174, 180, 194, 0.22)")).toBe(false);
    expect(isRasterUnsafeColor("hsl(230, 25%, 7%)")).toBe(false);
    expect(isRasterUnsafeColor("rebeccapurple")).toBe(false);
    expect(isRasterUnsafeColor("transparent")).toBe(false);
  });

  test("flags an unsafe color embedded in a longer value (box-shadow)", () => {
    expect(isRasterUnsafeColor("0 2px 8px color(srgb 0 0 0 / 0.4)")).toBe(true);
    expect(isRasterUnsafeColor("0 2px 8px rgba(0, 0, 0, 0.4)")).toBe(false);
  });
});

describe("colorSrgbToRgb (the exact Chrome serialization of computed color-mix)", () => {
  test("opaque color(srgb) -> rgb()", () => {
    expect(colorSrgbToRgb("color(srgb 1 0 0)")).toBe("rgb(255, 0, 0)");
    expect(colorSrgbToRgb("color(srgb 0.05 0.055 0.086)")).toBe("rgb(13, 14, 22)");
  });

  test("alpha channel -> rgba()", () => {
    expect(colorSrgbToRgb("color(srgb 0.682 0.706 0.761 / 0.22)")).toBe("rgba(174, 180, 194, 0.22)");
    expect(colorSrgbToRgb("color(srgb 1 1 1 / 0.5)")).toBe("rgba(255, 255, 255, 0.5)");
  });

  test("percentage channels and alpha", () => {
    expect(colorSrgbToRgb("color(srgb 100% 0% 50% / 50%)")).toBe("rgba(255, 0, 128, 0.5)");
  });

  test("none channels read as 0", () => {
    expect(colorSrgbToRgb("color(srgb none 1 0)")).toBe("rgb(0, 255, 0)");
    expect(colorSrgbToRgb("color(srgb 1 0 0 / none)")).toBe("rgba(255, 0, 0, 0)");
  });

  test("out-of-range channels clamp", () => {
    expect(colorSrgbToRgb("color(srgb 1.2 0.5 0)")).toBe("rgb(255, 128, 0)");
  });

  test("alpha of exactly 1 collapses to rgb()", () => {
    expect(colorSrgbToRgb("color(srgb 0 0 0 / 1)")).toBe("rgb(0, 0, 0)");
  });

  test("whitespace-tolerant", () => {
    expect(colorSrgbToRgb("  color(srgb  0 0 0  /  0.5 )")).toBe("rgba(0, 0, 0, 0.5)");
  });

  test("non-srgb spaces and non-color() strings return null", () => {
    expect(colorSrgbToRgb("color(display-p3 1 0 0)")).toBeNull();
    expect(colorSrgbToRgb("oklch(0.7 0.1 200)")).toBeNull();
    expect(colorSrgbToRgb("rgb(1, 2, 3)")).toBeNull();
    expect(colorSrgbToRgb("#fff")).toBeNull();
  });
});

describe("normalizeCssColor", () => {
  test("safe values pass through verbatim", () => {
    expect(normalizeCssColor("#0D0E16", "rgb(0, 0, 0)")).toBe("#0D0E16");
    expect(normalizeCssColor("rgba(1, 2, 3, 0.5)", "rgb(0, 0, 0)")).toBe("rgba(1, 2, 3, 0.5)");
  });

  test("color(srgb) resolves through the pure parser", () => {
    expect(normalizeCssColor("color(srgb 1 0 0 / 0.25)", "rgb(0, 0, 0)")).toBe("rgba(255, 0, 0, 0.25)");
  });

  test("empty and unresolvable values fall back", () => {
    expect(normalizeCssColor("", "rgb(9, 9, 9)")).toBe("rgb(9, 9, 9)");
    // happy-dom/bun has no real canvas color parsing, so a non-srgb function ends at the fallback.
    expect(normalizeCssColor("oklch(0.7 0.1 200)", "rgb(9, 9, 9)")).toBe("rgb(9, 9, 9)");
  });
});

describe("sanitizeDocColorsForRaster (injected normalizer; happy-dom document)", () => {
  // happy-dom's CSS parser REJECTS `color()`/`color-mix()` values outright (they read back
  // empty), so a real stylesheet can't inject them here. Stub getComputedStyle with a map of
  // per-id computed values instead — exactly what a real browser CSSOM would hand the walk.
  function makeDoc(computed: Record<string, Record<string, string>>): Document {
    const win = new Window();
    const doc = win.document as unknown as Document;
    doc.body.innerHTML = `<p id="mixed">x</p><p id="safe">y</p><p id="shadow">z</p>`;
    (doc.defaultView as any).getComputedStyle = (el: HTMLElement) => ({
      getPropertyValue: (p: string) => computed[el.id]?.[p] ?? "",
    });
    return doc;
  }

  const FIXTURE = {
    mixed: {
      color: "color-mix(in srgb, #fff 60%, transparent)",
      "background-color": "color(srgb 0.05 0.055 0.086 / 0.9)",
    },
    safe: { color: "rgb(1, 2, 3)", "background-color": "rgba(0, 0, 0, 0.5)" },
    shadow: { "box-shadow": "0 2px 8px color(srgb 0 0 0 / 0.4)" },
  };

  test("rewrites unsafe computed colors through the normalizer, leaves safe ones alone", () => {
    const doc = makeDoc(FIXTURE);
    const seen: string[] = [];
    const rewrites = sanitizeDocColorsForRaster(doc, (v) => {
      seen.push(v);
      return "rgb(10, 20, 30)";
    });
    expect(rewrites).toBe(3); // mixed.color + mixed.background-color + shadow.box-shadow
    const mixed = doc.getElementById("mixed")!;
    expect(mixed.style.color).toBe("rgb(10, 20, 30)");
    expect(mixed.style.backgroundColor).toBe("rgb(10, 20, 30)");
    expect(seen.some((v) => v.includes("color-mix"))).toBe(true);
    // The safe element is untouched (no inline style written).
    expect(doc.getElementById("safe")!.style.color).toBe("");
  });

  test("the real normalizer converts a computed color(srgb) inline onto the node", () => {
    const doc = makeDoc(FIXTURE);
    sanitizeDocColorsForRaster(doc); // default normalizeCssColor
    const mixed = doc.getElementById("mixed")!;
    // background-color was `color(srgb …/0.9)` -> pure-parsed to rgba.
    expect(mixed.style.backgroundColor).toBe("rgba(13, 14, 22, 0.9)");
  });

  test("an unsafe box-shadow is dropped rather than crashing the raster", () => {
    const doc = makeDoc(FIXTURE);
    sanitizeDocColorsForRaster(doc, () => "rgb(0, 0, 0)");
    expect(doc.getElementById("shadow")!.style.boxShadow).toBe("none");
  });

  test("no unsafe colors -> zero rewrites (fast path)", () => {
    const doc = makeDoc({ mixed: FIXTURE.safe, safe: FIXTURE.safe, shadow: FIXTURE.safe });
    expect(sanitizeDocColorsForRaster(doc, () => "rgb(0, 0, 0)")).toBe(0);
  });
});
