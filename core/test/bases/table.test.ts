import { test, expect } from "bun:test";
import { parseMarkdownTable, rowsToMarkdownTable } from "../../src/bases/table";

test("parseMarkdownTable reads headers and rows into Row.note", () => {
  const md = [
    "| title | date | done |",
    "| --- | --- | --- |",
    "| Dentist | 2026-06-03 | true |",
    "| Lunch | 2026-06-05 | false |",
  ].join("\n");
  const rows = parseMarkdownTable(md, { name: "Calendar", path: "Calendar.md" });
  expect(rows.length).toBe(2);
  expect(rows[0].note.title).toBe("Dentist");
  expect(rows[0].note.date).toBe("2026-06-03");
  expect(rows[0].note.done).toBe(true); // "true"/"false" coerced to boolean
  expect(rows[0].file.name).toBe("Calendar");
  expect(rows[0].file.path).toBe("Calendar.md");
});

test("rowsToMarkdownTable round-trips", () => {
  const md = ["| a | b |", "| --- | --- |", "| 1 | x |"].join("\n");
  const rows = parseMarkdownTable(md, { name: "T", path: "T.md" });
  const out = rowsToMarkdownTable(["a", "b"], rows);
  const rows2 = parseMarkdownTable(out, { name: "T", path: "T.md" });
  expect(rows2[0].note.a).toBe(1); // numeric coercion
  expect(rows2[0].note.b).toBe("x");
});

test("parseMarkdownTable returns [] when no table present", () => {
  expect(parseMarkdownTable("just prose, no table", { name: "N", path: "N.md" })).toEqual([]);
});

test("parseMarkdownTable skips a table after leading prose and stops at blank line", () => {
  const md = [
    "Some intro text.",
    "",
    "| x |",
    "| --- |",
    "| 1 |",
    "",
    "trailing prose | with a pipe",
  ].join("\n");
  const rows = parseMarkdownTable(md, { name: "N", path: "N.md" });
  expect(rows.length).toBe(1);
  expect(rows[0].note.x).toBe(1);
});

test("rowsToMarkdownTable serializes arrays as comma-joined and blanks for missing", () => {
  const rows = parseMarkdownTable(["| a | b |", "| --- | --- |", "| 1 | x |"].join("\n"), { name: "T", path: "T.md" });
  rows[0].note.b = ["one", "two"];
  delete rows[0].note.a;
  const out = rowsToMarkdownTable(["a", "b"], rows);
  expect(out).toContain("| one, two |");
  expect(out.split("\n")[2]).toBe("|  | one, two |");
});
