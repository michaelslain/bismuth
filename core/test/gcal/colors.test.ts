// core/test/gcal/colors.test.ts
// Bismuth category color (hex OR theme token) → nearest Google event colorId.
import { test, expect } from "bun:test";
import { nearestGoogleColorId, categoryColorId } from "../../src/gcal/colors";

test("hex → nearest Google event color", () => {
  expect(nearestGoogleColorId("#d50000")).toBe("11"); // red → Tomato
  expect(nearestGoogleColorId("#3f51b5")).toBe("9"); // blue → Blueberry
  expect(nearestGoogleColorId("#fbbc04")).toBe("5"); // gold → Banana
  expect(nearestGoogleColorId(undefined)).toBeUndefined();
  expect(nearestGoogleColorId("not-a-hex")).toBeUndefined();
});

test("theme swatch tokens resolve to a sensible Google color", () => {
  expect(categoryColorId("blue")).toBe("9"); // #5C7BEE → Blueberry
  expect(categoryColorId("gold")).toBe("5"); // #F2C53D → Banana
  expect(categoryColorId("rose")).toBe("4"); // #F0509B → Flamingo
  expect(categoryColorId("green")).toBe("7"); // #43D49A (teal-green) → Peacock
  expect(categoryColorId("#ff2600")).toBe("11"); // custom hex passes through → Tomato
  expect(categoryColorId(undefined)).toBeUndefined();
});

test("the `accent` token resolves via the active theme", () => {
  expect(categoryColorId("accent", "rose-gold")).toBe("4"); // #E1748F → Flamingo
  expect(categoryColorId("accent", "forest-oxide")).toBe("10"); // #3FB87C → Basil
  expect(categoryColorId("accent")).toBe("9"); // default oxide accent #5E8DE6 → Blueberry
});

test("toGoogle sets colorId from the category via the color map", async () => {
  const { toGoogle } = await import("../../src/gcal/map");
  const body = toGoogle({ title: "X", date: "2026-06-24", startTime: "09:00", category: "Exams" }, "America/Los_Angeles", { Exams: "11" });
  expect(body.colorId).toBe("11");
  expect(toGoogle({ title: "Y", date: "2026-06-24" }, "America/Los_Angeles").colorId).toBeUndefined();
});
