// core/test/gcal/recurrence.test.ts
// Pure RRULE ⇄ Bismuth recurrence translation (Phase 3).
import { test, expect } from "bun:test";
import { buildRRule, parseRRule, recurrenceSignature, firstOccurrence, type BismuthRecurrence } from "../../src/gcal/recurrence";

const SID = "series-1";

test("buildRRule emits the expected RRULE per frequency", () => {
  expect(buildRRule({ type: "daily", startDate: "2026-06-24", seriesId: SID }, true)).toEqual(["RRULE:FREQ=DAILY"]);
  expect(buildRRule({ type: "weekly", daysOfWeek: [1, 3], startDate: "2026-06-24", seriesId: SID }, true)).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"]);
  expect(buildRRule({ type: "biweekly", daysOfWeek: [5], startDate: "2026-06-24", seriesId: SID }, true)).toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR"]);
  expect(buildRRule({ type: "monthly", startDate: "2026-06-24", seriesId: SID }, true)).toEqual(["RRULE:FREQ=MONTHLY"]);
});

test("buildRRule encodes UNTIL as a DATE for all-day and a UTC DATE-TIME for timed", () => {
  expect(buildRRule({ type: "daily", startDate: "2026-06-24", endDate: "2026-07-04", seriesId: SID }, true)).toEqual(["RRULE:FREQ=DAILY;UNTIL=20260704"]);
  expect(buildRRule({ type: "daily", startDate: "2026-06-24", endDate: "2026-07-04", seriesId: SID }, false)).toEqual(["RRULE:FREQ=DAILY;UNTIL=20260704T235959Z"]);
});

test("buildRRule UNTIL for a timed series is the local end-of-day in UTC (not a naive Z)", () => {
  const rec: BismuthRecurrence = { type: "weekly", daysOfWeek: [3], startDate: "2026-06-24", endDate: "2026-07-04", seriesId: SID };
  // 23:59:59 on 2026-07-04 in PDT (UTC-7) = 06:59:59 UTC the NEXT day — keeps the final local
  // occurrence that a naive `20260704T235959Z` would drop for a timezone west of UTC.
  expect(buildRRule(rec, false, "America/Los_Angeles")).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20260705T065959Z"]);
  // No / UTC timezone → the historical naive form.
  expect(buildRRule(rec, false, "UTC")).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20260704T235959Z"]);
  // All-day UNTIL stays date-only and tz-independent.
  expect(buildRRule(rec, true, "America/Los_Angeles")).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20260704"]);
});

test("parseRRule round-trips every supported recurrence (sans seriesId)", () => {
  const cases: BismuthRecurrence[] = [
    { type: "daily", startDate: "2026-06-24", seriesId: SID },
    { type: "weekly", daysOfWeek: [1, 3, 5], startDate: "2026-06-24", seriesId: SID },
    { type: "biweekly", daysOfWeek: [2], startDate: "2026-06-24", seriesId: SID },
    { type: "monthly", startDate: "2026-06-24", endDate: "2026-12-31", seriesId: SID },
  ];
  for (const rec of cases) {
    const round = parseRRule(buildRRule(rec, true), rec.startDate, rec.seriesId);
    expect(round).toEqual(rec);
  }
});

test("parseRRule reads UNTIL from a UTC DATE-TIME back into a date", () => {
  const rec = parseRRule(["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260704T235959Z"], "2026-06-24", SID);
  expect(rec).toEqual({ type: "weekly", daysOfWeek: [1], startDate: "2026-06-24", endDate: "2026-07-04", seriesId: SID });
});

test("parseRRule returns null for unsupported rules", () => {
  expect(parseRRule(["RRULE:FREQ=YEARLY"], "2026-06-24", SID)).toBeNull();
  expect(parseRRule(["RRULE:FREQ=DAILY;COUNT=10"], "2026-06-24", SID)).toBeNull();
  expect(parseRRule(["RRULE:FREQ=WEEKLY;INTERVAL=3"], "2026-06-24", SID)).toBeNull();
  expect(parseRRule(["RRULE:FREQ=DAILY", "RRULE:FREQ=WEEKLY"], "2026-06-24", SID)).toBeNull();
  expect(parseRRule(["RRULE:FREQ=DAILY", "EXDATE:20260625"], "2026-06-24", SID)).toBeNull();
  expect(parseRRule(undefined, "2026-06-24", SID)).toBeNull();
});

test("firstOccurrence snaps an off-day startDate forward to a valid weekday", () => {
  // Mon/Wed series whose startDate fell on a Tuesday → first real occurrence is the Wed.
  expect(firstOccurrence({ type: "weekly", daysOfWeek: [1, 3], startDate: "2026-06-23", seriesId: "s" })).toBe("2026-06-24");
  // Already valid (Monday) → unchanged.
  expect(firstOccurrence({ type: "weekly", daysOfWeek: [1, 3], startDate: "2026-06-22", seriesId: "s" })).toBe("2026-06-22");
  // No weekday set (daily) → startDate as-is.
  expect(firstOccurrence({ type: "daily", startDate: "2026-06-23", seriesId: "s" })).toBe("2026-06-23");
});

test("toGoogle anchors a malformed (off-day start) recurring event on the first valid weekday", async () => {
  const { toGoogle } = await import("../../src/gcal/map");
  const body = toGoogle(
    { title: "Study", date: "2026-06-22", startTime: "09:30", recurrence: { type: "weekly", daysOfWeek: [1, 3], startDate: "2026-06-23", seriesId: "s" } },
    "America/Los_Angeles",
  );
  expect((body.start as { dateTime: string }).dateTime).toBe("2026-06-24T09:30:00"); // the Wed, not the Tue
  expect(body.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"]);
});

test("recurrenceSignature ignores seriesId and BYDAY order, but reflects content", () => {
  const a = recurrenceSignature({ type: "weekly", daysOfWeek: [3, 1], startDate: "2026-06-24", seriesId: "x" });
  const b = recurrenceSignature({ type: "weekly", daysOfWeek: [1, 3], startDate: "2026-06-24", seriesId: "y" });
  expect(a).toBe(b); // seriesId + day order don't matter
  const c = recurrenceSignature({ type: "weekly", daysOfWeek: [1, 4], startDate: "2026-06-24", seriesId: "x" });
  expect(c).not.toBe(a);
  expect(recurrenceSignature(undefined)).toBe("");
});
