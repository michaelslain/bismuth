import { test, expect } from "bun:test";
import { themeColors, makeColorResolver, gridColor } from "../../src/drawing/theme";

test("themeColors returns paper/ink per theme", () => {
  expect(themeColors("dark")).toEqual({ bg: "#0e0e11", fg: "#e8e8ea" });
  expect(themeColors("light")).toEqual({ bg: "#fbfbfa", fg: "#1b1b1f" });
});

test("makeColorResolver maps 'fg' to theme ink and passes hex through", () => {
  const r = makeColorResolver({ bg: "#0e0e11", fg: "#e8e8ea" });
  expect(r("fg")).toBe("#e8e8ea");
  expect(r("#e23b3b")).toBe("#e23b3b");
});

test("gridColor is the ink color at 0.14 alpha (rgba)", () => {
  expect(gridColor({ bg: "#0e0e11", fg: "#e8e8ea" })).toBe("rgba(232,232,234,0.14)");
});
