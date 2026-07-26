import { test, expect } from "bun:test";
import { themeColors, makeColorResolver, paperLineColor, paperDotColor } from "../../src/drawing/theme";
import { THEMES, DEFAULT_THEME } from "../../src/theme/tokens";

test("themeColors sources paper/ink/border from the theme tokens (default dark/light themes)", () => {
  // Now tracks the app theme (source of truth) rather than a drifted literal.
  expect(themeColors("dark")).toEqual({
    bg: THEMES[DEFAULT_THEME].background, // #15161A
    fg: THEMES[DEFAULT_THEME].foreground, // #E8E3D6
    border: THEMES[DEFAULT_THEME].border,
    borderSoft: THEMES[DEFAULT_THEME].borderSoft ?? THEMES[DEFAULT_THEME].border,
  });
  expect(themeColors("light")).toEqual({
    bg: THEMES["paper"].background, // #E9E6E0
    fg: THEMES["paper"].foreground, // #2E2C29
    border: THEMES["paper"].border,
    borderSoft: THEMES["paper"].borderSoft ?? THEMES["paper"].border,
  });
});

test("makeColorResolver maps 'fg' to theme ink and passes hex through", () => {
  const r = makeColorResolver({ bg: "#0e0e11", fg: "#e8e8ea", border: "#333333", borderSoft: "#222222" });
  expect(r("fg")).toBe("#e8e8ea");
  expect(r("#e23b3b")).toBe("#e23b3b");
});

test("paperLineColor/paperDotColor read the theme's border-soft / border hairline tokens", () => {
  const t = { bg: "#0e0e11", fg: "#e8e8ea", border: "#333333", borderSoft: "#222222" };
  expect(paperLineColor(t)).toBe("#222222");
  expect(paperDotColor(t)).toBe("#333333");
});
