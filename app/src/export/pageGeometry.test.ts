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
  pageSlices,
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

describe("pageSlices — auto-pagination of overflow content", () => {
  test("content shorter than one page -> a single slice covering all of it (no forced break needed)", () => {
    expect(pageSlices(500, 1000)).toEqual([{ start: 0, height: 500 }]);
  });

  test("content exactly one page tall -> exactly one slice", () => {
    expect(pageSlices(1000, 1000)).toEqual([{ start: 0, height: 1000 }]);
  });

  // THE regression the user reported: a long doc with NO explicit page-break markers must still
  // split into multiple fixed-height pages, not render onto one endless page.
  test("content 2.5x a page tall with NO breaks -> auto-flows onto 3 pages", () => {
    const slices = pageSlices(2500, 1000);
    expect(slices).toEqual([
      { start: 0, height: 1000 },
      { start: 1000, height: 1000 },
      { start: 2000, height: 500 },
    ]);
  });

  test("every full page is exactly pageHpx tall; only the last is shorter", () => {
    const pageHpx = 640;
    const slices = pageSlices(pageHpx * 4 + 123, pageHpx);
    expect(slices).toHaveLength(5);
    for (const s of slices.slice(0, -1)) expect(s.height).toBe(pageHpx);
    expect(slices.at(-1)).toEqual({ start: pageHpx * 4, height: 123 });
    // Slices tile the whole content with no gaps/overlap.
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].start).toBe(slices[i - 1].start + slices[i - 1].height);
    }
  });

  test("a forced break inside a page ends it early; the next page starts AT the marker", () => {
    // Break at 300 (< pageHpx 1000): page 1 is [0,300), page 2 resumes at 300.
    const slices = pageSlices(1500, 1000, [300]);
    expect(slices).toEqual([
      { start: 0, height: 300 },
      { start: 300, height: 1000 },
      { start: 1300, height: 200 },
    ]);
  });

  test("multiple forced breaks each cut a page, and overflow between them still auto-paginates", () => {
    // Breaks at 300 and 2600; between 300 and 2600 (2300px) is >2 pages, so it auto-splits.
    const slices = pageSlices(2800, 1000, [300, 2600]);
    expect(slices).toEqual([
      { start: 0, height: 300 },     // forced break at 300
      { start: 300, height: 1000 },  // auto page
      { start: 1300, height: 1000 }, // auto page
      { start: 2300, height: 300 },  // forced break at 2600
      { start: 2600, height: 200 },  // remainder
    ]);
  });

  test("a break exactly on the natural page bottom is a no-op (never an empty page)", () => {
    // From offset 0 the page naturally ends at 1000; a marker AT 1000 adds nothing.
    expect(pageSlices(1500, 1000, [1000])).toEqual([
      { start: 0, height: 1000 },
      { start: 1000, height: 500 },
    ]);
  });

  test("breaks are honored regardless of input order (sorted internally)", () => {
    // Same result whether passed [1200,400] or [400,1200].
    const expected = [
      { start: 0, height: 400 },
      { start: 400, height: 800 },
      { start: 1200, height: 400 },
    ];
    expect(pageSlices(1600, 1000, [1200, 400])).toEqual(expected);
    expect(pageSlices(1600, 1000, [400, 1200])).toEqual(expected);
  });

  test("empty / degenerate inputs -> no slices (never loops forever)", () => {
    expect(pageSlices(0, 1000)).toEqual([]);
    expect(pageSlices(1000, 0)).toEqual([]);
    expect(pageSlices(-5, 1000)).toEqual([]);
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
