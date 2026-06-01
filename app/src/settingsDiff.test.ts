// app/src/settingsDiff.test.ts
import { describe, expect, it } from "bun:test";
import { diffLeaves } from "./settingsDiff";

describe("diffLeaves", () => {
  it("returns nothing when objects are identical", () => {
    const o = { appearance: { theme: "oxide-duotone", icon: "lattice" }, graph: { spin: true } };
    expect(diffLeaves(o, structuredClone(o))).toEqual([]);
  });

  it("emits one entry per changed leaf, with its full path", () => {
    const prev = { appearance: { theme: "oxide-duotone", icon: "lattice" }, graph: { spin: true } };
    const next = { appearance: { theme: "rose-gold", icon: "lattice" }, graph: { spin: false } };
    expect(diffLeaves(prev, next)).toEqual([
      { path: ["appearance", "theme"], value: "rose-gold" },
      { path: ["graph", "spin"], value: false },
    ]);
  });

  it("treats a missing prev branch as all-new leaves", () => {
    const prev = { appearance: { theme: "oxide-duotone" } };
    const next = { appearance: { theme: "oxide-duotone" }, graph: { spin: true, nodeSize: 6 } };
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
    const prev = { properties: {}, appearance: { theme: "oxide-duotone" } };
    const next = { properties: {}, appearance: { theme: "oxide-duotone" } };
    expect(diffLeaves(prev, next)).toEqual([]);
  });

  it("ignores object key reordering (does not treat as change)", () => {
    // Objects with same keys in different order should not trigger a change
    const prev = { appearance: { icon: "lattice", theme: "oxide-duotone" } };
    const next = { appearance: { theme: "oxide-duotone", icon: "lattice" } };
    expect(diffLeaves(prev, next)).toEqual([]);
  });

  it("handles nested object key reordering at multiple levels", () => {
    // Same nested structure, different key order at each level
    const prev = { ui: { toolbar: { position: "top", visible: true } } };
    const next = { ui: { toolbar: { visible: true, position: "top" } } };
    expect(diffLeaves(prev, next)).toEqual([]);
  });

  it("detects changes when only one nested object has reordered keys", () => {
    const prev = { appearance: { theme: "oxide-duotone", icon: "lattice" } };
    const next = { appearance: { theme: "rose-gold", icon: "lattice" } };
    expect(diffLeaves(prev, next)).toEqual([{ path: ["appearance", "theme"], value: "rose-gold" }]);
  });

  it("handles arrays with different element order (treats as change)", () => {
    const prev = { graph: { palette: [1, 2, 3] } };
    const next = { graph: { palette: [3, 2, 1] } };
    expect(diffLeaves(prev, next)).toEqual([{ path: ["graph", "palette"], value: [3, 2, 1] }]);
  });

  it("handles null/undefined transitions", () => {
    const prev = { field: null };
    const next = { field: "value" };
    expect(diffLeaves(prev, next)).toEqual([{ path: ["field"], value: "value" }]);
  });

  it("handles numeric and boolean leaf changes", () => {
    const prev = { graph: { nodeSize: 5, spin: true } };
    const next = { graph: { nodeSize: 6, spin: false } };
    expect(diffLeaves(prev, next)).toEqual([
      { path: ["graph", "nodeSize"], value: 6 },
      { path: ["graph", "spin"], value: false },
    ]);
  });

  it("detects nested array changes", () => {
    const prev = { groups: [{ id: 1, items: [1, 2] }] };
    const next = { groups: [{ id: 1, items: [1, 3] }] };
    expect(diffLeaves(prev, next)).toEqual([{ path: ["groups"], value: [{ id: 1, items: [1, 3] }] }]);
  });
});
