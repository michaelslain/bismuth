import { describe, test, expect } from "bun:test";
import { buildChartData, buildHeatmapWeeks } from "../../src/bases/chart";
import type { Row, ViewConfig } from "../../src/bases/types";
import { EMPTY_FILE } from "../../src/bases/types";

function row(note: Record<string, unknown>): Row {
  return { file: { ...EMPTY_FILE, name: "n", basename: "n", path: "n.md" }, note, formula: {} };
}
const view = (v: Partial<ViewConfig>): ViewConfig => ({ type: "bar", name: "B", ...v });

describe("buildChartData", () => {
  test("sums a numeric value per day and sorts chronologically", () => {
    const rows = [
      row({ date: "2026-05-02", glasses: 3 }),
      row({ date: "2026-05-01", glasses: 5 }),
      row({ date: "2026-05-02", glasses: 2 }),
    ];
    const d = buildChartData(rows, view({ x: "date", y: "glasses", aggregate: "sum", bin: "day" }));
    expect(d.isDate).toBe(true);
    expect(d.points.map((p) => p.key)).toEqual(["2026-05-01", "2026-05-02"]);
    expect(d.points.map((p) => p.value)).toEqual([5, 5]);
    expect(d.max).toBe(5);
  });

  test("count mode (no y) counts rows per bucket", () => {
    const rows = [row({ done: "2026-05-01" }), row({ done: "2026-05-01" }), row({ done: "2026-05-02" })];
    const d = buildChartData(rows, view({ x: "done", aggregate: "count" }));
    expect(d.points.map((p) => p.value)).toEqual([2, 1]);
  });

  test("average aggregate", () => {
    const rows = [row({ date: "2026-05-01", w: 170 }), row({ date: "2026-05-01", w: 172 })];
    const d = buildChartData(rows, view({ x: "date", y: "w", aggregate: "avg" }));
    expect(d.points[0].value).toBe(171);
  });

  test("month binning groups days into months", () => {
    const rows = [row({ date: "2026-05-01", g: 1 }), row({ date: "2026-05-28", g: 2 }), row({ date: "2026-06-03", g: 4 })];
    const d = buildChartData(rows, view({ x: "date", y: "g", aggregate: "sum", bin: "month" }));
    expect(d.points.map((p) => p.key)).toEqual(["2026-05-01", "2026-06-01"]);
    expect(d.points.map((p) => p.value)).toEqual([3, 4]);
  });

  test("category axis sorts by value descending", () => {
    const rows = [row({ cat: "a", g: 1 }), row({ cat: "b", g: 5 }), row({ cat: "a", g: 1 })];
    const d = buildChartData(rows, view({ x: "cat", y: "g", aggregate: "sum" }));
    expect(d.isDate).toBe(false);
    expect(d.points.map((p) => p.key)).toEqual(["b", "a"]);
  });

  test("auto-detects a date x and numeric y when unset", () => {
    const rows = [row({ date: "2026-05-01", glasses: 4 }), row({ date: "2026-05-02", glasses: 6 })];
    const d = buildChartData(rows, view({}));
    expect(d.isDate).toBe(true);
    expect(d.points.map((p) => p.value)).toEqual([4, 6]);
  });

  test("empty rows yield no points and zero min/max", () => {
    const d = buildChartData([], view({ x: "date", y: "g" }));
    expect(d.points).toEqual([]);
    expect(d.max).toBe(0);
  });

  test("does not auto-pick a boolean column as the value (uses count)", () => {
    const rows = [row({ date: "2026-05-01", done: true }), row({ date: "2026-05-01", done: false })];
    const d = buildChartData(rows, view({}));
    expect(d.valueLabel).toBe("count");
    expect(d.points[0].value).toBe(2);
  });

  test("count mode labels as 'count' even with an explicit y", () => {
    const rows = [row({ date: "2026-05-01", glasses: 5 }), row({ date: "2026-05-01", glasses: 3 })];
    const d = buildChartData(rows, view({ x: "date", y: "glasses", aggregate: "count" }));
    expect(d.valueLabel).toBe("count");
    expect(d.points[0].value).toBe(2);
  });

  test("category ties break by key for determinism", () => {
    const rows = [row({ cat: "b", g: 2 }), row({ cat: "a", g: 2 })];
    const d = buildChartData(rows, view({ x: "cat", y: "g", aggregate: "sum" }));
    expect(d.points.map((p) => p.key)).toEqual(["a", "b"]);
  });
});

describe("buildHeatmapWeeks", () => {
  test("lays out day points into Monday-started week columns", () => {
    // 2026-05-25 (Mon) .. 2026-05-27 (Wed)
    const points = [
      { key: "2026-05-25", label: "", value: 1, date: "2026-05-25" },
      { key: "2026-05-27", label: "", value: 4, date: "2026-05-27" },
    ];
    const { weeks } = buildHeatmapWeeks(points);
    expect(weeks.length).toBe(1);
    expect(weeks[0].length).toBe(7);
    expect(weeks[0][0]).toEqual({ date: "2026-05-25", value: 1 });
    expect(weeks[0][1]).toEqual({ date: "2026-05-26", value: null }); // gap day
    expect(weeks[0][2]).toEqual({ date: "2026-05-27", value: 4 });
    expect(weeks[0][6].value).toBe(null); // Sunday, no data
  });

  test("empty points -> no weeks", () => {
    expect(buildHeatmapWeeks([]).weeks).toEqual([]);
  });
});
