import { describe, expect, test } from "bun:test";
import {
  parseCalendarFile,
  serializeCalendarFile,
  categoriesOf,
  eventsForDay,
  eventsForRange,
  detectOverlaps,
  addEvent,
  moveEvent,
  deleteEvent,
  overrideOccurrence,
  deleteOccurrence,
  findEvent,
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
