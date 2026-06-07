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

describe("light themes follow the design's .bis.light block, not a derived dark", () => {
  const lightVars = settingsToCssVars(withTheme("oxide-duotone-light"));
  const darkVars = settingsToCssVars(DEFAULTS); // oxide-duotone (dark)
  const t = THEMES["oxide-duotone-light"];

  it("pins the showcase accent to the design value (#7A86DE), not a guess", () => {
    expect(t.accent).toBe("#7A86DE");
    expect(lightVars["--accent"]).toBe("#7A86DE");
    // --accent-purple still tracks ramp[1].
    expect(lightVars["--accent-purple"]).toBe(t.accentPalette[1]);
  });

  it("text on a solid accent fill is white on light, near-black on dark", () => {
    expect(lightVars["--on-accent"]).toBe("#fff");
    expect(darkVars["--on-accent"]).toBe("#08101F");
  });

  it("the rail is a distinct surface (bg pulled toward border), not the flat canvas wash", () => {
    // Design target #EAE7F3; mix(bg 70%, border) lands on it. Must reference the border,
    // and must differ from the canvas.
    expect(lightVars["--rail"]).toBe(`color-mix(in srgb, ${t.background} 70%, ${t.border})`);
    expect(lightVars["--rail"]).not.toBe(lightVars["--bg"]);
  });

  it("the modal scrim is a soft neutral lavender veil, not a heavy fg-tinted one", () => {
    expect(lightVars["--scrim-bg"]).toBe(`color-mix(in srgb, ${t.neutral} 32%, transparent)`);
    // Dark keeps the foreground-tinted veil.
    expect(darkVars["--scrim-bg"]).toContain(THEMES["oxide-duotone"].foreground);
  });

  it("category swatches derive from the theme's own accent ramp on both light and dark", () => {
    // Preset category swatches always come from the palette so a category that stores one
    // of these tokens auto-recolors when the theme changes (only custom hex stays fixed).
    expect(lightVars["--green"]).toBe(t.accentPalette[1]); // design --green #6FA6E6
    expect(lightVars["--gold"]).toBe(t.accentPalette[4]); // design --gold  #C08FD8
    expect(lightVars["--rose"]).toBe(t.accentPalette[3]); // design --rose  #A98FE0
    // Dark tracks its own theme's ramp the same way (no hardcoded saturated trio).
    const td = THEMES["oxide-duotone"];
    expect(darkVars["--green"]).toBe(td.accentPalette[1]);
    expect(darkVars["--gold"]).toBe(td.accentPalette[4] ?? td.accentPalette[3]);
    expect(darkVars["--rose"]).toBe(td.accentPalette[3]);
  });
});
