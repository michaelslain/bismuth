import { test, expect } from "bun:test";
import { toDateStr, addDays, expandRecurrence, splitRecurrence, matchesRecurrence } from "../../src/bases/recurrence";

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

test("monthly on the 31st clamps to the last day of shorter months", () => {
  const r = { type: "monthly" as const, startDate: "2026-01-31", seriesId: "s" };
  // 2026 is not a leap year → Feb has 28 days, so the 31st series lands on Feb 28.
  expect(expandRecurrence(r, "2026-02-01", "2026-02-28")).toEqual(["2026-02-28"]);
  // April has 30 days → clamps to the 30th, not skipped.
  expect(expandRecurrence(r, "2026-04-01", "2026-04-30")).toEqual(["2026-04-30"]);
  // March has 31 days → exact match, no clamping (and only one match in the month).
  expect(expandRecurrence(r, "2026-03-01", "2026-03-31")).toEqual(["2026-03-31"]);
});

test("monthly on the 29th matches Feb's last day in a non-leap year", () => {
  const r = { type: "monthly" as const, startDate: "2026-01-29", seriesId: "s" };
  expect(expandRecurrence(r, "2026-02-01", "2026-02-28")).toEqual(["2026-02-28"]);
});

test("monthly on the 29th matches Feb 29 in a leap year", () => {
  const r = { type: "monthly" as const, startDate: "2024-01-29", seriesId: "s" };
  expect(expandRecurrence(r, "2024-02-01", "2024-02-29")).toEqual(["2024-02-29"]);
});

test("biweekly does not match dates before the series start", () => {
  const r = { type: "biweekly" as const, startDate: "2026-06-15", seriesId: "s" };
  // 14 days (2 weeks) before startDate: an even-week diff that previously matched
  // via -0 % 2 === 0. It must not match — the series hasn't begun yet.
  expect(matchesRecurrence(r, "2026-06-01")).toBe(false);
  // Sanity: the start date itself and 14 days after both match.
  expect(matchesRecurrence(r, "2026-06-15")).toBe(true);
  expect(matchesRecurrence(r, "2026-06-29")).toBe(true);
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
