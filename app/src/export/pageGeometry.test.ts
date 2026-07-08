// app/src/export/pageGeometry.test.ts
import { test, expect, describe } from "bun:test";
import {
  PAGE_W_PT,
  PAGE_H_PT,
  MARGIN_PT,
  CONTENT_W_PT,
  CONTENT_H_PT,
  PAGE_W_PX,
  pdfSliceMetrics,
  parseRgbColor,
} from "./pageGeometry";

describe("page constants", () => {
  test("US Letter portrait at 72pt/in", () => {
    expect(PAGE_W_PT).toBe(8.5 * 72); // 612
    expect(PAGE_H_PT).toBe(11 * 72); // 792
  });

  test("1 inch margin on every side", () => {
    expect(MARGIN_PT).toBe(72);
  });

  test("printable box = Letter minus 1in on each edge", () => {
    expect(CONTENT_W_PT).toBe(PAGE_W_PT - 2 * MARGIN_PT); // 468 = 6.5in
    expect(CONTENT_H_PT).toBe(PAGE_H_PT - 2 * MARGIN_PT); // 648 = 9in
    expect(CONTENT_W_PT).toBe(6.5 * 72);
    expect(CONTENT_H_PT).toBe(9 * 72);
  });

  test("source raster width is 8.5in @ 96dpi", () => {
    expect(PAGE_W_PX).toBe(8.5 * 96); // 816
  });
});

describe("pdfSliceMetrics", () => {
  test("maps a full-width canvas into the printable box", () => {
    // A 1x-scale raster: canvas.width == PAGE_W_PX.
    const { scale, pageHpx } = pdfSliceMetrics(816);
    // 468pt / 816px -> content px map into the 6.5in printable width.
    expect(scale).toBeCloseTo(CONTENT_W_PT / 816, 10);
    // One printable page holds CONTENT_H_PT worth of source px.
    expect(pageHpx).toBe(Math.floor(CONTENT_H_PT / scale));
    // A page of source px scaled back up lands within the printable height (never overshoots).
    expect(pageHpx * scale).toBeLessThanOrEqual(CONTENT_H_PT + 1e-6);
  });

  test("2x raster scales proportionally (twice the px per page)", () => {
    const one = pdfSliceMetrics(816);
    const two = pdfSliceMetrics(1632);
    expect(two.scale).toBeCloseTo(one.scale / 2, 10);
    expect(two.pageHpx).toBeGreaterThanOrEqual(one.pageHpx * 2 - 1);
  });
});

describe("parseRgbColor", () => {
  test("rgb()", () => {
    expect(parseRgbColor("rgb(18, 20, 24)")).toEqual([18, 20, 24]);
  });
  test("rgba() ignores alpha", () => {
    expect(parseRgbColor("rgba(255, 0, 128, 0.5)")).toEqual([255, 0, 128]);
  });
  test("#rrggbb", () => {
    expect(parseRgbColor("#ffffff")).toEqual([255, 255, 255]);
    expect(parseRgbColor("#000000")).toEqual([0, 0, 0]);
  });
  test("#rgb shorthand", () => {
    expect(parseRgbColor("#fff")).toEqual([255, 255, 255]);
    expect(parseRgbColor("#123")).toEqual([0x11, 0x22, 0x33]);
  });
  test("clamps and rounds channels", () => {
    expect(parseRgbColor("rgb(300, 5, 12.7)")).toEqual([255, 5, 13]);
  });
  test("unrecognized -> white fallback", () => {
    expect(parseRgbColor("papayawhip")).toEqual([255, 255, 255]);
    expect(parseRgbColor("")).toEqual([255, 255, 255]);
  });
});
