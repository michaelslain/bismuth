import { describe, expect, it } from "bun:test";
import { THEMES, THEME_NAMES, DEFAULT_THEME, resolveTheme, resolveAppearance } from "./themes";

describe("themes registry", () => {
  it("exposes 6 dark themes + 6 light counterparts, oxide-duotone first (the default)", () => {
    expect(THEME_NAMES[0]).toBe("oxide-duotone");
    expect(DEFAULT_THEME).toBe("oxide-duotone");
    expect(THEME_NAMES).toEqual([
      "oxide-duotone", "gunmetal-teal", "rose-gold",
      "indigo-oxide", "forest-oxide", "full-sheen",
      "oxide-duotone-light", "gunmetal-teal-light", "rose-gold-light",
      "indigo-oxide-light", "forest-oxide-light", "full-sheen-light",
    ]);
  });

  it("every theme carries the full base color token set", () => {
    for (const name of THEME_NAMES) {
      const t = THEMES[name];
      for (const key of ["background", "foreground", "neutral", "accent", "border", "surface", "surface2"] as const) {
        expect(t[key], `${name}.${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
      expect(t.accentPalette.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("oxide-duotone holds the mockup's duotone values", () => {
    expect(THEMES["oxide-duotone"].background).toBe("#0D0E16");
    expect(THEMES["oxide-duotone"].accent).toBe("#5E8DE6");
    expect(THEMES["oxide-duotone"].surface).toBe("#161827");
  });
});

describe("resolveTheme / resolveAppearance", () => {
  it("resolves a known theme to its tokens", () => {
    expect(resolveTheme("indigo-oxide")).toEqual(THEMES["indigo-oxide"]);
  });

  it("falls back to the default theme for an unknown name", () => {
    expect(resolveTheme("nope")).toEqual(THEMES["oxide-duotone"]);
  });

  it("resolveAppearance reads the theme off the appearance subtree", () => {
    expect(resolveAppearance({ theme: "forest-oxide" })).toEqual(THEMES["forest-oxide"]);
    expect(resolveAppearance({ theme: "" })).toEqual(THEMES["oxide-duotone"]);
  });
});
