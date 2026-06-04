// app/src/settings.smoke.test.ts
import { describe, expect, it } from "bun:test";
import { parse } from "yaml";
import { mergeServerSettings, firstLaunchImport, DEFAULTS } from "./settings";

// Simulates the backend's GET /settings: parse a settings.yaml body, then the
// frontend funnels it through mergeServerSettings. A null body models "no file".
function bootFromYaml(body: string | null) {
  let parsed: unknown = {};
  if (body !== null) {
    try { parsed = parse(body) ?? {}; } catch { parsed = {}; }
  }
  return mergeServerSettings(parsed);
}

describe("settings.yaml boot states (must not brick)", () => {
  it("1. no settings.yaml -> full defaults", () => {
    const s = bootFromYaml(null);
    expect(s).toEqual(DEFAULTS);
    expect(s.appearance.theme).toBe(DEFAULTS.appearance.theme);
  });

  it("2. empty file -> full defaults", () => {
    const s = bootFromYaml("");
    expect(s).toEqual(DEFAULTS);
  });

  it("3. syntactically broken line -> full defaults, no throw", () => {
    const broken = "appearance:\n  editorFont: 'Lora\n  theme: : : dark\n";
    expect(() => bootFromYaml(broken)).not.toThrow();
    expect(bootFromYaml(broken)).toEqual(DEFAULTS);
  });

  it("4. wrong-typed values -> per-key fall back to defaults", () => {
    const s = bootFromYaml("appearance:\n  editorFontSize: big\ncalendar:\n  defaultView: foo\n");
    // editorFontSize default kept (string != number)
    expect(s.appearance.editorFontSize).toBe(DEFAULTS.appearance.editorFontSize);
    // defaultView is a string-enum default and "foo" is a string, so the typed merge
    // accepts it (enum validity is surfaced as an editor squiggle, not a brick).
    expect(typeof s.calendar.defaultView).toBe("string");
    // every other field still fully shaped
    expect(s.editor.autoSaveDelay).toBe(DEFAULTS.editor.autoSaveDelay);
    expect(s.graph.nodeSize).toBe(DEFAULTS.graph.nodeSize);
  });

  it("first-launch import is a no-op once the file has user values", () => {
    const legacy = JSON.stringify({ appearance: { editorFont: "Georgia" } });
    const serverWithUserValues = { appearance: { editorFont: "Georgia" } };
    expect(firstLaunchImport(legacy, serverWithUserValues)).toBeNull();
  });
});
