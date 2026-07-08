// app/src/ui/gallery/activeItem.test.ts
import { describe, it, expect } from "bun:test";
import { defaultActiveIndex, moveActive } from "./activeItem";

const items = (...vals: string[]) => vals.map((v) => ({ value: v }));

describe("defaultActiveIndex", () => {
  it("returns -1 when there are no items", () => {
    expect(defaultActiveIndex("smile", [], "Star")).toBe(-1);
    expect(defaultActiveIndex("", [], undefined)).toBe(-1);
  });

  it("picks the TOP search result (index 0) when a query is present", () => {
    // The bug: even with a `current` from the app library, searching should default to
    // the top hit, not the current value's position.
    const it = items("Smile", "SmilePlus", "Frown");
    expect(defaultActiveIndex("smile", it, "Frown")).toBe(0);
  });

  it("ignores current entirely while searching, even if current is in the results", () => {
    const it = items("Smile", "Star");
    expect(defaultActiveIndex("s", it, "Star")).toBe(0);
  });

  it("treats a whitespace-only query as no query", () => {
    const it = items("Smile", "Star");
    expect(defaultActiveIndex("   ", it, "Star")).toBe(1); // falls back to current
  });

  it("with no query, highlights the current value's cell", () => {
    const it = items("Alpha", "Beta", "Gamma");
    expect(defaultActiveIndex("", it, "Gamma")).toBe(2);
  });

  it("with no query and current not found, defaults to 0", () => {
    const it = items("Alpha", "Beta");
    expect(defaultActiveIndex("", it, "Zeta")).toBe(0);
  });

  it("with no query and no current, defaults to 0", () => {
    const it = items("Alpha", "Beta");
    expect(defaultActiveIndex("", it, undefined)).toBe(0);
  });
});

describe("moveActive", () => {
  it("moves right and left by one, clamping at the edges", () => {
    expect(moveActive(0, 6, 3, "right")).toBe(1);
    expect(moveActive(2, 6, 3, "left")).toBe(1);
    expect(moveActive(0, 6, 3, "left")).toBe(0); // clamp at start
    expect(moveActive(5, 6, 3, "right")).toBe(5); // clamp at end
  });

  it("moves down/up by a full row of columns", () => {
    expect(moveActive(0, 6, 3, "down")).toBe(3);
    expect(moveActive(4, 6, 3, "up")).toBe(1);
    expect(moveActive(4, 6, 3, "down")).toBe(4); // would be 7 → clamp (stay)
    expect(moveActive(1, 6, 3, "up")).toBe(1); // would be -2 → clamp (stay)
  });

  it("treats a negative active index as 0 before moving", () => {
    expect(moveActive(-1, 6, 3, "right")).toBe(1);
    expect(moveActive(-1, 6, 3, "left")).toBe(0);
  });

  it("returns -1 when there are no items", () => {
    expect(moveActive(0, 0, 3, "right")).toBe(-1);
  });

  it("guards a zero/negative column count", () => {
    expect(moveActive(0, 6, 0, "down")).toBe(1);
  });
});
