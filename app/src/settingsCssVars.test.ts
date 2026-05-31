// app/src/settingsCssVars.test.ts
import { describe, expect, it } from "bun:test";
import { settingsToCssVars } from "./settingsCssVars";
import { DEFAULTS } from "./settings";

describe("settingsToCssVars", () => {
  it("maps appearance settings to CSS custom properties with units", () => {
    const vars = settingsToCssVars(DEFAULTS);
    expect(vars["--accent"]).toBe("#6496ff");
    expect(vars["--editor-font-size"]).toBe("16px");
    expect(vars["--editor-font"]).toBe("'Lora', serif"); // resolved through FONT_STACKS
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
