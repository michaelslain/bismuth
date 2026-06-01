import { test, expect } from "bun:test";
import { paperLines, paperDots, GRID_GAP } from "../../src/drawing/paper";

test("blank/lines/grid produce the expected line sets across a Letter page", () => {
  expect(paperLines("blank", 816, 1056)).toEqual([]);
  const lines = paperLines("lines", 816, 1056);
  expect(lines.every((l) => l.y1 === l.y2)).toBe(true);
  expect(lines[0].y1).toBe(GRID_GAP);
  const grid = paperLines("grid", 816, 1056);
  expect(grid.some((l) => l.x1 === l.x2)).toBe(true);
});

test("dots returns a point lattice for the dots background only", () => {
  expect(paperDots("grid", 816, 1056)).toEqual([]);
  const dots = paperDots("dots", 816, 1056);
  expect(dots[0]).toEqual({ x: GRID_GAP, y: GRID_GAP });
  expect(dots.length).toBeGreaterThan(100);
});
