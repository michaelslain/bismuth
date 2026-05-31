import { test, expect } from "bun:test";
import { toDateStr, addDays, expandRecurrence, splitRecurrence } from "../../src/bases/recurrence";

test("toDateStr / addDays", () => {
  expect(toDateStr(new Date("2026-05-27T00:00:00"))).toBe("2026-05-27");
  expect(toDateStr(addDays(new Date("2026-05-27T00:00:00"), 5))).toBe("2026-06-01");
});

test("daily recurrence fills range", () => {
  const r = { type: "daily" as const, startDate: "2026-05-01", seriesId: "s" };
  expect(expandRecurrence(r, "2026-05-01", "2026-05-03")).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
});

test("weekly recurrence honors daysOfWeek", () => {
  const r = { type: "weekly" as const, startDate: "2026-05-01", daysOfWeek: [1], seriesId: "s" }; // Mondays
  expect(expandRecurrence(r, "2026-05-01", "2026-05-31")).toEqual([
    "2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25",
  ]);
});

test("endDate truncates recurrence", () => {
  const r = { type: "daily" as const, startDate: "2026-05-01", endDate: "2026-05-02", seriesId: "s" };
  expect(expandRecurrence(r, "2026-05-01", "2026-05-10")).toEqual(["2026-05-01", "2026-05-02"]);
});

test("splitRecurrence truncates before split date and returns the tail", () => {
  const rec = { type: "weekly" as const, daysOfWeek: [1], startDate: "2026-06-01", seriesId: "s1" };
  const [before, after] = splitRecurrence(rec, "2026-06-15");
  expect(before.endDate).toBe("2026-06-14");
  expect(after?.startDate).toBe("2026-06-15");
  expect(after?.seriesId).not.toBe(before.seriesId);
});

test("splitRecurrence returns null tail when split is past the endDate", () => {
  const rec = { type: "daily" as const, startDate: "2026-06-01", endDate: "2026-06-10", seriesId: "s1" };
  const [, after] = splitRecurrence(rec, "2026-06-20");
  expect(after).toBeNull();
});
