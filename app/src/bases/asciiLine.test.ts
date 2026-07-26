import { describe, expect, test } from "bun:test";
import { buildLinePlot } from "./asciiLine";

describe("buildLinePlot", () => {
  test("empty input yields an empty plot", () => {
    const plot = buildLinePlot([]);
    expect(plot.rows).toEqual([]);
    expect(plot.axisRule).toBe("");
    expect(plot.axisLabels).toBe("");
  });

  test("a single point marks one column, no connecting glyphs", () => {
    const plot = buildLinePlot([{ label: "w1", value: 5 }], { height: 4, colWidth: 4 });
    const flat = plot.rows.map((r) => r.segments.map((s) => s.text).join("")).join("\n");
    expect(flat).toContain("o");
    // Exactly one glyph on the grid — a lone point draws no connecting line.
    const glyphCount = [...flat].filter((c) => c !== " " && c !== "\n").length;
    expect(glyphCount).toBe(1);
  });

  test("every row is exactly `height` cells wide across the grid", () => {
    const plot = buildLinePlot(
      [{ label: "a", value: 1 }, { label: "b", value: 8 }, { label: "c", value: 3 }],
      { height: 5, colWidth: 6 },
    );
    for (const row of plot.rows) {
      const width = row.segments.reduce((n, s) => n + s.text.length, 0);
      expect(width).toBe(18); // 3 points * colWidth 6
    }
    expect(plot.rows.length).toBe(5);
  });

  test("a rising value plots a lower row index (row 0 = top = max)", () => {
    const plot = buildLinePlot([{ label: "a", value: 0 }, { label: "b", value: 10 }], { height: 6, colWidth: 4 });
    // Find the row each marker landed on by locating the "o" glyph's row.
    const rowOfGlyph = (col: number) =>
      plot.rows.findIndex((r) => {
        let i = 0;
        for (const seg of r.segments) {
          if (seg.accent && seg.text[col - i] === "o" && col >= i && col < i + seg.text.length) return true;
          i += seg.text.length;
        }
        return false;
      });
    const lowRow = rowOfGlyph(2); // first point's column (colWidth/2)
    const highRow = rowOfGlyph(6); // second point's column
    expect(highRow).toBeLessThan(lowRow);
  });

  test("axisLabels is blank past the 16-point label-collision gate", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `p${i}`, value: i }));
    const plot = buildLinePlot(many);
    expect(plot.axisLabels).toBe("");
    const few = many.slice(0, 5);
    expect(buildLinePlot(few).axisLabels).not.toBe("");
  });

  test("top-row tick shows the max value, bottom-row tick shows 0", () => {
    const plot = buildLinePlot([{ label: "a", value: 42 }], { height: 4 });
    expect(plot.rows[0].tick.trim()).toBe("42");
    expect(plot.rows[plot.rows.length - 1].tick.trim()).toBe("0");
  });
});
