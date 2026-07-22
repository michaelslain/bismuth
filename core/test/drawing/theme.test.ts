import { test, expect } from "bun:test";
import { themeColors, makeColorResolver, gridColor } from "../../src/drawing/theme";
import { THEMES, DEFAULT_THEME } from "../../src/theme/tokens";

test("themeColors sources paper/ink from the theme tokens (default dark/light themes)", () => {
  // Now tracks the app theme (source of truth) rather than a drifted literal.
  expect(themeColors("dark")).toEqual({
    bg: THEMES[DEFAULT_THEME].background, // #0D0E16
    fg: THEMES[DEFAULT_THEME].foreground, // #E7E8F2
  });
  expect(themeColors("light")).toEqual({
    bg: THEMES["oxide-duotone-light"].background, // #F1EFF7
    fg: THEMES["oxide-duotone-light"].foreground, // #322D49
  });
});

test("makeColorResolver maps 'fg' to theme ink and passes hex through", () => {
  const r = makeColorResolver({ bg: "#0e0e11", fg: "#e8e8ea" });
  expect(r("fg")).toBe("#e8e8ea");
  expect(r("#e23b3b")).toBe("#e23b3b");
});

test("gridColor is the ink color at 0.14 alpha (rgba)", () => {
  expect(gridColor({ bg: "#0e0e11", fg: "#e8e8ea" })).toBe("rgba(232,232,234,0.14)");
});
