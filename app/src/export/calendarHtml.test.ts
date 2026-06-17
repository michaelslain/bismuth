// app/src/export/calendarHtml.test.ts
import { test, expect, describe } from "bun:test";
import { calendarHtml } from "./calendarHtml";
import { defaultExportOptions } from "./options";
import { paletteFor } from "./exportTheme";
import type { BaseConfig, Row, ViewConfig, ViewResult } from "../../../core/src/bases/types";
import type { ExportOptions } from "./types";

const cfg: BaseConfig = { views: [] };
const DARK = paletteFor("dark");

function row(note: Record<string, unknown>): Row {
  return { file: { name: "", basename: "", path: "", folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] }, note, formula: {} };
}

function vr(rows: Row[], view: Partial<ViewConfig> = {}): ViewResult {
  return { view: { type: "calendar", name: "Cal", ...view }, columns: [], groups: [{ key: "", rows }], summaries: {} };
}

function opts(o: Partial<ExportOptions>): ExportOptions {
  return { ...defaultExportOptions(), mode: "visual", ...o };
}

describe("calendarHtml — month grid", () => {
  // June 2026 starts on a Monday → with weekStartsOnMonday a clean 5-row (35-cell) grid.
  const june = opts({ calSpan: "month", calStart: "2026-06-15", weekStartsOnMonday: true });

  test("emits a 7-wide month grid for the anchor month", () => {
    const { body } = calendarHtml(cfg, vr([]), june, DARK);
    const cells = body.match(/class="exp-cal-cell["\s]/g) ?? [];   // not exp-cal-cellevents
    expect(cells.length).toBe(35);
    expect(body).toContain("June 2026");
    expect(body).toContain("exp-cal-month");
  });

  test("places a single-day event in its day cell", () => {
    const { body } = calendarHtml(cfg, vr([row({ title: "Dentist", date: "2026-06-10" })]), june, DARK);
    expect(body).toContain("Dentist");
    expect(body).toContain("exp-cal-chip");
  });

  test("expands a daily recurrence across the whole month", () => {
    const r = row({
      title: "Standup",
      date: "2026-06-01",
      recurrence: JSON.stringify({ type: "daily", startDate: "2026-06-01", endDate: "2026-06-30", seriesId: "s1" }),
    });
    const { body } = calendarHtml(cfg, vr([r]), june, DARK);
    const hits = body.match(/Standup/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(30); // one chip per in-month day
  });

  test("honors a custom dateField on the view", () => {
    const { body } = calendarHtml(cfg, vr([row({ title: "Due thing", due: "2026-06-12" })], { dateField: "due" }), june, DARK);
    expect(body).toContain("Due thing");
  });

  test("empty calStart resolves to the current month", () => {
    const { body } = calendarHtml(cfg, vr([]), opts({ calSpan: "month", calStart: "" }), DARK);
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    expect(body).toContain(`${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`);
  });
});

describe("calendarHtml — time grid (week/3day/day)", () => {
  test("week span emits 7 day columns", () => {
    const { body } = calendarHtml(cfg, vr([]), opts({ calSpan: "week", calStart: "2026-06-15" }), DARK);
    const heads = body.match(/class="exp-cal-colhead/g) ?? [];
    expect(heads.length).toBe(7);
    expect(body).toContain("exp-cal-time-grid");
  });

  test("3day span emits 3 columns starting at the anchor", () => {
    const { body } = calendarHtml(cfg, vr([]), opts({ calSpan: "3day", calStart: "2026-06-15" }), DARK);
    expect((body.match(/class="exp-cal-colhead/g) ?? []).length).toBe(3);
  });

  test("a timed event is absolutely positioned; an all-day event goes to the all-day band", () => {
    const rows = [
      row({ title: "Meeting", date: "2026-06-15", startTime: "09:00", endTime: "10:00" }),
      row({ title: "Holiday", date: "2026-06-15" }),
    ];
    const { body } = calendarHtml(cfg, vr(rows), opts({ calSpan: "day", calStart: "2026-06-15" }), DARK);
    expect(body).toContain("exp-cal-block");   // timed block
    expect(body).toContain("Meeting");
    expect(body).toContain("exp-cal-allday");  // all-day band rendered
    expect(body).toContain("Holiday");
  });
});

describe("calendarHtml — output shape", () => {
  test("returns a body wrapped in .exp-cal plus scoped css", () => {
    const { body, css } = calendarHtml(cfg, vr([]), opts({ calStart: "2026-06-15" }), DARK);
    expect(body.startsWith('<div class="exp-cal">')).toBe(true);
    expect(css).toContain(".exp-cal-cell");
    expect(css).toContain("max-width"); // overrides the 760px prose column
  });

  test("escapes event titles", () => {
    const { body } = calendarHtml(cfg, vr([row({ title: "<script>x</script>", date: "2026-06-10" })]), opts({ calStart: "2026-06-15" }), DARK);
    expect(body).not.toContain("<script>x");
    expect(body).toContain("&lt;script&gt;");
  });

  test("resolves a category NAME to its frontmatter color", () => {
    // category "Work" -> color token "blue" -> concrete hex #5C7BEE (no var()/color-mix).
    const rows = [row({ title: "Standup", date: "2026-06-16", category: "Work" })];
    const { body } = calendarHtml(cfg, vr(rows), opts({ calStart: "2026-06-15" }), DARK, [{ name: "Work", color: "blue" }]);
    expect(body).toContain("#5C7BEE");
  });

  test("an unmapped category falls back to the accent (never a raw category name as a color)", () => {
    const rows = [row({ title: "Misc", date: "2026-06-16", category: "Nonexistent" })];
    const { body } = calendarHtml(cfg, vr(rows), opts({ calStart: "2026-06-15" }), DARK, []);
    expect(body).not.toContain("Nonexistent;");   // the name is never emitted as a CSS color
    expect(body).toContain("#3F6BF0");             // accent fallback
  });
});
