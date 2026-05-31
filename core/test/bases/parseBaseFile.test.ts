import { test, expect } from "bun:test";
import { parseBaseFile } from "../../src/bases/parse";

const FILE = [
  "---",
  "type: base",
  "view: calendar",
  "schema: { title: text, date: date }",
  "---",
  "",
  "| title | date |",
  "| --- | --- |",
  "| Dentist | 2026-06-03 |",
].join("\n");

test("parseBaseFile splits frontmatter config from table rows", () => {
  const { config, rows } = parseBaseFile(FILE, { name: "Calendar", path: "Calendar.md" });
  expect(config.views[0].type).toBe("calendar");
  expect(config.schema).toEqual({ title: "text", date: "date" });
  expect(rows.length).toBe(1);
  expect(rows[0].note.title).toBe("Dentist");
});

test("parseBaseFile tolerates a file with no table (notes-source base)", () => {
  const f = [
    "---",
    "type: base",
    "source: { kind: notes, where: '#book' }",
    "views:",
    "  - type: table",
    "    name: Books",
    "---",
  ].join("\n");
  const { config, rows } = parseBaseFile(f, { name: "Books", path: "Books.md" });
  expect(rows).toEqual([]);
  expect(config.source).toEqual({ kind: "notes", where: "#book" });
  expect(config.views[0].type).toBe("table");
  expect(config.views[0].name).toBe("Books");
});

test("parseBaseFile honors explicit views: array with calendar type", () => {
  const f = ["---", "type: base", "views:", "  - type: calendar", "    name: Cal", "---"].join("\n");
  const { config } = parseBaseFile(f, { name: "Cal", path: "Cal.md" });
  expect(config.views[0].type).toBe("calendar");
});

test("parseBaseFile handles a file with no frontmatter", () => {
  const { config, rows } = parseBaseFile("| a |\n| --- |\n| 1 |", { name: "N", path: "N.md" });
  expect(rows[0].note.a).toBe(1);
  expect(config.views.length).toBeGreaterThanOrEqual(1);
});
