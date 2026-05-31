import { describe, test, expect } from "bun:test";
import { buildChartData } from "../../src/bases/chart";
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
});
