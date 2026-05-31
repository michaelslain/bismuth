// app/src/editor/settingsBuffer.test.ts
import { describe, expect, it } from "bun:test";
import { isSettingsBuffer } from "./settingsBuffer";

describe("isSettingsBuffer", () => {
  it("matches the vault-root settings.yaml", () => {
    expect(isSettingsBuffer("settings.yaml")).toBe(true);
  });
  it("does not match arbitrary yaml notes or null", () => {
    expect(isSettingsBuffer("notes/settings.yaml")).toBe(false);
    expect(isSettingsBuffer("foo.md")).toBe(false);
    expect(isSettingsBuffer(null)).toBe(false);
  });
});
