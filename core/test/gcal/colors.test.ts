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
  expect(categoryColorId("blue")).toBe("9"); // #8296C6 → Blueberry
  expect(categoryColorId("gold")).toBe("6"); // #CBB27E → Tangerine
  expect(categoryColorId("rose")).toBe("4"); // #C98CA8 → Flamingo
  expect(categoryColorId("green")).toBe("2"); // #A3BE8C → Sage
  expect(categoryColorId("#ff2600")).toBe("11"); // custom hex passes through → Tomato
  expect(categoryColorId(undefined)).toBeUndefined();
});

test("the `accent` token resolves via the active theme", () => {
  expect(categoryColorId("accent", "paper")).toBe("10"); // #4E7F73 → Basil
  expect(categoryColorId("accent", "cathode")).toBe("7"); // #35F0E0 → Peacock
  expect(categoryColorId("accent", "riso")).toBe("9"); // #2E36A8 → Blueberry
  expect(categoryColorId("accent")).toBe("2"); // default ink accent #93BDB0 → Sage
});

test("toGoogle sets colorId from the category via the color map", async () => {
  const { toGoogle } = await import("../../src/gcal/map");
  const body = toGoogle({ title: "X", date: "2026-06-24", startTime: "09:00", category: "Exams" }, "America/Los_Angeles", { Exams: "11" });
  expect(body.colorId).toBe("11");
  expect(toGoogle({ title: "Y", date: "2026-06-24" }, "America/Los_Angeles").colorId).toBeUndefined();
});
