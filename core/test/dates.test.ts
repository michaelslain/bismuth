import { describe, test, expect } from "bun:test";
import { todayISO, addDaysISO, binKey, binLabel, weekdayName, weekdayIndex, nextWeekdayISO } from "../src/dates";

test("todayISO formats a Date from its LOCAL y/m/d components", () => {
  const d = new Date(2026, 4, 31, 12, 0, 0); // 2026-05-31 local (month is 0-based)
  expect(todayISO(d)).toBe("2026-05-31");
});

test("todayISO matches the local calendar day, not the UTC slice", () => {
  // Construct a local Date whose local y/m/d we know. todayISO should report
  // the LOCAL day even when the equivalent UTC instant falls on another date.
  const d = new Date(2026, 0, 1, 0, 0, 0); // local midnight, New Year's Day
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  expect(todayISO(d)).toBe(expected);
  expect(todayISO(d)).toBe("2026-01-01");
});

test("todayISO() with no arg uses the current local day", () => {
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  expect(todayISO()).toBe(expected);
});

test("addDaysISO is consistent with todayISO (local anchoring)", () => {
  expect(addDaysISO("2026-05-31", 1)).toBe("2026-06-01");
  expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
  expect(addDaysISO("2026-02-28", 1)).toBe("2026-03-01"); // non-leap year
  expect(addDaysISO("2024-02-28", 1)).toBe("2024-02-29"); // leap year
});

test("addDaysISO round-trips through todayISO", () => {
  const start = "2026-05-15";
  // Adding then subtracting the same offset returns to the start.
  expect(addDaysISO(addDaysISO(start, 10), -10)).toBe(start);
});

describe("binKey", () => {
  test("day bin returns the date unchanged", () => {
    expect(binKey("2026-05-31", "day")).toBe("2026-05-31");
  });
  test("month bin snaps to the first of the month", () => {
    expect(binKey("2026-05-31", "month")).toBe("2026-05-01");
  });
  test("week bin snaps back to Monday", () => {
    // 2026-05-31 is a Sunday -> Monday of that ISO week is 2026-05-25
    expect(binKey("2026-05-31", "week")).toBe("2026-05-25");
    // 2026-05-25 is itself a Monday -> unchanged
    expect(binKey("2026-05-25", "week")).toBe("2026-05-25");
  });
});

describe("binLabel", () => {
  test("day label is 'Mon D'", () => {
    expect(binLabel("2026-05-31", "day")).toBe("May 31");
  });
  test("month label is 'Mon YYYY'", () => {
    expect(binLabel("2026-05-01", "month")).toBe("May 2026");
  });
  test("week label uses the Monday key's date", () => {
    expect(binLabel("2026-05-25", "week")).toBe("May 25");
  });
});

describe("weekday helpers", () => {
  test("weekdayName reports the local weekday", () => {
    expect(weekdayName("2026-05-27")).toBe("wednesday"); // a known Wednesday
    expect(weekdayName("2026-06-07")).toBe("sunday");
  });
  test("weekdayIndex accepts full names and 3-letter abbreviations, case-insensitive", () => {
    expect(weekdayIndex("Sunday")).toBe(0);
    expect(weekdayIndex("fri")).toBe(5);
    expect(weekdayIndex("SAT")).toBe(6);
    expect(weekdayIndex("someday")).toBeNull();
  });
  test("nextWeekdayISO resolves to the coming occurrence (1–7 days out)", () => {
    // 2026-05-27 is a Wednesday.
    expect(nextWeekdayISO("2026-05-27", "friday")).toBe("2026-05-29");
    expect(nextWeekdayISO("2026-05-27", "fri")).toBe("2026-05-29");
    expect(nextWeekdayISO("2026-05-27", "monday")).toBe("2026-06-01");
  });
  test("nextWeekdayISO maps the same weekday to a week out, not today", () => {
    expect(nextWeekdayISO("2026-05-27", "wednesday")).toBe("2026-06-03");
  });
  test("nextWeekdayISO returns null for non-weekday text", () => {
    expect(nextWeekdayISO("2026-05-27", "someday")).toBeNull();
  });
});
