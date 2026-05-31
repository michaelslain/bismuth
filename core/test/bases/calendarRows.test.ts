import { test, expect } from "bun:test";
import { occurrencesInRange } from "../../src/bases/calendarRows";
import type { Row } from "../../src/bases/types";

function row(note: Record<string, unknown>): Row {
  return { file: { name: "", basename: "", path: "", folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] }, note, formula: {} };
}
const opts = { dateField: "date", recurrenceField: "recurrence" };

test("non-recurring rows appear once when their date is in range", () => {
  const rows = [row({ date: "2026-06-03" }), row({ date: "2026-07-01" })];
  const occ = occurrencesInRange(rows, opts, "2026-06-01", "2026-06-30");
  expect(occ).toEqual([{ index: 0, date: "2026-06-03" }]);
});

test("a recurrence column (JSON string) expands to multiple occurrences", () => {
  const rec = JSON.stringify({ type: "weekly", daysOfWeek: [1], startDate: "2026-06-01", seriesId: "s" });
  const rows = [row({ date: "2026-06-01", recurrence: rec })];
  const occ = occurrencesInRange(rows, opts, "2026-06-01", "2026-06-30");
  expect(occ.map((o) => o.date)).toEqual(["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29"]);
  expect(occ.every((o) => o.index === 0)).toBe(true);
});

test("malformed recurrence falls back to the plain date", () => {
  const rows = [row({ date: "2026-06-03", recurrence: "not json" })];
  const occ = occurrencesInRange(rows, opts, "2026-06-01", "2026-06-30");
  expect(occ).toEqual([{ index: 0, date: "2026-06-03" }]);
});

test("rows without a date are skipped", () => {
  const rows = [row({ title: "no date" }), row({ date: "2026-06-10" })];
  const occ = occurrencesInRange(rows, opts, "2026-06-01", "2026-06-30");
  expect(occ).toEqual([{ index: 1, date: "2026-06-10" }]);
});
