// app/src/vaultPath.test.ts
//
// vaultBasename is the pure logic behind the status bar's vault name (issue #7):
// App.tsx keeps the full path for a tooltip + click-to-copy, but only shows the
// basename inline. Covers the cases the status bar must never render blank for.
import { describe, expect, it } from "bun:test";
import { vaultBasename } from "./vaultPath";

describe("vaultBasename", () => {
  it("returns the last segment of a normal path", () => {
    expect(vaultBasename("/Users/mike/vaults/Notes")).toBe("Notes");
  });

  it("ignores a trailing slash", () => {
    expect(vaultBasename("/Users/mike/vaults/Notes/")).toBe("Notes");
  });

  it("handles a root-level folder", () => {
    expect(vaultBasename("/Notes")).toBe("Notes");
  });

  it("falls back to the input instead of rendering blank for an empty string", () => {
    expect(vaultBasename("")).toBe("");
  });

  it("falls back to the input instead of rendering blank for a bare slash", () => {
    expect(vaultBasename("/")).toBe("/");
  });
});
