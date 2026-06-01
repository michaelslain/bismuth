import { test, expect } from "bun:test";
import { loadSettings, DEFAULTS } from "../src/settings";

test("loadSettings returns defaults for null / malformed / non-object input", () => {
  expect(loadSettings(null)).toEqual(DEFAULTS);
  expect(loadSettings("not json")).toEqual(DEFAULTS);
  expect(loadSettings("42")).toEqual(DEFAULTS);
  expect(loadSettings("null")).toEqual(DEFAULTS);
});

test("loadSettings returns a fresh clone, not the DEFAULTS reference", () => {
  const a = loadSettings(null);
  a.appearance.editorFontSize = 99;
  expect(DEFAULTS.appearance.editorFontSize).toBe(16);
});

test("loadSettings overlays stored values and keeps defaults for missing keys", () => {
  const raw = JSON.stringify({ appearance: { theme: "rose-gold" }, graph: { spin: false } });
  const s = loadSettings(raw);
  expect(s.appearance.theme).toBe("rose-gold");      // taken from storage
  expect(s.appearance.editorFont).toBe("Lora");      // default kept
  expect(s.graph.spin).toBe(false);                  // taken from storage
  expect(s.appearance.editorFontSize).toBe(16);      // default kept
});

test("loadSettings ignores wrong-typed and unknown keys", () => {
  const raw = JSON.stringify({
    appearance: { editorFontSize: "huge", bogus: 1 }, // wrong type + unknown
    editor: { autoSaveDelay: 1500 },
  });
  const s = loadSettings(raw) as any;
  expect(s.appearance.editorFontSize).toBe(16); // wrong type rejected → default
  expect(s.appearance.bogus).toBeUndefined();   // unknown key dropped
  expect(s.editor.autoSaveDelay).toBe(1500);    // valid override applied
});
