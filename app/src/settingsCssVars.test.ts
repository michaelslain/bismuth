// app/src/settingsCssVars.test.ts
import { describe, expect, it } from "bun:test";
import { settingsToCssVars } from "./settingsCssVars";
import { DEFAULTS } from "./settings";

describe("settingsToCssVars", () => {
  it("maps appearance settings to CSS custom properties with units", () => {
    const vars = settingsToCssVars(DEFAULTS);
    expect(vars["--accent"]).toBe("#3F6BF0");
    expect(vars["--editor-font-size"]).toBe("16px");
    expect(vars["--editor-font"]).toBe("'Lora', serif"); // resolved through FONT_STACKS
  });

  it("derives the theme color tokens from the 5 appearance token groups", () => {
    const vars = settingsToCssVars(DEFAULTS);
    expect(vars["--bg"]).toBe("#14151B");           // background (Ink)
    expect(vars["--fg"]).toBe("#F4F2EE");           // foreground (Paper)
    // neutral (Steel) drives borders/panel via color-mix; foreground drives muted/surfaces.
    expect(vars["--border"]).toBe("color-mix(in srgb, #AEB4C2 22%, transparent)");
    expect(vars["--text-muted"]).toBe("color-mix(in srgb, #F4F2EE 60%, transparent)");
    expect(vars["--panel"]).toBe("color-mix(in srgb, #AEB4C2 6%, transparent)");
    expect(vars["--surface-1"]).toBe("color-mix(in srgb, #F4F2EE 5%, transparent)");
    // --accent-purple tracks accentPalette[1] (Oxide purple).
    expect(vars["--accent-purple"]).toBe("#9B53E8");
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
