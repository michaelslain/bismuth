import { describe, expect, test } from "bun:test";
import {
  parseCalendarFile,
  serializeCalendarFile,
  emptyCalendarFile,
  isCalendarBase,
  categoriesOf,
  eventsForDay,
  eventsForRange,
  eventsInWindow,
  searchEvents,
  detectOverlaps,
  addEvent,
  moveEvent,
  deleteEvent,
  overrideOccurrence,
  deleteOccurrence,
  findEvent,
  recurrenceFromRRule,
  addCategory,
  updateCategory,
  removeCategory,
  type CalendarEvent,
  type Recurrence,
} from "../src/calendar";

function baseFile(events: CalendarEvent[], extraFm: Record<string, unknown> = {}): string {
  return serializeCalendarFile({ type: "base", view: "calendar", ...extraFm }, events);
}

const rec = (over: Partial<Recurrence> = {}): Recurrence => ({
  type: "daily",
  startDate: "2026-01-01",
  seriesId: "series-1",
  ...over,
});

describe("parse/serialize", () => {
  test("round-trips events + preserves the whole frontmatter", () => {
    const text = `---
type: base
view: calendar
title: My Cal
customKey: keep-me
categories:
  - name: Work
    color: "#ff0000"
---

- id: e1
  title: Standup
  date: 2026-01-02
  startTime: "09:00"
  endTime: "09:30"
  category: Work
`;
    const { frontmatter, events } = parseCalendarFile(text);
    expect(frontmatter.customKey).toBe("keep-me");
    expect(frontmatter.title).toBe("My Cal");
    expect(categoriesOf(frontmatter)).toEqual([{ name: "Work", color: "#ff0000" }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "e1", title: "Standup", date: "2026-01-02", startTime: "09:00", endTime: "09:30", category: "Work" });

    // Re-serialize and re-parse: frontmatter (incl. customKey) survives.
    const out = serializeCalendarFile(frontmatter, events);
    const again = parseCalendarFile(out);
    expect(again.frontmatter.customKey).toBe("keep-me");
    expect(again.events[0].title).toBe("Standup");
  });

  test("recurrence round-trips through the JSON-string column", () => {
    const e: CalendarEvent = { id: "r1", title: "Daily", date: "2026-01-01", recurrence: rec() };
    const parsed = parseCalendarFile(baseFile([e]));
    expect(parsed.events[0].recurrence).toEqual(rec());
  });
});

describe("add / move / delete", () => {
  test("addEvent stamps id + localUpdated", () => {
    const { events, event } = addEvent([], { title: "New", date: "2026-01-05" });
    expect(events).toHaveLength(1);
    expect(event.id).toBeTruthy();
    expect(event.localUpdated).toBeTruthy();
  });

  test("moveEvent changes date/time and throws on unknown id", () => {
    const start = addEvent([], { title: "A", date: "2026-01-05", startTime: "10:00", endTime: "11:00" }).events;
    const id = start[0].id;
    const next = moveEvent(start, id, { date: "2026-01-06", startTime: "12:00", endTime: "13:00" });
    expect(findEvent(next, id)).toMatchObject({ date: "2026-01-06", startTime: "12:00", endTime: "13:00" });
    expect(() => moveEvent(start, "nope", { date: "2026-01-07" })).toThrow();
  });

  test("deleteEvent removes by id and throws on unknown id", () => {
    const start = addEvent([], { title: "A", date: "2026-01-05" }).events;
    const id = start[0].id;
    expect(deleteEvent(start, id)).toHaveLength(0);
    expect(() => deleteEvent(start, "nope")).toThrow();
  });
});

describe("queries + overlap detection", () => {
  test("eventsForDay expands a daily recurrence to one instance", () => {
    const events: CalendarEvent[] = [
      { id: "r1", title: "Daily", date: "2026-01-01", startTime: "09:00", endTime: "09:30", recurrence: rec() },
      { id: "s1", title: "One-off", date: "2026-01-03", startTime: "14:00", endTime: "15:00" },
    ];
    const day = eventsForDay(events, "2026-01-03");
    expect(day.map((e) => e.id).sort()).toEqual(["r1", "s1"]);
    expect(day.find((e) => e.id === "r1")!.date).toBe("2026-01-03");
  });

  test("eventsForRange expands across multiple days", () => {
    const events: CalendarEvent[] = [{ id: "r1", title: "Daily", date: "2026-01-01", recurrence: rec() }];
    expect(eventsForRange(events, "2026-01-01", "2026-01-03")).toHaveLength(3);
  });

  test("detectOverlaps finds intersecting timed events, ignores all-day", () => {
    const day: CalendarEvent[] = [
      { id: "a", title: "A", date: "2026-01-03", startTime: "09:00", endTime: "10:00" },
      { id: "b", title: "B", date: "2026-01-03", startTime: "09:30", endTime: "11:00" },
      { id: "c", title: "C", date: "2026-01-03", startTime: "11:00", endTime: "12:00" }, // touches b's end, no overlap
      { id: "d", title: "AllDay", date: "2026-01-03" },
    ];
    const pairs = detectOverlaps(day);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.id, pairs[0].b.id].sort()).toEqual(["a", "b"]);
  });
});

describe("per-occurrence override of a recurring event", () => {
  test("override a middle occurrence splits the series into head + tail + single", () => {
    const events: CalendarEvent[] = [
      { id: "r1", title: "Daily", date: "2026-01-01", startTime: "09:00", endTime: "09:30", recurrence: rec() },
    ];
    // Override Jan 3 → move to 14:00.
    const next = overrideOccurrence(events, "r1", "2026-01-03", { startTime: "14:00", endTime: "15:00" });

    // Jan 2 still from the recurring head; Jan 3 is the single override; Jan 4 from the tail.
    const jan2 = eventsForDay(next, "2026-01-02");
    expect(jan2).toHaveLength(1);
    expect(jan2[0].startTime).toBe("09:00");

    const jan3 = eventsForDay(next, "2026-01-03");
    expect(jan3).toHaveLength(1);
    expect(jan3[0].startTime).toBe("14:00");
    expect(jan3[0].recurrence).toBeUndefined();

    const jan4 = eventsForDay(next, "2026-01-04");
    expect(jan4).toHaveLength(1);
    expect(jan4[0].startTime).toBe("09:00");
    // The tail keeps the SAME seriesId so it's still recognized as one series.
    expect(jan4[0].recurrence?.seriesId).toBe("series-1");
  });

  test("override the FIRST occurrence drops the head (no zombie with endDate < startDate)", () => {
    const events: CalendarEvent[] = [
      { id: "r1", title: "Daily", date: "2026-01-01", startTime: "09:00", endTime: "09:30", recurrence: rec() },
    ];
    const next = overrideOccurrence(events, "r1", "2026-01-01", { startTime: "14:00", endTime: "15:00" });
    const jan1 = eventsForDay(next, "2026-01-01");
    expect(jan1).toHaveLength(1);
    expect(jan1[0].startTime).toBe("14:00");
    // Jan 2 onward still recurs from the tail.
    expect(eventsForDay(next, "2026-01-02")).toHaveLength(1);
    // The original master (id r1) is gone.
    expect(findEvent(next, "r1")).toBeUndefined();
  });

  test("deleteOccurrence removes a single day but keeps the rest of the series", () => {
    const events: CalendarEvent[] = [
      { id: "r1", title: "Daily", date: "2026-01-01", recurrence: rec({ endDate: "2026-01-05" }) },
    ];
    const next = deleteOccurrence(events, "r1", "2026-01-03");
    expect(eventsForDay(next, "2026-01-03")).toHaveLength(0);
    expect(eventsForDay(next, "2026-01-02")).toHaveLength(1);
    expect(eventsForDay(next, "2026-01-04")).toHaveLength(1);
    // Range Jan 1–5 = 5 days minus the deleted one = 4 instances.
    expect(eventsForRange(next, "2026-01-01", "2026-01-05")).toHaveLength(4);
  });

  test("override/delete throw on a non-recurring event", () => {
    const events: CalendarEvent[] = [{ id: "s1", title: "One-off", date: "2026-01-03" }];
    expect(() => overrideOccurrence(events, "s1", "2026-01-03", {})).toThrow();
    expect(() => deleteOccurrence(events, "s1", "2026-01-03")).toThrow();
  });
});

describe("calendar-base discovery + creation", () => {
  test("isCalendarBase matches the view: shorthand and the views: array", () => {
    expect(isCalendarBase({ type: "base", view: "calendar" })).toBe(true);
    expect(isCalendarBase({ type: "base", views: [{ type: "table" }, { type: "calendar" }] })).toBe(true);
    expect(isCalendarBase({ type: "base", views: [{ type: "table" }] })).toBe(false);
    expect(isCalendarBase({ type: "base", view: "table" })).toBe(false);
    expect(isCalendarBase({ view: "calendar" })).toBe(false); // not a base
    // Mirrors parseBaseFile: an explicit views: array wins over the view: shorthand.
    expect(isCalendarBase({ type: "base", view: "calendar", views: [{ type: "table" }] })).toBe(false);
  });

  test("emptyCalendarFile round-trips and is discovered as a calendar base", () => {
    const text = emptyCalendarFile({ title: "Team Cal", categories: [{ name: "Work", color: "#f00" }] });
    const { frontmatter, events } = parseCalendarFile(text);
    expect(isCalendarBase(frontmatter)).toBe(true);
    expect(frontmatter.title).toBe("Team Cal");
    expect(categoriesOf(frontmatter)).toEqual([{ name: "Work", color: "#f00" }]);
    expect(events).toHaveLength(0);
  });
});

describe("raw window listing + search", () => {
  const events: CalendarEvent[] = [
    { id: "s1", title: "Dentist", date: "2026-02-10", location: "Downtown clinic" },
    { id: "s2", title: "Flight", date: "2026-03-01", description: "SFO to JFK" },
    { id: "m1", title: "Standup", date: "2026-01-01", category: "Work", recurrence: rec({ endDate: "2026-02-01" }) },
    { id: "m2", title: "Gym", date: "2026-02-15", categories: ["Health"], recurrence: rec({ startDate: "2026-02-15", seriesId: "s-gym" }) },
  ];

  test("eventsInWindow keeps singles by date and masters by series intersection", () => {
    const feb = eventsInWindow(events, "2026-02-01", "2026-02-28");
    // s1 (Feb 10), m1 (series ends Feb 1 → still intersects), m2 (starts Feb 15, open-ended).
    expect(feb.map((e) => e.id).sort()).toEqual(["m1", "m2", "s1"]);
    // Open-ended bounds.
    expect(eventsInWindow(events, "2026-03-01").map((e) => e.id).sort()).toEqual(["m2", "s2"]);
    expect(eventsInWindow(events, undefined, "2026-01-31").map((e) => e.id)).toEqual(["m1"]);
    expect(eventsInWindow(events)).toHaveLength(4);
  });

  test("searchEvents matches title/description/location/category/categories, case-insensitively", () => {
    expect(searchEvents(events, "dentist").map((e) => e.id)).toEqual(["s1"]);
    expect(searchEvents(events, "sfo").map((e) => e.id)).toEqual(["s2"]);
    expect(searchEvents(events, "CLINIC").map((e) => e.id)).toEqual(["s1"]);
    expect(searchEvents(events, "work").map((e) => e.id)).toEqual(["m1"]);
    expect(searchEvents(events, "health").map((e) => e.id)).toEqual(["m2"]);
    expect(searchEvents(events, "nope")).toHaveLength(0);
    expect(searchEvents(events, "  ")).toHaveLength(0);
  });
});

describe("recurrenceFromRRule (gcal RRULE subset)", () => {
  test("weekly BYDAY parses and normalizes startDate to the first valid weekday", () => {
    // 2026-01-01 is a Thursday; BYDAY=MO → first occurrence is Monday 2026-01-05.
    const r = recurrenceFromRRule("FREQ=WEEKLY;BYDAY=MO", "2026-01-01");
    expect(r.type).toBe("weekly");
    expect(r.daysOfWeek).toEqual([1]);
    expect(r.startDate).toBe("2026-01-05");
    expect(r.seriesId).toBeTruthy();
  });

  test("RRULE: prefix optional, lowercase tolerated, UNTIL → endDate, INTERVAL=2 → biweekly", () => {
    const r = recurrenceFromRRule("rrule:freq=weekly;interval=2;byday=tu,th;until=20260301", "2026-01-06");
    expect(r.type).toBe("biweekly");
    expect(r.daysOfWeek).toEqual([2, 4]);
    expect(r.endDate).toBe("2026-03-01");
    expect(recurrenceFromRRule("FREQ=DAILY", "2026-01-01").type).toBe("daily");
    expect(recurrenceFromRRule("FREQ=MONTHLY", "2026-01-15").type).toBe("monthly");
  });

  test("unsupported rules throw (YEARLY, COUNT, arbitrary INTERVAL)", () => {
    expect(() => recurrenceFromRRule("FREQ=YEARLY", "2026-01-01")).toThrow();
    expect(() => recurrenceFromRRule("FREQ=DAILY;COUNT=10", "2026-01-01")).toThrow();
    expect(() => recurrenceFromRRule("FREQ=DAILY;INTERVAL=3", "2026-01-01")).toThrow();
  });

  test("expandRecurrence agrees with a parsed weekly rule", () => {
    const r = recurrenceFromRRule("FREQ=WEEKLY;BYDAY=MO,WE", "2026-01-05");
    const events: CalendarEvent[] = [{ id: "w1", title: "W", date: r.startDate, recurrence: r }];
    const week = eventsForRange(events, "2026-01-05", "2026-01-11");
    expect(week.map((e) => e.date)).toEqual(["2026-01-05", "2026-01-07"]);
  });
});

describe("category mutations", () => {
  const fm = () => ({
    type: "base",
    view: "calendar",
    keep: "me",
    categories: [
      { name: "Work", color: "#f00" },
      { name: "Home", color: "teal" },
    ],
  });
  const evts = (): CalendarEvent[] => [
    { id: "a", title: "A", date: "2026-01-01", category: "Work" },
    { id: "b", title: "B", date: "2026-01-02", categories: ["Work", "Home"] },
    { id: "c", title: "C", date: "2026-01-03", category: "Home", localUpdated: "2020-01-01T00:00:00.000Z" },
  ];

  test("addCategory appends; duplicate name throws; other frontmatter preserved", () => {
    const next = addCategory(fm(), { name: "Gym", color: "#0f0" });
    expect(categoriesOf(next).map((c) => c.name)).toEqual(["Work", "Home", "Gym"]);
    expect(next.keep).toBe("me");
    expect(() => addCategory(next, { name: "Work", color: "#fff" })).toThrow();
    expect(() => addCategory(next, { name: "  ", color: "#fff" })).toThrow();
  });

  test("updateCategory recolors without touching events", () => {
    const { frontmatter, events } = updateCategory(fm(), evts(), "Work", { color: "#00f" });
    expect(categoriesOf(frontmatter)).toContainEqual({ name: "Work", color: "#00f" });
    expect(events).toEqual(evts()); // untouched — no rename
  });

  test("updateCategory rename cascades into category + categories and stamps localUpdated only on changed events", () => {
    const { frontmatter, events } = updateCategory(fm(), evts(), "Work", { name: "Job" });
    expect(categoriesOf(frontmatter).map((c) => c.name)).toEqual(["Job", "Home"]);
    const a = events.find((e) => e.id === "a")!;
    const b = events.find((e) => e.id === "b")!;
    const c = events.find((e) => e.id === "c")!;
    expect(a.category).toBe("Job");
    expect(a.localUpdated).toBeTruthy();
    expect(b.categories).toEqual(["Job", "Home"]);
    expect(b.localUpdated).toBeTruthy();
    expect(c.category).toBe("Home"); // untouched
    expect(c.localUpdated).toBe("2020-01-01T00:00:00.000Z");
  });

  test("updateCategory throws on unknown name or rename collision", () => {
    expect(() => updateCategory(fm(), evts(), "Nope", { color: "#000" })).toThrow();
    expect(() => updateCategory(fm(), evts(), "Work", { name: "Home" })).toThrow();
  });

  test("removeCategory clears the category from events (and dedups categories)", () => {
    const { frontmatter, events } = removeCategory(fm(), evts(), "Work");
    expect(categoriesOf(frontmatter).map((c) => c.name)).toEqual(["Home"]);
    expect(events.find((e) => e.id === "a")!.category).toBeUndefined();
    expect(events.find((e) => e.id === "b")!.categories).toEqual(["Home"]);
  });

  test("removeCategory --reassign rewrites references; invalid targets throw", () => {
    const { events } = removeCategory(fm(), evts(), "Work", "Home");
    expect(events.find((e) => e.id === "a")!.category).toBe("Home");
    expect(events.find((e) => e.id === "b")!.categories).toEqual(["Home"]); // deduped
    expect(() => removeCategory(fm(), evts(), "Work", "Nope")).toThrow();
    expect(() => removeCategory(fm(), evts(), "Work", "Work")).toThrow();
    expect(() => removeCategory(fm(), evts(), "Nope")).toThrow();
  });

  test("category rename survives a serialize/parse round-trip", () => {
    const { frontmatter, events } = updateCategory(fm(), evts(), "Work", { name: "Job" });
    const text = serializeCalendarFile(frontmatter, events);
    const again = parseCalendarFile(text);
    expect(categoriesOf(again.frontmatter).map((c) => c.name)).toEqual(["Job", "Home"]);
    expect(again.events.find((e) => e.id === "b")!.categories).toEqual(["Job", "Home"]);
    expect(again.frontmatter.keep).toBe("me");
  });
});
