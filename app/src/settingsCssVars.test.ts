// app/src/settingsCssVars.test.ts
import { describe, expect, it } from "bun:test";
import { settingsToCssVars } from "./settingsCssVars";
import { DEFAULTS } from "./settings";
import { THEMES } from "./themes";

function withTheme(theme: string) {
  return { ...DEFAULTS, appearance: { ...DEFAULTS.appearance, theme } } as typeof DEFAULTS;
}

describe("settingsToCssVars", () => {
  it("maps non-color appearance settings to CSS custom properties with units", () => {
    const vars = settingsToCssVars(DEFAULTS);
    expect(vars["--editor-font-size"]).toBe("16px");
    expect(vars["--editor-font"]).toBe("'Lora', serif"); // resolved through FONT_STACKS
  });

  it("derives the color tokens from the default theme (ink)", () => {
    const t = THEMES.ink;
    const vars = settingsToCssVars(DEFAULTS);
    expect(vars["--bg"]).toBe(t.background);
    expect(vars["--fg"]).toBe(t.foreground);
    expect(vars["--accent"]).toBe(t.accent);
    // Base UI colors come straight from the theme (explicit, not color-mix).
    expect(vars["--border"]).toBe(t.border);
    expect(vars["--text-muted"]).toBe(t.neutral);
    expect(vars["--panel"]).toBe(t.surface);
    expect(vars["--surface-1"]).toBe(t.surface);
    expect(vars["--surface-2"]).toBe(t.surface2);
    // --accent-purple tracks accentPalette[1].
    expect(vars["--accent-purple"]).toBe(t.accentPalette[1]);
  });

  it("falls back to the raw font value when not a known stack key", () => {
    const s = structuredClone(DEFAULTS);
    s.appearance.editorFont = "Comic Sans";
    expect(settingsToCssVars(s)["--editor-font"]).toBe("Comic Sans");
  });

  it("maps appearance/ui sizing to px vars and passes CSS lengths through", () => {
    const vars = settingsToCssVars(DEFAULTS);
    expect(vars["--sidebar-width"]).toBe("280px");
    expect(vars["--ui-font-size"]).toBe("13px");
    expect(vars["--tab-font-size"]).toBe("12px");
    expect(vars["--pane-divider-width"]).toBe("5px");
    expect(vars["--palette-top-offset"]).toBe("12vh"); // CSS length passed through verbatim
  });
});

describe("settingsToCssVars + themes", () => {
  it("selecting a theme recolors all base + accent vars from that theme", () => {
    const t = THEMES.cathode;
    const vars = settingsToCssVars(withTheme("cathode"));
    expect(vars["--bg"]).toBe(t.background);
    expect(vars["--accent"]).toBe(t.accent);
    expect(vars["--surface-1"]).toBe(t.surface);
    expect(vars["--border"]).toBe(t.border);
  });

  it("an unknown theme falls back to the default theme's colors", () => {
    const vars = settingsToCssVars(withTheme("does-not-exist"));
    expect(vars["--bg"]).toBe(THEMES.ink.background);
  });
});

describe("light themes read their own explicit ASCII scope values, not a derived dark", () => {
  const lightVars = settingsToCssVars(withTheme("paper"));
  const darkVars = settingsToCssVars(DEFAULTS); // ink (dark)
  const t = THEMES.paper;

  it("pins the accent to the design value, not a guess", () => {
    expect(t.accent).toBe("#4E7F73");
    expect(lightVars["--accent"]).toBe("#4E7F73");
    // --accent-purple still tracks ramp[1].
    expect(lightVars["--accent-purple"]).toBe(t.accentPalette[1]);
  });

  it("text on a solid accent fill uses each theme's own explicit on-accent token", () => {
    expect(lightVars["--on-accent"]).toBe(t.onAccent);
    expect(darkVars["--on-accent"]).toBe(THEMES.ink.onAccent);
  });

  it("the rail is the theme's explicit --rail value, not a derived mix", () => {
    expect(lightVars["--rail"]).toBe(t.rail);
    expect(lightVars["--rail"]).not.toBe(lightVars["--bg"]);
  });

  it("the modal scrim uses the theme's explicit scrimBg token", () => {
    expect(lightVars["--scrim-bg"]).toBe(t.scrimBg);
    expect(darkVars["--scrim-bg"]).toBe(THEMES.ink.scrimBg);
  });

  it("category swatches use the theme's own explicit category tokens on both light and dark", () => {
    // Preset category swatches read the theme's explicit categoryX field so a category that
    // stores one of these tokens auto-recolors when the theme changes (only custom hex stays fixed).
    expect(lightVars["--green"]).toBe(t.categoryGreen);
    expect(lightVars["--gold"]).toBe(t.categoryGold);
    expect(lightVars["--rose"]).toBe(t.categoryRose);
    // Dark tracks its own theme's explicit tokens the same way.
    const td = THEMES.ink;
    expect(darkVars["--green"]).toBe(td.categoryGreen);
    expect(darkVars["--gold"]).toBe(td.categoryGold);
    expect(darkVars["--rose"]).toBe(td.categoryRose);
  });
});
