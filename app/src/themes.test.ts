import { describe, expect, it } from "bun:test";
import { THEMES, THEME_NAMES, resolveAppearance, type AppearanceColors } from "./themes";

const base = (over: Partial<AppearanceColors> = {}): AppearanceColors => ({
  background: "#14151B",
  foreground: "#F4F2EE",
  neutral: "#AEB4C2",
  accent: "#3F6BF0",
  accentPalette: ["#F0509B", "#9B53E8", "#3F6BF0", "#27C7D9", "#43D49A", "#F2C53D"],
  theme: "default",
  ...over,
});

describe("themes registry", () => {
  it("exposes 7 themes including default first", () => {
    expect(THEME_NAMES[0]).toBe("default");
    expect(THEME_NAMES).toEqual([
      "default", "gunmetal-teal", "oxide-duotone", "rose-gold",
      "indigo-oxide", "forest-oxide", "full-sheen",
    ]);
  });

  it("default theme equals today's hardcoded tokens", () => {
    expect(THEMES["default"]).toEqual({
      background: "#14151B",
      foreground: "#F4F2EE",
      neutral: "#AEB4C2",
      accent: "#3F6BF0",
      accentPalette: ["#F0509B", "#9B53E8", "#3F6BF0", "#27C7D9", "#43D49A", "#F2C53D"],
    });
  });
});

describe("resolveAppearance", () => {
  it("uses the selected theme's tokens when keys are at their default", () => {
    const r = resolveAppearance(base({ theme: "indigo-oxide" }));
    expect(r.background).toBe(THEMES["indigo-oxide"].background);
    expect(r.accent).toBe(THEMES["indigo-oxide"].accent);
    expect(r.accentPalette).toEqual(THEMES["indigo-oxide"].accentPalette);
  });

  it("a color key that differs from the default theme overrides the selected theme", () => {
    const r = resolveAppearance(base({ theme: "indigo-oxide", accent: "#ff0000" }));
    expect(r.accent).toBe("#ff0000");
    expect(r.background).toBe(THEMES["indigo-oxide"].background);
  });

  it("with theme=default, custom keys behave exactly as today", () => {
    const r = resolveAppearance(base({ theme: "default", background: "#000000" }));
    expect(r.background).toBe("#000000");
    expect(r.foreground).toBe("#F4F2EE");
  });

  it("an unknown theme falls back to default tokens", () => {
    const r = resolveAppearance(base({ theme: "nope" as never }));
    expect(r.background).toBe(THEMES["default"].background);
  });

  it("detects accentPalette override by value, not reference", () => {
    const custom = ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"];
    const r = resolveAppearance(base({ theme: "rose-gold", accentPalette: custom }));
    expect(r.accentPalette).toEqual(custom);
  });
});
