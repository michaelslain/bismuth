import { test, expect } from "bun:test";
import { parseCalendarFile, serializeCalendarFile, categoriesOf } from "./calendarSerialize";

const FILE = [
  "---",
  "type: base",
  "view: calendar",
  "schema: { title: text, date: date }",
  "categories:",
  "  - name: Work",
  '    color: "#b00020"',
  "---",
  "",
  "| id | title | date | startTime | endTime | location | link | description | category | recurrence |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| a1 | Standup | 2026-05-30 | 09:00 |  |  |  |  | Work |  |",
].join("\n");

test("parse reads frontmatter (incl. schema + categories) and events", () => {
  const { frontmatter, events } = parseCalendarFile(FILE);
  expect(frontmatter.type).toBe("base");
  expect(frontmatter.schema).toEqual({ title: "text", date: "date" });
  expect(categoriesOf(frontmatter)).toEqual([{ name: "Work", color: "#b00020" }]);
  expect(events.length).toBe(1);
  expect(events[0].title).toBe("Standup");
  expect(events[0].startTime).toBe("09:00");
  expect(events[0].category).toBe("Work");
});

test("serialize preserves schema (not clobbered) and writes categories as a YAML list", () => {
  const { frontmatter, events } = parseCalendarFile(FILE);
  const out = serializeCalendarFile(frontmatter, events);
  expect(out).toContain("schema:"); // <-- the latent data-loss bug this fixes
  expect(out).toContain("- name: Work");
  expect(out).not.toContain('[{"name"'); // not JSON-in-YAML anymore
  // round-trips
  const round = parseCalendarFile(out);
  expect(round.frontmatter.schema).toEqual({ title: "text", date: "date" });
  expect(round.events[0].title).toBe("Standup");
  expect(categoriesOf(round.frontmatter)).toEqual([{ name: "Work", color: "#b00020" }]);
});

test("editing categories keeps every other frontmatter key", () => {
  const { frontmatter, events } = parseCalendarFile(FILE);
  frontmatter.categories = [
    { name: "Work", color: "#000000" },
    { name: "Personal", color: "#5b7cfa" },
  ];
  const out = serializeCalendarFile(frontmatter, events);
  expect(out).toContain("- name: Personal");
  expect(out).toContain("schema:");
  expect(out).toContain("view: calendar");
  expect(categoriesOf(parseCalendarFile(out).frontmatter).length).toBe(2);
});

test("recurrence round-trips through a JSON cell", () => {
  const { frontmatter, events } = parseCalendarFile(FILE);
  events[0].recurrence = { type: "weekly", daysOfWeek: [1], startDate: "2026-05-30", seriesId: "s1" };
  const round = parseCalendarFile(serializeCalendarFile(frontmatter, events));
  expect(round.events[0].recurrence?.type).toBe("weekly");
  expect(round.events[0].recurrence?.daysOfWeek).toEqual([1]);
});
