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

  it("derives the color tokens from the default theme (oxide-duotone)", () => {
    const t = THEMES["oxide-duotone"];
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
    const t = THEMES["indigo-oxide"];
    const vars = settingsToCssVars(withTheme("indigo-oxide"));
    expect(vars["--bg"]).toBe(t.background);
    expect(vars["--accent"]).toBe(t.accent);
    expect(vars["--surface-1"]).toBe(t.surface);
    expect(vars["--border"]).toBe(t.border);
  });

  it("an unknown theme falls back to the default theme's colors", () => {
    const vars = settingsToCssVars(withTheme("does-not-exist"));
    expect(vars["--bg"]).toBe(THEMES["oxide-duotone"].background);
  });
});
