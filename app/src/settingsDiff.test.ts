// app/src/settingsDiff.test.ts
import { describe, expect, it } from "bun:test";
import { diffLeaves } from "./settingsDiff";

describe("diffLeaves", () => {
  it("returns nothing when objects are identical", () => {
    const o = { appearance: { theme: "dark", accent: "#fff" }, graph: { spin: true } };
    expect(diffLeaves(o, structuredClone(o))).toEqual([]);
  });

  it("emits one entry per changed leaf, with its full path", () => {
    const prev = { appearance: { theme: "dark", accent: "#fff" }, graph: { spin: true } };
    const next = { appearance: { theme: "light", accent: "#fff" }, graph: { spin: false } };
    expect(diffLeaves(prev, next)).toEqual([
      { path: ["appearance", "theme"], value: "light" },
      { path: ["graph", "spin"], value: false },
    ]);
  });

  it("treats a missing prev branch as all-new leaves", () => {
    const prev = { appearance: { theme: "dark" } };
    const next = { appearance: { theme: "dark" }, graph: { spin: true, nodeSize: 6 } };
    expect(diffLeaves(prev, next)).toEqual([
      { path: ["graph", "spin"], value: true },
      { path: ["graph", "nodeSize"], value: 6 },
    ]);
  });

  it("treats arrays as leaf values compared whole", () => {
    const prev = { graph: { palette: [1, 2, 3] } };
    const next = { graph: { palette: [1, 2, 4] } };
    expect(diffLeaves(prev, next)).toEqual([{ path: ["graph", "palette"], value: [1, 2, 4] }]);
  });

  it("ignores an empty nested object on both sides (e.g. properties registry)", () => {
    const prev = { properties: {}, appearance: { theme: "dark" } };
    const next = { properties: {}, appearance: { theme: "dark" } };
    expect(diffLeaves(prev, next)).toEqual([]);
  });
});
