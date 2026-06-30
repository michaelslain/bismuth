// app/src/editor/settingsBuffer.test.ts
import { describe, expect, it } from "bun:test";
import { isSettingsBuffer } from "./settingsBuffer";

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
