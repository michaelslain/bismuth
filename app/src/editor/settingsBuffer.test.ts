// app/src/editor/settingsBuffer.test.ts
import { describe, expect, it } from "bun:test";
import { isSettingsBuffer, isConfigBuffer } from "./settingsBuffer";

describe("isSettingsBuffer", () => {
  it("matches the vault-root .settings file", () => {
    expect(isSettingsBuffer(".settings")).toBe(true);
  });
  it("does not match arbitrary notes, a nested .settings, or null", () => {
    expect(isSettingsBuffer("notes/.settings")).toBe(false);
    expect(isSettingsBuffer("foo.md")).toBe(false);
    expect(isSettingsBuffer(null)).toBe(false);
  });
});

describe("isConfigBuffer", () => {
  it("matches the .settings file and any .yaml/.yml", () => {
    // These must NEVER open in the visual/Milkdown editor (no settings autocomplete + YAML mangling).
    expect(isConfigBuffer(".settings")).toBe(true);
    expect(isConfigBuffer("config.yaml")).toBe(true);
    expect(isConfigBuffer("nested/deploy.yml")).toBe(true);
  });
  it("does not match prose notes or null", () => {
    expect(isConfigBuffer("foo.md")).toBe(false);
    expect(isConfigBuffer("notes/journal.md")).toBe(false);
    expect(isConfigBuffer(null)).toBe(false);
  });
});
