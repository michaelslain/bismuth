// core/test/gcal/map.test.ts
// Pure mapping from Google events → Bismuth calendar-base row fields (Phase 1).
import { test, expect } from "bun:test";
import { fromGoogle, buildNote, toGoogle, nextDay, signature } from "../../src/gcal/map";
import type { GEvent } from "../../src/gcal/client";

const base: GEvent = { id: "g1", etag: "e1", updated: "2026-06-23T10:00:00Z" };

test("timed event → naive local date + HH:MM taken verbatim from the dateTime string", () => {
  const m = fromGoogle({
    ...base,
    summary: "Standup",
    location: "Room 4",
    description: "daily",
    start: { dateTime: "2026-06-24T09:30:00-04:00", timeZone: "America/New_York" },
    end: { dateTime: "2026-06-24T10:00:00-04:00", timeZone: "America/New_York" },
  });
  expect(m).toEqual({
    title: "Standup",
    date: "2026-06-24",
    startTime: "09:30",
    endTime: "10:00",
    location: "Room 4",
    description: "daily",
  });
});

test("all-day event → date only, no start/end time", () => {
  const m = fromGoogle({ ...base, summary: "Holiday", start: { date: "2026-07-04" }, end: { date: "2026-07-05" } });
  expect(m).toEqual({ title: "Holiday", date: "2026-07-04", startTime: undefined, endTime: undefined, location: undefined, description: undefined });
});

test("recurring master is mapped with a parsed recurrence (anchored to its start)", () => {
  const m = fromGoogle({ ...base, summary: "Weekly", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"], start: { dateTime: "2026-06-24T09:00:00-04:00" }, end: { dateTime: "2026-06-24T10:00:00-04:00" } });
  expect(m?.date).toBe("2026-06-24");
  expect(m?.startTime).toBe("09:00");
  expect(m?.recurrence).toEqual({ type: "weekly", daysOfWeek: [3], startDate: "2026-06-24", seriesId: "g1" });
});

test("recurring master with an unsupported RRULE is skipped (null)", () => {
  expect(fromGoogle({ ...base, recurrence: ["RRULE:FREQ=YEARLY"], start: { date: "2026-06-24" } })).toBeNull();
});

test("a modified exception instance (recurringEventId) is skipped (null)", () => {
  expect(fromGoogle({ ...base, recurringEventId: "g0", summary: "moved instance", start: { dateTime: "2026-06-25T09:00:00-04:00" } })).toBeNull();
});

test("multi-day all-day event is skipped, not silently shrunk to one day", () => {
  // start 07-04, exclusive end 07-07 → spans 3 days; Bismuth's single `date` can't hold it.
  expect(fromGoogle({ ...base, summary: "Trip", start: { date: "2026-07-04" }, end: { date: "2026-07-07" } })).toBeNull();
  // a single-day all-day (exclusive end = next day) still maps fine.
  expect(fromGoogle({ ...base, summary: "Holiday", start: { date: "2026-07-04" }, end: { date: "2026-07-05" } })).not.toBeNull();
});

test("overnight timed event (end on a later calendar day) is skipped", () => {
  expect(fromGoogle({ ...base, summary: "Night", start: { dateTime: "2026-06-24T23:00:00-04:00" }, end: { dateTime: "2026-06-25T01:00:00-04:00" } })).toBeNull();
  // a within-day timed event still maps.
  expect(fromGoogle({ ...base, summary: "Day", start: { dateTime: "2026-06-24T09:00:00-04:00" }, end: { dateTime: "2026-06-24T10:00:00-04:00" } })).not.toBeNull();
});

test("cancelled event is skipped (null)", () => {
  expect(fromGoogle({ ...base, status: "cancelled", start: { date: "2026-06-24" } })).toBeNull();
});

test("event with no usable start is skipped (null)", () => {
  expect(fromGoogle({ ...base, summary: "Floating" })).toBeNull();
});

test("missing summary falls back to a placeholder title", () => {
  expect(fromGoogle({ ...base, start: { date: "2026-06-24" } })?.title).toBe("(no title)");
});

test("toGoogle: timed event uses dateTime + timeZone; end defaults to start when missing", () => {
  expect(toGoogle({ title: "X", date: "2026-06-24", startTime: "09:30" }, "America/New_York")).toEqual({
    summary: "X",
    location: "",
    description: "",
    start: { dateTime: "2026-06-24T09:30:00", timeZone: "America/New_York" },
    end: { dateTime: "2026-06-24T09:30:00", timeZone: "America/New_York" },
  });
});

test("toGoogle: all-day event uses date with an EXCLUSIVE next-day end", () => {
  expect(toGoogle({ title: "Holiday", date: "2026-07-04" }, "America/New_York")).toEqual({
    summary: "Holiday",
    location: "",
    description: "",
    start: { date: "2026-07-04" },
    end: { date: "2026-07-05" },
  });
});

test("nextDay rolls over month/year boundaries", () => {
  expect(nextDay("2026-07-04")).toBe("2026-07-05");
  expect(nextDay("2026-06-30")).toBe("2026-07-01");
  expect(nextDay("2026-12-31")).toBe("2027-01-01");
});

test("signature changes iff a synced field changes", () => {
  const a = signature({ title: "X", date: "2026-06-24", startTime: "09:00" });
  expect(signature({ title: "X", date: "2026-06-24", startTime: "09:00" })).toBe(a);
  expect(signature({ title: "X", date: "2026-06-24", startTime: "10:00" })).not.toBe(a);
});

test("buildNote mirrors the calendar-base column set with the given id", () => {
  const note = buildNote("bid-1", { title: "X", date: "2026-06-24", startTime: "08:00", endTime: "09:00" });
  expect(note).toEqual({
    id: "bid-1",
    title: "X",
    date: "2026-06-24",
    startTime: "08:00",
    endTime: "09:00",
    location: undefined,
    link: undefined,
    description: undefined,
    category: undefined,
    recurrence: undefined,
  });
});
